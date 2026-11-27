import { lazy, type ComponentType } from 'react';

const CHUNK_RELOAD_KEY = 'app_chunk_reload_attempted_at';
const CHUNK_RELOAD_COOLDOWN_MS = 15_000;

/**
 * 判斷錯誤是否屬於動態分包（Vite / ESM dynamic import）載入失敗。
 * 常見於部署新版後舊快取 index.html 指向已失效的 chunk，或行動網路瞬斷。
 */
export const isChunkLoadError = (error: unknown): boolean => {
  if (!error) return false;
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|error loading dynamically imported module|Expected a JavaScript-or-Wasm module script/i.test(
    message
  );
};

/**
 * 嘗試以安全冷卻時間執行一次頁面重整，讓瀏覽器重新取得最新 index.html 與分包清單。
 * 若短時間內已重整過則回傳 false，避免無限重整迴圈。
 */
export const triggerSafeChunkReload = (): boolean => {
  try {
    const lastAttemptRaw = sessionStorage.getItem(CHUNK_RELOAD_KEY);
    const lastAttempt = lastAttemptRaw ? Number(lastAttemptRaw) : 0;
    const now = Date.now();
    if (lastAttempt && now - lastAttempt < CHUNK_RELOAD_COOLDOWN_MS) {
      return false;
    }
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
};

/**
 * 包裝 React.lazy，當分包下載失敗時先自動重試一次，
 * 若仍為部署版本不一致導致的 chunk 錯誤則觸發一次性重載，防止登入後全白畫面。
 * @param factory 動態 import 函式
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (firstError) {
      if (!isChunkLoadError(firstError)) {
        throw firstError;
      }

      // 短暫等待後重試一次，吸收弱網或背景喚醒瞬間的網路抖動
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      try {
        return await factory();
      } catch (secondError) {
        if (isChunkLoadError(secondError) && triggerSafeChunkReload()) {
          // 瀏覽器正在重載中，回傳 pending promise 避免在卸載前閃出錯誤畫面
          return new Promise<{ default: T }>(() => {});
        }
        throw secondError;
      }
    }
  });
}
