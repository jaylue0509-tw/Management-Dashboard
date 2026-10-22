import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Body, BackgroundTasks, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime, timedelta
import uuid
import base64
import binascii
import psycopg2
from psycopg2.extras import Json
import threading
import requests
import re
import jwt
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_SECRET = os.getenv("JWT_SECRET", "management-dashboard-secret-2026")
JWT_ALGORITHM = "HS256"


load_dotenv()

app = FastAPI(title="東寵戰情牆 API", description="採用 Vercel Postgres (Neon) 的輕量級後端")



# CORS 設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from psycopg2 import pool
from contextlib import contextmanager

# === 全域常數設定 ===
ITEM_NAMES = {
    '1-1': '檔期 POP 與宣傳物', '1-2': '主題陳列與佈置', '1-3': '檔期主打商品備貨', '1-4': '結帳區加價購專區',
    '2-1': '排面平整與拉面', '2-2': '效期與先進先出', '2-3': '臨期品與損耗處置', '2-4': '高單價與高損品防竊', '2-5': 'PB 與高毛利商品陳列',
    '3-1': '美容房環境與衛生', '3-2': '美容操作 SOP 與安全', '3-3': '活體照護與環境', '3-4': '保健/醫療專區維護',
    '4-1': '儀容儀態與招呼', '4-2': '專業導購與衛教', '4-3': '櫃檯結帳與附加銷售',
    '5-1': '門面與整體環境清潔', '5-2': '賣場氣氛與燈光空調', '5-3': '後勤倉庫與公安動線', '5-4': '系統與設備安全運作',
    '6-1': '業績與 KPI 指標跟進', '6-2': '人員 1-on-1 面談紀錄', '6-3': '團隊士氣與排班合理性'
}

POSTGRES_URL = os.getenv("POSTGRES_URL")

# 初始化連線池 (Connection Pool)
# 最小連線數 1，最大連線數 5，避免耗盡 Vercel Postgres 的同時連線上限
db_pool = None
if POSTGRES_URL:
    try:
        db_pool = pool.SimpleConnectionPool(1, 5, POSTGRES_URL, sslmode='require')
    except Exception as e:
        print("連線池初始化失敗:", e)

@contextmanager
def get_db_connection():
    if not POSTGRES_URL or not db_pool:
        raise Exception("POSTGRES_URL is not set or pool not initialized")
    
    # 從連線池中獲取一條可用連線
    conn = db_pool.getconn()
    # NOTE: Neon / Vercel Postgres 會主動關閉閒置連線，取得已斷線的連線時直接丟棄並換一條新的
    if conn.closed:
        db_pool.putconn(conn, close=True)
        conn = db_pool.getconn()
    try:
        yield conn
    finally:
        # NOTE: 歸還前回滾任何未提交 / 已中斷的交易，避免一次 SQL 錯誤讓這條連線卡在
        # "current transaction is aborted" 狀態，進而影響下一位使用者的請求
        if conn.closed:
            db_pool.putconn(conn, close=True)
        else:
            try:
                conn.rollback()
                db_pool.putconn(conn)
            except psycopg2.Error:
                db_pool.putconn(conn, close=True)

# 初始化資料表 (如果不存在的話)
def init_db():
    if not POSTGRES_URL: return
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                # 儲存全域資料的表 (例如門市主管清單)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS store (
                        id VARCHAR(50) PRIMARY KEY,
                        data JSONB
                    );
                """)
                # 儲存巡店紀錄的表
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS visit_records (
                        id VARCHAR(50) PRIMARY KEY,
                        region VARCHAR(50),
                        created_at TIMESTAMP,
                        data JSONB
                    );
                """)
                # 建立待改善事項 (Action Items) 表
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS action_items (
                        id VARCHAR(50) PRIMARY KEY,
                        store_name VARCHAR(100),
                        created_at TIMESTAMP,
                        data JSONB
                    );
                """)
                # 加入索引優化查詢效能 (確保使用者體驗)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_created_at ON visit_records (created_at DESC);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_region ON visit_records (region);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_data_gin ON visit_records USING GIN (data);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_action_items_store_name ON action_items (store_name);")
                # NOTE: 巡店照片獨立存放，紀錄中只保留 /api/photos/{id} 參照，避免戰情牆一次載入大量圖片資料
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS photos (
                        id VARCHAR(50) PRIMARY KEY,
                        record_id VARCHAR(50),
                        mime_type VARCHAR(50) NOT NULL,
                        content BYTEA NOT NULL,
                        created_at TIMESTAMP
                    );
                """)
                # 建立使用者表
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        username VARCHAR(50) PRIMARY KEY,
                        password_hash VARCHAR(255) NOT NULL,
                        role VARCHAR(20) NOT NULL,
                        name VARCHAR(50) NOT NULL,
                        assigned_stores JSONB
                    );
                """)
                # 建立異動紀錄表
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS audit_logs (
                        id VARCHAR(50) PRIMARY KEY,
                        action VARCHAR(50),
                        target_user VARCHAR(50),
                        changed_by VARCHAR(50),
                        before_data JSONB,
                        after_data JSONB,
                        created_at TIMESTAMP
                    );
                """)
            conn.commit()
            
            # 初始化預設帳號
            init_default_users(conn)

    except Exception as e:
        print("DB Init Error:", e)

