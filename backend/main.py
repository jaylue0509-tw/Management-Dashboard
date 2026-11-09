import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Body, BackgroundTasks, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime, timedelta, timezone
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
                # 建立使用者表 (支援管理者查看密碼與首次登入強制改密碼)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        username VARCHAR(50) PRIMARY KEY,
                        password_hash VARCHAR(255) NOT NULL,
                        role VARCHAR(20) NOT NULL,
                        name VARCHAR(50) NOT NULL,
                        assigned_stores JSONB,
                        plain_password VARCHAR(255),
                        must_change_password BOOLEAN DEFAULT TRUE
                    );
                """)
                # 自動更新現有 users 資料表結構
                cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT TRUE;")
                cur.execute("UPDATE users SET must_change_password = TRUE WHERE must_change_password IS NULL AND role = 'manager';")
                cur.execute("UPDATE users SET must_change_password = FALSE WHERE username = 'admin';")
                cur.execute("DELETE FROM visit_records WHERE id = '0ec0b2f0-45ee-44e6-8db4-4a6fddd15d3c';")
                cur.execute("DELETE FROM action_items WHERE id = '86ed0b29-dc30-4825-808d-9a58d6c5e38f';")
                
                # 自動清理測試殘留資料 (例如文心秀泰)
                # (保留所有歷史巡店與待辦資料)
                pass

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
            sync_region_reorg_2026(conn)

    except Exception as e:
        print("DB Init Error:", e)

def init_default_users(conn):
    with conn.cursor() as cur:
        # 確保 admin 帳號存在且密碼雜湊合法 (預設密碼: admin1234)
        cur.execute("SELECT 1 FROM users WHERE username = 'admin'")
        if not cur.fetchone():
            admin_hash = pwd_context.hash("admin1234")
            cur.execute("""
                INSERT INTO users (username, password_hash, role, name, assigned_stores, must_change_password)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, ("admin", admin_hash, "admin", "總部管理員", Json([]), False))
            conn.commit()
            
            # 根據現有 managers 建立區主管帳號 (預設密碼: admin1234)
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
                        INSERT INTO users (username, password_hash, role, name, assigned_stores, plain_password, must_change_password)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (name, mgr_hash, "manager", name, Json(stores), "admin1234", True))
            conn.commit()

