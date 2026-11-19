import base64
import logging
import os
from typing import List, Optional
import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.security import get_current_user

logger = logging.getLogger("dashboard-api")
router = APIRouter(prefix="/api/google-maps", tags=["Google Maps 官方距離驗證"])


class RouteVerifyRequest(BaseModel):
    stops: List[str] = Field(..., min_length=2, max_length=12, description="依序排列之起訖與中繼站點地址或門市名稱")
    vehicle: str = Field(default="car", description="交通工具：car 或 motorcycle")


class VerifiedLeg(BaseModel):
    startAddress: str
    endAddress: str
    distanceKm: float
    durationMin: int


def _get_google_maps_key() -> str:
    return (os.getenv("GOOGLE_MAPS_API_KEY") or "").strip()


@router.get("/status")
def get_google_maps_status(user: dict = Depends(get_current_user)):
    """
    查詢後端是否已配置 Google Maps Platform API 金鑰
    """
    _ = user
    return {"configured": bool(_get_google_maps_key())}


@router.post("/verify-route")
def verify_google_maps_route(
    payload: RouteVerifyRequest,
    user: dict = Depends(get_current_user),
):
    """
    呼叫官方 Google Maps Directions API 與 Static Maps API
    回傳官方認證行車公里數、行車分鐘數、途經道路名稱及真實 Google Maps 路線圖 (Base64 PNG)
    """
    _ = user
    api_key = _get_google_maps_key()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="尚未設定 GOOGLE_MAPS_API_KEY 環境變數，請於 Vercel 或 backend/.env 填入後即可啟用自動抓取官方距離與路線圖。",
        )

    cleaned_stops = [s.strip() for s in payload.stops if s and s.strip()]
    if len(cleaned_stops) < 2:
        raise HTTPException(status_code=400, detail="至少需要起點與終點兩個有效地址")

    origin = cleaned_stops[0]
    destination = cleaned_stops[-1]
    waypoints = cleaned_stops[1:-1]

    params = {
        "origin": origin,
        "destination": destination,
        "mode": "driving",
        "language": "zh-TW",
        "region": "tw",
        "key": api_key,
    }
    if waypoints:
        params["waypoints"] = "|".join(waypoints[:9])

    try:
        resp = requests.get(
            "https://maps.googleapis.com/maps/api/directions/json",
            params=params,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        logger.error("Google Directions API request failed: %s", exc)
        raise HTTPException(status_code=502, detail="連線 Google Maps Directions API 失敗，請稍後再試")

    status = data.get("status")
    routes = data.get("routes") or []
    if status != "OK" or not routes:
        err_msg = data.get("error_message") or f"Google Maps 回傳狀態：{status}"
        logger.warning("Google Directions API status=%s msg=%s", status, err_msg)
        raise HTTPException(status_code=400, detail=f"Google Maps 無法規劃此路線（{err_msg}）")

    route = routes[0]
    legs_raw = route.get("legs") or []
    total_meters = sum((leg.get("distance") or {}).get("value", 0) for leg in legs_raw)
    total_seconds = sum((leg.get("duration") or {}).get("value", 0) for leg in legs_raw)

    distance_km = round(total_meters / 1000.0, 1)
    duration_min = max(1, round(total_seconds / 60.0))
    summary = str(route.get("summary") or "").strip()
    via_road = f"途經 {summary}" if summary else "Google Maps 建議路線"

    legs: List[dict] = []
    for leg in legs_raw:
        legs.append(
            VerifiedLeg(
                startAddress=str(leg.get("start_address") or ""),
                endAddress=str(leg.get("end_address") or ""),
                distanceKm=round(((leg.get("distance") or {}).get("value", 0)) / 1000.0, 1),
                durationMin=max(1, round(((leg.get("duration") or {}).get("value", 0)) / 60.0)),
            ).model_dump()
        )

    # 同步呼叫官方 Google Static Maps API 產出真實 Google Maps 路線截圖（供列印 PDF／匯出 Word 內嵌）
    static_map_data_url: Optional[str] = None
    encoded_polyline = (route.get("overview_polyline") or {}).get("points")
    if encoded_polyline:
        try:
            static_params: List[tuple[str, str]] = [
                ("size", "640x360"),
                ("scale", "2"),
                ("maptype", "roadmap"),
                ("language", "zh-TW"),
                ("region", "TW"),
                ("path", f"weight:5|color:0x3b28ccff|enc:{encoded_polyline}"),
                ("key", api_key),
            ]
            # 標記起點與終點
            if legs_raw:
                start_loc = legs_raw[0].get("start_location") or {}
                end_loc = legs_raw[-1].get("end_location") or {}
                if "lat" in start_loc and "lng" in start_loc:
                    static_params.append(("markers", f"color:blue|label:A|{start_loc['lat']},{start_loc['lng']}"))
                if "lat" in end_loc and "lng" in end_loc:
                    static_params.append(("markers", f"color:red|label:B|{end_loc['lat']},{end_loc['lng']}"))

            img_resp = requests.get(
                "https://maps.googleapis.com/maps/api/staticmap",
                params=static_params,
                timeout=10,
            )
            if img_resp.ok and img_resp.headers.get("Content-Type", "").startswith("image/"):
                b64 = base64.b64encode(img_resp.content).decode("ascii")
                mime = img_resp.headers.get("Content-Type", "image/png").split(";")[0]
                static_map_data_url = f"data:{mime};base64,{b64}"
        except requests.RequestException as exc:
            logger.warning("Google Static Maps fetch failed: %s", exc)

    return {
        "success": True,
        "distanceKm": distance_km,
        "durationMin": duration_min,
        "viaRoad": via_road,
        "legs": legs,
        "staticMapDataUrl": static_map_data_url,
    }
