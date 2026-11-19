import type { GeoPoint } from '../data/storeCoordinates';

/**
 * 將站點名稱轉為 Google Maps 友善搜尋字串
 * 優先保留完整中文地址或地標名稱，避免純經緯度被 Google Maps 解析為鄰近無關商號
 */
export const formatStopForGoogleMaps = (label: string, fallbackPt?: GeoPoint): string => {
  const clean = (label || '').trim();
  if (!clean) {
    return fallbackPt ? `${fallbackPt.lat.toFixed(6)},${fallbackPt.lng.toFixed(6)}` : '';
  }

  // 若為系統預設區域中心（如「新北區中心（板橋）」），取括號內區名搭配台灣地名
  const hubMatch = clean.match(/中心[（(]([^）)]+)[）)]/);
  if (hubMatch && hubMatch[1]) {
    return `${hubMatch[1].split('／')[0]}車站`;
  }

  // 若為總部大樓
  if (clean.includes('總部大樓') || clean === '總部') {
    return '新北市中和區景平路258號';
  }

  // 若為系統公務行程前綴（如「特殊行程：XXX」），取冒號後真實地點描述
  if (/^(總部行程|會議行程|特殊行程)[：:]/.test(clean)) {
    const detail = clean.replace(/^(總部行程|會議行程|特殊行程)[：:]/, '').trim();
    if (detail) return detail;
  }

  // 若為門市名稱（不含縣市路街號，且以「店」結尾或為簡短門市名），冠上「東森寵物」讓 Google Maps 精準定位門市門牌
  const looksLikeAddress = /[市縣區鄉鎮路街道段巷弄號車站機場大樓館中心]/.test(clean);
  if (!looksLikeAddress && clean.length <= 12) {
    return `東森寵物 ${clean}`;
  }

  return clean;
};

/**
 * 產生 Google Maps 官方多停靠點距離驗證連結（採用可讀中文地址／門市名，讓畫面如原版 Google Maps 清晰呈現）
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

  if (labels.length === 0) {
    return 'https://www.google.com/maps/dir/';
  }
  if (labels.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(labels[0])}`;
  }

  const origin = labels[0];
  const destination = labels[labels.length - 1];
  // Google Maps 通用 URL 支援最多 9 個中繼站 (waypoints)
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
 * 透過瀏覽器原生螢幕擷取 API（getDisplayMedia）一鍵拍攝 Google Maps 分頁／視窗的真實截圖
 * 擷取單張高解析度畫面後立即關閉螢幕共享串流，不錄影、不外傳
 */
export const captureScreenSnapshot = async (): Promise<string | null> => {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    throw new Error('目前瀏覽器不支援視窗擷取功能，請直接於 Google Maps 截圖後按 Ctrl+V 貼上或上傳圖檔。');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      cursor: 'never',
    } as MediaTrackConstraints,
    audio: false,
  });

  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    // 等待視訊影格穩定渲染
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
