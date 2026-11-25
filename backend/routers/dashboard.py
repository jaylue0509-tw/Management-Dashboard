import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel, Field
from psycopg2.extras import Json

from backend.database import get_db_connection, BEAUTY_DEPT_1_REGIONS, sync_beauty_directors
from backend.security import get_current_user, get_optional_user
from backend.schemas import Manager
from backend.utils import _normalize_activity_time

logger = logging.getLogger("dashboard-api")
router = APIRouter(prefix="/api", tags=["戰情數據與門市組織"])
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}$")

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
                if user and user.get("role") == "beauty_director":
                    bd_dept = (user.get("department") or "").strip()
                    assigned = set(user.get("assigned_stores") or [])
                    if bd_dept == "美容一處":
                        return [
                            m for m in data
                            if m.get("region") in BEAUTY_DEPT_1_REGIONS or m.get("storeName") in assigned
                        ]
                    if bd_dept == "美容二處":
                        return [
                            m for m in data
                            if (m.get("region") not in BEAUTY_DEPT_1_REGIONS) or m.get("storeName") in assigned
                        ]
                    return [m for m in data if m.get("storeName") in assigned]
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
        sync_beauty_directors(conn)
    return {"success": True, "count": len(managers)}

@router.get("/dashboard-data")
def get_dashboard_data(
    time_range: str = "day",
    region: str = "all",
    limit: int = 3000,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: Optional[dict] = Depends(get_optional_user),
):
    """
    獲取戰情牆首頁全部聚合數據（門市組織、活動紀錄、待改善項目）
    支援自訂安全上限 (預設 3000 筆、最高 5000 筆) 與日期區間篩選，避免跨月車資與歷史報表被截斷
    """
    # 防呆限流，避免惡意或誤傳超大 limit 拖垮資料庫
    safe_limit = max(100, min(limit, 5000))

    if start_date and not DATE_PATTERN.match(start_date):
        raise HTTPException(status_code=400, detail="start_date 格式需為 YYYY-MM-DD")
    if end_date and not DATE_PATTERN.match(end_date):
        raise HTTPException(status_code=400, detail="end_date 格式需為 YYYY-MM-DD")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # 1. Get Managers
            cur.execute("SELECT data FROM store WHERE id = 'managers'")
            row = cur.fetchone()
            managers = row[0] if row else []

            # 2. Get Activities
            query = "SELECT data, created_at FROM visit_records"
            params: list = []
            conditions: list = []

            if start_date or end_date:
                if start_date:
                    conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date >= %s::date")
                    params.append(start_date)
                if end_date:
                    conditions.append("(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Taipei')::date <= %s::date")
                    params.append(end_date)
            elif time_range == "all":
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

            # 多查 1 筆以判斷是否有截斷
            query += " ORDER BY created_at DESC LIMIT %s"
            params.append(safe_limit + 1)
            cur.execute(query, tuple(params))
            raw_rows = cur.fetchall()
            truncated = len(raw_rows) > safe_limit
            if truncated:
                raw_rows = raw_rows[:safe_limit]

            activities = [
                _normalize_activity_time(r[0], r[1]) for r in raw_rows
                if r[0]
                and "測試" not in str(r[0].get("storeName") or "")
                and "文心秀泰" not in str(r[0].get("storeName") or "")
                and r[0].get("recordId") != "0ec0b2f0-45ee-44e6-8db4-4a6fddd15d3c"
                and not any("測試" in str((it or {}).get("desc") or "") for it in (r[0].get("newActionItems") or []))
            ]

            # 3. Get Action Items（放寬上限至 1000 筆避免活躍 PDCA 遭截斷）
            action_items = []
            try:
                cur.execute("SELECT data FROM action_items ORDER BY created_at DESC LIMIT 1000")
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

            # 區主管／美容總監權限過濾（同步 users 最新負責門市與所屬處別）
            if user and user.get("role") in ("manager", "beauty_director") and user.get("sub"):
                cur.execute(
                    "SELECT name, assigned_stores, department, supervisor FROM users WHERE username = %s",
                    (user.get("sub"),),
                )
                u_row = cur.fetchone()
                if u_row:
                    user = {
                        **user,
                        "name": u_row[0] or user.get("name"),
                        "assigned_stores": u_row[1] or [],
                        "department": u_row[2] or user.get("department") or "",
                        "supervisor": u_row[3] or user.get("supervisor") or "",
                    }
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
            elif user and user.get("role") == "beauty_director":
                # 美容總監嚴格隔離：依美容一處（新北/北桃/竹苗/宜花/嘉南）與美容二處（其餘區域）切分，並僅回傳本人巡店紀錄
                bd_name = (user.get("name") or "").strip()
                bd_dept = (user.get("department") or "").strip()
                assigned = set(user.get("assigned_stores") or [])
                if bd_dept == "美容一處":
                    managers = [
                        m for m in managers
                        if m.get("region") in BEAUTY_DEPT_1_REGIONS or m.get("storeName") in assigned
                    ]
                elif bd_dept == "美容二處":
                    managers = [
                        m for m in managers
                        if (m.get("region") not in BEAUTY_DEPT_1_REGIONS) or m.get("storeName") in assigned
                    ]
                else:
                    managers = [m for m in managers if m.get("storeName") in assigned]
                dept_store_names = {m.get("storeName") for m in managers if m.get("storeName")} | assigned
                activities = [
                    a for a in activities
                    if (a.get("areaManagerName") or "").strip() == bd_name
                ]
                action_items = [
                    i for i in action_items
                    if (i.get("createdBy") or "").strip() == bd_name
                    or (i.get("storeName") in dept_store_names and i.get("auditDepartment") == "美容")
                ]

            return {
                "managers": managers,
                "activities": activities,
                "actionItems": action_items,
                "meta": {
                    "activityCount": len(activities),
                    "limit": safe_limit,
                    "truncated": truncated,
                },
            }


