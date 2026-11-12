import logging
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 載入環境變數
load_dotenv()

# 設定日誌
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("dashboard-api")

# 初始化資料庫連線與資料表結構
from backend.database import (
    get_db_connection,
    init_db,
    ITEM_NAMES,
    POSTGRES_URL,
    db_pool,
)
from backend.security import (
    pwd_context,
    JWT_SECRET,
    JWT_ALGORITHM,
    get_current_user,
    get_optional_user,
    require_admin,
)
from backend.schemas import (
    Manager,
    VisitRecord,
    PhotoPair,
    LoginRequest,
)

# 執行資料庫自動初始化
init_db()

# 建立 FastAPI 主應用程式實例
app = FastAPI(
    title="東寵戰情牆 API",
    description="採用 Vercel Postgres (Neon) 的輕量級後端模組化架構",
    version="2.0.0"
)

# CORS 中間件設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 掛載業務模組路由器
from backend.routers import (
    auth,
    visit_records,
    dashboard,
    pdca,
    admin,
    webhook,
)

app.include_router(auth.router)
app.include_router(visit_records.router)
app.include_router(dashboard.router)
app.include_router(pdca.router)
app.include_router(admin.router)
app.include_router(webhook.router)

@app.get("/")
def root():
    return {"status": "ok", "message": "東寵戰情牆 API 運作中"}
