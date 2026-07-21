import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import uuid
import psycopg2
from psycopg2.extras import Json

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
    try:
        yield conn
    finally:
        # 使用完畢後，務必將連線放回池中供下一次請求使用
        db_pool.putconn(conn)

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
                """)
                # 加入索引優化查詢效能 (確保使用者體驗)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_created_at ON visit_records (created_at DESC);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_region ON visit_records (region);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_visit_records_data_gin ON visit_records USING GIN (data);")
            conn.commit()
    except Exception as e:
        print("DB Init Error:", e)

# init_db() # 效能優化：已建立索引完成，關閉此功能以提升 Serverless Cold Start 啟動速度

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
    jobTitle: str
    actionType: str
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



# === API Endpoints ===



@app.get("/api/activities", response_model=List[VisitRecord])
def get_activities(time_range: str = "day", region: str = "all"):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # 建立基本的查詢語句
            query = "SELECT data FROM visit_records"
            params = []
            conditions = []
            
            # 加入時間區間過濾
            if time_range == "week":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')")
            elif time_range == "month":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')")
            else:
                # 預設過濾今日 (day)
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date")
            
            # 加入區域過濾
            if region != "all":
                conditions.append("region = %s")
                params.append(region)
                
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
                
            query += " ORDER BY created_at DESC LIMIT 100"
            
            cur.execute(query, tuple(params))
            rows = cur.fetchall()
            return [row[0] for row in rows]

@app.get("/api/managers", response_model=List[Manager])
def get_managers():
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            row = cur.fetchone()
            if row:
                return row[0]
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

@app.post("/api/visit-records")
def create_visit_record(payload: dict = Body(...)):
    record_id = str(uuid.uuid4())
    payload["recordId"] = record_id
    payload["createdAt"] = datetime.utcnow().isoformat()
    region = payload.get("region", "")
    
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO visit_records (id, region, created_at, data)
                VALUES (%s, %s, %s, %s)
            """, (record_id, region, datetime.utcnow(), Json(payload)))
        conn.commit()
        
    return {"success": True, "data": {"recordId": record_id}}

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
        "immediateImprovement": str(payload.get("defects") or "") + "\n" + str(payload.get("summary") or ""),
        "highlightDescription": str(payload.get("highlights") or ""),
        "abnormalFlag": bool(payload.get("defects")),
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
