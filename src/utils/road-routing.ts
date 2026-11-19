import type { GeoPoint } from '../data/storeCoordinates';
import { API_BASE_URL, getAuthHeaders } from '../api/api';

export interface GoogleMapsApiVerifyResult {
  distanceKm: number;
  durationMin: number;
  viaRoad: string;
  staticMapDataUrl?: string | null;
}

/**
 * 將站點名稱轉為 Google Maps 友善搜尋字串
 */
export const formatStopForGoogleMaps = (label: string, fallbackPt?: GeoPoint): string => {
  const clean = (label || '').trim();
  if (!clean) {
    return fallbackPt ? `${fallbackPt.lat.toFixed(6)},${fallbackPt.lng.toFixed(6)}` : '';
  }

  const hubMatch = clean.match(/中心[（(]([^）)]+)[）)]/);
  if (hubMatch && hubMatch[1]) {
    return `${hubMatch[1].split('／')[0]}車站`;
  }

  if (clean.includes('總部大樓') || clean === '總部') {
    return '新北市中和區景平路258號';
  }

  if (/^(總部行程|會議行程|特殊行程)[：:]/.test(clean)) {
    const detail = clean.replace(/^(總部行程|會議行程|特殊行程)[：:]/, '').trim();
    if (detail) return detail;
  }

  // 僅當文字包含實際門牌路名或交通地標詞彙時才視為完整地址（避免「中正」「中山」等字誤判為地址而漏加「東森寵物」）
  const looksLikeAddress = /(?:路|街|大道|段|巷|弄|號|車站|高鐵|捷運|機場|大樓|中心|園區|醫院|學校|大學)/.test(clean);
  if (!looksLikeAddress && clean.length <= 14) {
    const storeLabel = clean.endsWith('店') ? clean : `${clean}店`;
    return `東森寵物 ${storeLabel}`;
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

  const origin = labels[0];
  const destination = labels[labels.length - 1];
  const middle = labels.slice(1, -1).slice(0, 9);

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
 * 產生可直接內嵌於網頁 <iframe> 的真實 Google Maps 路線地圖網址
 * - 若設定 VITE_GOOGLE_MAPS_API_KEY，採用官方免費無限量 Google Maps Embed API v1 (支援完整多停靠點藍線)
 * - 未設定金鑰時自動採用 Google Maps 公開路線內嵌模式，即開即看真實 Google 地圖
 */
export const buildGoogleMapsEmbedUrl = (
  waypoints: GeoPoint[],
  customStopLabels?: string[]
): string | null => {
  const labels =
    customStopLabels && customStopLabels.length > 0
      ? customStopLabels.map(s => s.trim()).filter(Boolean)
      : waypoints.map(wp => formatStopForGoogleMaps(wp.label, wp));

  if (labels.length === 0) return null;

  const embedKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  if (embedKey && labels.length >= 2) {
    const params = new URLSearchParams({
      key: embedKey,
      origin: labels[0],
      destination: labels[labels.length - 1],
      mode: 'driving',
      language: 'zh-TW',
      region: 'TW',
    });
    const middle = labels.slice(1, -1).slice(0, 9);
    if (middle.length > 0) {
      params.set('waypoints', middle.join('|'));
    }
    return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
  }

  if (labels.length === 1) {
    return `https://maps.google.com/maps?hl=zh-TW&q=${encodeURIComponent(labels[0])}&output=embed`;
  }

  // Google Maps 公開路線內嵌格式（支援起點 saddr 與多站 daddr 以 "+to:" 串接）
  const origin = encodeURIComponent(labels[0]);
  const destChain = labels
    .slice(1, 10)
    .map(stop => encodeURIComponent(stop))
    .join('+to:');
  return `https://maps.google.com/maps?hl=zh-TW&saddr=${origin}&daddr=${destChain}&dirflg=d&output=embed`;
};

/**
 * 呼叫後端 /api/google-maps/verify-route 取得官方 Google Maps 實際距離與路線圖
 */
export const verifyRouteViaGoogleMapsApi = async (
  stops: string[],
  vehicle: 'car' | 'motorcycle' = 'car'
): Promise<{ ok: true; data: GoogleMapsApiVerifyResult } | { ok: false; message: string; missingKey?: boolean }> => {
  try {
    const res = await fetch(`${API_BASE_URL}/google-maps/verify-route`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ stops, vehicle }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        missingKey: res.status === 503,
        message: String(json?.detail || `Google Maps 查詢失敗 (HTTP ${res.status})`),
      };
    }
    return {
      ok: true,
      data: {
        distanceKm: Number(json.distanceKm) || 0,
        durationMin: Number(json.durationMin) || 0,
        viaRoad: String(json.viaRoad || ''),
        staticMapDataUrl: json.staticMapDataUrl || null,
      },
    };
  } catch {
    return {
      ok: false,
      message: '連線後端 Google Maps 驗證服務失敗，請檢查網路狀態',
    };
  }
};

/**
 * 透過瀏覽器原生螢幕擷取 API 一鍵拍攝 Google Maps 分頁截圖
 */
export const captureScreenSnapshot = async (): Promise<string | null> => {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    throw new Error('目前瀏覽器不支援視窗擷取，請直接截圖後按 Ctrl+V 貼上或上傳圖檔。');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'never' } as MediaTrackConstraints,
    audio: false,
  });

  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    await new Promise<void>(resolve => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        setTimeout(resolve, 160);
      } else {
        video.onloadeddata = () => setTimeout(resolve, 160);
      }
    });

    const maxW = 1600;
    const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    stream.getTracks().forEach(t => t.stop());
  }
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
