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
 * 將分鐘數格式化為 Google Maps 中文時間格式（如 67 -> "1 小時 7 分"、39 -> "39 分"）
 */
export const formatGoogleDuration = (totalMinutes: number, withSuffix = false): string => {
  const mins = Math.max(1, Math.round(totalMinutes || 0));
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const minUnit = withSuffix ? '分鐘' : '分';
    return m > 0 ? `${h} 小時 ${m} ${minUnit}` : `${h} 小時`;
  }
  return `${mins} ${withSuffix ? '分鐘' : '分'}`;
};

/**
 * 各區域中心與門市的標準台灣詳細地址顯示，讓點對點地址欄呈現如 Google Maps 實景格式
 */
const HUB_FULL_ADDRESSES: Record<string, string> = {
  新北區: '板橋車站 220台灣新北市板橋區縣民大道二段7號',
  北桃區: '桃園火車站 330台灣桃園市桃園區中正路1號',
  竹苗區: '竹北車站 302台灣新竹縣竹北市和平街59號',
  中投區: '臺中市政府 407台灣台中市西屯區臺灣大道三段99號',
  彰雲區: '員林車站 510台灣彰化縣員林市民權街55號',
  嘉南區: '新營車站 730台灣台南市新營區開元路1號',
  高雄區: '高鐵左營站 813台灣高雄市左營區高鐵路105號',
  高屏區: '鳳山車站 830台灣高雄市鳳山區曹公路68號',
  宜花區: '羅東車站 265台灣宜蘭縣羅東鎮公正路2號',
};

/**
 * 將站點名稱轉為 Google Maps 友善地址顯示字串
 */
export const formatStopForGoogleMaps = (label: string, fallbackPt?: GeoPoint, region?: string): string => {
  const clean = (label || '').trim();
  if (!clean) {
    return fallbackPt ? `${fallbackPt.lat.toFixed(6)},${fallbackPt.lng.toFixed(6)}` : '';
  }

  // 若為區域預設中心（如「彰雲區中心（員林）」），轉為完整車站門牌地址
  if (clean.includes('區中心')) {
    for (const [regKey, fullAddr] of Object.entries(HUB_FULL_ADDRESSES)) {
      if (clean.includes(regKey)) return fullAddr;
    }
    const hubMatch = clean.match(/中心[（(]([^）)]+)[）)]/);
    if (hubMatch && hubMatch[1]) {
      return `${hubMatch[1].split('／')[0]}車站`;
    }
  }

  if (clean.includes('總部大樓') || clean === '總部') {
    return '東森寵物雲總部 235台灣新北市中和區景平路258號';
  }

  if (/^(總部行程|會議行程|特殊行程)[：:（(]/.test(clean)) {
    const detail = clean
      .replace(/^(總部行程|會議行程|特殊行程)[：:（(]/, '')
      .replace(/[）)]$/, '')
      .trim();
    if (detail) return detail;
  }

  // 僅當文字包含實際門牌路名或交通地標詞彙時才視為完整地址（避免「彰化中正」的「中」字被誤判）
  const looksLikeAddress = /(?:路|街|大道|段|巷|弄|號|車站|高鐵|捷運|機場|大樓|中心|園區|醫院|學校|大學)/.test(clean);
  if (!looksLikeAddress && clean.length <= 14) {
    const storeLabel = clean.endsWith('店') ? clean : `${clean}店`;
    const regionHint = region ? region.replace('區', '') : '';
    return `東森寵物雲 ${storeLabel}${regionHint ? `（台灣${regionHint}）` : ''}`;
  }

  return clean;
};

/**
 * 產生 Google Maps 外部新分頁多停靠點路線連結
 */
