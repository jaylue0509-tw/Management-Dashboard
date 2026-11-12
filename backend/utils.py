import os
import re
import uuid
import base64
import logging
from datetime import datetime, timedelta
from typing import Optional
import requests
import psycopg2
from backend.database import ITEM_NAMES

logger = logging.getLogger("dashboard-api")

DATA_URL_PATTERN = re.compile(r'^data:(image/[a-zA-Z0-9.+-]+)(?:;[a-zA-Z0-9=._-]+)*;base64,(.+)$', re.DOTALL)
TAIPEI_OFFSET = timedelta(hours=8)
CORE_ITEM_NAMES = {'core-1': '環境異味與清潔', 'core-2': '櫃檯焦點陳列', 'core-3': '人員狀態與迎賓'}
MODULE_NAMES = ['行銷與檔期執行', '商品陳列與損耗管理', '寵物專業服務與照護', '人員服務與顧客體驗', '門市環境與設備安全', '經營數據與團隊管理']

def trigger_teams_notify(message: str):
    webhook_url = os.getenv("TEAMS_WEBHOOK_URL")
    if not webhook_url:
        logger.info("No TEAMS_WEBHOOK_URL found. Skip sending Teams notify.")
        return
    headers = {"Content-Type": "application/json"}
    data = {"text": message}
    try:
        requests.post(webhook_url, headers=headers, json=data, timeout=5)
    except Exception as e:
        logger.warning("Failed to send Teams notify: %s", e)

def _taipei_date_after(days: int) -> str:
    """回傳台北時區今天往後 N 天的日期字串 (YYYY-MM-DD)"""
    return (datetime.utcnow() + TAIPEI_OFFSET + timedelta(days=days)).date().isoformat()

def _normalize_activity_time(record: dict, db_created_at: Optional[datetime]) -> dict:
    """
    以資料庫 created_at 欄位 (UTC) 為準統一輸出 createdAt，並補上 'Z' 時區標記。
    同時即時計算 timeAgoMinutes。
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
    """門市名稱正規化：去空白與「店」字"""
    return str(name or "").strip().replace("店", "")

def _store_photo(cur, record_id: str, url: str) -> str:
    """
    健壯的照片儲存處理：
    - 支援 JPEG, PNG, WEBP, HEIC 等多種行動裝置圖片 MIME 格式
    - 儲存於 photos 資料表並回傳 /api/photos/{id}
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
            logger.warning("照片解碼寫入警告 (降級保留原圖 Base64 以確保照片顯示): %s", e)
            try:
                cur.execute("ROLLBACK TO SAVEPOINT sp_photo")
            except Exception:
                pass
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