class ManagerStartAddressPayload(BaseModel):
    targetManager: str = Field(..., min_length=1, max_length=60, description="主管姓名或 __global__")
    address: Optional[str] = Field(default=None, max_length=200)
    lat: Optional[float] = Field(default=None, ge=21.0, le=26.5)
    lng: Optional[float] = Field(default=None, ge=118.0, le=123.0)
    source: Optional[str] = Field(default="nominatim", max_length=32)
    matchedDisplayName: Optional[str] = Field(default=None, max_length=300)
    clear: bool = Field(default=False, description="是否清除該主管起始地址")


@router.get("/manager-start-addresses")
def get_manager_start_addresses(user: dict = Depends(get_current_user)):
    """
    取得區主管自訂起始點地址設定（持久化於資料庫，手機／電腦／總部統一標準）
    - 管理員 (admin)：取得全體主管起始點
    - 區主管 (manager)：僅能取得自己本人之起始點
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM store WHERE id = 'manager_start_addresses'")
            row = cur.fetchone()
            stored = row[0] if row and isinstance(row[0], dict) else {"global": None, "byManager": {}}

    by_mgr = stored.get("byManager") if isinstance(stored.get("byManager"), dict) else {}
    global_cfg = stored.get("global") if isinstance(stored.get("global"), dict) else None

    if user.get("role") != "admin":
        mgr_name = (user.get("name") or "").strip()
        personal = {mgr_name: by_mgr[mgr_name]} if mgr_name and mgr_name in by_mgr else {}
        return {"global": None, "byManager": personal}

    return {"global": global_cfg, "byManager": by_mgr}


@router.put("/manager-start-addresses")
def upsert_manager_start_address(
    payload: ManagerStartAddressPayload,
    user: dict = Depends(get_current_user),
):
    """
    新增、修改或清除區主管專屬出發起始點地址
    - 區主管 (manager)：僅能修改自己本人之起始地址，禁止異動他人或全域設定
    - 管理員 (admin)：可設定任一主管或全體通用起始地址
    """
    target = payload.targetManager.strip()
    is_admin = user.get("role") == "admin"
    current_name = (user.get("name") or "").strip()

    if not is_admin:
        if target == "__global__" or target != current_name:
            raise HTTPException(status_code=403, detail="區主管僅能設定或修改自己本人的出發起始點地址")

    if not payload.clear:
        if not payload.address or not payload.address.strip():
            raise HTTPException(status_code=400, detail="請填寫有效的出發起始點地址")
        if payload.lat is None or payload.lng is None:
            raise HTTPException(status_code=400, detail="缺少地址定位座標，請重新定位")

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM store WHERE id = 'manager_start_addresses'")
            row = cur.fetchone()
            stored = row[0] if row and isinstance(row[0], dict) else {"global": None, "byManager": {}}
            if not isinstance(stored.get("byManager"), dict):
                stored["byManager"] = {}

            if payload.clear:
                if target == "__global__":
                    stored["global"] = None
                else:
                    stored["byManager"].pop(target, None)
            else:
                entry = {
                    "address": payload.address.strip(),
                    "lat": float(payload.lat),
                    "lng": float(payload.lng),
                    "source": payload.source or "nominatim",
                    "matchedDisplayName": payload.matchedDisplayName or payload.address.strip(),
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "updatedBy": current_name or user.get("sub") or "",
                }
                if target == "__global__":
                    stored["global"] = entry
                else:
                    stored["byManager"][target] = entry

            cur.execute(
                """
                INSERT INTO store (id, data) VALUES ('manager_start_addresses', %s)
                ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
                """,
                (Json(stored),),
            )
        conn.commit()

    if not is_admin:
        personal = {current_name: stored["byManager"][current_name]} if current_name in stored["byManager"] else {}
        return {"success": True, "data": {"global": None, "byManager": personal}}

    return {"success": True, "data": stored}


class PettyCashDraftPayload(BaseModel):
    managerName: str = Field(..., min_length=1, max_length=60, description="區主管姓名")
    monthKey: str = Field(..., min_length=7, max_length=7, description="統計月份 YYYY-MM")
    formSerialNo: Optional[str] = Field(default="", max_length=60)
    purposePrefix: Optional[str] = Field(default="", max_length=240)
    vehicleType: Optional[str] = Field(default="car", max_length=20)
    ratePerKm: Optional[float] = Field(default=6.5, ge=0.0, le=100.0)
    evidencePatches: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    customRows: List[Dict[str, Any]] = Field(default_factory=list, max_length=120)
    reset: bool = Field(default=False, description="是否重置並清空當月草稿")


def _build_petty_cash_draft_id(manager_name: str, month_key: str) -> str:
    return f"petty_cash_draft:{manager_name}:{month_key}"


@router.get("/petty-cash-drafts")
def get_petty_cash_draft(
    manager_name: str,
    month_key: str,
    user: dict = Depends(get_current_user),
):
    """
    取得指定區主管於指定月份的《零用金單據黏存單》雲端草稿（手機／電腦／總部跨裝置同步）
    - 區主管 (manager)：嚴格僅能讀取自己本人的草稿
    - 管理員 (admin)：可讀取任一主管草稿進行線上核對
    """
    target_mgr = manager_name.strip()
    target_month = month_key.strip()
    if not target_mgr or not MONTH_PATTERN.match(target_month):
        raise HTTPException(status_code=400, detail="無效的主管姓名或月份格式（需為 YYYY-MM）")

    is_admin = user.get("role") == "admin"
    current_name = (user.get("name") or "").strip()
    if not is_admin and target_mgr != current_name:
        raise HTTPException(status_code=403, detail="區主管僅能檢視自己本人的零用金單據黏存單草稿")

    store_id = _build_petty_cash_draft_id(target_mgr, target_month)
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM store WHERE id = %s", (store_id,))
            row = cur.fetchone()
            draft = row[0] if row and isinstance(row[0], dict) else None

    return {"success": True, "draft": draft}


@router.put("/petty-cash-drafts")
def upsert_petty_cash_draft(
    payload: PettyCashDraftPayload,
    user: dict = Depends(get_current_user),
):
    """
    儲存或重置指定區主管於指定月份的《零用金單據黏存單》雲端草稿
    - 區主管 (manager)：僅能儲存或重置自己本人的草稿
    - 管理員 (admin)：可協助調整並儲存任一主管草稿
    """
    target_mgr = payload.managerName.strip()
    target_month = payload.monthKey.strip()
    if not target_mgr or not MONTH_PATTERN.match(target_month):
        raise HTTPException(status_code=400, detail="無效的主管姓名或月份格式（需為 YYYY-MM）")

    is_admin = user.get("role") == "admin"
    current_name = (user.get("name") or "").strip()
    if not is_admin and target_mgr != current_name:
        raise HTTPException(status_code=403, detail="區主管僅能儲存或修改自己本人的零用金單據黏存單草稿")

    store_id = _build_petty_cash_draft_id(target_mgr, target_month)

    if payload.reset:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM store WHERE id = %s", (store_id,))
            conn.commit()
        return {"success": True, "draft": None}

    if len(payload.evidencePatches) > 120:
        raise HTTPException(status_code=400, detail="草稿筆數超過上限")

    now_iso = datetime.now(timezone.utc).isoformat()
    draft_doc = {
        "managerName": target_mgr,
        "monthKey": target_month,
        "formSerialNo": (payload.formSerialNo or "").strip(),
        "purposePrefix": (payload.purposePrefix or "").strip(),
        "vehicleType": payload.vehicleType if payload.vehicleType in ("car", "motorcycle") else "car",
        "ratePerKm": float(payload.ratePerKm if payload.ratePerKm is not None else 6.5),
        "evidencePatches": payload.evidencePatches,
        "customRows": payload.customRows,
        "updatedAt": now_iso,
        "updatedBy": current_name or user.get("sub") or "",
    }

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO store (id, data) VALUES (%s, %s)
                ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
                """,
                (store_id, Json(draft_doc)),
            )
        conn.commit()

    return {"success": True, "draft": draft_doc}


