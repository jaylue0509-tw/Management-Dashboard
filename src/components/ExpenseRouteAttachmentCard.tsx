import React, { useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  Upload,
  CheckCircle2,
  Trash2,
  Camera,
  ZoomIn,
  Loader2,
  Plus,
} from 'lucide-react';
import type { GeoPoint } from '../data/storeCoordinates';
import {
  buildGoogleMapsDirectionsUrl,
  captureScreenSnapshot,
  compressScreenshotFile,
} from '../utils/road-routing';

export type VerificationStatus = 'pending_screenshot' | 'google_verified';

export interface RouteEvidenceData {
  waypoints: GeoPoint[];
  stopLabels: string[];
  durationMin: number;
  viaRoad: string;
  verificationStatus: VerificationStatus;
  googleScreenshots: string[];
}

interface ExpenseRouteAttachmentCardProps {
  index: number;
  dateStr: string;
  applicantName: string;
  routeSummaryText: string;
  vehicleType: 'car' | 'motorcycle';
  ratePerKm: number;
  actualKm: number;
  fuelSubsidy: number;
  evidence: RouteEvidenceData;
  onPreviewImage?: (dataUrl: string) => void;
  onUpdateEvidence: (patch: {
    actualKm?: number;
    durationMin?: number;
    viaRoad?: string;
    stopLabels?: string[];
    verificationStatus?: VerificationStatus;
    googleScreenshots?: string[];
  }) => void;
}

/**
 * 報核單極簡附件卡：
 * 一鍵開啟真實 Google Maps 完整路線視窗（含左側路線時間公里＋右側地圖）並一鍵截圖存為正式附件
 */
