import {
  HEADQUARTERS_POINT,
  RAW_STORE_COORDINATES,
  REGION_HUB_POINTS,
  type GeoPoint,
} from '../data/storeCoordinates';
import { normalizeStoreName } from './store-region';
import { API_BASE_URL, getAuthHeaders } from '../api/api';

export const CUSTOM_HUBS_STORAGE_KEY = 'manager_custom_hubs_v1';
export const CUSTOM_HUBS_UPDATED_EVENT = 'manager-custom-hubs-updated';

export interface CustomHubConfig {
  address: string;
  lat: number;
  lng: number;
  matchedDisplayName?: string;
  source: 'nominatim' | 'store' | 'district' | 'coordinates' | 'headquarters';
  updatedAt: string;
}

export interface StoredCustomHubs {
  global: CustomHubConfig | null;
  byManager: Record<string, CustomHubConfig>;
}

/**
 * 台灣常用行政區、交通樞紐與地標離線保底座標表
 * 當網路離線或 Nominatim 查詢無結果時，可依地址關鍵字自動對應行政區中心
 */
const TAIWAN_LANDMARK_FALLBACKS: { keywords: string[]; lat: number; lng: number; name: string }[] = [
  { keywords: ['總部', '東森總部', '中和景平'], lat: HEADQUARTERS_POINT.lat, lng: HEADQUARTERS_POINT.lng, name: '總部大樓（中和）' },
  // 台北市
  { keywords: ['中正區', '台北車站', '北車'], lat: 25.0478, lng: 121.517, name: '台北市中正區' },
  { keywords: ['大安區', '大安'], lat: 25.0267, lng: 121.5435, name: '台北市大安區' },
  { keywords: ['信義區', '台北101'], lat: 25.033, lng: 121.5654, name: '台北市信義區' },
  { keywords: ['松山區', '松山'], lat: 25.0497, lng: 121.5775, name: '台北市松山區' },
  { keywords: ['中山區', '中山'], lat: 25.0642, lng: 121.5335, name: '台北市中山區' },
  { keywords: ['大同區', '大同'], lat: 25.0635, lng: 121.513, name: '台北市大同區' },
  { keywords: ['萬華區', '萬華', '西門'], lat: 25.0345, lng: 121.4995, name: '台北市萬華區' },
  { keywords: ['士林區', '士林'], lat: 25.0928, lng: 121.5256, name: '台北市士林區' },
  { keywords: ['北投區', '北投'], lat: 25.1318, lng: 121.5015, name: '台北市北投區' },
  { keywords: ['內湖區', '內湖'], lat: 25.0697, lng: 121.5885, name: '台北市內湖區' },
  { keywords: ['南港區', '南港'], lat: 25.0545, lng: 121.6068, name: '台北市南港區' },
  { keywords: ['文山區', '文山', '景美', '木柵'], lat: 24.9897, lng: 121.5705, name: '台北市文山區' },
  // 新北市
  { keywords: ['板橋區', '板橋'], lat: 25.0143, lng: 121.4637, name: '新北市板橋區' },
  { keywords: ['中和區', '中和'], lat: 25.0015, lng: 121.4885, name: '新北市中和區' },
  { keywords: ['永和區', '永和'], lat: 25.0085, lng: 121.5155, name: '新北市永和區' },
  { keywords: ['新莊區', '新莊'], lat: 25.036, lng: 121.4325, name: '新北市新莊區' },
  { keywords: ['三重區', '三重'], lat: 25.063, lng: 121.4868, name: '新北市三重區' },
  { keywords: ['蘆洲區', '蘆洲'], lat: 25.0848, lng: 121.4735, name: '新北市蘆洲區' },
  { keywords: ['土城區', '土城'], lat: 24.9722, lng: 121.4433, name: '新北市土城區' },
  { keywords: ['新店區', '新店'], lat: 24.9675, lng: 121.5415, name: '新北市新店區' },
  { keywords: ['樹林區', '樹林'], lat: 24.9912, lng: 121.4242, name: '新北市樹林區' },
  { keywords: ['汐止區', '汐止'], lat: 25.0675, lng: 121.658, name: '新北市汐止區' },
  { keywords: ['淡水區', '淡水'], lat: 25.1695, lng: 121.4408, name: '新北市淡水區' },
  { keywords: ['林口區', '林口'], lat: 25.0775, lng: 121.3765, name: '新北市林口區' },
  { keywords: ['五股區', '五股'], lat: 25.083, lng: 121.4382, name: '新北市五股區' },
  { keywords: ['泰山區', '泰山'], lat: 25.0588, lng: 121.4308, name: '新北市泰山區' },
  { keywords: ['三峽區', '三峽'], lat: 24.9345, lng: 121.369, name: '新北市三峽區' },
  { keywords: ['鶯歌區', '鶯歌'], lat: 24.9555, lng: 121.3545, name: '新北市鶯歌區' },
  { keywords: ['八里區', '八里'], lat: 25.1468, lng: 121.4015, name: '新北市八里區' },
  // 基隆與桃園
  { keywords: ['基隆'], lat: 25.1276, lng: 121.7392, name: '基隆市' },
  { keywords: ['桃園區', '桃園火車站', '桃園市'], lat: 24.9936, lng: 121.301, name: '桃園市桃園區' },
  { keywords: ['中壢區', '中壢', '青埔'], lat: 24.9537, lng: 121.2258, name: '桃園市中壢區' },
  { keywords: ['蘆竹區', '蘆竹', '南崁'], lat: 25.045, lng: 121.295, name: '桃園市蘆竹區' },
  { keywords: ['龜山區', '龜山'], lat: 25.0125, lng: 121.3545, name: '桃園市龜山區' },
  { keywords: ['八德區', '八德'], lat: 24.9385, lng: 121.2845, name: '桃園市八德區' },
  { keywords: ['平鎮區', '平鎮'], lat: 24.9295, lng: 121.2185, name: '桃園市平鎮區' },
  { keywords: ['楊梅區', '楊梅'], lat: 24.9075, lng: 121.1455, name: '桃園市楊梅區' },
  { keywords: ['龍潭區', '龍潭'], lat: 24.8645, lng: 121.2115, name: '桃園市龍潭區' },
  { keywords: ['大溪區', '大溪'], lat: 24.8805, lng: 121.2865, name: '桃園市大溪區' },
  { keywords: ['觀音區', '觀音'], lat: 25.0355, lng: 121.0825, name: '桃園市觀音區' },
  // 新竹與苗栗
  { keywords: ['竹北'], lat: 24.8387, lng: 121.0177, name: '新竹縣竹北市' },
  { keywords: ['新竹'], lat: 24.8066, lng: 120.9686, name: '新竹市' },
  { keywords: ['湖口'], lat: 24.9015, lng: 121.0445, name: '新竹縣湖口鄉' },
  { keywords: ['竹東'], lat: 24.7365, lng: 121.0872, name: '新竹縣竹東鎮' },
  { keywords: ['頭份'], lat: 24.6875, lng: 120.9065, name: '苗栗縣頭份市' },
  { keywords: ['竹南'], lat: 24.6875, lng: 120.8768, name: '苗栗縣竹南鎮' },
  { keywords: ['苗栗'], lat: 24.5602, lng: 120.8214, name: '苗栗縣苗栗市' },
  { keywords: ['苑裡'], lat: 24.4422, lng: 120.6532, name: '苗栗縣苑裡鎮' },
  // 台中、南投、彰化、雲林
  { keywords: ['西屯', '台中市政', '七期', '逢甲'], lat: 24.1618, lng: 120.6469, name: '台中市西屯區' },
  { keywords: ['北屯'], lat: 24.1825, lng: 120.6865, name: '台中市北屯區' },
  { keywords: ['南屯'], lat: 24.1385, lng: 120.6435, name: '台中市南屯區' },
  { keywords: ['豐原'], lat: 24.252, lng: 120.7225, name: '台中市豐原區' },
  { keywords: ['大里'], lat: 24.0995, lng: 120.6775, name: '台中市大里區' },
  { keywords: ['太平'], lat: 24.1265, lng: 120.7185, name: '台中市太平區' },
  { keywords: ['烏日', '台中高鐵'], lat: 24.1115, lng: 120.6155, name: '台中市烏日區' },
  { keywords: ['沙鹿', '清水', '梧棲'], lat: 24.2365, lng: 120.5665, name: '台中市海線（沙鹿）' },
  { keywords: ['台中', '臺中'], lat: 24.1477, lng: 120.6736, name: '台中市中心' },
  { keywords: ['草屯'], lat: 23.9785, lng: 120.6845, name: '南投縣草屯鎮' },
  { keywords: ['南投', '埔里'], lat: 23.9157, lng: 120.6869, name: '南投縣南投市' },
  { keywords: ['彰化'], lat: 24.0757, lng: 120.5435, name: '彰化縣彰化市' },
  { keywords: ['員林'], lat: 23.9591, lng: 120.5718, name: '彰化縣員林市' },
  { keywords: ['和美', '鹿港'], lat: 24.0845, lng: 120.4645, name: '彰化縣鹿港／和美' },
  { keywords: ['斗六'], lat: 23.7095, lng: 120.543, name: '雲林縣斗六市' },
  { keywords: ['虎尾', '雲林'], lat: 23.7085, lng: 120.435, name: '雲林縣虎尾鎮' },
  // 嘉義與台南
  { keywords: ['嘉義'], lat: 23.4801, lng: 120.4491, name: '嘉義市' },
  { keywords: ['新營'], lat: 23.3102, lng: 120.3168, name: '台南市新營區' },
  { keywords: ['永康'], lat: 23.0265, lng: 120.2565, name: '台南市永康區' },
  { keywords: ['安平', '台南', '臺南'], lat: 22.9997, lng: 120.227, name: '台南市中心' },
  { keywords: ['麻豆', '善化', '新市'], lat: 23.145, lng: 120.295, name: '台南市善化／麻豆' },
  // 高雄與屏東
  { keywords: ['左營', '高雄高鐵'], lat: 22.6872, lng: 120.3075, name: '高雄市左營區' },
  { keywords: ['鼓山', '三民', '苓雅', '前鎮', '高雄'], lat: 22.6273, lng: 120.3014, name: '高雄市中心' },
  { keywords: ['鳳山'], lat: 22.627, lng: 120.358, name: '高雄市鳳山區' },
  { keywords: ['楠梓', '岡山'], lat: 22.7285, lng: 120.3245, name: '高雄市楠梓區' },
  { keywords: ['小港'], lat: 22.5645, lng: 120.3605, name: '高雄市小港區' },
  { keywords: ['屏東'], lat: 22.6718, lng: 120.4875, name: '屏東縣屏東市' },
  { keywords: ['潮州', '東港'], lat: 22.5505, lng: 120.5425, name: '屏東縣潮州鎮' },
  // 宜蘭、花蓮、台東
  { keywords: ['宜蘭'], lat: 24.757, lng: 121.753, name: '宜蘭縣宜蘭市' },
  { keywords: ['羅東'], lat: 24.677, lng: 121.7668, name: '宜蘭縣羅東鎮' },
  { keywords: ['花蓮'], lat: 23.9872, lng: 121.6016, name: '花蓮縣花蓮市' },
  { keywords: ['台東', '臺東'], lat: 22.7583, lng: 121.1444, name: '台東縣台東市' },
];

