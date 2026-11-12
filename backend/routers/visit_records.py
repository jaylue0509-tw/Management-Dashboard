import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, Body, BackgroundTasks, Response
from psycopg2.extras import Json

from backend.database import get_db_connection
from backend.security import get_current_user, get_optional_user
from backend.schemas import VisitRecord
from backend.utils import (
    trigger_teams_notify,
    TAIPEI_OFFSET,
    MODULE_NAMES,
    _taipei_date_after,
    _normalize_activity_time,
    _normalize_store,
    _store_photo,
    _build_defect_label
)

logger = logging.getLogger("dashboard-api")
router = APIRouter(prefix="/api", tags=["巡店與活動管理"])

@router.get("/photos/{photo_id}")
def get_photo(photo_id: str):
    """
    讀取巡店照片 (照片 id 為隨機 UUID，內容不可變，可長期快取)
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT mime_type, content FROM photos WHERE id = %s", (photo_id,))
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Photo not found")
    return Response(content=bytes(row[1]), media_type=row[0],
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})

@router.get("/activities", response_model=List[VisitRecord])
def get_activities(time_range: str = "day", region: str = "all", user: Optional[dict] = Depends(get_optional_user)):
    """
    取得巡店活動紀錄列表
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
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

            if user and user.get("role") == "manager":
                mgr_name = user.get("name")
                assigned = list(user.get("assigned_stores") or [])
                conditions.append("(data->>'areaManagerName' = %s OR data->>'storeName' = ANY(%s))")
                params.extend([mgr_name, assigned])
                
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
                
            query += " ORDER BY created_at DESC LIMIT 500"
            
            cur.execute(query, tuple(params))
            rows = cur.fetchall()
            return [_normalize_activity_time(row[0], row[1]) for row in rows if row[0]]