@router.get("/petty-cash-drafts/summary")
def get_petty_cash_drafts_summary(
    month_key: str,
    user: dict = Depends(get_current_user),
):
    """
    取得指定月份各區主管《零用金單據黏存單》雲端填報狀態摘要（管理員可檢視全區，區主管僅檢視自己）
    """
    target_month = month_key.strip()
    if not MONTH_PATTERN.match(target_month):
        raise HTTPException(status_code=400, detail="無效的月份格式（需為 YYYY-MM）")

    is_admin = user.get("role") == "admin"
    current_name = (user.get("name") or "").strip()

    summaries: Dict[str, Dict[str, Any]] = {}
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            if is_admin:
                cur.execute(
                    "SELECT data FROM store WHERE id LIKE %s",
                    (f"petty_cash_draft:%:{target_month}",),
                )
            else:
                if not current_name:
                    return {"success": True, "monthKey": target_month, "byManager": {}}
                cur.execute(
                    "SELECT data FROM store WHERE id = %s",
                    (_build_petty_cash_draft_id(current_name, target_month),),
                )

            for (doc,) in cur.fetchall():
                if not isinstance(doc, dict):
                    continue
                mgr = str(doc.get("managerName") or "").strip()
                if not mgr:
                    continue
                ev_patches = doc.get("evidencePatches") if isinstance(doc.get("evidencePatches"), dict) else {}
                custom_rows = doc.get("customRows") if isinstance(doc.get("customRows"), list) else []
                invoice_count = sum(
                    1 for v in ev_patches.values()
                    if isinstance(v, dict) and str(v.get("invoiceNumber") or "").strip()
                ) + sum(
                    1 for r in custom_rows
                    if isinstance(r, dict) and str(r.get("invoiceNumber") or "").strip()
                )
                summaries[mgr] = {
                    "updatedAt": doc.get("updatedAt") or "",
                    "updatedBy": doc.get("updatedBy") or "",
                    "formSerialNo": doc.get("formSerialNo") or "",
                    "customRowCount": len(custom_rows),
                    "invoiceCount": invoice_count,
                }

    return {"success": True, "monthKey": target_month, "byManager": summaries}



