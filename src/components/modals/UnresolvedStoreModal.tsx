import React from 'react';
import { AlertTriangle, CheckCircle2, ClipboardSignature, Search, X } from 'lucide-react';

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
  onResolveStore: (storeName: string) => Promise<void>;
  onJumpToStore?: (storeName: string, recordId: string) => void;
  isSubmittingResolve: boolean;
}

/**
 * 未結案門市追蹤與快速結案彈窗
 * 負責展示缺失原因、引導主管前往巡店複查或線上直接結案
 */
export const UnresolvedStoreModal: React.FC<Props> = ({
  storeInfo,
  onClose,
  onNavigateAudit,
  onResolveStore,
  onJumpToStore,
  isSubmittingResolve,
}) => {
  if (!storeInfo) return null;

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

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateAudit(storeInfo.store)}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 transition-colors cursor-pointer"
          >
            <ClipboardSignature size={17} />
            前往巡店複查 / 拍照存證
          </button>

          <button
            type="button"
            disabled={isSubmittingResolve}
            onClick={() => onResolveStore(storeInfo.store)}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20 transition-colors cursor-pointer"
          >
            <CheckCircle2 size={17} />
            {isSubmittingResolve ? '正在結案處理中...' : '確認現場已改善（直接結案）'}
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