const geocodeCache = new Map<string, CustomHubConfig>();

/**
 * 將使用者輸入的台灣地址、地標、門市名稱或經緯度轉換為精準地理座標
 */
export const geocodeTaiwanAddress = async (rawInput: string): Promise<CustomHubConfig | null> => {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const cached = geocodeCache.get(trimmed);
  if (cached) return { ...cached, updatedAt: new Date().toISOString() };

  // 1. 直接輸入「緯度, 經度」格式（如 25.0169, 121.4628）
  const coordMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lng = Number(coordMatch[2]);
    if (lat >= 21.5 && lat <= 26.5 && lng >= 118 && lng <= 122.5) {
      const res: CustomHubConfig = {
        address: trimmed,
        lat,
        lng,
        matchedDisplayName: `自訂座標 (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
        source: 'coordinates',
        updatedAt: new Date().toISOString(),
      };
      geocodeCache.set(trimmed, res);
      return res;
    }
  }

  // 2. 優先比對總部或區域預設中心
  if (trimmed === '總部' || trimmed === '總部大樓' || trimmed.includes('東森總部')) {
    return {
      address: trimmed,
      lat: HEADQUARTERS_POINT.lat,
      lng: HEADQUARTERS_POINT.lng,
      matchedDisplayName: HEADQUARTERS_POINT.label,
      source: 'headquarters',
      updatedAt: new Date().toISOString(),
    };
  }

  // 3. 比對系統內建門市名稱（方便直接以某門市作為出發點）
  const normStore = normalizeStoreName(trimmed);
  if (normStore && RAW_STORE_COORDINATES[normStore]) {
    const pt = RAW_STORE_COORDINATES[normStore];
    const res: CustomHubConfig = {
      address: trimmed,
      lat: pt.lat,
      lng: pt.lng,
      matchedDisplayName: `${trimmed}（門市座標）`,
      source: 'store',
      updatedAt: new Date().toISOString(),
    };
    geocodeCache.set(trimmed, res);
    return res;
  }

  // 4. 線上高精度地理編碼：OpenStreetMap Nominatim（免費免金鑰，限定台灣範圍）
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 6000);
    const queryUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=tw&limit=1&accept-language=zh-TW&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(queryUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    window.clearTimeout(timeoutId);

    if (response.ok) {
      const results = await response.json();
      if (Array.isArray(results) && results.length > 0) {
        const hit = results[0];
        const lat = Number(hit.lat);
        const lng = Number(hit.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const res: CustomHubConfig = {
            address: trimmed,
            lat,
            lng,
            matchedDisplayName: String(hit.display_name || trimmed),
            source: 'nominatim',
            updatedAt: new Date().toISOString(),
          };
          geocodeCache.set(trimmed, res);
          return res;
        }
      }
    }
  } catch {
    // 網路離線或超時時自動退回離線行政區座標表，不中斷操作
  }

  // 5. 離線保底：比對台灣行政區／地標關鍵字表
  const normalizedAddr = trimmed.replace(/臺/g, '台');
  for (const item of TAIWAN_LANDMARK_FALLBACKS) {
    if (item.keywords.some(kw => normalizedAddr.includes(kw.replace(/臺/g, '台')))) {
      const res: CustomHubConfig = {
        address: trimmed,
        lat: item.lat,
        lng: item.lng,
        matchedDisplayName: `${item.name}（行政區保底座標）`,
        source: 'district',
        updatedAt: new Date().toISOString(),
      };
      geocodeCache.set(trimmed, res);
      return res;
    }
  }

  // 6. 最後嘗試比對區域中心名稱
  for (const [regionName, pt] of Object.entries(REGION_HUB_POINTS)) {
    if (normalizedAddr.includes(regionName.replace('區', ''))) {
      return {
        address: trimmed,
        lat: pt.lat,
        lng: pt.lng,
        matchedDisplayName: pt.label,
        source: 'district',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return null;
};

/**
 * 將手機／瀏覽器 GPS 經緯度反查為台灣繁體中文門牌或道路地址（失敗時安全回退為經緯度文字）
 */
export const reverseGeocodeTaiwanCoords = async (
  lat: number,
  lng: number
): Promise<CustomHubConfig> => {
  let readableAddress = `GPS 定位（${lat.toFixed(5)}, ${lng.toFixed(5)}）`;
  let displayName = readableAddress;

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&accept-language=zh-TW&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    window.clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      const addr = json?.address || {};
      const city = addr.city || addr.county || '';
      const district = addr.suburb || addr.town || addr.city_district || addr.district || '';
      const road = addr.road || addr.pedestrian || addr.neighbourhood || '';
      const houseNo = addr.house_number ? `${addr.house_number}號` : '';
      const composed = `${city}${district}${road}${houseNo}`.trim();
      if (composed.length >= 4) {
        readableAddress = composed;
      } else if (typeof json?.display_name === 'string' && json.display_name.trim()) {
        readableAddress = json.display_name.split(',').slice(0, 3).reverse().join('').trim() || readableAddress;
      }
      if (typeof json?.display_name === 'string' && json.display_name.trim()) {
        displayName = json.display_name;
      }
    }
  } catch {
    // 離線或超時時保留精準 GPS 經緯度文字
  }

  return {
    address: readableAddress,
    lat,
    lng,
    matchedDisplayName: displayName,
    source: 'coordinates',
    updatedAt: new Date().toISOString(),
  };
};

/**
 * 讀取本地持久化儲存的自訂出發起始點設定
 */
export const loadCustomHubPoints = (): StoredCustomHubs => {
  try {
    const raw = localStorage.getItem(CUSTOM_HUBS_STORAGE_KEY);
    if (!raw) return { global: null, byManager: {} };
    const parsed = JSON.parse(raw);
    return {
      global: parsed?.global && typeof parsed.global.lat === 'number' ? parsed.global : null,
      byManager: parsed?.byManager && typeof parsed.byManager === 'object' ? parsed.byManager : {},
    };
  } catch {
    return { global: null, byManager: {} };
  }
};

/**
 * 儲存自訂起始點設定並發送全域事件，同步連動車資核算、報核單與巡店路徑地圖
 */
export const saveCustomHubPoints = (data: StoredCustomHubs): void => {
  try {
    localStorage.setItem(CUSTOM_HUBS_STORAGE_KEY, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent(CUSTOM_HUBS_UPDATED_EVENT));
  } catch {
    // 忽略私密瀏覽等儲存異常
  }
};

/**
 * 清除本機自訂起始點快取（登出、切換帳號或權限失效時呼叫，避免跨帳號資料殘留）
 */
export const clearCustomHubPointsCache = (): void => {
  try {
    localStorage.removeItem(CUSTOM_HUBS_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(CUSTOM_HUBS_UPDATED_EVENT));
  } catch {
    // 忽略儲存異常
  }
};

/**
 * 將 CustomHubConfig 轉換為里程引擎與地圖共用的 GeoPoint
 */
export const customHubToGeoPoint = (cfg: CustomHubConfig | null | undefined): GeoPoint | undefined => {
  if (!cfg) return undefined;
  return {
    lat: cfg.lat,
    lng: cfg.lng,
    label: cfg.address,
  };
};

/**
 * 從後端資料庫同步最新的區主管起始點地址設定（手機／電腦／總部統一標準）
 */
export const syncCustomHubPointsFromServer = async (): Promise<StoredCustomHubs> => {
  const local = loadCustomHubPoints();
  try {
    const res = await fetch(`${API_BASE_URL}/manager-start-addresses`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (res.status === 401 || res.status === 403) {
      clearCustomHubPointsCache();
      return { global: null, byManager: {} };
    }
    if (!res.ok) return local;
    const json = await res.json();
    const serverData: StoredCustomHubs = {
      global: json?.global && typeof json.global.lat === 'number' ? json.global : null,
      byManager: json?.byManager && typeof json.byManager === 'object' ? json.byManager : {},
    };
    saveCustomHubPoints(serverData);
    return serverData;
  } catch {
    return local;
  }
};

/**
 * 將區主管出發起始點地址持久化儲存至後端資料庫（並同步本機快取與全域事件）
 */
export const saveCustomHubPointToServer = async (
  targetKey: string,
  cfg: CustomHubConfig
): Promise<{ ok: boolean; syncedCloud: boolean; data: StoredCustomHubs }> => {
  const local = loadCustomHubPoints();
  const optimistic: StoredCustomHubs =
    targetKey === '__global__'
      ? { ...local, global: cfg }
      : { ...local, byManager: { ...local.byManager, [targetKey]: cfg } };
  saveCustomHubPoints(optimistic);

  try {
    const res = await fetch(`${API_BASE_URL}/manager-start-addresses`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        targetManager: targetKey,
        address: cfg.address,
        lat: cfg.lat,
        lng: cfg.lng,
        source: cfg.source,
        matchedDisplayName: cfg.matchedDisplayName || cfg.address,
        clear: false,
      }),
    });
    if (!res.ok) {
      return { ok: true, syncedCloud: false, data: optimistic };
    }
    const json = await res.json();
    if (json?.data) {
      const serverData: StoredCustomHubs = {
        global: json.data.global || null,
        byManager: json.data.byManager || {},
      };
      saveCustomHubPoints(serverData);
      return { ok: true, syncedCloud: true, data: serverData };
    }
    return { ok: true, syncedCloud: true, data: optimistic };
  } catch {
    return { ok: true, syncedCloud: false, data: optimistic };
  }
};

/**
 * 從後端資料庫清除指定主管之自訂出發起始點地址
 */
export const deleteCustomHubPointFromServer = async (
  targetKey: string
): Promise<{ ok: boolean; syncedCloud: boolean; data: StoredCustomHubs }> => {
  const local = loadCustomHubPoints();
  const optimistic: StoredCustomHubs =
    targetKey === '__global__'
      ? { ...local, global: null }
      : {
          ...local,
          byManager: Object.fromEntries(
            Object.entries(local.byManager).filter(([k]) => k !== targetKey)
          ),
        };
  saveCustomHubPoints(optimistic);

  try {
    const res = await fetch(`${API_BASE_URL}/manager-start-addresses`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ targetManager: targetKey, clear: true }),
    });
    if (!res.ok) {
      return { ok: true, syncedCloud: false, data: optimistic };
    }
    const json = await res.json();
    if (json?.data) {
      const serverData: StoredCustomHubs = {
        global: json.data.global || null,
        byManager: json.data.byManager || {},
      };
      saveCustomHubPoints(serverData);
      return { ok: true, syncedCloud: true, data: serverData };
    }
    return { ok: true, syncedCloud: true, data: optimistic };
  } catch {
    return { ok: true, syncedCloud: false, data: optimistic };
  }
};