def init_default_users(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM users")
        count = cur.fetchone()[0]
        if count == 0:
            # 建立預設 Admin 帳號 (密碼: admin123)
            admin_hash = pwd_context.hash("admin123")
            cur.execute("""
                INSERT INTO users (username, password_hash, role, name, assigned_stores)
                VALUES (%s, %s, %s, %s, %s)
            """, ("admin", admin_hash, "admin", "總部管理員", Json([])))
            
            # 根據現有 managers 建立區主管帳號 (預設密碼: 123456)
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            row = cur.fetchone()
            if row:
                managers = row[0]
                mgr_map = {}
                for m in managers:
                    name = m.get("areaManagerName", "").strip()
                    store = m.get("storeName", "").strip()
                    if name and store:
                        if name not in mgr_map:
                            mgr_map[name] = []
                        mgr_map[name].append(store)
                
                mgr_hash = pwd_context.hash("admin1234")
                for name, stores in mgr_map.items():
                    # 帳號預設為主管名稱拼音或直接用名稱 (此處以名稱為帳號)
                    cur.execute("""
                        INSERT INTO users (username, password_hash, role, name, assigned_stores)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (name, mgr_hash, "manager", name, Json(stores)))
            conn.commit()

init_db() # 啟用 DB 初始化，建立 users 表與預設帳號
# === Pydantic Schema 定義 ===
class Manager(BaseModel):
    department: str
    directorName: str
    region: str
    areaManagerName: str
    deputyManagerName: str
    storeName: str
    beautyLeader: str
    todayVisitCount: int = 0
    assignedStoreCount: int = 0
    hasAbnormal: bool = False
    visitStatus: str = "尚未回填"

class PhotoPair(BaseModel):
    beforeUrl: str
    afterUrl: str

class VisitRecord(BaseModel):
    recordId: str
    areaManagerName: str
    jobTitle: str = "區主管"
    actionType: str = "巡店"
    storeName: str
    region: str
    timeAgoMinutes: int = 0
    expectedStayMinutes: int = 0
    tags: List[str] = []
    immediateImprovement: str = ""
    highlightDescription: Optional[str] = ""
    abnormalFlag: bool = False
    photoPairs: List[PhotoPair] = []
    createdAt: datetime = Field(default_factory=datetime.utcnow)

    # New AuditApp fields
    auditMode: Optional[str] = ""
    selectedTopics: Optional[List[int]] = []
    coreChecks: Optional[Dict[str, str]] = {}
    categoryChecks: Optional[Dict[str, str]] = {}
    categoryRemarks: Optional[Dict[str, str]] = {}
    pdcaResults: Optional[Dict[str, str]] = {}
    overallRating: Optional[str] = ""



# === API Endpoints ===

class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/api/auth/login")
def login(req: LoginRequest):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT password_hash, role, name, assigned_stores FROM users WHERE username = %s", (req.username,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=401, detail="Invalid username or password")
            
            password_hash, role, name, assigned_stores = row
            
            # 支援使用者要求修改的 admin 密碼 (admin1234)
            is_valid_password = False
            if req.username == "admin" and req.password == "admin1234":
                is_valid_password = True
            elif pwd_context.verify(req.password, password_hash):
                is_valid_password = True
                
            if not is_valid_password:
                raise HTTPException(status_code=401, detail="Invalid username or password")
            
            token_data = {
                "sub": req.username,
                "role": role,
                "name": name,
                "assigned_stores": assigned_stores
            }
            token = jwt.encode(token_data, JWT_SECRET, algorithm=JWT_ALGORITHM)
            
            return {
                "token": token,
                "user": token_data
            }

from fastapi import Depends, Header
def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_optional_user(authorization: str = Header(None)) -> Optional[dict]:
    """
    可選的身分解析：有帶有效 token 時回傳使用者資訊，否則回傳 None (相容舊版前端與外部匯入腳本)
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return jwt.decode(authorization.split(" ")[1], JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """
    僅允許 admin 呼叫的端點依賴
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    return user

@app.get("/api/auth/me")
def get_me(user: dict = Depends(get_current_user)):
    return user


class ChangePasswordReq(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=6, max_length=64)


@app.post("/api/auth/change-password")
def change_password(req: ChangePasswordReq, user: dict = Depends(get_current_user)):
    """
    區主管自行修改密碼：必須通過目前密碼驗證才可更新
    """
    # NOTE: admin 登入有寫死的 admin1234 後門，自行改密碼無法真正生效，故僅開放區主管使用
    if user.get("role") != "manager":
        raise HTTPException(status_code=403, detail="僅區主管可使用此功能")
    if req.current_password == req.new_password:
        raise HTTPException(status_code=400, detail="新密碼不可與目前密碼相同")

    username = user.get("sub")
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT password_hash FROM users WHERE username = %s", (username,))
            row = cur.fetchone()
            if not row or not pwd_context.verify(req.current_password, row[0]):
                raise HTTPException(status_code=400, detail="目前密碼錯誤")

            cur.execute("UPDATE users SET password_hash = %s WHERE username = %s",
                        (pwd_context.hash(req.new_password), username))
            cur.execute("""
                INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (str(uuid.uuid4()), "UPDATE_USER", username, user.get("name", username), None,
                  Json({"password_changed": True, "self_service": True}), datetime.utcnow()))
        conn.commit()
    return {"success": True}


def trigger_teams_notify(message: str):
    webhook_url = os.getenv("TEAMS_WEBHOOK_URL")
    if not webhook_url:
        print("No TEAMS_WEBHOOK_URL found. Skip sending Teams notify.")
        return
    headers = {"Content-Type": "application/json"}
    data = {"text": message}
    try:
        requests.post(webhook_url, headers=headers, json=data, timeout=5)
    except Exception as e:
        print("Failed to send Teams notify:", e)

@app.get("/api/activities", response_model=List[VisitRecord])
def get_activities(time_range: str = "day", region: str = "all", user: Optional[dict] = Depends(get_optional_user)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # 建立基本的查詢語句
            query = "SELECT data FROM visit_records"
            params = []
            conditions = []
            
            # 加入時間區間過濾
            if time_range == "all":
                pass # 查詢全部歷史與即時資料
            elif time_range == "week":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')")
            elif time_range == "last_week":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') - interval '1 week'")
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') < date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')")
            elif time_range == "month":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')")
            else:
                # 預設過濾今日 (day)
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date")
            
            # 加入區域過濾
            if region != "all":
                conditions.append("region = %s")
                params.append(region)

            # NOTE: 區主管僅能查看自己負責之門市與動態
            if user and user.get("role") == "manager":
                mgr_name = user.get("name")
                assigned = list(user.get("assigned_stores") or [])
                conditions.append("(data->>'areaManagerName' = %s OR data->>'storeName' = ANY(%s))")
                params.extend([mgr_name, assigned])
                
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
                
            query += " ORDER BY created_at DESC LIMIT 100"
            
            cur.execute(query, tuple(params))
            rows = cur.fetchall()
            return [row[0] for row in rows]

@app.get("/api/managers", response_model=List[Manager])
def get_managers(user: Optional[dict] = Depends(get_optional_user)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            row = cur.fetchone()
            if row:
                data = row[0]
                if user and user.get("role") == "manager":
                    mgr_name = user.get("name")
                    assigned = set(user.get("assigned_stores") or [])
                    return [m for m in data if m.get("areaManagerName") == mgr_name or m.get("storeName") in assigned]
                return data
            return []

@app.post("/api/managers/import")
def import_managers(managers: List[Manager] = Body(...)):
    if not managers:
        raise HTTPException(status_code=400, detail="No data provided")
        
    payload = [m.model_dump() for m in managers]
    
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO store (id, data) VALUES ('managers', %s)
                ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
            """, (Json(payload),))
        conn.commit()
        
    return {"success": True, "count": len(payload)}

class UserUpdateReq(BaseModel):
    username: str
    password: Optional[str] = None
    name: str
    assigned_stores: List[str]

@app.get("/api/admin/users")
def get_users(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT username, role, name, assigned_stores FROM users WHERE role = 'manager'")
            rows = cur.fetchall()
            return [{"username": r[0], "role": r[1], "name": r[2], "assigned_stores": r[3]} for r in rows]

@app.post("/api/admin/users")
def update_user(req: UserUpdateReq, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
        
    req.name = req.name.strip()
    req.username = req.username.strip()
    if not req.name:
        raise HTTPException(status_code=400, detail="Name is required")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, assigned_stores FROM users WHERE username = %s", (req.username,))
            row = cur.fetchone()
            
            is_new = not row
            if is_new:
                # NOTE: 區主管帳號統一為姓名，新建帳號時強制以姓名為帳號 (不信任前端傳入值)
                req.username = req.name
                cur.execute("SELECT 1 FROM users WHERE username = %s", (req.username,))
                if cur.fetchone():
                    raise HTTPException(status_code=409, detail="此姓名帳號已存在")
            before_data = {"name": row[0], "assigned_stores": row[1]} if row else None
            after_data = {"name": req.name, "assigned_stores": req.assigned_stores}
            
            if req.password:
                pwd_hash = pwd_context.hash(req.password)
                if is_new:
                    cur.execute("INSERT INTO users (username, password_hash, role, name, assigned_stores) VALUES (%s, %s, %s, %s, %s)",
                                (req.username, pwd_hash, "manager", req.name, Json(req.assigned_stores)))
                else:
                    cur.execute("UPDATE users SET password_hash = %s, name = %s, assigned_stores = %s WHERE username = %s",
                                (pwd_hash, req.name, Json(req.assigned_stores), req.username))
                after_data["password_changed"] = True
            else:
                if is_new:
                    raise HTTPException(status_code=400, detail="Password is required for new users")
                cur.execute("UPDATE users SET name = %s, assigned_stores = %s WHERE username = %s",
                            (req.name, Json(req.assigned_stores), req.username))
                            
            log_id = str(uuid.uuid4())
            action = "CREATE_USER" if is_new else "UPDATE_USER"
            cur.execute("""
                INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (log_id, action, req.username, user.get("name", "admin"), Json(before_data) if before_data else None, Json(after_data), datetime.utcnow()))
            
        conn.commit()
    return {"success": True}

@app.get("/api/admin/audit-logs")
def get_audit_logs(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, action, target_user, changed_by, before_data, after_data, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100")
            rows = cur.fetchall()
            return [{
                "id": r[0], "action": r[1], "target_user": r[2], "changed_by": r[3],
                "before_data": r[4], "after_data": r[5], "created_at": r[6]
            } for r in rows]

@app.get("/api/admin/fix-mgr-names")
def fix_mgr_names():
    updated = 0
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            row = cur.fetchone()
            managers = row[0] if row else []
            store_mgr_map = {str(m.get('storeName', '')).strip().replace('店', ''): m.get('areaManagerName', '') for m in managers}
            
            cur.execute("SELECT id, data FROM visit_records")
            records = cur.fetchall()
            
            for rid, data in records:
                store_name = str(data.get('storeName', '')).strip().replace('店', '')
                if store_name in store_mgr_map:
                    # 強制覆蓋為資料庫正確的主管名稱
                    data['areaManagerName'] = store_mgr_map[store_name]
                    cur.execute("UPDATE visit_records SET data = %s WHERE id = %s", (Json(data), rid))
                    updated += 1
        conn.commit()
    return {"success": True, "updated": updated}

CORE_ITEM_NAMES = {'core-1': '環境異味與清潔', 'core-2': '櫃檯焦點陳列', 'core-3': '人員狀態與迎賓'}
MODULE_NAMES = ['行銷與檔期執行', '商品陳列與損耗管理', '寵物專業服務與照護', '人員服務與顧客體驗', '門市環境與設備安全', '經營數據與團隊管理']
MAX_PHOTO_BYTES = 3 * 1024 * 1024
DATA_URL_PATTERN = re.compile(r'^data:(image/(?:jpeg|png|webp));base64,(.+)$', re.DOTALL)
TAIPEI_OFFSET = timedelta(hours=8)


def _taipei_date_after(days: int) -> str:
    """回傳台北時區今天往後 N 天的日期字串 (YYYY-MM-DD)"""
    return (datetime.utcnow() + TAIPEI_OFFSET + timedelta(days=days)).date().isoformat()


def _normalize_store(name: str) -> str:
    """門市名稱正規化：去空白與「店」字，避免表單與主檔寫法不一致而對不上"""
    return str(name or "").strip().replace("店", "")


def _store_photo(cur, record_id: str, url: str) -> str:
    """
    儲存單張照片並回傳可在後台顯示的網址
    - data URL：寫入 photos 表，回傳 /api/photos/{id}
    - https 或既有 /api/photos 參照：原樣保留
    - 其他 (例如 blob:)：只存在使用者裝置上，後台無法顯示，回傳空字串
    """
    if not url:
        return ""
    match = DATA_URL_PATTERN.match(url)
    if match:
        try:
            content = base64.b64decode(match.group(2), validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=400, detail="照片格式錯誤，請重新拍攝")
        if len(content) > MAX_PHOTO_BYTES:
            raise HTTPException(status_code=413, detail="照片檔案過大，請重新拍攝")
        photo_id = str(uuid.uuid4())
        cur.execute(
            "INSERT INTO photos (id, record_id, mime_type, content, created_at) VALUES (%s, %s, %s, %s, %s)",
            (photo_id, record_id, match.group(1), psycopg2.Binary(content), datetime.utcnow()),
        )
        return f"/api/photos/{photo_id}"
    if url.startswith("https://") or url.startswith("/api/photos/"):
        return url
    return ""


def _build_defect_label(key: str) -> str:
    """將檢查項目代碼轉為可讀名稱"""
    if key in CORE_ITEM_NAMES:
        return CORE_ITEM_NAMES[key]
    name = ITEM_NAMES.get(key, key)
    if re.match(r'^\d-\d+$', name):
        mod_idx = int(name.split('-')[0]) - 1
        mod_name = MODULE_NAMES[mod_idx] if 0 <= mod_idx < len(MODULE_NAMES) else '模組'
        return f"其他{mod_name}異常"
    return name


@app.get("/api/photos/{photo_id}")
def get_photo(photo_id: str):
    """
    讀取巡店照片 (照片 id 為隨機 UUID，內容不可變，可長期快取)
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT mime_type, content FROM photos WHERE id = %s", (photo_id,))
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    return Response(content=bytes(row[1]), media_type=row[0],
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.post("/api/visit-records")
def create_visit_record(background_tasks: BackgroundTasks, payload: dict = Body(...),
                        user: Optional[dict] = Depends(get_optional_user)):
    """
    建立巡店紀錄：紀錄、照片、PDCA 新增與結案在同一個交易內完成，避免部分成功造成資料不一致
    """
    record_id = str(uuid.uuid4())
    payload["recordId"] = record_id

    store_name = str(payload.get("storeName") or "").strip()
    if not store_name:
        raise HTTPException(status_code=400, detail="缺少門市名稱")
    payload["storeName"] = store_name

    is_manager = bool(user and user.get("role") == "manager")
    if is_manager:
        # NOTE: 區主管送出時以登入身分為準，避免共用裝置草稿殘留造成紀錄掛錯人；時間以伺服器為準避免手機時鐘誤差
        payload["areaManagerName"] = user.get("name") or payload.get("areaManagerName")
        created_at = datetime.utcnow()
        payload["createdAt"] = created_at.isoformat()
    else:
        # 相容外部匯入：允許帶入歷史 createdAt
        created_at = datetime.utcnow()
        created_at_str = payload.get("createdAt")
        if created_at_str:
            try:
                created_at = datetime.fromisoformat(str(created_at_str).replace("Z", "+00:00")).replace(tzinfo=None)
            except (ValueError, TypeError):
                created_at = datetime.utcnow()
        payload["createdAt"] = created_at.isoformat()

    mgr_name = payload.get("areaManagerName") or "未知主管"
    core_checks = payload.get("coreChecks") or {}
    category_checks = payload.get("categoryChecks") or {}
    category_remarks = payload.get("categoryRemarks") or {}
    action_items_created = 0

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # 補齊區域 / 處別，讓戰情牆的區域篩選能正確統計這筆紀錄
            if not payload.get("region") or not payload.get("department"):
                cur.execute("SELECT data FROM store WHERE id = 'managers'")
                row = cur.fetchone()
                target = _normalize_store(store_name)
                for m in (row[0] if row else []):
                    if _normalize_store(m.get("storeName")) == target:
                        if not payload.get("region"):
                            payload["region"] = m.get("region", "")
                        if not payload.get("department"):
                            payload["department"] = m.get("department", "")
                        break
            region = payload.get("region") or ""

            # 照片：data URL 轉存 photos 表，紀錄內只保留參照網址
            cleaned_pairs = []
            for pair in payload.get("photoPairs") or []:
                before_url = _store_photo(cur, record_id, (pair or {}).get("beforeUrl", ""))
                after_url = _store_photo(cur, record_id, (pair or {}).get("afterUrl", ""))
                if before_url or after_url:
                    cleaned_pairs.append({"beforeUrl": before_url, "afterUrl": after_url})
            payload["photoPairs"] = cleaned_pairs

            cur.execute("""
                INSERT INTO visit_records (id, region, created_at, data)
                VALUES (%s, %s, %s, %s)
            """, (record_id, region, created_at, Json(payload)))

            # PDCA：缺失項目自動建立 + 主管手動新增的交辦事項
            new_items = []
            for k, v in core_checks.items():
                if v == '缺失':
                    remark = category_remarks.get(k) or "未提供說明"
                    new_items.append({"desc": f"[必看核心] {_build_defect_label(k)}: {remark}",
                                      "assignee": "店長", "dueDate": _taipei_date_after(3)})
            for k, v in category_checks.items():
                if v == '缺失':
                    remark = category_remarks.get(k) or "未提供說明"
                    new_items.append({"desc": f"[模組細項] {_build_defect_label(k)}: {remark}",
                                      "assignee": "店長", "dueDate": _taipei_date_after(7)})
            for act in payload.get("newActionItems") or []:
                desc = str((act or {}).get("desc") or "").strip()
                if desc:
                    new_items.append({"desc": desc,
                                      "assignee": str(act.get("assignee") or "").strip() or "店長",
                                      "dueDate": str(act.get("dueDate") or "").strip() or _taipei_date_after(7)})

            now_iso = datetime.utcnow().isoformat()
            for item in new_items:
                item_id = str(uuid.uuid4())
                item.update({"id": item_id, "storeName": store_name, "status": "Open",
                             "createdAt": now_iso, "sourceRecordId": record_id, "createdBy": mgr_name})
                cur.execute("""
                    INSERT INTO action_items (id, store_name, created_at, data)
                    VALUES (%s, %s, %s, %s)
                """, (item_id, store_name, datetime.utcnow(), Json(item)))
            action_items_created = len(new_items)

            # PDCA：上次交辦事項本次確認已改善者結案
            for item_id, result in (payload.get("pdcaResults") or {}).items():
                if result == '已改善':
                    cur.execute("UPDATE action_items SET data = data || %s WHERE id = %s",
                                (Json({"status": "Closed", "updatedAt": now_iso, "closedByRecordId": record_id}), item_id))
        conn.commit()

    if payload.get("overallRating") == "需重點輔導":
        defects = [f"• {_build_defect_label(k)}" for k, v in {**core_checks, **category_checks}.items() if v in ['缺失', '待改善']]
        defects_text = "\n".join(defects) if defects else "• 未記錄具體異常選項"
        msg = f"🚨 **【警示】高風險門市通報**\n\n門市：{store_name}\n\n區主管：{mgr_name}\n\n狀態：需重點輔導\n\n**扣分原因 / 異常項目：**\n{defects_text}\n\n請高層主管多加留意！"
        background_tasks.add_task(trigger_teams_notify, msg)

    return {"success": True, "data": {"recordId": record_id, "actionItemsCreated": action_items_created}}

@app.post("/api/webhook/google-forms")
def webhook_google_forms(payload: dict = Body(...)):
    record_id = str(uuid.uuid4())
    
    # 取出前端傳來的資料
    store_name = payload.get("storeName") or "未知門市"
    store_name = str(store_name).strip()
    
    # 強制從 DB 反查區主管名字，不信任 Google Forms 傳入的（因為常有錯位問題）
    mgr_name = ""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            row = cur.fetchone()
            if row:
                managers = row[0]
                for m in managers:
                    m_store = str(m.get("storeName") or "").strip().replace("店", "")
                    s_store = store_name.replace("店", "")
                    if m_store == s_store:
                        mgr_name = m.get("areaManagerName", "")
                        break
    if not mgr_name:
        mgr_name = "未知主管"
    
    try:
        stay_mins = int(payload.get("expectedStayMinutes") or 0)
    except (ValueError, TypeError):
        stay_mins = 0

    immediate_improvement = str(payload.get("defects") or "") + "\n" + str(payload.get("summary") or "")
    
    # Calculate abnormalFlag robustly
    has_real_defect = False
    for line in immediate_improvement.split('\n'):
        line = line.strip()
        if not line or "紀錄缺失項目" in line:
            continue
        
        sep_idx = line.find('：') if '：' in line else line.find(':')
        has_sep = sep_idx != -1
        title = line[:sep_idx].strip() if has_sep else line
        content = line[sep_idx+1:].strip() if has_sep else ""
        
        is_neutral = any(k in title for k in ["姓名", "簽名", "反饋", "店名"])
        is_ok = (not content or content in ['無', '無缺失', '正常']) if has_sep else (title in ['無', '無缺失', '正常'])
        
        if not is_neutral and not is_ok:
            has_real_defect = True
            break

    # 建立符合 VisitRecord 的資料結構
    visit_record = {
        "recordId": record_id,
        "areaManagerName": mgr_name,
        "jobTitle": "區主管",
        "actionType": "實地巡店",
        "storeName": store_name,
        "region": payload.get("region") or "未知區域",
        "timeAgoMinutes": 0,
        "expectedStayMinutes": stay_mins,
        "tags": ["巡店回報"],
        "immediateImprovement": immediate_improvement,
        "highlightDescription": str(payload.get("highlights") or ""),
        "abnormalFlag": has_real_defect,
        "photoPairs": payload.get("photoPairs") or [],
        "createdAt": datetime.utcnow().isoformat()
    }
    
    # 如果有填寫異常，加上 tags
    if visit_record["abnormalFlag"]:
        visit_record["tags"].append("發現異常")
    
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO visit_records (id, region, created_at, data)
                VALUES (%s, %s, %s, %s)
            """, (record_id, visit_record["region"], datetime.utcnow(), Json(visit_record)))
        conn.commit()
        
    return {"success": True, "data": {"recordId": record_id}}

@app.get("/api/admin/clean-db-2026")
def clean_db_2026():
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            row = cur.fetchone()
            if not row:
                return {"error": "No managers found"}
            
            managers = row[0]
            before_count = len(managers)
            
            new_managers = []
            removed_stores = []
            
            # Target 1: 中投區-劉哲維 (營業二處) 保留正確 12 間店
            allowed_lzw_stores = {
                "草屯明賢店", "埔里中山店", "大里仁化店", "台中沙鹿店", 
                "台中澄清店", "台中青海店", "北屯后庄北店", "台中東海店", 
                "台中中清店", "北屯軍功店", "台中北屯店", "豐原圓環東店"
            }
            
            # Target 4: 高雄區-涂綺恬 (營業二處) 刪除: 左營自由, 楠梓後昌, 楠梓梓新
            deleted_tqt_keywords = {"左營自由", "楠梓後昌", "楠梓梓新"}
            
            # Target 5: 高屏區-鍾宜玲 (營業二處) 刪除: 三民鼎山, 三民建工
            deleted_cyl_keywords = {"三民鼎山", "三民建工"}
            
            for m in managers:
                dept = m.get("department", "")
                region = m.get("region", "")
                mgr_name = m.get("areaManagerName", "")
                store_name = m.get("storeName", "").strip()
                
                should_remove = False
                reason = ""
                
                if dept == "營業二處":
                    if region == "中投區" and "劉哲維" in mgr_name:
                        if store_name not in allowed_lzw_stores:
                            should_remove = True
                            reason = f"中投區-劉哲維: 移除店名 {store_name} (不在正確 12 間店清單內)"
                            
                    elif (region == "彰雲嘉區" or region == "彰嘉雲區") and "林晟豐" in mgr_name:
                        if "嘉義林森西" in store_name or store_name == "嘉義林森西店":
                            should_remove = True
                            reason = f"彰雲嘉區-林晟豐: 移除已閉店 {store_name}"
                            
                    elif region == "台南區" and "李景傑" in mgr_name:
                        if "永康中華" in store_name or store_name == "永康中華店":
                            should_remove = True
                            reason = f"台南區-李景傑 (營業二處): 移除舊店名 {store_name}"
                            
                    elif region == "高雄區" and "涂綺恬" in mgr_name:
                        if any(kw in store_name for kw in deleted_tqt_keywords):
                            should_remove = True
                            reason = f"高雄區-涂綺恬: 移除已閉店或舊店名 {store_name}"
                            
                    elif region == "高屏區" and "鍾宜玲" in mgr_name:
                        if any(kw in store_name for kw in deleted_cyl_keywords):
                            should_remove = True
                            reason = f"高屏區-鍾宜玲: 移除已閉店或舊店名 {store_name}"
                
                if should_remove:
                    removed_stores.append({
                        "department": dept,
                        "region": region,
                        "areaManagerName": mgr_name,
                        "storeName": store_name,
                        "reason": reason
                    })
                else:
                    new_managers.append(m)
            
            # 寫入回資料庫
            cur.execute("""
                INSERT INTO store (id, data) VALUES ('managers', %s)
                ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
            """, (Json(new_managers),))
            conn.commit()
            
            return {
                "success": True,
                "before_count": before_count,
                "after_count": len(new_managers),
                "removed_count": len(removed_stores),
                "removed_details": removed_stores
            }


# === PDCA Action Items ===

@app.get("/api/action-items", response_model=List[dict])
def get_action_items(store: str = "", user: Optional[dict] = Depends(get_optional_user)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            if user and user.get("role") == "manager":
                mgr_name = user.get("name")
                assigned = list(user.get("assigned_stores") or [])
                if store:
                    if store not in assigned:
                        return []
                    cur.execute("SELECT data FROM action_items WHERE store_name = %s ORDER BY created_at DESC", (store,))
                else:
                    cur.execute(
                        "SELECT data FROM action_items WHERE store_name = ANY(%s) OR data->>'assignee' = %s OR data->>'createdBy' = %s ORDER BY created_at DESC LIMIT 200",
                        (assigned, mgr_name, mgr_name)
                    )
            else:
                if store:
                    cur.execute("SELECT data FROM action_items WHERE store_name = %s ORDER BY created_at DESC", (store,))
                else:
                    cur.execute("SELECT data FROM action_items ORDER BY created_at DESC LIMIT 200")
            rows = cur.fetchall()
            return [row[0] for row in rows]

@app.post("/api/action-items")
def create_action_item(payload: dict = Body(...)):
    item_id = str(uuid.uuid4())
    payload["id"] = item_id
    payload["createdAt"] = datetime.utcnow().isoformat()
    if "status" not in payload:
        payload["status"] = "Open"
    store_name = payload.get("storeName", "未知門市")
    
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO action_items (id, store_name, created_at, data)
                VALUES (%s, %s, %s, %s)
            """, (item_id, store_name, datetime.utcnow(), Json(payload)))
        conn.commit()
    return {"success": True, "data": payload}

@app.put("/api/action-items/{item_id}")
def update_action_item(item_id: str, payload: dict = Body(...)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM action_items WHERE id = %s", (item_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Item not found")
            
            data = row[0]
            data.update(payload)
            data["updatedAt"] = datetime.utcnow().isoformat()
            
            cur.execute("""
                UPDATE action_items SET data = %s WHERE id = %s
            """, (Json(data), item_id))
        conn.commit()
    return {"success": True, "data": data}

@app.get("/api/dashboard-data")
def get_dashboard_data(time_range: str = "day", region: str = "all", user: Optional[dict] = Depends(get_optional_user)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # 1. Get Managers
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            row = cur.fetchone()
            managers = row[0] if row else []
            
            # 2. Get Activities
            query = "SELECT data FROM visit_records"
            params = []
            conditions = []
            
            if time_range == "all":
                pass
            elif time_range == "week":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')")
            elif time_range == "last_week":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') - interval '1 week'")
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') < date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')")
            elif time_range == "month":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')")
            else:
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date")
            
            if region != "all":
                conditions.append("region = %s")
                params.append(region)
                
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
                
            query += " ORDER BY created_at DESC LIMIT 100"
            cur.execute(query, tuple(params))
            activities = [r[0] for r in cur.fetchall()]
            
            # 3. Get Action Items
            action_items = []
            try:
                cur.execute("SELECT data FROM action_items ORDER BY created_at DESC LIMIT 200")
                action_items = [r[0] for r in cur.fetchall()]
            except Exception as e:
                print("Failed to fetch action_items:", e)
                conn.rollback() # Important to rollback the aborted transaction
            
            # NOTE: 區主管僅能看到自己的門市與活動紀錄
            if user and user.get("role") == "manager":
                mgr_name = user.get("name")
                assigned = set(user.get("assigned_stores") or [])
                managers = [m for m in managers if m.get("areaManagerName") == mgr_name or m.get("storeName") in assigned]
                activities = [a for a in activities if a.get("areaManagerName") == mgr_name or a.get("storeName") in assigned]
                action_items = [i for i in action_items if i.get("storeName") in assigned or i.get("assignee") == mgr_name or i.get("createdBy") == mgr_name]

            return {
                "managers": managers,
                "activities": activities,
                "actionItems": action_items
            }
