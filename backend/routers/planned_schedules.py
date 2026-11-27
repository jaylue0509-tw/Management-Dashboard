import logging
import re
import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from psycopg2.extras import Json

from backend.database import (
    BEAUTY_DEPT_2_EXTRA_STORES,
    BEAUTY_DIRECTORS_SEED,
    get_db_connection,
    is_store_in_beauty_department,
    sync_beauty_directors,
)
from backend.organization import business_department_for_region, business_director_for_department
from backend.security import get_current_user

logger = logging.getLogger("dashboard-api")
router = APIRouter(prefix="/api", tags=["預排行程管理"])

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ALLOWED_TIME_SLOTS = {"全天", "上午", "下午"}
ALLOWED_ROLES = {"manager", "beauty_director"}

# 模組層一次性快取旗標：避免每次 GET/POST/PUT/DELETE /planned-schedules 都重跑 DDL 與同步，節省 Neon 耗用並加速回應
_PLANNED_TABLE_READY = False
_BEAUTY_DIRECTORS_SYNCED = False


class PlannedScheduleCreateReq(BaseModel):
    personName: str = Field(..., min_length=1, max_length=60)
    personRole: str = Field(..., min_length=1, max_length=32)
    department: Optional[str] = Field(default="", max_length=60)
    region: Optional[str] = Field(default="", max_length=60)
    scheduleDate: str = Field(..., min_length=10, max_length=10)
    timeSlot: Optional[str] = Field(default="全天", max_length=30)
    scheduleType: str = Field(..., min_length=1, max_length=40)
    storeName: Optional[str] = Field(default="", max_length=120)
    storeNames: Optional[List[str]] = Field(default=None, max_length=30)
    note: Optional[str] = Field(default="", max_length=500)


class PlannedScheduleUpdateReq(BaseModel):
    scheduleDate: Optional[str] = Field(default=None, min_length=10, max_length=10)
    timeSlot: Optional[str] = Field(default=None, max_length=30)
    scheduleType: Optional[str] = Field(default=None, min_length=1, max_length=40)
    storeName: Optional[str] = Field(default=None, max_length=120)
    note: Optional[str] = Field(default=None, max_length=500)


