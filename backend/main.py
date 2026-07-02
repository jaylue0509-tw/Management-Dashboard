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
    return DashboardSummary(
        totalVisits=15,
        completedManagersCount=8,
        pendingManagersCount=4,
        visitedStoresCount=12,
        abnormalIssuesCount=2,
        improvementIssuesCount=5,
        totalExpectedStayMinutes=720,
        highlightCount=3
    )

@app.get("/api/activities", response_model=List[VisitRecord])
def get_activities(date: str = "", region: str = "all"):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            if region != "all":
                cur.execute("SELECT data FROM visit_records WHERE region = %s ORDER BY created_at DESC LIMIT 100", (region,))
            else:
                cur.execute("SELECT data FROM visit_records ORDER BY created_at DESC LIMIT 100")
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