export const buildGoogleMapsDirectionsUrl = (
  waypoints: GeoPoint[],
  vehicle: 'car' | 'motorcycle' = 'car',
  customStopLabels?: string[]
): string => {
  const labels =
    customStopLabels && customStopLabels.length > 0
      ? customStopLabels.map(s => s.trim()).filter(Boolean)
      : waypoints.map(wp => formatStopForGoogleMaps(wp.label, wp));

  if (labels.length === 0) return 'https://www.google.com/maps/dir/';
  if (labels.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(labels[0])}`;
  }

  // 移除括號內補充字樣以利 Google Maps 精準搜尋
  const cleanForSearch = (s: string) => s.replace(/（台灣[^）]*）/g, '').trim();
  const origin = cleanForSearch(labels[0]);
  const destination = cleanForSearch(labels[labels.length - 1]);
  const middle = labels.slice(1, -1).slice(0, 9).map(cleanForSearch);

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
 * 呼叫開源 OSRM 道路引擎取得點對點真實道路導航距離、預估時間、途經主要道路與完整道路幾何折線
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

  let fallbackKm = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    fallbackKm += estimateDrivingKm(waypoints[i], waypoints[i + 1], region);
  }
  fallbackKm = Math.max(2.5, Math.round(fallbackKm * 10) / 10);
  const fallbackResult: RealRoadRouteResult = {
    distanceKm: fallbackKm,
    durationMin: Math.max(6, Math.round((fallbackKm / 34) * 60)),
    viaRoad: '途經主要省道／市區幹道',
    geometry: waypoints.map(w => [w.lat, w.lng]),
    source: 'estimated',
  };

  try {
    const coordStr = waypoints
      .map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
      .join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=true`;

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6500);
    const res = await fetch(url, { signal: controller.signal });
    window.clearTimeout(timer);

    if (!res.ok) return fallbackResult;
    const json = await res.json();
    const route = json?.routes?.[0];
    if (!route || typeof route.distance !== 'number') return fallbackResult;

    const rawKm = Math.round((route.distance / 1000) * 10) / 10;
    const distanceKm = rawKm > 0 ? rawKm : fallbackKm;
    const durationMin = Math.max(3, Math.round((route.duration || 0) / 60));

    const roadLengths = new Map<string, number>();
    for (const leg of route.legs || []) {
      for (const step of leg.steps || []) {
        const roadName = String(step.name || step.ref || '').trim();
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
      viaRoad: topRoads.length > 0 ? `途經${topRoads.join('和')}` : '途經最佳快速道路',
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
 * 計算真實 Google Maps 中文街道圖磚 (`mt1.google.com/vt/lyrs=m&hl=zh-TW`) 與點對點導航折線佈局
 */
export const computeGoogleMapLayout = (
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

  // 若起終點極接近，自動外擴小範圍確保地圖完整呈現周邊路網
  if (maxLat - minLat < 0.008) {
    minLat -= 0.006;
    maxLat += 0.006;
  }
  if (maxLng - minLng < 0.008) {
    minLng -= 0.006;
    maxLng += 0.006;
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  const padX = Math.min(64, width * 0.16);
  const padY = Math.min(56, height * 0.18);
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
      const serverIdx = Math.abs(wrappedX + ty) % 4;
      tiles.push({
        // 真實 Google Maps 繁體中文街道圖磚（含台灣國道梅花標、省道盾牌、中文路名與地標）
        url: `https://mt${serverIdx}.google.com/vt/lyrs=m&x=${wrappedX}&y=${ty}&z=${zoom}&hl=zh-TW&gl=TW`,
        left: Math.round(tx * 256 - topLeftX),
        top: Math.round(ty * 256 - topLeftY),
      });
    }
  }

  const step = Math.max(1, Math.floor(allPts.length / 240));
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

  const midIdx = Math.floor(projectedLine.length * 0.55);
  const rawMid = projectedLine[midIdx] || { x: width / 2, y: height / 2 };
  const midPoint = {
    x: Math.max(85, Math.min(width - 85, rawMid.x)),
    y: Math.max(46, Math.min(height - 38, rawMid.y)),
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

const escapeHtml = (str: string | number | undefined | null): string =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * 產生列印／另存 PDF 專用之真實 Google Maps 點對點距離截圖雙欄 HTML（左側 Google Maps 路線欄＋右側真實 Google Maps 圖磚與藍紫導航線）
 */
export const buildPrintableGoogleMapCardHtml = (params: {
  stopLabels: string[];
  waypoints: GeoPoint[];
  geometry: [number, number][];
  distanceKm: number;
  durationMin: number;
  viaRoad: string;
  vehicle: 'car' | 'motorcycle';
  width?: number;
  height?: number;
}): string => {
  const mapW = params.width ?? 560;
  const mapH = params.height ?? 330;
  const layout = computeGoogleMapLayout(params.waypoints, params.geometry, mapW, mapH);
  const durShort = formatGoogleDuration(params.durationMin, false);
  const durLong = formatGoogleDuration(params.durationMin, true);
  const vehicleIcon = params.vehicle === 'motorcycle' ? '🛵' : '🚗';

  const stopsHtml = params.stopLabels
    .map((label, idx) => {
      const isLast = idx === params.stopLabels.length - 1 && params.stopLabels.length > 1;
      const dot = isLast
        ? `<span style="color:#d93025;font-size:13px;font-weight:900;">📍</span>`
        : `<span style="display:inline-block;width:10px;height:10px;border-radius:999px;border:2px solid #3c4043;background:#fff;"></span>`;
      return `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <div style="width:16px;text-align:center;flex-shrink:0;">${dot}</div>
          <div style="flex:1;border:1px solid #dadce0;border-radius:8px;padding:6px 10px;font-size:9.5pt;color:#202124;background:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${escapeHtml(label)}
          </div>
        </div>
      `;
    })
    .join('');

  const tilesHtml = layout.tiles
    .map(
      t =>
        `<img src="${t.url}" alt="" style="position:absolute;left:${t.left}px;top:${t.top}px;width:256px;height:256px;max-width:none;border:0;" />`
    )
    .join('');

  const markersHtml = layout.markers
    .map(m => {
      if (m.isEnd && layout.markers.length > 1) {
        return `<div style="position:absolute;left:${m.x.toFixed(1)}px;top:${m.y.toFixed(1)}px;transform:translate(-50%,-95%);z-index:22;font-size:18px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.4));">📍</div>`;
      }
      return `<div style="position:absolute;left:${m.x.toFixed(1)}px;top:${m.y.toFixed(1)}px;transform:translate(-50%,-50%);width:13px;height:13px;border-radius:999px;background:#ffffff;border:3px solid #202124;box-shadow:0 1px 4px rgba(0,0,0,0.45);z-index:21;"></div>`;
    })
    .join('');

  return `
    <table style="width:100%;border-collapse:collapse;border:1.5px solid #dadce0;border-radius:10px;overflow:hidden;background:#fff;table-layout:fixed;">
      <tr>
        <td style="width:39%;vertical-align:top;padding:12px 14px;border-right:1px solid #dadce0;background:#ffffff;">
          <div style="display:flex;align-items:center;gap:10px;padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid #e8eaed;font-size:9pt;color:#5f6368;">
            <span style="background:#d2e3fc;color:#174ea6;padding:4px 10px;border-radius:999px;font-weight:800;">
              ${vehicleIcon} ${durShort}
            </span>
            <span>🚆 --</span>
            <span>🚶 --</span>
          </div>
          ${stopsHtml}
          <div style="margin-top:12px;padding-top:10px;border-top:1px solid #e8eaed;border-left:4px solid #1a73e8;padding-left:10px;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;">
              <span style="font-size:10.5pt;font-weight:800;color:#202124;">${vehicleIcon} ${escapeHtml(params.viaRoad)}</span>
              <span style="font-size:11pt;font-weight:800;color:#b06000;">${durShort}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:3px;">
              <span style="font-size:8.5pt;color:#70757a;">據路況，此為目前最快路線</span>
              <span style="font-size:10.5pt;font-weight:800;color:#5f6368;">${params.distanceKm.toFixed(1)} 公里</span>
            </div>
          </div>
        </td>
        <td style="width:61%;vertical-align:top;padding:0;background:#e8eaed;">
          <div style="position:relative;width:${mapW}px;height:${mapH}px;overflow:hidden;margin:0 auto;">
            ${tilesHtml}
            <svg width="${mapW}" height="${mapH}" style="position:absolute;left:0;top:0;z-index:10;pointer-events:none;">
              ${
                layout.polylineSvgPoints
                  ? `<polyline points="${layout.polylineSvgPoints}" fill="none" stroke="#1e1b98" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
                     <polyline points="${layout.polylineSvgPoints}" fill="none" stroke="#4262ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />`
                  : ''
              }
            </svg>
            ${markersHtml}
            <div style="position:absolute;left:${layout.midPoint.x.toFixed(1)}px;top:${layout.midPoint.y.toFixed(1)}px;transform:translate(-50%,-115%);background:#174ea6;color:#ffffff;padding:5px 10px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.4);z-index:30;font-family:sans-serif;line-height:1.25;white-space:nowrap;">
              <div style="font-size:11px;font-weight:800;">${vehicleIcon} ${durLong}</div>
              <div style="font-size:10.5px;font-weight:700;">${params.distanceKm.toFixed(1)} 公里</div>
            </div>
            <div style="position:absolute;right:8px;bottom:4px;z-index:30;font-size:11px;font-weight:700;color:#3c4043;text-shadow:0 0 3px #fff,0 0 3px #fff;">
              Google Maps
            </div>
          </div>
        </td>
      </tr>
    </table>
  `;
};

/**
 * 將使用者上傳、拖曳或 Ctrl+V 貼上之 Google Maps 截圖壓縮為高畫質 Data URL
 */
export const compressScreenshotFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('圖片讀取失敗'));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error('圖片解析失敗'));
      img.onload = () => {
        const maxW = 1600;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('無法建立畫布'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
