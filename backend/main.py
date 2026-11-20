import logging
import os
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

# CORS 中間件設定（依環境變數白名單控制，避免萬用字元搭配憑證傳送）
_DEFAULT_CORS_ORIGINS = [
    "https://management-dashboard-rust.vercel.app",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
]
_env_cors = [o.strip() for o in (os.getenv("CORS_ORIGINS") or "").split(",") if o.strip()]
_allowed_origins = _env_cors if _env_cors else _DEFAULT_CORS_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=r"^https://management-dashboard-[a-z0-9-]+\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# 掛載業務模組路由器
from backend.routers import (
    auth,
    visit_records,
    dashboard,
    pdca,
    admin,
    webhook,
    google_maps,
)

app.include_router(auth.router)
app.include_router(visit_records.router)
app.include_router(dashboard.router)
app.include_router(pdca.router)
app.include_router(admin.router)
app.include_router(webhook.router)
app.include_router(google_maps.router)

@app.get("/")
def root():
    return {"status": "ok", "message": "東寵戰情牆 API 運作中"}
