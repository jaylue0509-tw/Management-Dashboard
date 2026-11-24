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

# 美容總監巡店表專屬項目名稱對照（供後端缺失彙整、Teams 高風險預警與前次紀錄回溯使用）
BEAUTY_CORE_ITEM_NAMES = {
    'b-core-1': '美容操作防墜與牽繩',
    'b-core-2': '美容/住宿區空氣與異味',
    'b-core-3': '住宿水糧與門鎖安全',
}
BEAUTY_MODULE_NAMES = [
    '美容安全操作與服務 SOP',
    '美容技術品質與造型美感',
    '寵物住宿照護與環境管理',
    '美容/住宿環境衛生與設備維護',
    '顧客溝通、衛教與客訴預防',
    '美容營運績效與團隊培育',
]
BEAUTY_ITEM_NAMES = {
    'b-1-1': '接送與體表檢查落實',
    'b-1-2': '洗浴與吹整安全',
    'b-1-3': '工具消毒與防交叉感染',
    'b-2-1': '基礎護理細膩度',
    'b-2-2': '吹整蓬鬆度與剪工線條',
    'b-2-3': '洗劑正確使用與稀釋',
    'b-3-1': '犬貓分區與空間舒適度',
    'b-3-2': '每日照護與健康觀察紀錄',
    'b-3-3': '放風與外出安全規範',
    'b-3-4': '飼主自備品與特殊醫囑管理',
    'b-4-1': '美容室與洗浴區清潔',
    'b-4-2': '每日清消紀錄落實',
    'b-4-3': '專業設備運作與保養',
    'b-4-4': '溫濕度與通風控制',
    'b-5-1': '溝通單與報價透明',
    'b-5-2': '專業皮膚/毛髮衛教與加值推薦',
    'b-5-3': '客訴與突發狀況應變',
    'b-6-1': '預約排程與產能利用率',
    'b-6-2': '美容與門市跨部門協作',
}

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
    """將檢查項目代碼轉為可讀名稱（支援營運區主管與美容總監雙體系題庫）"""
    if key in CORE_ITEM_NAMES:
        return CORE_ITEM_NAMES[key]
    if key in BEAUTY_CORE_ITEM_NAMES:
        return BEAUTY_CORE_ITEM_NAMES[key]
    if key in BEAUTY_ITEM_NAMES:
        return BEAUTY_ITEM_NAMES[key]
    if key.startswith('b-'):
        parts = key.split('-')
        if len(parts) >= 2 and parts[1].isdigit():
            mod_idx = int(parts[1]) - 1
            mod_name = BEAUTY_MODULE_NAMES[mod_idx] if 0 <= mod_idx < len(BEAUTY_MODULE_NAMES) else '美容模組'
            return f"其他{mod_name}異常"
    name = ITEM_NAMES.get(key, key)
    if re.match(r'^\d-\d+$', name):
        mod_idx = int(name.split('-')[0]) - 1
        mod_name = MODULE_NAMES[mod_idx] if 0 <= mod_idx < len(MODULE_NAMES) else '模組'
        return f"其他{mod_name}異常"
    return name

