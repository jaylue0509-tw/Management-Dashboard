/**
 * 時間工具：統一處理後端回傳的 UTC 時間字串
 *
 * NOTE: 舊資料的 createdAt 為無時區 ISO 字串 (例如 "2026-11-03T06:03:04.417921")，
 * 實際上是 UTC 時間；若直接丟進 new Date() 會被當成本地時間，導致日期與時間偏移 8 小時。
 */

const ISO_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * 將後端時間字串正規化為帶有 'Z' 的 UTC ISO 字串
 * @param iso 後端時間字串
 * @returns 帶時區的 ISO 字串；無法辨識時原樣回傳
 */
export const normalizeUtcIso = (iso?: string | null): string => {
  if (!iso) return '';
  const trimmed = String(iso).trim();
  return ISO_WITHOUT_ZONE.test(trimmed) ? `${trimmed}Z` : trimmed;
};

/**
 * 解析後端 UTC 時間字串為 Date 物件
 * @param iso 後端時間字串
 * @returns Date 物件 (無效時為 Invalid Date)
 */
export const parseUtcDate = (iso?: string | null): Date => new Date(normalizeUtcIso(iso));

/**
 * 取得台北時區的日期字串 (YYYY-MM-DD)
 * @param iso 後端時間字串
 * @returns 台北日期字串；無效時回傳空字串
 */
export const getTaipeiDateStr = (iso?: string | null): string => {
  if (!iso) return '';
  const d = parseUtcDate(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
};

/**
 * 格式化為台北時區的「M/D HH:mm」回報時間
 * @param iso 後端時間字串
 * @returns 回報時間文字；無效時回傳空字串
 */
export const formatTaipeiReportTime = (iso?: string | null): string => {
  if (!iso) return '';
  const d = parseUtcDate(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
};

/**
 * 計算距今分鐘數 (即時計算，不依賴資料內寫死的 timeAgoMinutes)
 * @param iso 後端時間字串
 * @returns 距今分鐘數；無效時回傳 0
 */
export const getMinutesAgo = (iso?: string | null): number => {
  const d = parseUtcDate(iso);
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
};

/**
 * 將距今分鐘數轉為易讀文字
 * @param minutes 距今分鐘數
 * @returns 例如「剛剛」「15 分前」「3 小時前」「2 天前」
 */
export const formatTimeAgo = (minutes: number): string => {
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} 小時前`;
  return `${Math.floor(minutes / (60 * 24))} 天前`;
};

/**
 * 取得台北時區的今日日期字串 (YYYY-MM-DD)
 */
export const getTaipeiTodayStr = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

/**
 * 依天數增減日期字串 (YYYY-MM-DD)
 * @param dateStr 基準日期 YYYY-MM-DD
 * @param deltaDays 增加或減少的天數
 */
export const shiftDateStr = (dateStr: string, deltaDays: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
};


