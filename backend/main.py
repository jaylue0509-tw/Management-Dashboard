import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import uuid
import redis.asyncio as redis

load_dotenv()

app = FastAPI(title="東寵戰情牆 API", description="採用 Vercel KV 的輕量級後端")

# CORS 設定：允許前端 (localhost:5173 等) 進行跨域請求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Vercel KV (Redis) 連線設定 ===
KV_URL = os.getenv("KV_URL", "redis://localhost:6379")
redis_client = redis.from_url(KV_URL, decode_responses=True)

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
async def get_summary(date: str = ""):
    # 暫時回傳假資料，後續可實作真正的計算
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
async def get_activities(date: str = "", region: str = "all"):
    # 從 Redis 讀取所有巡店紀錄
    data = await redis_client.lrange("visit_records", 0, -1)
    records = [json.loads(r) for r in data]
    
    # Python 記憶體過濾
    if region != "all":
        records = [r for r in records if r.get("region") == region]
        
    return records

@app.get("/api/managers", response_model=List[Manager])
async def get_managers():
    data = await redis_client.get("managers")
    if not data:
        return []
    return json.loads(data)

@app.post("/api/managers/import")
async def import_managers(managers: List[Manager] = Body(...)):
    if not managers:
        raise HTTPException(status_code=400, detail="No data provided")
        
    payload = [m.model_dump() for m in managers]
    
    # 寫入 Vercel KV
    await redis_client.set("managers", json.dumps(payload))
    return {"success": True, "count": len(payload)}

@app.post("/api/visit-records")
async def create_visit_record(payload: dict = Body(...)):
    record_id = str(uuid.uuid4())
    payload["recordId"] = record_id
    payload["createdAt"] = datetime.utcnow().isoformat()
    
    # 將巡店紀錄存入 Redis List 頂端 (最新在前)
    await redis_client.lpush("visit_records", json.dumps(payload))
    return {"success": True, "data": {"recordId": record_id}}