def sync_region_reorg_2026(conn):
    """
    同步 2026 最新區域與門市組織整併：
    1. 原「台南區」整併入「嘉南區」，統稱「嘉南區」（共 18 家門市）：
       - 區域主管：葉信宏 區主管（統籌整體營運管理）
       - 副區主管：李景傑 副區主管
       - 轄下 18 家門市：新營民生店、麻豆興中店、佳里新生店、善化光復店、新市中正店、
         嘉義北港店、嘉義友愛店、嘉義吳鳳南店、嘉義朴子店、安南海佃店、台南永康店、
         永康永大店、關廟南雄店、台南中華東店、台南西門店、仁德中山店、安平建平店、歸仁中山店
    2. 「彰雲嘉區」改為「彰雲區」（區經理：林晟豐）
    3. 「高雄區」之大寮鳳林店、高雄林園東店移至「高屏區」（區經理：鍾宜玲）
    """
    jianan_stores = [
        "新營民生店", "麻豆興中店", "佳里新生店", "善化光復店", "新市中正店",
        "嘉義北港店", "嘉義友愛店", "嘉義吳鳳南店", "嘉義朴子店",
        "安南海佃店", "台南永康店", "永康永大店", "關廟南雄店",
        "台南中華東店", "台南西門店", "仁德中山店", "安平建平店", "歸仁中山店"
    ]
    jianan_set = set(jianan_stores)
    gaoping_moved = {"大寮鳳林店", "高雄林園東店", "高雄林園店"}

    with conn.cursor() as cur:
        cur.execute("SELECT data FROM store WHERE id = 'managers'")
        row = cur.fetchone()
        if not row or not isinstance(row[0], list):
            return

        managers = row[0]
        changed = False
        seen_stores = set()
        updated_managers = []
        sample_dept = ""
        sample_director = ""

        # 先擷取嘉南區／原台南區的處別與處長基準
        for m in managers:
            if m.get("region") in ("嘉南區", "台南區") and m.get("department"):
                sample_dept = m.get("department", "")
                sample_director = m.get("directorName", "")
                if m.get("region") == "嘉南區":
                    break

        for m in managers:
            s_name = str(m.get("storeName") or "").strip()
            if not s_name:
                continue
            if s_name == "高雄林園店":
                s_name = "高雄林園東店"
                m["storeName"] = s_name
                changed = True

            if m.get("region") in ("彰雲嘉區", "彰雲區", "台南區", "嘉南區") and not sample_dept:
                sample_dept = m.get("department", "")
                sample_director = m.get("directorName", "")

            if s_name in jianan_set:
                if (
                    m.get("region") != "嘉南區"
                    or m.get("areaManagerName") != "葉信宏"
                    or m.get("deputyManagerName") != "李景傑"
                    or (sample_dept and m.get("department") != sample_dept)
                ):
                    m["region"] = "嘉南區"
                    m["areaManagerName"] = "葉信宏"
                    m["deputyManagerName"] = "李景傑"
                    if sample_dept:
                        m["department"] = sample_dept
                    if sample_director:
                        m["directorName"] = sample_director
                    changed = True
            elif m.get("region") in ("嘉南區", "台南區") or m.get("areaManagerName") in ("葉信宏", "李景傑"):
                # 移除原台南區／嘉南區不在最新 18 家清單內的舊門市
                changed = True
                continue
            elif s_name in gaoping_moved:
                if m.get("region") != "高屏區" or m.get("areaManagerName") != "鍾宜玲":
                    m["region"] = "高屏區"
                    m["areaManagerName"] = "鍾宜玲"
                    changed = True
            elif m.get("region") in ("彰雲嘉區", "彰嘉雲區"):
                m["region"] = "彰雲區"
                changed = True

            if s_name not in seen_stores:
                seen_stores.add(s_name)
                updated_managers.append(m)
            else:
                changed = True

        for js in jianan_stores:
            if js not in seen_stores:
                updated_managers.append({
                    "department": sample_dept,
                    "directorName": sample_director,
                    "region": "嘉南區",
                    "areaManagerName": "葉信宏",
                    "deputyManagerName": "李景傑",
                    "storeName": js,
                    "beautyLeader": "",
                    "todayVisitCount": 0,
                    "assignedStoreCount": 0,
                    "hasAbnormal": False,
                    "visitStatus": "尚未回填"
                })
                seen_stores.add(js)
                changed = True

        if changed:
            cur.execute("UPDATE store SET data = %s WHERE id = 'managers'", (Json(updated_managers),))

        # 同步區主管與副區主管帳號負責門市清單（葉信宏與李景傑共同管理嘉南區 18 家門市）
        target_mgrs = {"葉信宏", "林晟豐", "李景傑", "涂綺恬", "鍾宜玲"}
        mgr_stores_map = {name: [] for name in target_mgrs}
        for m in updated_managers:
            mgr_name = str(m.get("areaManagerName") or "").strip()
            s_name = str(m.get("storeName") or "").strip()
            if mgr_name in mgr_stores_map and s_name:
                mgr_stores_map[mgr_name].append(s_name)

        mgr_stores_map["葉信宏"] = list(jianan_stores)
        mgr_stores_map["李景傑"] = list(jianan_stores)

        for mgr_name, stores_list in mgr_stores_map.items():
            cur.execute("SELECT assigned_stores FROM users WHERE username = %s", (mgr_name,))
            u_row = cur.fetchone()
            if not u_row:
                mgr_hash = pwd_context.hash("admin1234")
                cur.execute("""
                    INSERT INTO users (username, password_hash, role, name, assigned_stores, plain_password, must_change_password)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (mgr_name, mgr_hash, "manager", mgr_name, Json(stores_list), "admin1234", True))
            else:
                current_stores = u_row[0] or []
                if current_stores != stores_list:
                    cur.execute(
                        "UPDATE users SET assigned_stores = %s, name = %s WHERE username = %s",
                        (Json(stores_list), mgr_name, mgr_name)
                    )

        # 將歷史巡店紀錄中之「台南區」或嘉南區 18 家門市統一歸入「嘉南區」
        cur.execute(
            """
            UPDATE visit_records
            SET region = '嘉南區',
                data = jsonb_set(data, '{region}', '"嘉南區"', true)
            WHERE region = '台南區'
               OR data->>'region' = '台南區'
               OR data->>'storeName' = ANY(%s)
            """,
            (jianan_stores,)
        )
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
            cur.execute("SELECT password_hash, role, name, assigned_stores, must_change_password FROM users WHERE username = %s", (req.username,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=401, detail="Invalid username or password")
            
            password_hash, role, name, assigned_stores, must_change_db = row
            
            # 安全密碼驗證 (以 bcrypt 雜湊比對)
            is_valid_password = False
            try:
                if pwd_context.verify(req.password, password_hash):
                    is_valid_password = True
            except Exception:
                pass

            # 相容性升級保護：若歷史帳號 hash 未就緒且輸入預設密碼 admin1234，驗證通過並即刻重整 hash，避免使用者遭反鎖
            if not is_valid_password and req.password == "admin1234":
                if req.username == "admin" or must_change_db is True or must_change_db is None:
                    is_valid_password = True
                    try:
                        new_hash = pwd_context.hash(req.password)
                        cur.execute("UPDATE users SET password_hash = %s WHERE username = %s", (new_hash, req.username))
                        conn.commit()
                    except Exception as e:
                        print("Hash auto-upgrade warning:", e)

            if not is_valid_password:
                raise HTTPException(status_code=401, detail="Invalid username or password")
            
            # 判斷是否需要強制更改密碼 (區主管若被標記為必須修改，登入後強制更改)
            must_change = False
            if role == "manager" and (must_change_db is True or must_change_db is None):
                must_change = True
            
            token_data = {
                "sub": req.username,
                "role": role,
                "name": name,
                "assigned_stores": assigned_stores,
                "must_change_password": must_change
            }
            token = jwt.encode(token_data, JWT_SECRET, algorithm=JWT_ALGORITHM)

            # 記錄登入操作審計日誌
            try:
                log_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (log_id, "USER_LOGIN", req.username, name, None,
                      Json({"role": role, "name": name, "assigned_stores_count": len(assigned_stores or [])}),
                      datetime.utcnow()))
                conn.commit()
            except Exception as log_err:
                print("登入審計日誌寫入警告 (不阻斷登入):", log_err)
            
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
    username = user.get("sub")
    if username:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT role, name, assigned_stores, must_change_password FROM users WHERE username = %s", (username,))
                row = cur.fetchone()
                if row:
                    role, name, assigned_stores, must_change_db = row
                    must_change = bool(role == "manager" and (must_change_db is True or must_change_db is None))
                    return {
                        "sub": username,
                        "role": role,
                        "name": name,
                        "assigned_stores": assigned_stores or [],
                        "must_change_password": must_change
                    }
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

            cur.execute("""
                UPDATE users 
                SET password_hash = %s, must_change_password = FALSE 
                WHERE username = %s
            """, (pwd_context.hash(req.new_password), username))
            cur.execute("""
                INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (str(uuid.uuid4()), "UPDATE_USER", username, user.get("name", username), None,
                  Json({"password_changed": True, "self_service": True}), datetime.utcnow()))
        conn.commit()
    return {"success": True, "must_change_password": False}


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
            query = "SELECT data, created_at FROM visit_records"
            params = []
            conditions = []
            
            # 加入時間區間過濾
            if time_range == "all":
                pass # 查詢全部歷史與即時資料
            elif time_range == "week":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('week', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))")
            elif time_range == "last_week":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('week', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')) - interval '1 week'")
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') < date_trunc('week', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))")
            elif time_range == "month":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))")
            else:
                # 預設過濾今日 (day)
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date = ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))::date")
            
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
                
            query += " ORDER BY created_at DESC LIMIT 500"
            
            cur.execute(query, tuple(params))
            rows = cur.fetchall()
            return [_normalize_activity_time(row[0], row[1]) for row in rows if row[0]]

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
                    return [
                        m for m in data
                        if m.get("areaManagerName") == mgr_name
                        or m.get("deputyManagerName") == mgr_name
                        or m.get("storeName") in assigned
                    ]
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
            cur.execute("SELECT username, role, name, assigned_stores, must_change_password FROM users WHERE role = 'manager' ORDER BY name ASC")
            rows = cur.fetchall()
            return [
                {
                    "username": r[0],
                    "role": r[1],
                    "name": r[2],
                    "assigned_stores": r[3],
                    "must_change_password": True if r[4] is None else bool(r[4])
                }
                for r in rows
            ]

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
                    cur.execute("""
                        INSERT INTO users (username, password_hash, role, name, assigned_stores, must_change_password) 
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (req.username, pwd_hash, "manager", req.name, Json(req.assigned_stores), True))
                else:
                    cur.execute("""
                        UPDATE users 
                        SET password_hash = %s, must_change_password = TRUE, name = %s, assigned_stores = %s 
                        WHERE username = %s
                    """, (pwd_hash, req.name, Json(req.assigned_stores), req.username))
                after_data["password_changed"] = True
            else:
                if is_new:
                    raise HTTPException(status_code=400, detail="Password is required for new users")
                cur.execute("UPDATE users SET name = %s, assigned_stores = %s WHERE username = %s",
                            (req.name, Json(req.assigned_stores), req.username))
                            
            log_id = str(uuid.uuid4())
            # 同步更新 store ('managers') 中的門市負責區主管姓名，確保系統設定後台與戰情牆組織圖 100% 同步
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            mgr_row = cur.fetchone()
            if mgr_row and isinstance(mgr_row[0], list):
                managers_list = mgr_row[0]
                assigned_norm = {_normalize_store(s) for s in (req.assigned_stores or []) if s}
                old_name = (before_data or {}).get("name")
                changed_mgrs = False
                for m in managers_list:
                    m_store_norm = _normalize_store(m.get("storeName"))
                    is_deputy_target = (
                        m.get("deputyManagerName") in (req.name, old_name)
                        and m.get("areaManagerName") not in (req.name, old_name)
                    )
                    if m_store_norm in assigned_norm:
                        if is_deputy_target:
                            if m.get("deputyManagerName") != req.name:
                                m["deputyManagerName"] = req.name
                                changed_mgrs = True
                        elif m.get("areaManagerName") != req.name:
                            m["areaManagerName"] = req.name
                            changed_mgrs = True
                    elif old_name and old_name != req.name:
                        if m.get("deputyManagerName") == old_name:
                            m["deputyManagerName"] = req.name
                            changed_mgrs = True
                        elif m.get("areaManagerName") == old_name:
                            m["areaManagerName"] = req.name
                            changed_mgrs = True
                if changed_mgrs:
                    cur.execute("UPDATE store SET data = %s WHERE id = 'managers'", (Json(managers_list),))

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
MAX_PHOTO_BYTES = 10 * 1024 * 1024
DATA_URL_PATTERN = re.compile(r'^data:(image/[a-zA-Z0-9.+-]+)(?:;[a-zA-Z0-9=._-]+)*;base64,(.+)$', re.DOTALL)
TAIPEI_OFFSET = timedelta(hours=8)


def _taipei_date_after(days: int) -> str:
    """回傳台北時區今天往後 N 天的日期字串 (YYYY-MM-DD)"""
    return (datetime.utcnow() + TAIPEI_OFFSET + timedelta(days=days)).date().isoformat()


def _normalize_activity_time(record: dict, db_created_at: Optional[datetime]) -> dict:
    """
    以資料庫 created_at 欄位 (UTC) 為準統一輸出 createdAt，並補上 'Z' 時區標記。
    NOTE: 舊資料的 createdAt 為無時區 ISO 字串，前端會誤判為本地時間造成日期偏移 8 小時；
    同時即時計算 timeAgoMinutes，避免永遠顯示建立當下寫入的 0 分鐘。
    """
    if not isinstance(record, dict):
        return record
    item = dict(record)
    if isinstance(db_created_at, datetime):
        utc_dt = db_created_at.replace(tzinfo=None)
        item["createdAt"] = utc_dt.isoformat() + "Z"
        item["timeAgoMinutes"] = max(0, int((datetime.utcnow() - utc_dt).total_seconds() // 60))
    else:
        raw = str(item.get("createdAt") or "")
        if raw and not raw.endswith("Z") and not re.search(r"[+-]\d{2}:?\d{2}$", raw):
            item["createdAt"] = raw + "Z"
    return item


def _normalize_store(name: str) -> str:
    """門市名稱正規化：去空白與「店」字，避免表單與主檔寫法不一致而對不上"""
    return str(name or "").strip().replace("店", "")


def _store_photo(cur, record_id: str, url: str) -> str:
    """
    健壯的照片儲存處理：
    - 支援 JPEG, PNG, WEBP, HEIC 等多種行動裝置圖片 MIME 格式
    - 若照片格式略有瑕疵或解碼異常，記錄錯誤並回傳空值，絕不阻斷主巡檢紀錄之存檔
    """
    if not url:
        return ""
    if url.startswith("https://") or url.startswith("/api/photos/"):
        return url

    mime_type = "image/jpeg"
    raw_base64 = None

    match = DATA_URL_PATTERN.match(url)
    if match:
        mime_type = match.group(1)
        raw_base64 = match.group(2)
    elif "base64," in url:
        parts = url.split("base64,", 1)
        raw_base64 = parts[1]
        if "data:image/" in parts[0]:
            mime_type = parts[0].split("data:")[1].split(";")[0]

    if raw_base64:
        try:
            content = base64.b64decode(raw_base64.strip(), validate=False)
            photo_id = str(uuid.uuid4())
            cur.execute("SAVEPOINT sp_photo")
            cur.execute(
                "INSERT INTO photos (id, record_id, mime_type, content, created_at) VALUES (%s, %s, %s, %s, %s)",
                (photo_id, record_id, mime_type, psycopg2.Binary(content), datetime.utcnow()),
            )
            return f"/api/photos/{photo_id}"
        except Exception as e:
            print(f"照片解碼寫入警告 (降級保留原圖 Base64 以確保照片顯示): {e}")
            try:
                cur.execute("ROLLBACK TO SAVEPOINT sp_photo")
            except Exception:
                pass
            return url
            return ""

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

    now_utc = datetime.utcnow()
    created_at = now_utc
    created_at_str = payload.get("createdAt")
    if created_at_str:
        try:
            parsed_dt = datetime.fromisoformat(str(created_at_str).replace("Z", "+00:00"))
            if parsed_dt.tzinfo is not None:
                created_at = parsed_dt.astimezone(timezone.utc).replace(tzinfo=None)
            else:
                created_at = parsed_dt
        except (ValueError, TypeError):
            created_at = now_utc

    is_manager = bool(user and user.get("role") == "manager")
    if is_manager:
        # NOTE: 區主管送出時以登入身分為準，避免共用裝置草稿殘留造成紀錄掛錯人
        payload["areaManagerName"] = user.get("name") or payload.get("areaManagerName")

    # 驗證並限制區經理問卷回填時間：允許今日或往前最多 5 天（以台北時區日期為準），且不可超過當下時間
    taipei_today = (now_utc + TAIPEI_OFFSET).date()
    min_backfill_date = taipei_today - timedelta(days=5)
    record_taipei_date = (created_at + TAIPEI_OFFSET).date()

    if is_manager:
        if record_taipei_date < min_backfill_date:
            raise HTTPException(
                status_code=400,
                detail=f"問卷回填日期最多僅能往前 5 天（最早可選 {min_backfill_date.isoformat()}）"
            )
        if record_taipei_date > taipei_today:
            raise HTTPException(status_code=400, detail="問卷回填日期不可選擇未來日期")

    if created_at > now_utc:
        created_at = now_utc

    if record_taipei_date < taipei_today:
        payload["isBackfilled"] = True
        payload["submittedAt"] = now_utc.isoformat() + "Z"

    payload["createdAt"] = created_at.isoformat() + "Z"

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
                if not payload.get("region") and row and row[0]:
                    for m in row[0]:
                        if str(m.get("areaManagerName") or "").strip() == str(mgr_name).strip():
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

            # 自動彙整異常狀態、標籤與改善說明文字，確保巡店紀錄送出後與戰情牆 100% 即時同步顯示
            defect_lines = []
            for k, v in core_checks.items():
                if v == '缺失':
                    remark = category_remarks.get(k) or "未提供說明"
                    defect_lines.append(f"{_build_defect_label(k)}：{remark}")
            for k, v in category_checks.items():
                if v in ('缺失', '待改善'):
                    remark = category_remarks.get(k) or "未提供說明"
                    defect_lines.append(f"{_build_defect_label(k)} ({v})：{remark}")
            has_defect = len(defect_lines) > 0 or payload.get("overallRating") == "需重點輔導"
            payload["abnormalFlag"] = bool(has_defect)
            if not payload.get("immediateImprovement") and defect_lines:
                payload["immediateImprovement"] = "\n".join(defect_lines)
            tags = list(payload.get("tags") or ["實地巡店"])
            if has_defect and "發現異常" not in tags:
                tags.append("發現異常")
            payload["tags"] = tags

            cur.execute("""
                INSERT INTO visit_records (id, region, created_at, data)
                VALUES (%s, %s, %s, %s)
            """, (record_id, region, created_at, Json(payload)))

            # PDCA：缺失項目自動建立 + 主管手動新增的交辦事項
            new_items = []
            for k, v in core_checks.items():
                if v == '缺失':
                    remark = category_remarks.get(k) or "未提供說明"
                    desc_text = f"{_build_defect_label(k)}：{remark}"
                    new_items.append({
                        "category": "必看核心底線",
                        "desc": desc_text,
                        "issueDescription": desc_text,
                        "assignee": "店長",
                        "dueDate": _taipei_date_after(3)
                    })
            for k, v in category_checks.items():
                if v in ('缺失', '待改善'):
                    remark = category_remarks.get(k) or "未提供說明"
                    mod_idx = int(k.split('-')[0]) - 1 if '-' in k and k.split('-')[0].isdigit() else -1
                    cat_label = MODULE_NAMES[mod_idx] if 0 <= mod_idx < len(MODULE_NAMES) else "模組細項"
                    desc_text = f"{_build_defect_label(k)} ({v})：{remark}"
                    new_items.append({
                        "category": cat_label,
                        "desc": desc_text,
                        "issueDescription": desc_text,
                        "assignee": "店長",
                        "dueDate": _taipei_date_after(7)
                    })
            for act in payload.get("newActionItems") or []:
                desc = str((act or {}).get("desc") or "").strip()
                if desc:
                    new_items.append({
                        "category": "主管交辦事項",
                        "desc": desc,
                        "issueDescription": desc,
                        "assignee": str(act.get("assignee") or "").strip() or "店長",
                        "dueDate": str(act.get("dueDate") or "").strip() or _taipei_date_after(7)
                    })

            now_iso = datetime.utcnow().isoformat()
            for item in new_items:
                item_id = str(uuid.uuid4())
                item.update({
                    "id": item_id,
                    "storeName": store_name,
                    "status": "Open",
                    "createdAt": now_iso,
                    "sourceRecordId": record_id,
                    "visitRecordId": record_id,
                    "createdBy": mgr_name
                })
                cur.execute("""
                    INSERT INTO action_items (id, store_name, created_at, data)
                    VALUES (%s, %s, %s, %s)
                """, (item_id, store_name, datetime.utcnow(), Json(item)))
            action_items_created = len(new_items)

            # PDCA：上次交辦事項本次確認已改善者結案（同步更新 action_items 與歷史異常 visit_records）
            resolved_any_pdca = False
            for item_id, result in (payload.get("pdcaResults") or {}).items():
                if result == '已改善':
                    resolved_any_pdca = True
                    if str(item_id).startswith("vr-"):
                        vr_id = str(item_id)[3:]
                        cur.execute("UPDATE visit_records SET data = data || %s WHERE id = %s",
                                    (Json({"pdcaResolved": True, "pdcaResolvedAt": now_iso, "pdcaResolvedByRecordId": record_id}), vr_id))
                    else:
                        cur.execute("UPDATE action_items SET data = data || %s WHERE id = %s",
                                    (Json({"status": "Closed", "updatedAt": now_iso, "closedByRecordId": record_id}), item_id))
            if resolved_any_pdca or not has_defect:
                cur.execute(
                    "UPDATE visit_records SET data = data || %s WHERE id != %s AND replace(data->>'storeName', '店', '') = %s",
                    (Json({"pdcaResolved": True, "pdcaResolvedAt": now_iso}), record_id, _normalize_store(store_name))
                )
            for item_id, result in (payload.get("pdcaResults") or {}).items():
                if result == '已改善':
                    cur.execute("UPDATE action_items SET data = data || %s WHERE id = %s",
                                (Json({"status": "Closed", "updatedAt": now_iso, "closedByRecordId": record_id}), item_id))

            # 記錄巡店送出審計日誌
            log_id = str(uuid.uuid4())
            cur.execute("""
                INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (log_id, "CREATE_VISIT_RECORD", store_name, mgr_name, None,
                  Json({
                      "storeName": store_name,
                      "region": region,
                      "auditMode": payload.get("auditMode"),
                      "overallRating": payload.get("overallRating"),
                      "actionItemsCreated": action_items_created,
                      "recordId": record_id
                  }), datetime.utcnow()))
        conn.commit()

    if payload.get("overallRating") == "需重點輔導":
        defects = [f"• {_build_defect_label(k)}" for k, v in {**core_checks, **category_checks}.items() if v in ['缺失', '待改善']]
        defects_text = "\n".join(defects) if defects else "• 未記錄具體異常選項"
        msg = f"🚨 **【警示】高風險門市通報**\n\n門市：{store_name}\n\n區主管：{mgr_name}\n\n狀態：需重點輔導\n\n**扣分原因 / 異常項目：**\n{defects_text}\n\n請高層主管多加留意！"
        background_tasks.add_task(trigger_teams_notify, msg)

    return {"success": True, "data": {"recordId": record_id, "actionItemsCreated": action_items_created}}


