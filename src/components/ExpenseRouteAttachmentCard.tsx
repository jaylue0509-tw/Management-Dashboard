import React, { useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  Upload,
  CheckCircle2,
  MapPin,
  Trash2,
  ClipboardPaste,
  Camera,
  Plus,
  X,
  AlertCircle,
  ZoomIn,
  Loader2,
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
  /** 可直接編修之 Google Maps 站點名稱／地址清單（開啟 Google Maps 時直接帶入這些可讀地址） */
  stopLabels: string[];
  durationMin: number;
  viaRoad: string;
  verificationStatus: VerificationStatus;
  /** 真實 Google Maps 官方截圖清單（支援單日附 1 至多張截圖，例如去程＋回程或總覽＋明細） */
  googleScreenshots: string[];
}

interface ExpenseRouteAttachmentCardProps {
  index: number;
  dateStr: string;
  applicantName: string;
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
 * 國內出差旅費報核單附件：真實 Google Maps 官方截圖佐證卡
 * 設計目標：直接呈現使用者從 Google Maps 取得的真實官方截圖（支援一鍵開啟 Google Maps、一鍵視窗截圖、Ctrl+V 貼上與拖曳上傳），
 * 並將核對後的 Google Maps 實際公里數即時連動回主報核單金額計算。
 */
export const ExpenseRouteAttachmentCard: React.FC<ExpenseRouteAttachmentCardProps> = ({
  index,
  dateStr,
  applicantName,
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
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const googleUrl = useMemo(
    () => buildGoogleMapsDirectionsUrl(evidence.waypoints, vehicleType, evidence.stopLabels),
    [evidence.waypoints, vehicleType, evidence.stopLabels]
  );

  const hasScreenshots = evidence.googleScreenshots.length > 0;

  const showTempMessage = (type: 'ok' | 'err', text: string) => {
    setStatusMessage({ type, text });
    window.setTimeout(() => setStatusMessage(null), 3800);
  };

  const appendScreenshotDataUrl = (dataUrl: string) => {
    const nextList = [...evidence.googleScreenshots, dataUrl];
    onUpdateEvidence({
      googleScreenshots: nextList,
      verificationStatus: 'google_verified',
    });
    showTempMessage('ok', '已成功附加真實 Google Maps 截圖！列印與匯出 Word 將直接呈現此原圖。');
  };

  const handleFiles = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      showTempMessage('err', '請選擇圖片檔案（PNG / JPG / WebP）');
      return;
    }
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
      showTempMessage('ok', `已附加 ${imageFiles.length} 張真實 Google Maps 截圖！`);
    } catch {
      showTempMessage('err', '截圖讀取失敗，請重新嘗試');
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

  const handleOneClickCapture = async () => {
    setIsCapturing(true);
    try {
      const dataUrl = await captureScreenSnapshot();
      if (dataUrl) {
        appendScreenshotDataUrl(dataUrl);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.toLowerCase().includes('cancel') && !msg.toLowerCase().includes('permission')) {
        showTempMessage('err', msg || '擷取已取消，您也可以直接截圖後按 Ctrl+V 貼上');
      }
    } finally {
      setIsCapturing(false);
    }
  };

  const handleUpdateStopLabel = (stopIdx: number, value: string) => {
    const next = [...evidence.stopLabels];
    next[stopIdx] = value;
    onUpdateEvidence({ stopLabels: next });
  };

  const handleAddStop = () => {
    onUpdateEvidence({ stopLabels: [...evidence.stopLabels, ''] });
  };

  const handleRemoveStop = (stopIdx: number) => {
    onUpdateEvidence({
      stopLabels: evidence.stopLabels.filter((_, idx) => idx !== stopIdx),
    });
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
      className={`bg-white rounded-2xl border-2 outline-none shadow-sm overflow-hidden transition-all ${
        hasScreenshots
          ? 'border-emerald-300 focus:border-emerald-500'
          : 'border-slate-200 hover:border-blue-300 focus:border-blue-500'
      }`}
    >
      {/* 卡片標頭：附件編號、日期、截圖驗證狀態與連動計價 */}
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2.5 py-0.5 rounded-md bg-slate-900 text-white text-xs font-extrabold">
            附件 {index + 1}
          </span>
          <span className="text-sm font-extrabold text-slate-900">
            {dateStr}（{applicantName}）
          </span>
          {hasScreenshots ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
              <CheckCircle2 size={12} />
              已附真實 Google Maps 截圖（{evidence.googleScreenshots.length} 張）
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
              <AlertCircle size={12} />
              尚未附上真實 Google Maps 截圖
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 text-xs font-bold flex-wrap">
          <span className="text-slate-600">
            計價公里：<strong className="text-blue-700 text-sm">{actualKm.toFixed(1)} 公里</strong>
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
            油資補助 NT$ {fuelSubsidy.toLocaleString('zh-TW')}（@{ratePerKm}元）
          </span>
        </div>
      </div>

      {/* 主體雙欄：左側「步驟設定與核對輸入」＋ 右側「真實 Google Maps 官方截圖展示區」 */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* 左側：起訖地址微調 + 三步驟開啟與擷取真實 Google Maps */}
        <div className="lg:col-span-5 p-4 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col justify-between gap-3.5 bg-white">
          <div className="space-y-3">
            {/* 步驟 1：確認起訖地址並開啟真實 Google Maps */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-slate-800">
                  ① 確認起訖地點（可直接改為實際出差地址）
                </span>
                <button
                  type="button"
                  onClick={handleAddStop}
                  className="inline-flex items-center gap-0.5 text-[11px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                >
                  <Plus size={12} />
                  <span>新增停靠點</span>
                </button>
              </div>

              <div className="space-y-1.5">
                {evidence.stopLabels.map((label, sIdx) => {
                  const isFirst = sIdx === 0;
                  const isLast = sIdx === evidence.stopLabels.length - 1 && evidence.stopLabels.length > 1;
                  return (
                    <div key={`stop-${sIdx}`} className="flex items-center gap-1.5">
                      <span className="w-5 flex justify-center shrink-0">
                        {isLast ? (
                          <MapPin size={14} className="text-rose-600" />
                        ) : (
                          <span
                            className={`w-4 h-4 rounded-full text-[9px] font-extrabold flex items-center justify-center ${
                              isFirst
                                ? 'bg-slate-900 text-white'
                                : 'bg-blue-600 text-white'
                            }`}
                          >
                            {isFirst ? '起' : sIdx}
                          </span>
                        )}
                      </span>
                      <input
                        type="text"
                        value={label}
                        onChange={e => handleUpdateStopLabel(sIdx, e.target.value)}
                        placeholder={isFirst ? '輸入出發地址（如：新北市板橋區...）' : '輸入目的地地址或門市名（如：臺北流行音樂中心）'}
                        className="flex-1 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-lg px-2.5 py-1.5 outline-none"
                      />
                      {evidence.stopLabels.length > 2 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveStop(sIdx)}
                          className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                          title="移除此站點"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <a
                href={googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold transition-colors shadow-xs"
              >
                <ExternalLink size={14} />
                <span>步驟 1：開啟真實 Google Maps 路線頁面</span>
              </a>
            </div>

            {/* 步驟 2：擷取或貼上真實 Google Maps 截圖 */}
            <div className="pt-2.5 border-t border-slate-100 space-y-2">
              <div className="text-xs font-extrabold text-slate-800">
                ② 放入真實 Google Maps 距離截圖（3 種方式任選）
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleOneClickCapture}
                  disabled={isCapturing}
                  className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer transition-colors shadow-xs"
                  title="選擇剛剛打開的 Google Maps 分頁，一鍵直接拍下真實截圖放進附件"
                >
                  {isCapturing ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  <span>{isCapturing ? '擷取中...' : '一鍵擷取視窗'}</span>
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
                  className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer transition-colors shadow-xs"
                >
                  <Upload size={14} />
                  <span>上傳截圖檔案</span>
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                <ClipboardPaste size={13} className="text-blue-600 shrink-0" />
                <span>
                  或用 <kbd className="px-1 bg-white border border-slate-300 rounded text-slate-700 font-bold">Win+Shift+S</kbd> 截圖 Google Maps 後，點此卡片按 <kbd className="px-1 bg-white border border-slate-300 rounded text-slate-700 font-bold">Ctrl+V</kbd> 秒貼！
                </span>
              </div>
            </div>

            {/* 步驟 3：填入 Google Maps 顯示之官方公里數（即時連動主表費用） */}
            <div className="pt-2.5 border-t border-slate-100 space-y-2">
              <div className="text-xs font-extrabold text-slate-800">
                ③ 依 Google Maps 截圖填入核定公里數（即時連動主表）
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5 bg-blue-50/70 border border-blue-200 rounded-xl px-2.5 py-1.5">
                  <span className="text-[10px] font-extrabold text-blue-800">Google Maps 實際公里數</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={actualKm}
                      onChange={e =>
                        onUpdateEvidence({
                          actualKm: Math.max(0, Number(e.target.value) || 0),
                          verificationStatus: hasScreenshots ? 'google_verified' : evidence.verificationStatus,
                        })
                      }
                      className="w-full text-base font-black text-blue-700 bg-white border border-blue-300 rounded-lg px-2 py-0.5 outline-none tabular-nums"
                    />
                    <span className="text-xs font-bold text-slate-600 shrink-0">公里</span>
                  </div>
                </label>

                <label className="flex flex-col gap-0.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
                  <span className="text-[10px] font-extrabold text-slate-600">Google Maps 行車時間</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      value={evidence.durationMin || ''}
                      placeholder="39"
                      onChange={e =>
                        onUpdateEvidence({
                          durationMin: Math.max(0, Math.round(Number(e.target.value) || 0)),
                        })
                      }
                      className="w-full text-base font-black text-slate-800 bg-white border border-slate-300 rounded-lg px-2 py-0.5 outline-none tabular-nums"
                    />
                    <span className="text-xs font-bold text-slate-600 shrink-0">分鐘</span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {statusMessage && (
            <div
              className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${
                statusMessage.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-700'
              }`}
            >
              {statusMessage.type === 'ok' ? '✅ ' : '⚠️ '}
              {statusMessage.text}
            </div>
          )}
        </div>

        {/* 右側：真實 Google Maps 官方截圖展示／拖曳上傳主畫面（列印附件將直接輸出此真實截圖） */}
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
          className={`lg:col-span-7 p-4 flex flex-col justify-between gap-3 transition-colors ${
            isDragging ? 'bg-blue-50/90' : 'bg-slate-100/70'
          }`}
        >
          {hasScreenshots ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  真實 Google Maps 距離佐證截圖（列印 PDF／Word 將原圖輸出此附件）
                </span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  ＋ 再加貼一張截圖
                </button>
              </div>

              <div
                className={`grid gap-3 ${
                  evidence.googleScreenshots.length > 1 ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'
                }`}
              >
                {evidence.googleScreenshots.map((dataUrl, imgIdx) => (
                  <div
                    key={`gm-shot-${imgIdx}`}
                    className="relative group rounded-xl overflow-hidden border-2 border-emerald-200 bg-white shadow-sm"
                  >
                    <img
                      src={dataUrl}
                      alt={`Google Maps 真實截圖_${dateStr}_${imgIdx + 1}`}
                      onClick={() => onPreviewImage?.(dataUrl)}
                      className="w-full max-h-[380px] object-contain bg-slate-50 cursor-zoom-in"
                    />
                    <div className="absolute top-2 right-2 flex items-center gap-1.5">
                      {onPreviewImage && (
                        <button
                          type="button"
                          onClick={() => onPreviewImage(dataUrl)}
                          className="p-1.5 rounded-lg bg-slate-900/75 hover:bg-slate-900 text-white shadow cursor-pointer"
                          title="放大檢視原圖"
                        >
                          <ZoomIn size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveScreenshot(imgIdx)}
                        className="p-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-700 text-white shadow cursor-pointer"
                        title="刪除此截圖"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="px-3 py-1.5 bg-emerald-50 border-t border-emerald-100 flex items-center justify-between text-[11px] font-bold text-emerald-900">
                      <span>真實 Google Maps 官方截圖 #{imgIdx + 1}</span>
                      <span>
                        {actualKm.toFixed(1)} 公里
                        {evidence.durationMin > 0 ? ` · ${evidence.durationMin} 分` : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`flex-1 min-h-[300px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center p-6 cursor-pointer transition-all ${
                isDragging
                  ? 'border-blue-500 bg-blue-50 text-blue-800'
                  : 'border-slate-300 bg-white/90 hover:border-blue-400 hover:bg-blue-50/30 text-slate-600'
              }`}
            >
              <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center mb-3">
                <Camera size={28} />
              </div>
              <div className="text-sm font-extrabold text-slate-800">
                請附上【真實 Google Maps 路線距離截圖】
              </div>
              <p className="text-xs text-slate-500 mt-1.5 max-w-md leading-relaxed">
                為符合會計核銷正式要求，本附件區僅呈現金流核對用之<strong>真實 Google Maps 官方截圖</strong>（不再以網頁模擬地圖替代）。
                <br />
                請先點左側「<strong>開啟真實 Google Maps 路線頁面</strong>」，再用「<strong>一鍵擷取視窗</strong>」或截圖後直接於此處按 <strong>Ctrl+V 貼上</strong>／拖曳圖檔！
              </p>
              <div className="mt-4 flex items-center gap-2 flex-wrap justify-center">
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    handleOneClickCapture();
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold cursor-pointer shadow-xs"
                >
                  <Camera size={14} />
                  <span>一鍵擷取 Google Maps 分頁</span>
                </button>
                <span className="text-xs text-slate-400 font-bold">或</span>
                <span className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold">
                  <Upload size={13} />
                  <span>點擊上傳 / 拖曳圖片 / Ctrl+V 貼上</span>
                </span>
              </div>
            </div>
          )}

          {/* 底部：Google Maps 核驗連結供會計點選複查 */}
          <div className="bg-white rounded-lg border border-slate-200 px-3 py-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-500">
            <span className="truncate font-mono" title={googleUrl}>
              Google Maps 路線核驗連結：{googleUrl}
            </span>
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-bold shrink-0"
            >
              開啟 Google Maps ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
