import uuid
import logging
from datetime import datetime
from fastapi import APIRouter, Body
from psycopg2.extras import Json

from backend.database import get_db_connection

logger = logging.getLogger("dashboard-api")
router = APIRouter(prefix="/api/webhook", tags=["Webhook 整合"])

@router.post("/google-forms")
def webhook_google_forms(payload: dict = Body(...)):
    """
    接收並解析 Google 表單回傳的巡店問卷資料
    """
    record_id = str(uuid.uuid4())
    
    store_name = payload.get("storeName") or "未知門市"
    store_name = str(store_name).strip()
    
    # 強制從 DB 反查區主管名字，不信任 Google Forms 傳入的防呆防錯位
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