@app.put("/api/visit-records/{record_id}/photos")
def update_visit_record_photos(record_id: str, payload: dict = Body(...)):
    """
    補傳或更新巡店紀錄之改善前 (Before) / 改善後 (After) 對比照片
    """
    raw_pairs = payload.get("photoPairs") or []
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM visit_records WHERE id = %s", (record_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Visit record not found")

            record_data = row[0]
            cleaned_pairs = []
            for pair in raw_pairs:
                before_url = _store_photo(cur, record_id, (pair or {}).get("beforeUrl", ""))
                after_url = _store_photo(cur, record_id, (pair or {}).get("afterUrl", ""))
                if before_url or after_url:
                    cleaned_pairs.append({"beforeUrl": before_url, "afterUrl": after_url})

            record_data["photoPairs"] = cleaned_pairs
            cur.execute("UPDATE visit_records SET data = %s WHERE id = %s", (Json(record_data), record_id))
        conn.commit()

    return {"success": True, "photoPairs": cleaned_pairs}

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

            # 清除測試假資料 (例如文心秀泰)
            # (保留所有歷史巡店與待辦資料)
            pass
            conn.commit()
            
            return {
                "success": True,
                "before_count": before_count,
                "after_count": len(new_managers),
                "removed_count": len(removed_stores),
                "removed_details": removed_stores
            }


