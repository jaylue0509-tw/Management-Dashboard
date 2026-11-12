import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, Body
from psycopg2.extras import Json

from backend.database import get_db_connection
from backend.security import get_current_user, get_optional_user
from backend.schemas import Manager
from backend.utils import _normalize_activity_time

logger = logging.getLogger("dashboard-api")
router = APIRouter(prefix="/api", tags=["戰情數據與門市組織"])

@router.get("/managers", response_model=List[Manager])
def get_managers(user: Optional[dict] = Depends(get_optional_user)):
    """
    取得門市主管組織資料
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            row = cur.fetchone()
            if row:
                data = row[0]
                if user and user.get("role") == "manager":
                    mgr_name = user.get("name")
                    assigned = set(user.get("assigned_stores") or [])
                    return [
                        m for m in data
                        if m.get("areaManagerName") == mgr_name
                        or m.get("deputyManagerName") == mgr_name
                        or m.get("storeName") in assigned
                    ]
                return data
            return []

@router.post("/managers/import")
def import_managers(managers: List[Manager] = Body(...), user: dict = Depends(get_current_user)):
    """
    整份覆寫門市組織主檔（僅限總部管理員）
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="僅系統管理員可進行匯入操作")
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO store (id, data) VALUES ('managers', %s)
                ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
            """, (Json([m.dict() for m in managers]),))
        conn.commit()
    return {"success": True, "count": len(managers)}

@router.get("/dashboard-data")
def get_dashboard_data(time_range: str = "day", region: str = "all", user: Optional[dict] = Depends(get_optional_user)):
    """
    獲取戰情牆首頁全部聚合數據（門市組織、活動紀錄、待改善項目）
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # 1. Get Managers
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            row = cur.fetchone()
            managers = row[0] if row else []
            
            # 2. Get Activities
            query = "SELECT data, created_at FROM visit_records"
            params = []
            conditions = []
            
            if time_range == "all":
                pass
            elif time_range == "week":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('week', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))")
            elif time_range == "last_week":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('week', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')) - interval '1 week'")
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') < date_trunc('week', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))")
            elif time_range == "month":
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei') >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))")
            else:
                conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date = ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei'))::date")
            
            if region != "all":
                conditions.append("region = %s")
                params.append(region)
                
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
                
            query += " ORDER BY created_at DESC LIMIT 500"
            cur.execute(query, tuple(params))
            activities = [
                _normalize_activity_time(r[0], r[1]) for r in cur.fetchall()
                if r[0]
                and "測試" not in str(r[0].get("storeName") or "")
                and "文心秀泰" not in str(r[0].get("storeName") or "")
                and r[0].get("recordId") != "0ec0b2f0-45ee-44e6-8db4-4a6fddd15d3c"
                and not any("測試" in str((it or {}).get("desc") or "") for it in (r[0].get("newActionItems") or []))
            ]
            
            # 3. Get Action Items
            action_items = []
            try:
                cur.execute("SELECT data FROM action_items ORDER BY created_at DESC LIMIT 200")
                action_items = [
                    r[0] for r in cur.fetchall()
                    if r[0]
                    and "測試" not in str(r[0].get("storeName") or "")
                    and "文心秀泰" not in str(r[0].get("storeName") or "")
                    and "測試" not in str(r[0].get("desc") or "")
                    and "測試" not in str(r[0].get("issueDescription") or "")
                    and r[0].get("sourceRecordId") != "0ec0b2f0-45ee-44e6-8db4-4a6fddd15d3c"
                ]
            except Exception as e:
                logger.warning("Failed to fetch action_items: %s", e)
                conn.rollback()
            
            # 區主管權限過濾（同步 users 最新負責門市）
            if user and user.get("role") == "manager" and user.get("sub"):
                cur.execute("SELECT name, assigned_stores FROM users WHERE username = %s", (user.get("sub"),))
                u_row = cur.fetchone()
                if u_row:
                    user = {**user, "name": u_row[0] or user.get("name"), "assigned_stores": u_row[1] or []}
            if user and user.get("role") == "manager":
                mgr_name = user.get("name")
                assigned = set(user.get("assigned_stores") or [])
                managers = [
                    m for m in managers
                    if m.get("areaManagerName") == mgr_name
                    or m.get("deputyManagerName") == mgr_name
                    or m.get("storeName") in assigned
                ]
                co_mgrs = {mgr_name}
                for m in managers:
                    if m.get("areaManagerName"):
                        co_mgrs.add(m.get("areaManagerName"))
                    if m.get("deputyManagerName"):
                        co_mgrs.add(m.get("deputyManagerName"))
                activities = [
                    a for a in activities
                    if a.get("areaManagerName") in co_mgrs or a.get("storeName") in assigned
                ]
                action_items = [
                    i for i in action_items
                    if i.get("storeName") in assigned
                    or i.get("assignee") in co_mgrs
                    or i.get("createdBy") in co_mgrs
                ]

            return {
                "managers": managers,
                "activities": activities,
                "actionItems": action_items
            }