def _ensure_planned_table(cur) -> bool:
    """確保熱實例尚未重跑冷啟動時也能安全建立 planned_schedules 表（同實例僅檢查一次）"""
    global _PLANNED_TABLE_READY
    if _PLANNED_TABLE_READY:
        return False
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS planned_schedules (
            id VARCHAR(50) PRIMARY KEY,
            person_name VARCHAR(60) NOT NULL,
            person_role VARCHAR(32) NOT NULL,
            department VARCHAR(60) DEFAULT '',
            region VARCHAR(60) DEFAULT '',
            schedule_date VARCHAR(10) NOT NULL,
            time_slot VARCHAR(30) DEFAULT '全天',
            schedule_type VARCHAR(40) NOT NULL,
            store_name VARCHAR(120) DEFAULT '',
            note TEXT DEFAULT '',
            created_by VARCHAR(60) DEFAULT '',
            created_at TIMESTAMP,
            updated_at TIMESTAMP
        );
        """
    )
    _PLANNED_TABLE_READY = True
    return True


def _build_full_roster(cur) -> dict:
    """
    彙整系統內「每一位區經理」與「每一位美容總監」之完整名冊與負責門市，
    供預排行程獨立面板呈現完整人員列與快速選店使用。
    """
    cur.execute("SELECT data FROM store WHERE id = 'managers'")
    row = cur.fetchone()
    raw_managers = row[0] if row and isinstance(row[0], list) else []

    # 1. 整理每一位區經理（含正／副區主管）
    mgr_map: dict[str, dict] = {}
    all_valid_stores_by_region: list[tuple[str, str]] = []

    for m in raw_managers:
        s_name = str(m.get("storeName") or "").strip()
        if not s_name or "測試" in s_name or "文心秀泰" in s_name:
            continue
        reg = str(m.get("region") or "").strip()
        if reg == "台南區":
            reg = "嘉南區"
        dept = str(m.get("department") or "").strip()
        director = str(m.get("directorName") or "").strip()
        area_mgr = str(m.get("areaManagerName") or "").strip()
        deputy_mgr = str(m.get("deputyManagerName") or "").strip()

        all_valid_stores_by_region.append((reg, s_name))
        expected_dept = business_department_for_region(reg)
        if expected_dept:
            dept = expected_dept
        expected_director = business_director_for_department(dept)
        if expected_director:
            director = expected_director

        for name, is_deputy in ((area_mgr, False), (deputy_mgr, True)):
            if not name or name in ("無", "陳育廷"):
                continue
            if name not in mgr_map:
                mgr_map[name] = {
                    "name": name,
                    "role": "manager",
                    "title": "副區主管" if is_deputy else "區經理",
                    "department": dept,
                    "supervisor": director,
                    "region": reg,
                    "nickname": "",
                    "stores": [],
                }
            entry = mgr_map[name]
            if not is_deputy:
                entry["title"] = "區經理"
            if dept and entry["department"] != dept:
                entry["department"] = dept
            if reg and not entry["region"]:
                entry["region"] = reg
            if s_name not in entry["stores"]:
                entry["stores"].append(s_name)

    # 補充 users 表中角色為 manager 且仍有轄屬門市之帳號（排除已無門市之離職／舊帳號）
    cur.execute(
        "SELECT name, assigned_stores, department, supervisor FROM users WHERE role = 'manager' AND username != '陳育廷' AND name != '陳育廷' ORDER BY name ASC"
    )
    for u_name, u_stores, u_dept, u_sup in cur.fetchall():
        clean_name = str(u_name or "").strip()
        valid_stores = [s for s in (u_stores or []) if s and "測試" not in s]
        if not clean_name:
            continue
        if clean_name not in mgr_map:
            if not valid_stores:
                continue
            store_region = next((reg for reg, store in all_valid_stores_by_region if store in valid_stores), "")
            mgr_map[clean_name] = {
                "name": clean_name,
                "role": "manager",
                "title": "區經理",
                "department": business_department_for_region(store_region) or str(u_dept or "").strip(),
                "supervisor": str(u_sup or "").strip(),
                "region": store_region,
                "nickname": "",
                "stores": valid_stores,
            }
        elif not mgr_map[clean_name]["stores"] and valid_stores:
            mgr_map[clean_name]["stores"] = valid_stores

    area_managers_roster = sorted(
        mgr_map.values(),
        key=lambda x: (x.get("department") or "zz", x.get("region") or "zz", x.get("name") or ""),
    )

    # 2. 整理每一位美容總監（美容一處：廖羿蓁 / 美容二處：戴欐蘐，含嘉義 4 店共同巡視）
    beauty_roster: list[dict] = []
    for bd in BEAUTY_DIRECTORS_SEED:
        is_dept_1 = bd["is_dept_1"]
        bd_dept = bd["department"]
        bd_stores: list[str] = []
        seen = set()
        for reg, s_name in all_valid_stores_by_region:
            if is_store_in_beauty_department(s_name, reg, bd_dept):
                if s_name not in seen:
                    seen.add(s_name)
                    bd_stores.append(s_name)
        if not is_dept_1:
            for extra_store in sorted(BEAUTY_DEPT_2_EXTRA_STORES):
                if extra_store not in seen:
                    seen.add(extra_store)
                    bd_stores.append(extra_store)

        beauty_roster.append(
            {
                "name": bd["name"],
                "role": "beauty_director",
                "title": "美容總監",
                "department": bd_dept,
                "supervisor": bd["supervisor"],
                "region": "新北/北桃/竹苗/宜花/嘉南" if is_dept_1 else "中投/彰雲/高雄/高屏 + 嘉義4店",
                "nickname": bd["nickname"],
                "stores": bd_stores,
            }
        )

    return {
        "areaManagers": area_managers_roster,
        "beautyDirectors": beauty_roster,
    }


def _get_allowed_person_names(user: dict, roster: dict) -> set[str]:
    """計算當前登入者允許檢視或編輯之預排行程人員姓名集合"""
    role = user.get("role")
    my_name = str(user.get("name") or "").strip()
    if role == "admin":
        return (
            {p["name"] for p in roster["areaManagers"]}
            | {p["name"] for p in roster["beautyDirectors"]}
        )
    if role == "beauty_director":
        # 美容總監嚴格隔離：僅能檢視與編輯自己本人
        return {my_name} if my_name else set()
    if role == "manager":
        # 區經理可檢視與編輯自己（以及同區域正副主管協同）
        my_entry = next((m for m in roster["areaManagers"] if m["name"] == my_name), None)
        if not my_entry or not my_entry.get("region"):
            return {my_name} if my_name else set()
        same_reg = {
            m["name"]
            for m in roster["areaManagers"]
            if m.get("region") == my_entry["region"]
        }
        return same_reg | ({my_name} if my_name else set())
    return set()


@router.get("/planned-schedules")
def list_planned_schedules(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """
    取得指定日期區間內的「區經理預排行程」與「美容總監預排行程」及對應人員名冊
    """
    if start_date and not DATE_RE.match(start_date):
        raise HTTPException(status_code=400, detail="start_date 格式須為 YYYY-MM-DD")
    if end_date and not DATE_RE.match(end_date):
        raise HTTPException(status_code=400, detail="end_date 格式須為 YYYY-MM-DD")

    global _BEAUTY_DIRECTORS_SYNCED
    with get_db_connection() as conn:
        if not _BEAUTY_DIRECTORS_SYNCED:
            try:
                sync_beauty_directors(conn)
                _BEAUTY_DIRECTORS_SYNCED = True
            except Exception:
                conn.rollback()

        with conn.cursor() as cur:
            if _ensure_planned_table(cur):
                conn.commit()

            roster = _build_full_roster(cur)
            allowed_names = _get_allowed_person_names(user, roster)

            # 依權限過濾名冊
            if user.get("role") == "admin":
                filtered_mgrs = roster["areaManagers"]
                filtered_bds = roster["beautyDirectors"]
            elif user.get("role") == "beauty_director":
                filtered_mgrs = []
                filtered_bds = [b for b in roster["beautyDirectors"] if b["name"] in allowed_names]
            else:
                filtered_mgrs = [m for m in roster["areaManagers"] if m["name"] in allowed_names]
                filtered_bds = []

            conditions = ["person_name <> '陳育廷'"]
            params: list = []
            if start_date:
                conditions.append("schedule_date >= %s")
                params.append(start_date)
            if end_date:
                conditions.append("schedule_date <= %s")
                params.append(end_date)

            if user.get("role") != "admin":
                if not allowed_names:
                    return {
                        "schedules": [],
                        "areaManagers": filtered_mgrs,
                        "beautyDirectors": filtered_bds,
                    }
                conditions.append("person_name = ANY(%s)")
                params.append(list(allowed_names))

            query = (
                "SELECT id, person_name, person_role, department, region, schedule_date, "
                "time_slot, schedule_type, store_name, note, created_by, created_at, updated_at "
                "FROM planned_schedules"
            )
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            query += " ORDER BY schedule_date ASC, CASE time_slot WHEN '上午' THEN 1 WHEN '下午' THEN 2 ELSE 3 END ASC, created_at ASC LIMIT 2000"

            cur.execute(query, tuple(params))
            rows = cur.fetchall()

    roster_by_name = {
        person["name"]: person
        for person in roster["areaManagers"] + roster["beautyDirectors"]
    }
    schedules = [
        {
            "id": r[0],
            "personName": r[1],
            "personRole": r[2],
            "department": roster_by_name.get(r[1], {}).get("department") or business_department_for_region(r[4] or "") or r[3] or "",
            "region": r[4] or "",
            "scheduleDate": r[5],
            "timeSlot": r[6] or "全天",
            "scheduleType": r[7],
            "storeName": r[8] or "",
            "note": r[9] or "",
            "createdBy": r[10] or "",
            "createdAt": (r[11].isoformat() + "Z") if r[11] else "",
            "updatedAt": (r[12].isoformat() + "Z") if r[12] else "",
        }
        for r in rows
    ]

    return {
        "schedules": schedules,
        "areaManagers": filtered_mgrs,
        "beautyDirectors": filtered_bds,
    }


@router.post("/planned-schedules")
def create_planned_schedule(
    req: PlannedScheduleCreateReq,
    user: dict = Depends(get_current_user),
):
    """
    新增區經理或美容總監預排行程（支援單次勾選多間門市批次建立）
    """
    person_name = req.personName.strip()
    person_role = req.personRole.strip()
    schedule_date = req.scheduleDate.strip()
    time_slot = (req.timeSlot or "全天").strip()
    schedule_type = req.scheduleType.strip()
    note = (req.note or "").strip()

    if person_role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="不支援的角色類型")
    if not DATE_RE.match(schedule_date):
        raise HTTPException(status_code=400, detail="預排日期格式須為 YYYY-MM-DD")
    if time_slot not in ALLOWED_TIME_SLOTS:
        time_slot = "全天"

    # 整理欲建立之門市清單（若非門市巡檢則建立單筆行程）
    target_stores: list[str] = []
    if req.storeNames:
        for s in req.storeNames:
            cs = str(s or "").strip()
            if cs and cs not in target_stores:
                target_stores.append(cs)
    elif req.storeName and req.storeName.strip():
        target_stores.append(req.storeName.strip())

    if schedule_type in ("門市巡店", "美容巡店") and not target_stores:
        raise HTTPException(status_code=400, detail="請至少選擇一間預計巡視的門市")
    if not target_stores:
        target_stores = [""]

    now_utc = datetime.utcnow()
    actor = str(user.get("name") or user.get("sub") or "").strip()

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            _ensure_planned_table(cur)
            roster = _build_full_roster(cur)
            allowed_names = _get_allowed_person_names(user, roster)
            if user.get("role") != "admin" and person_name not in allowed_names:
                raise HTTPException(status_code=403, detail="您僅能新增自己轄屬範圍的預排行程")

            # 自動補齊處別與區域
            all_people = roster["areaManagers"] + roster["beautyDirectors"]
            matched_person = next((p for p in all_people if p["name"] == person_name), None)
            if not matched_person or matched_person["role"] != person_role:
                raise HTTPException(status_code=400, detail="此人員不在現行組織名冊中")
            dept = matched_person["department"]
            region = matched_person["region"]

            created_items = []
            for st_name in target_stores:
                item_id = str(uuid.uuid4())
                cur.execute(
                    """
                    INSERT INTO planned_schedules (
                        id, person_name, person_role, department, region,
                        schedule_date, time_slot, schedule_type, store_name,
                        note, created_by, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        item_id,
                        person_name,
                        person_role,
                        dept,
                        region,
                        schedule_date,
                        time_slot,
                        schedule_type,
                        st_name,
                        note,
                        actor,
                        now_utc,
                        now_utc,
                    ),
                )
                created_items.append(
                    {
                        "id": item_id,
                        "personName": person_name,
                        "personRole": person_role,
                        "department": dept,
                        "region": region,
                        "scheduleDate": schedule_date,
                        "timeSlot": time_slot,
                        "scheduleType": schedule_type,
                        "storeName": st_name,
                        "note": note,
                        "createdBy": actor,
                        "createdAt": now_utc.isoformat() + "Z",
                        "updatedAt": now_utc.isoformat() + "Z",
                    }
                )

            cur.execute(
                """
                INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid.uuid4()),
                    "CREATE_PLANNED_SCHEDULE",
                    person_name,
                    actor,
                    None,
                    Json(
                        {
                            "scheduleDate": schedule_date,
                            "scheduleType": schedule_type,
                            "stores": target_stores,
                            "count": len(created_items),
                        }
                    ),
                    now_utc,
                ),
            )
        conn.commit()

    return {"success": True, "items": created_items}


@router.put("/planned-schedules/{schedule_id}")
def update_planned_schedule(
    schedule_id: str,
    req: PlannedScheduleUpdateReq,
    user: dict = Depends(get_current_user),
):
    """修改單筆預排行程"""
    now_utc = datetime.utcnow()
    actor = str(user.get("name") or user.get("sub") or "").strip()

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            _ensure_planned_table(cur)
            cur.execute(
                "SELECT person_name, schedule_date, time_slot, schedule_type, store_name, note FROM planned_schedules WHERE id = %s",
                (schedule_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="找不到該筆預排行程")

            person_name, cur_date, cur_slot, cur_type, cur_store, cur_note = row
            roster = _build_full_roster(cur)
            allowed_names = _get_allowed_person_names(user, roster)
            if user.get("role") != "admin" and person_name not in allowed_names:
                raise HTTPException(status_code=403, detail="您無權限修改此筆預排行程")

            new_date = req.scheduleDate.strip() if req.scheduleDate else cur_date
            if not DATE_RE.match(new_date):
                raise HTTPException(status_code=400, detail="日期格式須為 YYYY-MM-DD")
            new_slot = req.timeSlot.strip() if req.timeSlot else cur_slot
            if new_slot not in ALLOWED_TIME_SLOTS:
                new_slot = "全天"
            new_type = req.scheduleType.strip() if req.scheduleType else cur_type
            new_store = req.storeName.strip() if req.storeName is not None else (cur_store or "")
            new_note = req.note.strip() if req.note is not None else (cur_note or "")

            cur.execute(
                """
                UPDATE planned_schedules
                SET schedule_date = %s,
                    time_slot = %s,
                    schedule_type = %s,
                    store_name = %s,
                    note = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (new_date, new_slot, new_type, new_store, new_note, now_utc, schedule_id),
            )
            cur.execute(
                """
                INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid.uuid4()),
                    "UPDATE_PLANNED_SCHEDULE",
                    person_name,
                    actor,
                    Json({"scheduleDate": cur_date, "scheduleType": cur_type, "storeName": cur_store}),
                    Json({"scheduleDate": new_date, "scheduleType": new_type, "storeName": new_store}),
                    now_utc,
                ),
            )
        conn.commit()

    return {"success": True}


@router.delete("/planned-schedules/{schedule_id}")
def delete_planned_schedule(
    schedule_id: str,
    user: dict = Depends(get_current_user),
):
    """刪除單筆預排行程"""
    actor = str(user.get("name") or user.get("sub") or "").strip()

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            _ensure_planned_table(cur)
            cur.execute(
                "SELECT person_name, schedule_date, schedule_type, store_name FROM planned_schedules WHERE id = %s",
                (schedule_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="找不到該筆預排行程")

            person_name, cur_date, cur_type, cur_store = row
            roster = _build_full_roster(cur)
            allowed_names = _get_allowed_person_names(user, roster)
            if user.get("role") != "admin" and person_name not in allowed_names:
                raise HTTPException(status_code=403, detail="您無權限刪除此筆預排行程")

            cur.execute("DELETE FROM planned_schedules WHERE id = %s", (schedule_id,))
            cur.execute(
                """
                INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid.uuid4()),
                    "DELETE_PLANNED_SCHEDULE",
                    person_name,
                    actor,
                    Json({"scheduleDate": cur_date, "scheduleType": cur_type, "storeName": cur_store}),
                    None,
                    datetime.utcnow(),
                ),
            )
        conn.commit()

    return {"success": True, "deletedId": schedule_id}
