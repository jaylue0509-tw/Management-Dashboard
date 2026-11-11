import { normalizeRegionName, normalizeStoreName } from '../utils/store-region';

export interface GeoPoint {
  lat: number;
  lng: number;
  label: string;
  isOffshore?: boolean;
}

/**
 * 台北總部座標（新北市中和區／台北市區中心基準）
 */
export const HEADQUARTERS_POINT: GeoPoint = {
  lat: 25.0015,
  lng: 121.4885,
  label: '總部大樓',
};

/**
 * 各區域中心／區主管日常出發基準點
 */
export const REGION_HUB_POINTS: Record<string, GeoPoint> = {
  新北區: { lat: 25.0169, lng: 121.4628, label: '新北區中心（板橋）' },
  北桃區: { lat: 25.033, lng: 121.38, label: '北桃區中心（林口／桃園）' },
  竹苗區: { lat: 24.8138, lng: 120.987, label: '竹苗區中心（竹北）' },
  中投區: { lat: 24.1618, lng: 120.6469, label: '中投區中心（台中市政）' },
  彰雲區: { lat: 23.9591, lng: 120.5718, label: '彰雲區中心（員林）' },
  嘉南區: { lat: 23.185, lng: 120.28, label: '嘉南區中心（麻豆／新營）' },
  高雄區: { lat: 22.665, lng: 120.305, label: '高雄區中心（左營）' },
  高屏區: { lat: 22.625, lng: 120.435, label: '高屏區中心（屏東／鳳山）' },
  宜花區: { lat: 24.677, lng: 121.77, label: '宜花區中心（羅東）' },
};

/**
 * 全台各門市實際行政區與路段座標（依正規化門市名稱索引，不含結尾「店」字）
 */