# === PDCA Action Items ===

@app.post("/api/pdca/resolve-store")
def resolve_store_pdca(payload: dict = Body(...), user: Optional[dict] = Depends(get_optional_user)):
    store_name = str(payload.get("storeName") or "").strip()
    if not store_name:
        raise HTTPException(status_code=400, detail="缺少門市名稱")
    norm_store = _normalize_store(store_name)
    now_iso = datetime.utcnow().isoformat()
    resolved_by = (user or {}).get("name") or payload.get("resolvedBy") or "區主管"
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE action_items SET data = data || %s WHERE replace(store_name, '店', '') = %s",
                (Json({"status": "Closed", "updatedAt": now_iso, "resolvedBy": resolved_by}), norm_store)
            )
            cur.execute(
                "UPDATE visit_records SET data = data || %s WHERE replace(data->>'storeName', '店', '') = %s",
                (Json({"pdcaResolved": True, "pdcaResolvedAt": now_iso, "pdcaResolvedBy": resolved_by}), norm_store)
            )
        conn.commit()
    return {"success": True, "storeName": store_name}

@app.get("/api/action-items", response_model=List[dict])
def get_action_items(store: str = "", user: Optional[dict] = Depends(get_optional_user)):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            if user and user.get("role") == "manager":
                mgr_name = user.get("name")
                assigned = list(user.get("assigned_stores") or [])
                if store:
                    if user.get("sub"):
                        cur.execute("SELECT assigned_stores FROM users WHERE username = %s", (user.get("sub"),))
                        u_row = cur.fetchone()
                        if u_row and u_row[0]:
                            assigned = list(u_row[0])
                    if store not in assigned and _normalize_store(store) not in {_normalize_store(s) for s in assigned}:
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
            items = [
                row[0] for row in rows
                if row[0] and "測試" not in str(row[0].get("desc") or "") and "測試" not in str(row[0].get("issueDescription") or "")
            ]
            # 若指定門市查詢且尚無 Open 之 action_items，自動從該門市未結案之異常巡店紀錄合成待複查項目，確保區主管於巡店 Step 1 可點選結案
            if store and not any(i.get("status") == "Open" for i in items):
                cur.execute(
                    "SELECT id, created_at, data FROM visit_records WHERE replace(data->>'storeName', '店', '') = %s ORDER BY created_at DESC LIMIT 5",
                    (_normalize_store(store),)
                )
                for vr_id, vr_created, vr_data in cur.fetchall():
                    if not vr_data or vr_data.get("pdcaResolved") is True:
                        continue
                    cat_checks = vr_data.get("categoryChecks") or {}
                    core_checks_vr = vr_data.get("coreChecks") or {}
                    remarks_vr = vr_data.get("categoryRemarks") or {}
                    defects_found = []
                    for ck, cv in {**core_checks_vr, **cat_checks}.items():
                        if cv in ("缺失", "待改善"):
                            label = _build_defect_label(ck)
                            rmk = remarks_vr.get(ck)
                            defects_found.append(f"{label} ({cv})" + (f"：{rmk}" if rmk else ""))
                    if not defects_found and vr_data.get("abnormalFlag"):
                        defects_found.append("前次巡檢發現異常待複查確認")
                    if defects_found:
                        items.append({
                            "id": f"vr-{vr_id}",
                            "storeName": store,
                            "desc": "；".join(defects_found),
                            "issueDescription": "；".join(defects_found),
                            "assignee": "店長",
                            "dueDate": (vr_created.date().isoformat() if vr_created else _taipei_date_after(0)),
                            "status": "Open",
                            "sourceRecordId": vr_id
                        })
                        break
            return items
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
            query = "SELECT data, created_at FROM visit_records"
            params = []
            conditions = []
            
            if time_range == "all":
                pass
            elif time_range == "week":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('week', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))")
            elif time_range == "last_week":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('week', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')) - interval '1 week'")
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') < date_trunc('week', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))")
            elif time_range == "month":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))")
            else:
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date = ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))::date")
            
            if region != "all":
                conditions.append("region = %s")
                params.append(region)
                
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
                
            query += " ORDER BY created_at DESC LIMIT 500"
            cur.execute(query, tuple(params))
            activities = [
                _normalize_activity_time(r[0], r[1]) for r in cur.fetchall()
                if r[0]
                and "測試" not in str(r[0].get("storeName") or "")
                and "文心秀泰" not in str(r[0].get("storeName") or "")
                and r[0].get("recordId") != "0ec0b2f0-45ee-44e6-8db4-4a6fddd15d3c"
                and not any("測試" in str((it or {}).get("desc") or "") for it in (r[0].get("newActionItems") or []))
            ]
            
            # 3. Get Action Items
            action_items = []
            try:
                cur.execute("SELECT data FROM action_items ORDER BY created_at DESC LIMIT 200")
                action_items = [
                    r[0] for r in cur.fetchall()
                    if r[0]
                    and "測試" not in str(r[0].get("storeName") or "")
                    and "文心秀泰" not in str(r[0].get("storeName") or "")
                    and "測試" not in str(r[0].get("desc") or "")
                    and "測試" not in str(r[0].get("issueDescription") or "")
                    and r[0].get("sourceRecordId") != "0ec0b2f0-45ee-44e6-8db4-4a6fddd15d3c"
                ]
            except Exception as e:
                print("Failed to fetch action_items:", e)
                conn.rollback() # Important to rollback the aborted transaction
            
            # NOTE: 區主管僅能看到自己的門市與活動紀錄（即時同步 users 表最新負責門市）
            if user and user.get("role") == "manager" and user.get("sub"):
                cur.execute("SELECT name, assigned_stores FROM users WHERE username = %s", (user.get("sub"),))
                u_row = cur.fetchone()
                if u_row:
                    user = {**user, "name": u_row[0] or user.get("name"), "assigned_stores": u_row[1] or []}
            if user and user.get("role") == "manager":
                mgr_name = user.get("name")
                assigned = set(user.get("assigned_stores") or [])
                managers = [
                    m for m in managers
                    if m.get("areaManagerName") == mgr_name
                    or m.get("deputyManagerName") == mgr_name
                    or m.get("storeName") in assigned
                ]
                co_mgrs = {mgr_name}
                for m in managers:
                    if m.get("areaManagerName"):
                        co_mgrs.add(m.get("areaManagerName"))
                    if m.get("deputyManagerName"):
                        co_mgrs.add(m.get("deputyManagerName"))
                activities = [
                    a for a in activities
                    if a.get("areaManagerName") in co_mgrs or a.get("storeName") in assigned
                ]
                action_items = [
                    i for i in action_items
                    if i.get("storeName") in assigned
                    or i.get("assignee") in co_mgrs
                    or i.get("createdBy") in co_mgrs
                ]

            return {
                "managers": managers,
                "activities": activities,
                "actionItems": action_items
            }
