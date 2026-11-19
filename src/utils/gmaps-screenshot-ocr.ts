export interface ParsedGoogleMapsOcrResult {
  distanceKm: number | null;
  durationMin: number | null;
  rawText: string;
}

/**
 * 將圖片裁切並放大、轉為高對比灰階畫布，大幅提升 Google Maps 截圖中「XX.X 公里」數字的 OCR 辨識率與速度
 */
const prepareCroppedCanvas = (
  img: HTMLImageElement,
  region: { xRatio: number; yRatio: number; wRatio: number; hRatio: number },
  scaleFactor = 2
): HTMLCanvasElement => {
  const sx = Math.floor(img.width * region.xRatio);
  const sy = Math.floor(img.height * region.yRatio);
  const sw = Math.max(1, Math.floor(img.width * region.wRatio));
  const sh = Math.max(1, Math.floor(img.height * region.hRatio));

  const maxOutW = 1400;
  const effectiveScale = sw * scaleFactor > maxOutW ? maxOutW / sw : scaleFactor;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * effectiveScale));
  canvas.height = Math.max(1, Math.round(sh * effectiveScale));

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  // 高對比灰階強化，壓低背景雜訊並凸顯黑字／深灰字與橘字
  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // 柔和對比拉升，保留小數點細節避免二值化吃掉「.」
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
      data[i] = contrasted;
      data[i + 1] = contrasted;
      data[i + 2] = contrasted;
    }
    ctx.putImageData(imageData, 0, 0);
  } catch {
    // 忽略 canvas pixel 存取例外
  }

  return canvas;
};

/**
 * 從 OCR 文字中解析 Google Maps 顯示之第一筆主要路線公里數與行車分鐘數
 */
const parseDistanceAndDuration = (text: string): { distanceKm: number | null; durationMin: number | null } => {
  // 正規化全形空白、逗號小數點誤認與常見繁簡字形
  const normalized = text
    .replace(/，/g, '.')
    .replace(/(\d)\s*,\s*(\d)/g, '$1.$2')
    .replace(/[。．·]/g, '.')
    .replace(/\s+/g, ' ');

  // 1. 優先匹配「XX.X 公里」或「XX.X km」（排除 0 或異常超大值）
  const kmRegex = /(\d{1,4}(?:\.\d{1,2})?)\s*(?:公\s*里|公\s*裡|km|KM|Km)/g;
  const kmMatches: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = kmRegex.exec(normalized)) !== null) {
    const val = Number(m[1]);
    if (Number.isFinite(val) && val > 0 && val <= 1500) {
      kmMatches.push(Math.round(val * 10) / 10);
    }
  }

  // 若沒匹配到公里，檢查是否為短程「XXX 公尺 / m」
  let distanceKm: number | null = kmMatches.length > 0 ? kmMatches[0] : null;
  if (distanceKm === null) {
    const meterMatch = normalized.match(/(\d{2,4})\s*(?:公\s*尺|m\b)/i);
    if (meterMatch) {
      const meters = Number(meterMatch[1]);
      if (Number.isFinite(meters) && meters >= 50 && meters <= 9999) {
        distanceKm = Math.round((meters / 1000) * 10) / 10;
      }
    }
  }

  // 2. 解析行車時間（「1 小時 7 分」或「40 分」）
  let durationMin: number | null = null;
  const hrMinMatch = normalized.match(/(\d{1,2})\s*小\s*時\s*(\d{1,2})\s*分/);
  if (hrMinMatch) {
    durationMin = Number(hrMinMatch[1]) * 60 + Number(hrMinMatch[2]);
  } else {
    const minMatch = normalized.match(/(\d{1,3})\s*分(?:鐘)?/);
    if (minMatch) {
      const mins = Number(minMatch[1]);
      if (mins > 0 && mins <= 1200) durationMin = mins;
    }
  }

  return { distanceKm, durationMin };
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('截圖載入失敗'));
    img.src = src;
  });

/**
 * 自動辨識 Google Maps 路線截圖中的公里數（例如「37.4 公里」）與行車時間（例如「1 小時 7 分」）
 * 採動態載入 tesseract.js，零外部 API Key、不影響首屏載入體積
 */
export const recognizeGoogleMapsScreenshotKm = async (
  imageDataUrl: string
): Promise<ParsedGoogleMapsOcrResult> => {
  const img = await loadImage(imageDataUrl);
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['chi_tra', 'eng']);

  try {
    const aspect = img.width / Math.max(1, img.height);
    const regionsToTry =
      aspect >= 1.15
        ? [
            // 寬螢幕完整 Google Maps 畫面：優先掃描左下路線詳情欄（白底黑字最清晰）
            { xRatio: 0, yRatio: 0.45, wRatio: 0.48, hRatio: 0.55 },
            // 備援：右側地圖上的藍紫色氣泡區（如「1小時7分鐘 37.4 公里」）
            { xRatio: 0.35, yRatio: 0.15, wRatio: 0.65, hRatio: 0.75 },
          ]
        : [
            // 直式或僅裁切左側欄之截圖：優先掃描下半段路線摘要，再掃全圖
            { xRatio: 0, yRatio: 0.45, wRatio: 1, hRatio: 0.55 },
            { xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 1 },
          ];

    let combinedText = '';
    for (const region of regionsToTry) {
      const canvas = prepareCroppedCanvas(img, region, 2);
      const { data } = await worker.recognize(canvas);
      const text = data?.text || '';
      combinedText += `\n${text}`;

      const parsed = parseDistanceAndDuration(text);
      if (parsed.distanceKm !== null) {
        return {
          distanceKm: parsed.distanceKm,
          durationMin: parsed.durationMin,
          rawText: text.trim(),
        };
      }
    }

    const fallbackParsed = parseDistanceAndDuration(combinedText);
    return {
      distanceKm: fallbackParsed.distanceKm,
      durationMin: fallbackParsed.durationMin,
      rawText: combinedText.trim(),
    };
  } finally {
    await worker.terminate();
  }
};
