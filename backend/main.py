import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Body

load_dotenv()
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import uuid
import pymongo

app = FastAPI(title="東寵戰情牆 API", description="採用 MongoDB + FastAPI 的強大後端")

@app.on_event("startup")
async def startup_db_client():
    # 建立索引以確保大量資料時的查詢與排序效能
    await db.visit_records.create_index([("createdAt", pymongo.DESCENDING)])
    await db.visit_records.create_index([("region", pymongo.ASCENDING), ("createdAt", pymongo.DESCENDING)])

# CORS 設定：允許前端 (localhost:5173 等) 進行跨域請求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === MongoDB 連線設定 ===
# 可透過環境變數設定 MONGO_URI。若未設定，預設連線至本機的 MongoDB
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = "dongchong_dashboard"

client = AsyncIOMotorClient(MONGO_URI)
db = client[DB_NAME]

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
    # 暫時回傳假資料，後續可實作對 db.visit_records 的 MongoDB Aggregate 彙總
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
    # 建立查詢條件，將過濾交給 MongoDB 而不是 Python，搭配索引大幅提升效能
    query = {}
    if region != "all":
        query["region"] = region
        
    # 從 MongoDB 讀取，排除 _id 欄位以免 JSON 轉換出錯
    cursor = db.visit_records.find(query, {"_id": 0}).sort("createdAt", pymongo.DESCENDING)
    records = await cursor.to_list(length=100)
    
    return records

@app.get("/api/managers", response_model=List[Manager])
async def get_managers():
    cursor = db.managers.find({}, {"_id": 0})
    managers = await cursor.to_list(length=100)
    if not managers:
        return []
    return managers

@app.post("/api/managers/import")
async def import_managers(managers: List[Manager] = Body(...)):
    if not managers:
        raise HTTPException(status_code=400, detail="No data provided")
        
    # 清空現有資料
    await db.managers.delete_many({})
    
    # 轉換為 dictionary list 並確保沒有 _id 衝突
    payload = [m.model_dump() for m in managers]
    
    # 大量寫入 MongoDB
    await db.managers.insert_many(payload)
    return {"success": True, "count": len(payload)}

@app.post("/api/visit-records")
async def create_visit_record(payload: dict = Body(...)):
    record_id = str(uuid.uuid4())
    payload["recordId"] = record_id
    payload["createdAt"] = datetime.utcnow()
    
    # 將前端送來的 Payload 直接寫入 MongoDB Document
    await db.visit_records.insert_one(payload)
    return {"success": True, "data": {"recordId": record_id}}
