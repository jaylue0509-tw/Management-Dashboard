import uuid
import logging
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, Body
from psycopg2.extras import Json

from backend.database import get_db_connection
from backend.security import get_optional_user
from backend.utils import _normalize_store, _build_defect_label, _taipei_date_after

logger = logging.getLogger("dashboard-api")
router = APIRouter(prefix="/api", tags=["PDCA 與改善項目"])

@router.post("/pdca/resolve-store")
def resolve_store_pdca(payload: dict = Body(...), user: Optional[dict] = Depends(get_optional_user)):
    """
    一鍵結案指定門市之未結案缺失與 PDCA 事項
    """
    store_name = str(payload.get("storeName") or "").strip()
    if not store_name:
        raise HTTPException(status_code=400, detail="缺少門市名稱")
    norm_store = _normalize_store(store_name)
    now_iso = datetime.utcnow().isoformat()
    resolved_by = (user or {}).get("name") or payload.get("resolvedBy") or "區主管"
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE action_items SET data = data || %s WHERE replace(store_name, '店', '') = %s",
                (Json({"status": "Closed", "updatedAt": now_iso, "resolvedBy": resolved_by}), norm_store)
            )
            cur.execute(
                "UPDATE visit_records SET data = data || %s WHERE replace(data->>'storeName', '店', '') = %s",
                (Json({"pdcaResolved": True, "pdcaResolvedAt": now_iso, "pdcaResolvedBy": resolved_by}), norm_store)
            )
        conn.commit()
    return {"success": True, "storeName": store_name}

@router.get("/action-items", response_model=List[dict])
def get_action_items(store: str = "", user: Optional[dict] = Depends(get_optional_user)):
    """
    取得待改善行動項目清單
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            if user and user.get("role") in ("manager", "beauty_director"):
                mgr_name = user.get("name")
                assigned = list(user.get("assigned_stores") or [])
                if user.get("sub"):
                    cur.execute("SELECT assigned_stores FROM users WHERE username = %s", (user.get("sub"),))
                    u_row = cur.fetchone()
                    if u_row and u_row[0]:
                        assigned = list(u_row[0])
                if store:
                    if store not in assigned and _normalize_store(store) not in {_normalize_store(s) for s in assigned}:
                        return []
                    cur.execute("SELECT data FROM action_items WHERE replace(store_name, '店', '') = %s ORDER BY created_at DESC", (_normalize_store(store),))
                elif user.get("role") == "beauty_director":
                    cur.execute(
                        "SELECT data FROM action_items WHERE data->>'createdBy' = %s OR (store_name = ANY(%s) AND data->>'auditDepartment' = '美容') ORDER BY created_at DESC LIMIT 200",
                        (mgr_name, assigned)
                    )
                else:
                    cur.execute(
                        "SELECT data FROM action_items WHERE store_name = ANY(%s) OR data->>'assignee' = %s OR data->>'createdBy' = %s ORDER BY created_at DESC LIMIT 200",
                        (assigned, mgr_name, mgr_name)
                    )
            else:
                if store:
                    cur.execute("SELECT data FROM action_items WHERE replace(store_name, '店', '') = %s ORDER BY created_at DESC", (_normalize_store(store),))
                else:
                    cur.execute("SELECT data FROM action_items ORDER BY created_at DESC LIMIT 200")
            rows = cur.fetchall()
            items = [
                row[0] for row in rows
                if row[0] and "測試" not in str(row[0].get("desc") or "") and "測試" not in str(row[0].get("issueDescription") or "")
            ]
            
            # 若指定門市查詢且尚無 Open 之 action_items，自動從該門市未結案之異常巡店紀錄合成待複查項目
            if store and not any(i.get("status") == "Open" for i in items):
                cur.execute(
                    "SELECT id, created_at, data FROM visit_records WHERE replace(data->>'storeName', '店', '') = %s ORDER BY created_at DESC LIMIT 5",
                    (_normalize_store(store),)
                )
                for vr_id, vr_created, vr_data in cur.fetchall():
                    if not vr_data or vr_data.get("pdcaResolved") is True:
                        continue
                    cat_checks = vr_data.get("categoryChecks") or {}
                    core_checks_vr = vr_data.get("coreChecks") or {}
                    remarks_vr = vr_data.get("categoryRemarks") or {}
                    defects_found = []
                    for ck, cv in {**core_checks_vr, **cat_checks}.items():
                        if cv in ("缺失", "待改善", "違規"):
                            label = _build_defect_label(ck)
                            rmk = remarks_vr.get(ck)
                            defects_found.append(f"{label} ({cv})" + (f"：{rmk}" if rmk else ""))
                    if not defects_found and vr_data.get("abnormalFlag"):
                        defects_found.append("前次巡檢發現異常待複查確認")
                    if defects_found:
                        is_beauty_vr = vr_data.get("auditType") == "beauty" or vr_data.get("actionType") == "美容總監巡店"
                        items.append({
                            "id": f"vr-{vr_id}",
                            "storeName": store,
                            "auditDepartment": "美容" if is_beauty_vr else "營運",
                            "desc": "；".join(defects_found),
                            "issueDescription": "；".join(defects_found),
                            "assignee": "美容師" if is_beauty_vr else "店長",
                            "dueDate": (vr_created.date().isoformat() if vr_created else _taipei_date_after(0)),
                            "status": "Open",
                            "sourceRecordId": vr_id
                        })
                        break
            return items

@router.post("/action-items")
def create_action_item(payload: dict = Body(...)):
    """
    新增待改善事項
    """
    item_id = str(uuid.uuid4())
    payload["id"] = item_id
    payload["createdAt"] = datetime.utcnow().isoformat()
    if "status" not in payload:
        payload["status"] = "Open"
    store_name = payload.get("storeName", "未知門市")
    
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO action_items (id, store_name, created_at, data)
                VALUES (%s, %s, %s, %s)
            """, (item_id, store_name, datetime.utcnow(), Json(payload)))
        conn.commit()
    return {"success": True, "data": payload}

