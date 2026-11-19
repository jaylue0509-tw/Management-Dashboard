import type { GeoPoint } from '../data/storeCoordinates';
import { estimateDrivingKm } from '../data/storeCoordinates';

export interface RealRoadRouteResult {
  distanceKm: number;
  durationMin: number;
  viaRoad: string;
  /** 沿真實道路展開之 [lat, lng] 折線座標陣列 */
  geometry: [number, number][];
  source: 'osrm' | 'estimated';
}

const routeCache = new Map<string, RealRoadRouteResult>();

const buildCacheKey = (waypoints: GeoPoint[]): string =>
  waypoints.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');

/**
 * 將經緯度投影至 Web Mercator 世界像素座標（256px 基準圖磚）
 */
const projectToWorld = (lat: number, lng: number, zoom: number): { x: number; y: number } => {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.max(-0.9999, Math.min(0.9999, sinLat));
  const scale = 256 * Math.pow(2, zoom);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * scale,
  };
};

/**
 * 呼叫開源 OSRM 道路引擎取得真實道路導航距離、預估時間、途經主要道路與完整道路幾何折線
 * 若離線或限流則優雅降級回系統估算值，確保附件卡片隨時可正常呈現
 */
export const fetchRealRoadRoute = async (
  waypoints: GeoPoint[],
  region?: string
): Promise<RealRoadRouteResult> => {
  if (!waypoints || waypoints.length < 2) {
    return {
      distanceKm: 0,
      durationMin: 0,
      viaRoad: '無移動路段',
      geometry: waypoints.map(w => [w.lat, w.lng]),
      source: 'estimated',
    };
  }

  const key = buildCacheKey(waypoints);
  const cached = routeCache.get(key);
  if (cached) return cached;

  // 先準備估算備案（避免外部服務逾時導致錯誤）
  let fallbackKm = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    fallbackKm += estimateDrivingKm(waypoints[i], waypoints[i + 1], region);
  }
  fallbackKm = Math.round(fallbackKm * 10) / 10;
  const fallbackResult: RealRoadRouteResult = {
    distanceKm: fallbackKm,
    durationMin: Math.max(5, Math.round((fallbackKm / 34) * 60)),
    viaRoad: '系統依門市座標推估路線',
    geometry: waypoints.map(w => [w.lat, w.lng]),
    source: 'estimated',
  };

  try {
    const coordStr = waypoints
      .map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
      .join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true`;

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, { signal: controller.signal });
    window.clearTimeout(timer);

    if (!res.ok) return fallbackResult;
    const json = await res.json();
    const route = json?.routes?.[0];
    if (!route || typeof route.distance !== 'number') return fallbackResult;

    const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
    const durationMin = Math.max(1, Math.round((route.duration || 0) / 60));

    // 擷取各段最長的主要道路名稱作為「途經 XXX」顯示
    const roadLengths = new Map<string, number>();
    for (const leg of route.legs || []) {
      for (const step of leg.steps || []) {
        const roadName = String(step.ref || step.name || '').trim();
        if (roadName && roadName !== '-') {
          roadLengths.set(roadName, (roadLengths.get(roadName) || 0) + (step.distance || 0));
        }
      }
    }
    const topRoads = Array.from(roadLengths.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([name]) => name);

    const rawCoords: [number, number][] = Array.isArray(route.geometry?.coordinates)
      ? route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]])
      : waypoints.map(w => [w.lat, w.lng]);

    const result: RealRoadRouteResult = {
      distanceKm,
      durationMin,
      viaRoad: topRoads.length > 0 ? `途經 ${topRoads.join('、')}` : '依目前最佳路況建議路線',
      geometry: rawCoords,
      source: 'osrm',
    };
    routeCache.set(key, result);
    return result;
  } catch {
    return fallbackResult;
  }
};

/**
 * 產生 Google Maps 官方多停靠點距離驗證連結
 * 使用者點擊即可在 Google Maps 打開與附件完全相同的起訖站點路線進行距離比對與截圖
 */
export const buildGoogleMapsDirectionsUrl = (
  waypoints: GeoPoint[],
  vehicle: 'car' | 'motorcycle' = 'car'
): string => {
  if (!waypoints || waypoints.length === 0) {
    return 'https://www.google.com/maps';
  }
  const fmt = (pt: GeoPoint) => `${pt.lat.toFixed(6)},${pt.lng.toFixed(6)}`;
  if (waypoints.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${fmt(waypoints[0])}`;
  }

  const origin = fmt(waypoints[0]);
  const destination = fmt(waypoints[waypoints.length - 1]);
  // Google Maps 通用 URL 支援最多 9 個中繼站
  const middle = waypoints.slice(1, -1).slice(0, 9).map(fmt);

  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode: vehicle === 'motorcycle' ? 'driving' : 'driving',
  });
  if (middle.length > 0) {
    params.set('waypoints', middle.join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

/**
 * 計算地圖視野（涵蓋全部路線折線與停靠站點之中心點、最佳縮放層級與圖磚陣列）
 */
export const computeStaticMapLayout = (
  waypoints: GeoPoint[],
  geometry: [number, number][],
  width: number,
  height: number
) => {
  const allPts: [number, number][] =
    geometry.length >= 2
      ? geometry
      : waypoints.map(w => [w.lat, w.lng] as [number, number]);

  if (allPts.length === 0) {
    return {
      zoom: 12,
      tiles: [] as { url: string; left: number; top: number }[],
      polylineSvgPoints: '',
      midPoint: { x: width / 2, y: height / 2 },
      markers: [] as { x: number; y: number; label: string; isStart: boolean; isEnd: boolean; idx: number }[],
    };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of allPts) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  // 挑選完整容納路線與留白的最佳縮放層級 (8 ~ 15)
  const padX = Math.min(56, width * 0.14);
  const padY = Math.min(48, height * 0.16);
  let zoom = 14;
  for (let z = 15; z >= 8; z--) {
    const nw = projectToWorld(maxLat, minLng, z);
    const se = projectToWorld(minLat, maxLng, z);
    if (se.x - nw.x <= width - padX * 2 && se.y - nw.y <= height - padY * 2) {
      zoom = z;
      break;
    }
    zoom = z;
  }

  const centerWorld = projectToWorld(centerLat, centerLng, zoom);
  const topLeftX = centerWorld.x - width / 2;
  const topLeftY = centerWorld.y - height / 2;

  const startTileX = Math.floor(topLeftX / 256);
  const endTileX = Math.floor((topLeftX + width) / 256);
  const startTileY = Math.floor(topLeftY / 256);
  const endTileY = Math.floor((topLeftY + height) / 256);
  const maxTileIdx = Math.pow(2, zoom) - 1;

  const tiles: { url: string; left: number; top: number }[] = [];
  for (let tx = startTileX; tx <= endTileX; tx++) {
    for (let ty = startTileY; ty <= endTileY; ty++) {
      if (ty < 0 || ty > maxTileIdx) continue;
      const wrappedX = ((tx % (maxTileIdx + 1)) + (maxTileIdx + 1)) % (maxTileIdx + 1);
      tiles.push({
        // ESRI World Street Map：無浮水印且街道／國道／省道標示清晰
        url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${zoom}/${ty}/${wrappedX}`,
        left: Math.round(tx * 256 - topLeftX),
        top: Math.round(ty * 256 - topLeftY),
      });
    }
  }

  // 簡化密集折線點位（最多取 220 點避免列印 HTML 過重）
  const step = Math.max(1, Math.floor(allPts.length / 220));
  const sampledPts: [number, number][] = [];
  for (let i = 0; i < allPts.length; i += step) {
    sampledPts.push(allPts[i]);
  }
  const lastPt = allPts[allPts.length - 1];
  if (sampledPts[sampledPts.length - 1] !== lastPt) {
    sampledPts.push(lastPt);
  }

  const projectedLine = sampledPts.map(([lat, lng]) => {
    const p = projectToWorld(lat, lng, zoom);
    return { x: p.x - topLeftX, y: p.y - topLeftY };
  });

  const polylineSvgPoints = projectedLine
    .map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  const midIdx = Math.floor(projectedLine.length / 2);
  const rawMid = projectedLine[midIdx] || { x: width / 2, y: height / 2 };
  const midPoint = {
    x: Math.max(76, Math.min(width - 76, rawMid.x)),
    y: Math.max(38, Math.min(height - 34, rawMid.y)),
  };

  const markers = waypoints.map((wp, idx) => {
    const p = projectToWorld(wp.lat, wp.lng, zoom);
    return {
      x: p.x - topLeftX,
      y: p.y - topLeftY,
      label: wp.label,
      isStart: idx === 0,
      isEnd: idx === waypoints.length - 1,
      idx,
    };
  });

  return { zoom, tiles, polylineSvgPoints, midPoint, markers };
};

/**
 * 產出供列印／另存 PDF 使用之靜態街道地圖＋藍紫色真實導航路線＋「🚗 XX分 / XX.X公里」標註氣泡 HTML
 */
export const buildPrintableRouteMapHtml = (params: {
  waypoints: GeoPoint[];
  geometry: [number, number][];
  distanceKm: number;
  durationMin: number;
  vehicle: 'car' | 'motorcycle';
  width?: number;
  height?: number;
}): string => {
  const width = params.width ?? 520;
  const height = params.height ?? 290;
  const layout = computeStaticMapLayout(params.waypoints, params.geometry, width, height);
  const vehicleIcon = params.vehicle === 'motorcycle' ? '🛵' : '🚗';

  const tilesHtml = layout.tiles
    .map(
      t =>
        `<img src="${t.url}" alt="" style="position:absolute;left:${t.left}px;top:${t.top}px;width:256px;height:256px;max-width:none;border:0;" />`
    )
    .join('');

  const markersHtml = layout.markers
    .map(m => {
      if (m.isStart) {
        return `<div style="position:absolute;left:${m.x.toFixed(1)}px;top:${m.y.toFixed(1)}px;transform:translate(-50%,-50%);width:16px;height:16px;border-radius:999px;background:#ffffff;border:3.5px solid #1e293b;box-shadow:0 1px 4px rgba(0,0,0,0.4);z-index:20;"></div>`;
      }
      if (m.isEnd && layout.markers.length > 1) {
        return `<div style="position:absolute;left:${m.x.toFixed(1)}px;top:${m.y.toFixed(1)}px;transform:translate(-50%,-100%);width:22px;height:22px;border-radius:999px 999px 999px 0;background:#dc2626;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,0.4);z-index:22;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:900;">終</div>`;
      }
      return `<div style="position:absolute;left:${m.x.toFixed(1)}px;top:${m.y.toFixed(1)}px;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:999px;background:#2563eb;color:#ffffff;border:2px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.4);z-index:21;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;font-family:sans-serif;">${m.idx}</div>`;
    })
    .join('');

  return `
    <div style="position:relative;width:${width}px;height:${height}px;overflow:hidden;border-radius:8px;border:1px solid #cbd5e1;background:#e2e8f0;">
      ${tilesHtml}
      <svg width="${width}" height="${height}" style="position:absolute;left:0;top:0;z-index:10;pointer-events:none;">
        ${
          layout.polylineSvgPoints
            ? `<polyline points="${layout.polylineSvgPoints}" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.92" />
               <polyline points="${layout.polylineSvgPoints}" fill="none" stroke="#4338ca" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />`
            : ''
        }
      </svg>
      ${markersHtml}
      <div style="position:absolute;left:${layout.midPoint.x.toFixed(1)}px;top:${layout.midPoint.y.toFixed(1)}px;transform:translate(-50%,-115%);background:#1d4ed8;color:#ffffff;padding:4px 9px;border-radius:7px;box-shadow:0 3px 10px rgba(15,23,42,0.45);border:1.5px solid #ffffff;z-index:30;font-family:sans-serif;line-height:1.25;white-space:nowrap;">
        <div style="font-size:11px;font-weight:800;">${vehicleIcon} ${params.durationMin} 分</div>
        <div style="font-size:10px;font-weight:700;opacity:0.95;">${params.distanceKm.toFixed(1)} 公里</div>
      </div>
      <div style="position:absolute;right:6px;bottom:4px;z-index:30;background:rgba(255,255,255,0.88);padding:1px 6px;border-radius:4px;font-size:9px;color:#475569;font-family:sans-serif;">
        ESRI World Street Map · 路線距離佐證圖
      </div>
    </div>
  `;
};
