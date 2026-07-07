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

POSTGRES_URL = os.getenv("POSTGRES_URL")

def get_db_connection():
    if not POSTGRES_URL:
        # Fallback 避免本地報錯，雖然沒設定會無法連線
        raise Exception("POSTGRES_URL is not set")
    # Vercel Postgres 需要 SSL
    conn = psycopg2.connect(POSTGRES_URL, sslmode='require')
    return conn

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
            conn.commit()
    except Exception as e:
        print("DB Init Error:", e)

init_db()

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

class DashboardSummary(BaseModel):
    totalVisits: int
    completedManagersCount: int
    pendingManagersCount: int
    visitedStoresCount: int
    abnormalIssuesCount: int
    improvementIssuesCount: int
    totalExpectedStayMinutes: int
    highlightCount: int

# === API Endpoints ===

@app.get("/api/summary", response_model=DashboardSummary)
def get_summary(date: str = ""):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            if date:
                cur.execute("SELECT data FROM visit_records WHERE created_at::date = %s::date", (date,))
            else:
                # 預設抓取今日
                cur.execute("SELECT data FROM visit_records WHERE created_at::date = CURRENT_DATE")
            
            rows = cur.fetchall()
            
            total_visits = len(rows)
            abnormal_count = 0
            expected_stay = 0
            highlight_count = 0
            
            for r in rows:
                data = r[0]
                if data.get("abnormalFlag"):
                    abnormal_count += 1
                expected_stay += int(data.get("expectedStayMinutes", 0))
                if data.get("highlightDescription"):
                    highlight_count += 1

    return DashboardSummary(
        totalVisits=total_visits,
        completedManagersCount=0,
        pendingManagersCount=0,
        visitedStoresCount=0,
        abnormalIssuesCount=abnormal_count,
        improvementIssuesCount=0,
        totalExpectedStayMinutes=expected_stay,
        highlightCount=highlight_count
    )

@app.get("/api/activities", response_model=List[VisitRecord])
def get_activities(date: str = "", region: str = "all"):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # 建立基本的查詢語句
            query = "SELECT data FROM visit_records"
            params = []
            conditions = []
            
            # 加入日期過濾
            if date:
                conditions.append("created_at::date = %s::date")
                params.append(date)
            else:
                # 預設過濾今日
                conditions.append("created_at::date = CURRENT_DATE")
            
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
    
    # 建立符合 VisitRecord 的資料結構
    visit_record = {
        "recordId": record_id,
        "areaManagerName": payload.get("areaManagerName", "未知主管"),
        "jobTitle": "區主管",
        "actionType": "實地巡店",
        "storeName": payload.get("storeName", "未知門市"),
        "region": payload.get("region", "未知區域"),
        "timeAgoMinutes": 0,
        "expectedStayMinutes": payload.get("expectedStayMinutes", 0),
        "tags": ["巡店回報"],
        "immediateImprovement": payload.get("defects", "") + "\n" + payload.get("summary", ""),
        "highlightDescription": payload.get("highlights", ""),
        "abnormalFlag": bool(payload.get("defects")),
        "photoPairs": payload.get("photoPairs", []),
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
