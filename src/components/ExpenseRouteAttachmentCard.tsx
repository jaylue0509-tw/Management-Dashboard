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
  RefreshCw,
  Map as MapIcon,
  Image as ImageIcon,
} from 'lucide-react';
import type { GeoPoint } from '../data/storeCoordinates';
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsEmbedUrl,
  captureScreenSnapshot,
  compressScreenshotFile,
  verifyRouteViaGoogleMapsApi,
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
 * 報核單極簡附件卡：直接內嵌連動真實 Google Maps，並支援一鍵同步官方距離與貼上截圖
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
  const [isDragging, setIsDragging] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSyncingApi, setIsSyncingApi] = useState(false);
  const [viewMode, setViewMode] = useState<'auto' | 'embed' | 'screenshot'>('auto');
  const [notice, setNotice] = useState<string>('');

  const googleUrl = useMemo(
    () => buildGoogleMapsDirectionsUrl(evidence.waypoints, vehicleType, evidence.stopLabels),
    [evidence.waypoints, vehicleType, evidence.stopLabels]
  );

  const googleEmbedUrl = useMemo(
    () => buildGoogleMapsEmbedUrl(evidence.waypoints, evidence.stopLabels),
    [evidence.waypoints, evidence.stopLabels]
  );

  const hasScreenshots = evidence.googleScreenshots.length > 0;
  const showScreenshot =
    hasScreenshots && (viewMode === 'screenshot' || viewMode === 'auto');

  const showTempNotice = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(''), 4500);
  };

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
      setViewMode('screenshot');
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

  const handleSyncGoogleMapsApi = async () => {
    const stops = evidence.stopLabels.map(s => s.trim()).filter(Boolean);
    if (stops.length < 2) {
      showTempNotice('此行程缺少起訖地點，請先於主表確認地址');
      return;
    }
    setIsSyncingApi(true);
    setNotice('');
    try {
      const res = await verifyRouteViaGoogleMapsApi(stops, vehicleType);
      if (!res.ok) {
        showTempNotice(
          res.missingKey
            ? '後端尚未設定 GOOGLE_MAPS_API_KEY，已可直接從下方即時 Google 地圖查看或按「Google Maps ↗」核對'
            : res.message
        );
        return;
      }

      const nextShots = res.data.staticMapDataUrl
        ? [res.data.staticMapDataUrl, ...evidence.googleScreenshots.filter(s => s !== res.data.staticMapDataUrl)]
        : evidence.googleScreenshots;

      onUpdateEvidence({
        actualKm: res.data.distanceKm,
        durationMin: res.data.durationMin,
        viaRoad: res.data.viaRoad,
        googleScreenshots: nextShots,
        verificationStatus: 'google_verified',
      });
      if (res.data.staticMapDataUrl) setViewMode('screenshot');
      showTempNotice(`已同步 Google Maps 官方距離：${res.data.distanceKm} 公里（約 ${res.data.durationMin} 分）`);
    } finally {
      setIsSyncingApi(false);
    }
  };

  const handleOneClickCapture = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCapturing(true);
    try {
      const dataUrl = await captureScreenSnapshot();
      if (dataUrl) {
        onUpdateEvidence({
          googleScreenshots: [...evidence.googleScreenshots, dataUrl],
          verificationStatus: 'google_verified',
        });
        setViewMode('screenshot');
      }
    } catch {
      // 使用者取消視窗選擇
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
      {/* 極簡標題與 Google Maps 連動工具列 */}
      <div className="bg-slate-50 border-b border-slate-200 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-xs font-extrabold shrink-0">
            附件 {index + 1}
          </span>
          <span className="text-xs sm:text-sm font-extrabold text-slate-900 shrink-0">
            {dateStr}
          </span>
          {routeSummaryText && (
            <span className="text-xs text-slate-500 truncate max-w-[300px]" title={routeSummaryText}>
              {routeSummaryText}
            </span>
          )}
          {hasScreenshots && <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 公里數與油資連動 */}
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
              title="實際公里數（修改即即時連動主報核單）"
            />
            <span className="text-[11px] font-bold text-slate-500">km</span>
            <span className="text-[11px] font-extrabold text-emerald-700 pl-1 border-l border-slate-200">
              ${fuelSubsidy.toLocaleString('zh-TW')}
            </span>
            <span className="text-[10px] text-slate-400">(@{ratePerKm})</span>
          </div>

          {/* 切換即時 Google 地圖 / 已貼截圖 */}
          {hasScreenshots && googleEmbedUrl && (
            <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('screenshot')}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer ${
                  showScreenshot ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                }`}
              >
                <ImageIcon size={11} />
                <span>截圖</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('embed')}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer ${
                  !showScreenshot ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600'
                }`}
              >
                <MapIcon size={11} />
                <span>即時地圖</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleSyncGoogleMapsApi}
            disabled={isSyncingApi}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 text-emerald-800 border border-emerald-200 text-xs font-bold cursor-pointer transition-colors"
            title="透過後端 Google Maps Directions API 自動抓取官方距離與路線圖"
          >
            {isSyncingApi ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            <span>自動抓距離</span>
          </button>

          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition-colors"
            title="於新分頁開啟完整 Google Maps 路線"
          >
            <ExternalLink size={12} />
            <span>Google Maps</span>
          </a>

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
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer transition-colors"
          >
            <Upload size={12} />
            <span>{hasScreenshots ? '加貼截圖' : '上傳截圖'}</span>
          </button>
        </div>
      </div>

      {/* 主體附件區：直接呈現真實 Google Maps 內嵌地圖，或顯示已貼上／API 抓回之截圖 */}
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
        className={`p-3 space-y-2 transition-colors ${isDragging ? 'bg-blue-50' : 'bg-white'}`}
      >
        {notice && (
          <div className="text-[11px] font-bold text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
            {notice}
          </div>
        )}

        {showScreenshot ? (
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
                  className="w-full max-h-[420px] object-contain cursor-zoom-in mx-auto"
                />
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1.5 rounded-lg bg-slate-900/70 hover:bg-slate-900 text-white shadow cursor-pointer"
                    title="加貼一張截圖"
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
        ) : googleEmbedUrl ? (
          /* 直接內嵌真實 Google Maps 路線視窗 */
          <div className="space-y-2">
            <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
              <iframe
                src={googleEmbedUrl}
                title={`Google Maps 路線_${dateStr}`}
                className="w-full h-[360px] border-0 block"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 px-0.5">
              <span>
                點選本卡片按 <kbd className="px-1 bg-slate-100 border border-slate-300 rounded text-slate-700 font-bold">Ctrl+V</kbd> 或拖曳圖片，即可將截圖存為列印／Word 附件原圖
              </span>
              <button
                type="button"
                onClick={handleOneClickCapture}
                disabled={isCapturing}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-bold cursor-pointer"
              >
                {isCapturing ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
                <span>{isCapturing ? '擷取中...' : '擷取此畫面為附件圖'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 hover:border-blue-400 py-8 px-4 text-center text-xs font-bold text-slate-500 cursor-pointer"
          >
            點擊上傳、拖曳圖片，或按 Ctrl+V 直接貼上 Google Maps 截圖
          </div>
        )}
      </div>
    </div>
  );
};