export const ExpenseRouteAttachmentCard: React.FC<ExpenseRouteAttachmentCardProps> = ({
  index,
  dateStr,
  routeSummaryText,
  vehicleType,
  ratePerKm,
  actualKm,
  fuelSubsidy,
  evidence,
  onPreviewImage,
  onUpdateEvidence,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const popupRef = useRef<Window | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasOpenedMap, setHasOpenedMap] = useState(false);

  const googleUrl = useMemo(
    () => buildGoogleMapsDirectionsUrl(evidence.waypoints, vehicleType, evidence.stopLabels),
    [evidence.waypoints, vehicleType, evidence.stopLabels]
  );

  const hasScreenshots = evidence.googleScreenshots.length > 0;

  const handleFiles = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    try {
      const nextList = [...evidence.googleScreenshots];
      for (const file of imageFiles) {
        const dataUrl = await compressScreenshotFile(file);
        nextList.push(dataUrl);
      }
      onUpdateEvidence({
        googleScreenshots: nextList,
        verificationStatus: 'google_verified',
      });
    } catch {
      // 忽略無效圖檔
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const f = items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await handleFiles(files);
    }
  };

  /**
   * 以最佳比例 (1360×820) 開啟完整 Google Maps 路線視窗（左側起訖時間公里面板＋右側地圖）
   */
  const handleOpenGoogleMapsPopup = () => {
    const win = window.open(
      googleUrl,
      `gmap_verify_${dateStr}`,
      'width=1360,height=820,left=60,top=40,noopener=no'
    );
    popupRef.current = win;
    setHasOpenedMap(true);
  };

  /**
   * 一鍵截圖 Google Maps 視窗／分頁並自動存入本筆附件（完成後自動關閉剛開啟之視窗）
   */
  const handleOneClickCapture = async () => {
    setIsCapturing(true);
    try {
      const dataUrl = await captureScreenSnapshot();
      if (dataUrl) {
        onUpdateEvidence({
          googleScreenshots: [...evidence.googleScreenshots, dataUrl],
          verificationStatus: 'google_verified',
        });
        setHasOpenedMap(false);
        if (popupRef.current && !popupRef.current.closed) {
          try {
            popupRef.current.close();
          } catch {
            // 跨網域視窗若無法自動關閉則忽略
          }
        }
      }
    } catch {
      // 使用者取消視窗選擇時靜默返回
    } finally {
      setIsCapturing(false);
    }
  };

  const handleRemoveScreenshot = (imgIdx: number) => {
    const next = evidence.googleScreenshots.filter((_, idx) => idx !== imgIdx);
    onUpdateEvidence({
      googleScreenshots: next,
      verificationStatus: next.length > 0 ? 'google_verified' : 'pending_screenshot',
    });
  };

  return (
    <div
      onPaste={handlePaste}
      tabIndex={0}
      className={`bg-white rounded-xl border outline-none shadow-2xs overflow-hidden transition-colors ${
        hasScreenshots
          ? 'border-emerald-300 focus:border-emerald-500'
          : 'border-slate-200 hover:border-blue-300 focus:border-blue-500'
      }`}
    >
      {/* 極簡單行標題與連動公里數列 */}
      <div className="bg-slate-50 border-b border-slate-200 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-xs font-extrabold shrink-0">
            附件 {index + 1}
          </span>
          <span className="text-xs sm:text-sm font-extrabold text-slate-900 shrink-0">
            {dateStr}
          </span>
          {routeSummaryText && (
            <span className="text-xs text-slate-500 truncate max-w-[360px]" title={routeSummaryText}>
              {routeSummaryText}
            </span>
          )}
          {hasScreenshots && <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 實際公里數輸入（即時連動報核單主表油資與大寫金額） */}
          <div className="inline-flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-0.5">
            <input
              type="number"
              step="0.1"
              min="0"
              value={actualKm}
              onChange={e =>
                onUpdateEvidence({
                  actualKm: Math.max(0, Number(e.target.value) || 0),
                })
              }
              className="w-14 text-right text-xs font-extrabold text-blue-700 outline-none tabular-nums"
              title="依 Google Maps 截圖輸入公里數（立即連動主報核單）"
            />
            <span className="text-[11px] font-bold text-slate-500">km</span>
            <span className="text-[11px] font-extrabold text-emerald-700 pl-1 border-l border-slate-200">
              ${fuelSubsidy.toLocaleString('zh-TW')}
            </span>
            <span className="text-[10px] text-slate-400">(@{ratePerKm})</span>
          </div>

          <button
            type="button"
            onClick={handleOpenGoogleMapsPopup}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold cursor-pointer transition-colors"
            title="開啟完整 Google Maps 路線視窗（含左側路線時間公里＋右側地圖）"
          >
            <ExternalLink size={12} />
            <span>開啟 Google Maps</span>
          </button>

          <button
            type="button"
            onClick={handleOneClickCapture}
            disabled={isCapturing}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-white text-xs font-extrabold cursor-pointer transition-all ${
              hasOpenedMap
                ? 'bg-indigo-600 hover:bg-indigo-700 ring-2 ring-indigo-300'
                : 'bg-slate-900 hover:bg-slate-800'
            }`}
            title="點選剛開啟的 Google Maps 視窗／分頁，一鍵截圖存成附件"
          >
            {isCapturing ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
            <span>{isCapturing ? '截圖中...' : '一鍵截圖'}</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => {
              if (e.target.files) handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold cursor-pointer"
            title="上傳圖片檔"
          >
            <Upload size={12} />
          </button>
        </div>
      </div>

      {/* 純粹附件截圖展示／擷取區 */}
      <div
        onDragOver={e => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        }}
        className={`p-3 transition-colors ${isDragging ? 'bg-blue-50' : 'bg-white'}`}
      >
        {hasScreenshots ? (
          <div
            className={`grid gap-3 ${
              evidence.googleScreenshots.length > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {evidence.googleScreenshots.map((dataUrl, imgIdx) => (
              <div
                key={`gm-shot-${imgIdx}`}
                className="relative rounded-lg overflow-hidden border border-slate-200 bg-slate-50"
              >
                <img
                  src={dataUrl}
                  alt={`附件_${index + 1}_${dateStr}_${imgIdx + 1}`}
                  onClick={() => onPreviewImage?.(dataUrl)}
                  className="w-full max-h-[440px] object-contain cursor-zoom-in mx-auto"
                />
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleOneClickCapture}
                    className="p-1.5 rounded-lg bg-indigo-600/85 hover:bg-indigo-700 text-white shadow cursor-pointer"
                    title="再一鍵截圖一張"
                  >
                    <Plus size={13} />
                  </button>
                  {onPreviewImage && (
                    <button
                      type="button"
                      onClick={() => onPreviewImage(dataUrl)}
                      className="p-1.5 rounded-lg bg-slate-900/70 hover:bg-slate-900 text-white shadow cursor-pointer"
                      title="放大檢視"
                    >
                      <ZoomIn size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveScreenshot(imgIdx)}
                    className="p-1.5 rounded-lg bg-rose-600/85 hover:bg-rose-700 text-white shadow cursor-pointer"
                    title="刪除截圖"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 py-7 px-4 flex flex-col items-center justify-center gap-3 text-center">
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={handleOpenGoogleMapsPopup}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-xs cursor-pointer transition-colors"
              >
                <ExternalLink size={14} />
                <span>① 開啟 Google Maps 路線視窗</span>
              </button>

              <button
                type="button"
                onClick={handleOneClickCapture}
                disabled={isCapturing}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-extrabold shadow-xs cursor-pointer transition-all ${
                  hasOpenedMap
                    ? 'bg-emerald-600 hover:bg-emerald-700 ring-4 ring-emerald-200'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {isCapturing ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                <span>{isCapturing ? '擷取中...' : '② 一鍵截圖 Google Maps 放進附件'}</span>
              </button>
            </div>

            <div className="text-[11px] text-slate-500">
              待 Google Maps 顯示路線公里數後按「<strong>② 一鍵截圖</strong>」選擇該視窗即可自動存為附件；或直接按{' '}
              <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded text-slate-700 font-bold">Ctrl+V</kbd>{' '}
              貼上／拖曳圖片至此
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
