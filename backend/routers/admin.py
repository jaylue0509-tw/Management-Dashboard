import uuid
import logging
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from psycopg2.extras import Json
from pydantic import BaseModel

from backend.database import get_db_connection
from backend.security import pwd_context, get_current_user
from backend.utils import _normalize_store

logger = logging.getLogger("dashboard-api")
router = APIRouter(prefix="/api/admin", tags=["系統管理"])

class UserUpdateReq(BaseModel):
    username: str
    password: Optional[str] = None
    name: str
    assigned_stores: List[str]

@router.get("/users")
def get_users(user: dict = Depends(get_current_user)):
    """
    獲取所有區主管使用者列表（限管理員）
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT username, role, name, assigned_stores, must_change_password FROM users WHERE role = 'manager' ORDER BY name ASC")
            rows = cur.fetchall()
            return [
                {
                    "username": r[0],
                    "role": r[1],
                    "name": r[2],
                    "assigned_stores": r[3],
                    "must_change_password": True if r[4] is None else bool(r[4])
                }
                for r in rows
            ]

@router.post("/users")
def update_user(req: UserUpdateReq, user: dict = Depends(get_current_user)):
    """
    建立或更新區主管帳號，並同步門市指派與組織主檔（限管理員）
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
        
    req.name = req.name.strip()
    req.username = req.username.strip()
    if not req.name:
        raise HTTPException(status_code=400, detail="Name is required")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name, assigned_stores FROM users WHERE username = %s", (req.username,))
            row = cur.fetchone()
            
            is_new = not row
            if is_new:
                req.username = req.name
                cur.execute("SELECT 1 FROM users WHERE username = %s", (req.username,))
                if cur.fetchone():
                    raise HTTPException(status_code=409, detail="此姓名帳號已存在")
            before_data = {"name": row[0], "assigned_stores": row[1]} if row else None
            after_data = {"name": req.name, "assigned_stores": req.assigned_stores}
            
            if req.password:
                pwd_hash = pwd_context.hash(req.password)
                if is_new:
                    cur.execute("""
                        INSERT INTO users (username, password_hash, role, name, assigned_stores, must_change_password) 
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (req.username, pwd_hash, "manager", req.name, Json(req.assigned_stores), True))
                else:
                    cur.execute("""
                        UPDATE users 
                        SET password_hash = %s, must_change_password = TRUE, name = %s, assigned_stores = %s 
                        WHERE username = %s
                    """, (pwd_hash, req.name, Json(req.assigned_stores), req.username))
                after_data["password_changed"] = True
            else:
                if is_new:
                    raise HTTPException(status_code=400, detail="Password is required for new users")
                cur.execute("UPDATE users SET name = %s, assigned_stores = %s WHERE username = %s",
                            (req.name, Json(req.assigned_stores), req.username))
                            
            log_id = str(uuid.uuid4())
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            mgr_row = cur.fetchone()
            if mgr_row and isinstance(mgr_row[0], list):
                managers_list = mgr_row[0]
                assigned_norm = {_normalize_store(s) for s in (req.assigned_stores or []) if s}
                old_name = (before_data or {}).get("name")
                changed_mgrs = False
                for m in managers_list:
                    m_store_norm = _normalize_store(m.get("storeName"))
                    is_deputy_target = (
                        m.get("deputyManagerName") in (req.name, old_name)
                        and m.get("areaManagerName") not in (req.name, old_name)
                    )
                    if m_store_norm in assigned_norm:
                        if is_deputy_target:
                            if m.get("deputyManagerName") != req.name:
                                m["deputyManagerName"] = req.name
                                changed_mgrs = True
                        elif m.get("areaManagerName") != req.name:
                            m["areaManagerName"] = req.name
                            changed_mgrs = True
                    elif old_name and old_name != req.name:
                        if m.get("deputyManagerName") == old_name:
                            m["deputyManagerName"] = req.name
                            changed_mgrs = True
                        elif m.get("areaManagerName") == old_name:
                            m["areaManagerName"] = req.name
                            changed_mgrs = True
                if changed_mgrs:
                    cur.execute("UPDATE store SET data = %s WHERE id = 'managers'", (Json(managers_list),))

            action = "CREATE_USER" if is_new else "UPDATE_USER"
            cur.execute("""
                INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (log_id, action, req.username, user.get("name", "admin"), Json(before_data) if before_data else None, Json(after_data), datetime.utcnow()))
            
        conn.commit()
    return {"success": True}

@router.get("/audit-logs")
def get_audit_logs(user: dict = Depends(get_current_user)):
    """
    查詢系統異動與操作審計日誌（限管理員）
    """
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, action, target_user, changed_by, before_data, after_data, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100")
            rows = cur.fetchall()
            return [{
                "id": r[0], "action": r[1], "target_user": r[2], "changed_by": r[3],
                "before_data": r[4], "after_data": r[5], "created_at": r[6]
            } for r in rows]