@router.put("/action-items/{item_id}")
def update_action_item(
    item_id: str,
    payload: dict = Body(...),
    user: Optional[dict] = Depends(get_optional_user),
):
    """
    更新待改善事項狀態與註記（支援單筆直接結案，並於該店同部門待辦全數結案時自動同步更新巡店紀錄結案狀態）
    """
    now_iso = datetime.utcnow().isoformat()
    resolved_by = (user or {}).get("name") or payload.get("resolvedBy") or "區主管"

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # 相容虛擬合成待辦 ID（vr-{visit_record_id}）直接結案
            if str(item_id).startswith("vr-"):
                vr_id = str(item_id)[3:]
                cur.execute("SELECT data FROM visit_records WHERE id = %s", (vr_id,))
                vr_row = cur.fetchone()
                if not vr_row:
                    raise HTTPException(status_code=404, detail="找不到對應之巡店紀錄")
                cur.execute(
                    "UPDATE visit_records SET data = data || %s WHERE id = %s",
                    (Json({"pdcaResolved": True, "pdcaResolvedAt": now_iso, "pdcaResolvedBy": resolved_by}), vr_id),
                )
                conn.commit()
                return {"success": True, "data": {"id": item_id, "status": "Closed", "updatedAt": now_iso}}

            cur.execute("SELECT data, store_name FROM action_items WHERE id = %s", (item_id,))
            row = cur.fetchone()
            if not row or not row[0]:
                raise HTTPException(status_code=404, detail="Item not found")
            
            data = dict(row[0])
            store_name = row[1] or data.get("storeName") or ""
            data.update(payload)
            data["updatedAt"] = now_iso
            if data.get("status") == "Closed" and not data.get("resolvedBy"):
                data["resolvedBy"] = resolved_by
            
            cur.execute(
                "UPDATE action_items SET data = %s WHERE id = %s",
                (Json(data), item_id),
            )

            # 若本次將待辦標記為 Closed，檢查該門市同部門是否已無其他 Open 待辦；若已全數結案，同步標記原巡店紀錄 pdcaResolved
            if data.get("status") == "Closed" and store_name:
                norm_store = _normalize_store(store_name)
                item_dept = data.get("auditDepartment") or "營運"
                cur.execute(
                    "SELECT data FROM action_items WHERE replace(store_name, '店', '') = %s AND id != %s",
                    (norm_store, item_id),
                )
                remaining_open = [
                    r[0] for r in cur.fetchall()
                    if r[0]
                    and (r[0].get("status") or "Open") == "Open"
                    and (r[0].get("auditDepartment") or "營運") == item_dept
                ]
                if not remaining_open:
                    if item_dept == "美容":
                        cur.execute(
                            "UPDATE visit_records SET data = data || %s WHERE replace(data->>'storeName', '店', '') = %s AND (data->>'auditType' = 'beauty' OR data->>'actionType' = '美容總監巡店')",
                            (Json({"pdcaResolved": True, "pdcaResolvedAt": now_iso, "pdcaResolvedBy": resolved_by}), norm_store),
                        )
                    else:
                        cur.execute(
                            "UPDATE visit_records SET data = data || %s WHERE replace(data->>'storeName', '店', '') = %s AND COALESCE(data->>'auditType', '') != 'beauty' AND COALESCE(data->>'actionType', '') != '美容總監巡店'",
                            (Json({"pdcaResolved": True, "pdcaResolvedAt": now_iso, "pdcaResolvedBy": resolved_by}), norm_store),
                        )
        conn.commit()
    return {"success": True, "data": data}

