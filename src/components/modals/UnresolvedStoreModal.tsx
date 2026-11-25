import React, { useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, ClipboardSignature, Search, Trash2, X } from 'lucide-react';

export interface ResolvingStoreInfo {
  store: string;
  reasons: string[];
  reportTime?: string;
  recordId?: string;
  region?: string;
  areaManagerName?: string;
}

interface Props {
  storeInfo: ResolvingStoreInfo | null;
  onClose: () => void;
  onNavigateAudit: (storeName: string) => void;
  onResolveStore: (storeName: string, afterPhotos?: string[]) => Promise<void>;
  onJumpToStore?: (storeName: string, recordId: string) => void;
  isSubmittingResolve: boolean;
}

const compressModalPhoto = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1280;
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          if (width >= height) {
            height = Math.round((height * maxSide) / width);
            width = maxSide;
          } else {
            width = Math.round((width * maxSide) / height);
            height = maxSide;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = () => reject(new Error('圖片載入失敗'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('檔案讀取失敗'));
    reader.readAsDataURL(file);
  });

/**
 * 未結案門市追蹤與快速結案彈窗
 * 支援直接在此補傳「改善後照片」並一鍵結案（免重跑勾選檢查單），或前往完整巡店複查
 */
export const UnresolvedStoreModal: React.FC<Props> = ({
  storeInfo,
  onClose,
  onNavigateAudit,
  onResolveStore,
  onJumpToStore,
  isSubmittingResolve,
}) => {
  const [afterPhotos, setAfterPhotos] = useState<string[]>([]);

  if (!storeInfo) return null;

  const handleSelectFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = 3 - afterPhotos.length;
    if (remaining <= 0) return;
    const picked = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remaining);
    const compressedList: string[] = [];
    for (const f of picked) {
      try {
        compressedList.push(await compressModalPhoto(f));
      } catch {
        // 忽略損壞圖片
      }
    }
    if (compressedList.length > 0) {
      setAfterPhotos(prev => [...prev, ...compressedList]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 cursor-pointer"
          aria-label="關閉視窗"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-gray-900">{storeInfo.store}</h3>
              {storeInfo.region && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                  {storeInfo.region}
                </span>
              )}
              {storeInfo.areaManagerName && (
                <span className="text-xs font-semibold text-gray-500">
                  (主管：{storeInfo.areaManagerName})
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              未結案缺失追蹤 {storeInfo.reportTime ? `· 回報時間：${storeInfo.reportTime}` : ''}
            </p>
          </div>
        </div>

        <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3.5 mb-5 max-h-48 overflow-y-auto">
          <div className="text-xs font-bold text-rose-800 mb-2">待改善 / 異常原因：</div>
          <ul className="space-y-1.5">
            {storeInfo.reasons.map((r, i) => (
              <li key={i} className="text-sm text-rose-900 font-medium flex items-start gap-2">
                <span className="text-rose-500 mt-0.5">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 免重跑檢查單：直接補傳改善後照片並結案 */}
        {storeInfo.recordId && (
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 mb-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-extrabold text-emerald-900 flex items-center gap-1.5">
                <Camera size={14} className="text-emerald-600" />
                補傳改善後照片（選填，免重填檢查單）
              </span>
              <span className="text-[11px] font-bold text-emerald-700">{afterPhotos.length} / 3</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {afterPhotos.map((url, idx) => (
                <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden border border-emerald-300 bg-white">
                  <img src={url} alt="改善後預覽" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setAfterPhotos(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute top-0.5 right-0.5 p-1 rounded-full bg-black/70 text-white hover:bg-rose-600 cursor-pointer"
                    title="移除照片"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
              {afterPhotos.length < 3 && (
                <label className="h-16 px-3 rounded-lg border-2 border-dashed border-emerald-400 bg-white hover:bg-emerald-50 flex flex-col items-center justify-center gap-0.5 text-emerald-700 cursor-pointer transition-colors">
                  <Camera size={16} />
                  <span className="text-[11px] font-extrabold">點擊補拍／上傳</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onClick={e => {
                      (e.target as HTMLInputElement).value = '';
                    }}
                    onChange={e => handleSelectFiles(e.target.files)}
                  />
                </label>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            disabled={isSubmittingResolve}
            onClick={() => onResolveStore(storeInfo.store, afterPhotos)}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20 transition-colors cursor-pointer"
          >
            <CheckCircle2 size={17} />
            {isSubmittingResolve
              ? '正在上傳與結案處理中...'
              : afterPhotos.length > 0
              ? `上傳 ${afterPhotos.length} 張改善照並直接結案`
              : '確認現場已改善（直接結案，免填檢查單）'}
          </button>

          <button
            type="button"
            onClick={() => onNavigateAudit(storeInfo.store)}
            className="w-full py-2.5 px-4 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <ClipboardSignature size={15} />
            開啟完整巡店檢查單（執行新一輪巡檢）
          </button>

          {storeInfo.recordId && onJumpToStore && (
            <button
              type="button"
              onClick={() => {
                const targetStore = storeInfo.store;
                const targetId = storeInfo.recordId!;
                onClose();
                onJumpToStore(targetStore, targetId);
              }}
              className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Search size={14} />
              定位查看下方原始巡店紀錄
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