@router.post("/visit-records")
def create_visit_record(background_tasks: BackgroundTasks, payload: dict = Body(...),
                        user: Optional[dict] = Depends(get_optional_user)):
    """
    建立巡店紀錄：紀錄、照片、PDCA 新增與結案在同一個交易內完成
    """
    record_id = str(uuid.uuid4())
    payload["recordId"] = record_id

    store_name = str(payload.get("storeName") or "").strip()
    if not store_name:
        raise HTTPException(status_code=400, detail="缺少門市名稱")
    payload["storeName"] = store_name

    now_utc = datetime.utcnow()
    created_at = now_utc
    created_at_str = payload.get("createdAt")
    if created_at_str:
        try:
            parsed_dt = datetime.fromisoformat(str(created_at_str).replace("Z", "+00:00"))
            if parsed_dt.tzinfo is not None:
                created_at = parsed_dt.astimezone(timezone.utc).replace(tzinfo=None)
            else:
                created_at = parsed_dt
        except (ValueError, TypeError):
            created_at = now_utc

    is_manager = bool(user and user.get("role") == "manager")
    if is_manager:
        payload["areaManagerName"] = user.get("name") or payload.get("areaManagerName")

    taipei_today = (now_utc + TAIPEI_OFFSET).date()
    min_backfill_date = taipei_today - timedelta(days=5)
    record_taipei_date = (created_at + TAIPEI_OFFSET).date()

    if is_manager:
        if record_taipei_date < min_backfill_date:
            raise HTTPException(
                status_code=400,
                detail=f"問卷回填日期最多僅能往前 5 天（最早可選 {min_backfill_date.isoformat()}）"
            )
        if record_taipei_date > taipei_today:
            raise HTTPException(status_code=400, detail="問卷回填日期不可選擇未來日期")

    if created_at > now_utc:
        created_at = now_utc

    if record_taipei_date < taipei_today:
        payload["isBackfilled"] = True
        payload["submittedAt"] = now_utc.isoformat() + "Z"

    payload["createdAt"] = created_at.isoformat() + "Z"

    mgr_name = payload.get("areaManagerName") or "未知主管"
    core_checks = payload.get("coreChecks") or {}
    category_checks = payload.get("categoryChecks") or {}
    category_remarks = payload.get("categoryRemarks") or {}
    action_items_created = 0

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            if not payload.get("region") or not payload.get("department"):
                cur.execute("SELECT data FROM store WHERE id = 'managers'")
                row = cur.fetchone()
                target = _normalize_store(store_name)
                for m in (row[0] if row else []):
                    if _normalize_store(m.get("storeName")) == target:
                        if not payload.get("region"):
                            payload["region"] = m.get("region", "")
                        if not payload.get("department"):
                            payload["department"] = m.get("department", "")
                        break
                if not payload.get("region") and row and row[0]:
                    for m in row[0]:
                        if str(m.get("areaManagerName") or "").strip() == str(mgr_name).strip():
                            payload["region"] = m.get("region", "")
                            if not payload.get("department"):
                                payload["department"] = m.get("department", "")
                            break
            region = payload.get("region") or ""

            cleaned_pairs = []
            for pair in payload.get("photoPairs") or []:
                before_url = _store_photo(cur, record_id, (pair or {}).get("beforeUrl", ""))
                after_url = _store_photo(cur, record_id, (pair or {}).get("afterUrl", ""))
                if before_url or after_url:
                    cleaned_pairs.append({"beforeUrl": before_url, "afterUrl": after_url})
            payload["photoPairs"] = cleaned_pairs

            defect_lines = []
            for k, v in core_checks.items():
                if v == '缺失':
                    remark = category_remarks.get(k) or "未提供說明"
                    defect_lines.append(f"{_build_defect_label(k)}：{remark}")
            for k, v in category_checks.items():
                if v in ('缺失', '待改善'):
                    remark = category_remarks.get(k) or "未提供說明"
                    defect_lines.append(f"{_build_defect_label(k)} ({v})：{remark}")
            has_defect = len(defect_lines) > 0 or payload.get("overallRating") == "需重點輔導"
            payload["abnormalFlag"] = bool(has_defect)
            if not payload.get("immediateImprovement") and defect_lines:
                payload["immediateImprovement"] = "\n".join(defect_lines)
            tags = list(payload.get("tags") or ["實地巡店"])
            if has_defect and "發現異常" not in tags:
                tags.append("發現異常")
            payload["tags"] = tags

            cur.execute("""
                INSERT INTO visit_records (id, region, created_at, data)
                VALUES (%s, %s, %s, %s)
            """, (record_id, region, created_at, Json(payload)))

            new_items = []
            for k, v in core_checks.items():
                if v == '缺失':
                    remark = category_remarks.get(k) or "未提供說明"
                    desc_text = f"{_build_defect_label(k)}：{remark}"
                    new_items.append({
                        "category": "必看核心底線",
                        "desc": desc_text,
                        "issueDescription": desc_text,
                        "assignee": "店長",
                        "dueDate": _taipei_date_after(3)
                    })
            for k, v in category_checks.items():
                if v in ('缺失', '待改善'):
                    remark = category_remarks.get(k) or "未提供說明"
                    mod_idx = int(k.split('-')[0]) - 1 if '-' in k and k.split('-')[0].isdigit() else -1
                    cat_label = MODULE_NAMES[mod_idx] if 0 <= mod_idx < len(MODULE_NAMES) else "模組細項"
                    desc_text = f"{_build_defect_label(k)} ({v})：{remark}"
                    new_items.append({
                        "category": cat_label,
                        "desc": desc_text,
                        "issueDescription": desc_text,
                        "assignee": "店長",
                        "dueDate": _taipei_date_after(7)
                    })
            for act in payload.get("newActionItems") or []:
                desc = str((act or {}).get("desc") or "").strip()
                if desc:
                    new_items.append({
                        "category": "主管交辦事項",
                        "desc": desc,
                        "issueDescription": desc,
                        "assignee": str(act.get("assignee") or "").strip() or "店長",
                        "dueDate": str(act.get("dueDate") or "").strip() or _taipei_date_after(7)
                    })

            now_iso = datetime.utcnow().isoformat()
            for item in new_items:
                item_id = str(uuid.uuid4())
                item.update({
                    "id": item_id,
                    "storeName": store_name,
                    "status": "Open",
                    "createdAt": now_iso,
                    "sourceRecordId": record_id,
                    "visitRecordId": record_id,
                    "createdBy": mgr_name
                })
                cur.execute("""
                    INSERT INTO action_items (id, store_name, created_at, data)
                    VALUES (%s, %s, %s, %s)
                """, (item_id, store_name, datetime.utcnow(), Json(item)))
            action_items_created = len(new_items)

            resolved_any_pdca = False
            for item_id, result in (payload.get("pdcaResults") or {}).items():
                if result == '已改善':
                    resolved_any_pdca = True
                    if str(item_id).startswith("vr-"):
                        vr_id = str(item_id)[3:]
                        cur.execute("UPDATE visit_records SET data = data || %s WHERE id = %s",
                                    (Json({"pdcaResolved": True, "pdcaResolvedAt": now_iso, "pdcaResolvedByRecordId": record_id}), vr_id))
                    else:
                        cur.execute("UPDATE action_items SET data = data || %s WHERE id = %s",
                                    (Json({"status": "Closed", "updatedAt": now_iso, "closedByRecordId": record_id}), item_id))
            if resolved_any_pdca or not has_defect:
                cur.execute(
                    "UPDATE visit_records SET data = data || %s WHERE id != %s AND replace(data->>'storeName', '店', '') = %s",
                    (Json({"pdcaResolved": True, "pdcaResolvedAt": now_iso}), record_id, _normalize_store(store_name))
                )
            for item_id, result in (payload.get("pdcaResults") or {}).items():
                if result == '已改善':
                    cur.execute("UPDATE action_items SET data = data || %s WHERE id = %s",
                                (Json({"status": "Closed", "updatedAt": now_iso, "closedByRecordId": record_id}), item_id))

            log_id = str(uuid.uuid4())
            cur.execute("""
                INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (log_id, "CREATE_VISIT_RECORD", store_name, mgr_name, None,
                  Json({
                      "storeName": store_name,
                      "region": region,
                      "auditMode": payload.get("auditMode"),
                      "overallRating": payload.get("overallRating"),
                      "actionItemsCreated": action_items_created,
                      "recordId": record_id
                  }), datetime.utcnow()))
        conn.commit()

    if payload.get("overallRating") == "需重點輔導":
        defects = [f"• {_build_defect_label(k)}" for k, v in {**core_checks, **category_checks}.items() if v in ['缺失', '待改善']]
        defects_text = "\n".join(defects) if defects else "• 未記錄具體異常選項"
        msg = f"🚨 **【警示】高風險門市通報**\n\n門市：{store_name}\n\n區主管：{mgr_name}\n\n狀態：需重點輔導\n\n**扣分原因 / 異常項目：**\n{defects_text}\n\n請高層主管多加留意！"
        background_tasks.add_task(trigger_teams_notify, msg)

    return {"success": True, "data": {"recordId": record_id, "actionItemsCreated": action_items_created}}

@router.put("/visit-records/{record_id}/photos")
def update_visit_record_photos(record_id: str, payload: dict = Body(...)):
    """
    補傳或更新巡店紀錄之改善前 (Before) / 改善後 (After) 對比照片
    """
    raw_pairs = payload.get("photoPairs") or []
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM visit_records WHERE id = %s", (record_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Visit record not found")

            record_data = row[0]
            cleaned_pairs = []
            for pair in raw_pairs:
                before_url = _store_photo(cur, record_id, (pair or {}).get("beforeUrl", ""))
                after_url = _store_photo(cur, record_id, (pair or {}).get("afterUrl", ""))
                if before_url or after_url:
                    cleaned_pairs.append({"beforeUrl": before_url, "afterUrl": after_url})

            record_data["photoPairs"] = cleaned_pairs
            cur.execute("UPDATE visit_records SET data = %s WHERE id = %s", (Json(record_data), record_id))
        conn.commit()

    return {"success": True, "photoPairs": cleaned_pairs}

@router.put("/visit-records/{record_id}")
def update_visit_record(
    record_id: str,
    payload: dict = Body(...),
    user: dict = Depends(get_current_user)
):
    """
    區主管或管理員修改已填寫之當日活動／行程或巡店補充內容
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data, created_at FROM visit_records WHERE id = %s", (record_id,))
            row = cur.fetchone()
            if not row or not row[0]:
                raise HTTPException(status_code=404, detail="找不到該筆活動紀錄")

            record_data = dict(row[0])
            existing_created_at = row[1]

            if user.get("role") != "admin":
                mgr_name = user.get("name") or ""
                assigned = set(user.get("assigned_stores") or [])
                rec_mgr = str(record_data.get("areaManagerName") or "").strip()
                rec_store = str(record_data.get("storeName") or "").strip()
                if rec_mgr != mgr_name and rec_store not in assigned:
                    raise HTTPException(status_code=403, detail="您僅能修改自己填寫的當日活動內容")

            before_snapshot = {
                "actionType": record_data.get("actionType"),
                "storeName": record_data.get("storeName"),
                "highlightDescription": record_data.get("highlightDescription"),
                "immediateImprovement": record_data.get("immediateImprovement"),
                "expectedStayMinutes": record_data.get("expectedStayMinutes"),
                "createdAt": record_data.get("createdAt"),
            }

            schedule_types = {"總部行程", "會議行程", "特殊行程"}
            if "actionType" in payload and payload["actionType"]:
                new_type = str(payload["actionType"]).strip()
                record_data["actionType"] = new_type
                if new_type in schedule_types:
                    record_data["storeName"] = str(payload.get("storeName") or new_type).strip()
                    record_data["tags"] = [new_type, "當日行程"]

            if "storeName" in payload and payload["storeName"]:
                record_data["storeName"] = str(payload["storeName"]).strip()

            if "highlightDescription" in payload and payload["highlightDescription"] is not None:
                record_data["highlightDescription"] = str(payload["highlightDescription"]).strip()

            if "immediateImprovement" in payload and payload["immediateImprovement"] is not None:
                record_data["immediateImprovement"] = str(payload["immediateImprovement"]).strip()

            if "expectedStayMinutes" in payload and payload["expectedStayMinutes"] is not None:
                try:
                    record_data["expectedStayMinutes"] = int(payload["expectedStayMinutes"])
                except (ValueError, TypeError):
                    pass

            if user.get("role") == "admin" and payload.get("areaManagerName"):
                record_data["areaManagerName"] = str(payload["areaManagerName"]).strip()

            new_created_at = existing_created_at
            raw_created = payload.get("createdAt")
            if raw_created:
                try:
                    dt = datetime.fromisoformat(str(raw_created).replace("Z", "+00:00"))
                    if dt.tzinfo is not None:
                        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
                    new_created_at = dt
                    record_data["createdAt"] = dt.isoformat() + "Z"
                except ValueError:
                    pass

            now_iso = datetime.utcnow().isoformat() + "Z"
            record_data["updatedAt"] = now_iso
            record_data["updatedBy"] = user.get("name") or user.get("sub") or "區主管"

            cur.execute(
                "UPDATE visit_records SET data = %s, created_at = %s WHERE id = %s",
                (Json(record_data), new_created_at, record_id)
            )

            cur.execute("""
                INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                str(uuid.uuid4()),
                "UPDATE_VISIT_RECORD",
                record_data.get("storeName") or record_id,
                user.get("name") or user.get("sub") or "區主管",
                Json(before_snapshot),
                Json({
                    "recordId": record_id,
                    "actionType": record_data.get("actionType"),
                    "highlightDescription": record_data.get("highlightDescription"),
                    "expectedStayMinutes": record_data.get("expectedStayMinutes"),
                }),
                datetime.utcnow()
            ))
        conn.commit()

    return {"success": True, "data": record_data}

@router.delete("/visit-records/{record_id}")
def delete_visit_record(
    record_id: str,
    user: dict = Depends(get_current_user)
):
    """
    刪除誤填之當日公務行程紀錄（限本人或管理員）
    """
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM visit_records WHERE id = %s", (record_id,))
            row = cur.fetchone()
            if not row or not row[0]:
                raise HTTPException(status_code=404, detail="找不到該筆活動紀錄")

            record_data = dict(row[0])
            if user.get("role") != "admin":
                mgr_name = user.get("name") or ""
                rec_mgr = str(record_data.get("areaManagerName") or "").strip()
                if rec_mgr != mgr_name:
                    raise HTTPException(status_code=403, detail="您僅能刪除自己登記的當日行程")

            cur.execute("DELETE FROM visit_records WHERE id = %s", (record_id,))
            cur.execute("""
                INSERT INTO audit_logs (id, action, target_user, changed_by, before_data, after_data, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                str(uuid.uuid4()),
                "DELETE_VISIT_RECORD",
                record_data.get("storeName") or record_id,
                user.get("name") or user.get("sub") or "區主管",
                Json(record_data),
                None,
                datetime.utcnow()
            ))
        conn.commit()

    return {"success": True, "deletedRecordId": record_id}