const RAW_STORE_COORDINATES: Record<string, { lat: number; lng: number; isOffshore?: boolean }> = {
  // 新北區 (8 店)
  板橋雨農: { lat: 25.0252, lng: 121.4596 },
  新北八里: { lat: 25.1468, lng: 121.4015 },
  土城中華: { lat: 24.9795, lng: 121.4418 },
  永和得和: { lat: 25.0012, lng: 121.5205 },
  三重中正北: { lat: 25.0695, lng: 121.4792 },
  三重三和: { lat: 25.0762, lng: 121.4918 },
  新莊旗艦: { lat: 25.0395, lng: 121.4465 },
  新莊中正: { lat: 25.0322, lng: 121.4342 },

  // 北桃區 (14 店)
  蘆竹南昌: { lat: 25.0425, lng: 121.2925 },
  北投中和: { lat: 25.1398, lng: 121.4995 },
  大安通化: { lat: 25.0308, lng: 121.5542 },
  士林文林: { lat: 25.0928, lng: 121.5256 },
  龜山自強西: { lat: 24.9942, lng: 121.3375 },
  大同民族西: { lat: 25.0685, lng: 121.5138 },
  大安建國南: { lat: 25.0285, lng: 121.5375 },
  士林文林二: { lat: 25.0952, lng: 121.5245 },
  桃園巨蛋: { lat: 24.9958, lng: 121.3228 },
  蘆竹大新: { lat: 25.0225, lng: 121.2642 },
  龜山復興: { lat: 25.0585, lng: 121.3688 },
  中壢中央東: { lat: 24.9562, lng: 121.2268 },
  觀音大觀: { lat: 25.0465, lng: 121.1415 },
  大直北安: { lat: 25.0812, lng: 121.5478 },

  // 竹苗區 (10 店)
  新竹建興: { lat: 24.8012, lng: 120.9925 },
  新竹經國: { lat: 24.8125, lng: 120.9635 },
  竹北成功: { lat: 24.8185, lng: 121.0245 },
  苑裡中山: { lat: 24.4422, lng: 120.6532 },
  竹北中正東: { lat: 24.8365, lng: 121.0128 },
  湖口中山: { lat: 24.9015, lng: 121.0445 },
  竹東長春: { lat: 24.7405, lng: 121.0872 },
  竹南延平: { lat: 24.6875, lng: 120.8768 },
  苗栗縣府: { lat: 24.5645, lng: 120.8205 },
  頭份中華: { lat: 24.6915, lng: 120.9065 },

  // 中投區 (12 店)
  台中東海: { lat: 24.1825, lng: 120.5918 },
  豐原圓環東: { lat: 24.2512, lng: 120.7285 },
  台中青海: { lat: 24.1695, lng: 120.6462 },
  大里仁化: { lat: 24.0958, lng: 120.6968 },
  台中北屯: { lat: 24.1725, lng: 120.6982 },
  台中中清: { lat: 24.1852, lng: 120.6658 },
  北屯后庄北: { lat: 24.1945, lng: 120.6672 },
  台中沙鹿: { lat: 24.2368, lng: 120.5625 },
  北屯軍功: { lat: 24.1782, lng: 120.7248 },
  台中澄清: { lat: 24.1812, lng: 120.6168 },
  埔里中山: { lat: 23.9685, lng: 120.9642 },
  草屯明賢: { lat: 23.9788, lng: 120.6835 },

  // 彰雲區 (13 店)
  溪湖彰水: { lat: 23.9602, lng: 120.4795 },
  田中福安: { lat: 23.8588, lng: 120.5872 },
  北斗中華: { lat: 23.8725, lng: 120.5258 },
  彰化中正: { lat: 24.0755, lng: 120.5385 },
  彰化中山: { lat: 24.0685, lng: 120.5432 },
  和美彰美: { lat: 24.1095, lng: 120.5025 },
  員林三民東: { lat: 23.9612, lng: 120.5785 },
  虎尾林森: { lat: 23.7115, lng: 120.4368 },
  斗六民生南: { lat: 23.7025, lng: 120.5412 },
  北港民享: { lat: 23.5752, lng: 120.3035 },
  西螺公正: { lat: 23.7985, lng: 120.4612 },
  斗南延平: { lat: 23.6768, lng: 120.4785 },
  麥寮中興: { lat: 23.7512, lng: 120.2545 },

  // 嘉南區 (18 店)
  新營民生: { lat: 23.3105, lng: 120.3088 },
  麻豆興中: { lat: 23.1842, lng: 120.2518 },
  佳里新生: { lat: 23.1605, lng: 120.1772 },
  善化光復: { lat: 23.1328, lng: 120.2965 },
  新市中正: { lat: 23.0785, lng: 120.2918 },
  嘉義北港: { lat: 23.4812, lng: 120.4265 },
  嘉義友愛: { lat: 23.4828, lng: 120.4385 },
  嘉義吳鳳南: { lat: 23.4625, lng: 120.4578 },
  嘉義朴子: { lat: 23.4648, lng: 120.2472 },
  安南海佃: { lat: 23.0358, lng: 120.1895 },
  台南永康: { lat: 23.0225, lng: 120.2568 },
  永康永大: { lat: 23.0165, lng: 120.2632 },
  關廟南雄: { lat: 22.9618, lng: 120.3285 },
  台南中華東: { lat: 22.9845, lng: 120.2335 },
  台南西門: { lat: 22.9965, lng: 120.2002 },
  仁德中山: { lat: 22.9718, lng: 120.2465 },
  安平建平: { lat: 22.9912, lng: 120.1785 },
  歸仁中山: { lat: 22.9672, lng: 120.2918 },

  // 高雄區 (14 店)
  楠梓藍昌: { lat: 22.7285, lng: 120.2895 },
  楠梓興楠: { lat: 22.7312, lng: 120.3318 },
  岡山柳橋西: { lat: 22.7935, lng: 120.2912 },
  路竹中山: { lat: 22.8565, lng: 120.2625 },
  左營左大: { lat: 22.6885, lng: 120.2945 },
  仁武仁雄: { lat: 22.6815, lng: 120.3485 },
  前金自強一: { lat: 22.6315, lng: 120.2945 },
  三民十全: { lat: 22.6442, lng: 120.3125 },
  前金自立: { lat: 22.6285, lng: 120.2988 },
  前鎮瑞隆: { lat: 22.6052, lng: 120.3328 },
  鳳山青年: { lat: 22.6388, lng: 120.3492 },
  小港宏平: { lat: 22.5675, lng: 120.3545 },
  澎湖馬公: { lat: 23.5695, lng: 119.5665, isOffshore: true },
  小港桂陽: { lat: 22.5785, lng: 120.3712 },

  // 高屏區 (10 店)
  大寮鳳林: { lat: 22.6058, lng: 120.3958 },
  高雄林園東: { lat: 22.5055, lng: 120.3965 },
  台東更生: { lat: 22.7615, lng: 121.1415 },
  屏東自由: { lat: 22.6745, lng: 120.4882 },
  東港中正: { lat: 22.4685, lng: 120.4535 },
  潮州延平: { lat: 22.5518, lng: 120.5415 },
  內埔學人: { lat: 22.6135, lng: 120.5678 },
  恆春環城南: { lat: 22.0015, lng: 120.7458 },
  屏東萬丹: { lat: 22.5885, lng: 120.4848 },
  苓雅大順: { lat: 22.6312, lng: 120.3268 },

  // 宜花區 (8 店)
  羅東林場: { lat: 24.6838, lng: 121.7718 },
  宜蘭新生: { lat: 24.7632, lng: 121.7545 },
  花蓮中正: { lat: 23.9785, lng: 121.6068 },
  羅東光榮: { lat: 24.6752, lng: 121.7785 },
  吉安自強: { lat: 23.9712, lng: 121.5865 },
  玉里和平: { lat: 23.3345, lng: 121.3145 },
  蘇澳中山: { lat: 24.5965, lng: 121.8435 },
  宜蘭員山: { lat: 24.7458, lng: 121.7218 },
};

/**
 * 取得區域中心座標
 */
export const getRegionHubPoint = (region?: string): GeoPoint => {
  const normRegion = normalizeRegionName(region);
  if (normRegion && REGION_HUB_POINTS[normRegion]) {
    return REGION_HUB_POINTS[normRegion];
  }
  return REGION_HUB_POINTS['中投區'];
};

/**
 * 取得門市地理座標；若為未知門市則回退至所屬區域中心座標
 */
export const getStoreGeoPoint = (storeName: string, fallbackRegion?: string): GeoPoint => {
  const norm = normalizeStoreName(storeName);
  const hit = RAW_STORE_COORDINATES[norm];
  if (hit) {
    return {
      lat: hit.lat,
      lng: hit.lng,
      label: storeName,
      isOffshore: hit.isOffshore,
    };
  }
  const hub = getRegionHubPoint(fallbackRegion);
  return {
    lat: hub.lat,
    lng: hub.lng,
    label: storeName || hub.label,
  };
};

/**
 * Haversine 球面直線距離公式（單位：公里）
 */
const haversineKm = (a: GeoPoint, b: GeoPoint): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * 依據台灣實際道路路網蜿蜒係數，推估兩點之間的實際開車里程（單位：公里，取至小數點第 1 位）
 * NOTE:
 * - 若兩點為同一門市（距離 < 0.15 km），回傳 0 km
 * - 若涉及離島門市（如澎湖馬公店），僅計算當地市區短程交通（約 8.0 km），不計算跨海直線距離
 * - 宜花／高屏山海線道路修正係數採 1.38，一般西部走廊縣市道路採 1.33，同行政區短程保底 2.5 km
 */
export const estimateDrivingKm = (from: GeoPoint, to: GeoPoint, region?: string): number => {
  if (from.isOffshore || to.isOffshore) {
    if (from.label === to.label) return 0;
    return 8.0;
  }

  const straightKm = haversineKm(from, to);
  if (straightKm < 0.15) return 0;

  const normRegion = normalizeRegionName(region);
  const isMountainOrEast = normRegion === '宜花區' || normRegion === '高屏區';
  const roadFactor = isMountainOrEast ? 1.38 : 1.33;

  const estimated = Math.max(2.5, straightKm * roadFactor);
  return Math.round(estimated * 10) / 10;
};
