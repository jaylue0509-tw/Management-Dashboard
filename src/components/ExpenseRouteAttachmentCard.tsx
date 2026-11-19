import React, { useMemo, useRef, useState } from 'react';
import {
  Car,
  Bike,
  ExternalLink,
  RefreshCw,
  Upload,
  CheckCircle2,
  MapPin,
  Trash2,
  ClipboardPaste,
  Image as ImageIcon,
  Map as MapIcon,
  Loader2,
} from 'lucide-react';
import type { GeoPoint } from '../data/storeCoordinates';
import {
  buildGoogleMapsDirectionsUrl,
  computeStaticMapLayout,
} from '../utils/road-routing';

export type VerificationStatus = 'estimated' | 'osrm' | 'google_verified';

export interface RouteEvidenceData {
  waypoints: GeoPoint[];
  geometry: [number, number][];
  durationMin: number;
  viaRoad: string;
  verificationStatus: VerificationStatus;
  googleScreenshotDataUrl?: string;
  googleMapsUrl: string;
}

interface ExpenseRouteAttachmentCardProps {
  index: number;
  dateStr: string;
  applicantName: string;
  vehicleType: 'car' | 'motorcycle';
  ratePerKm: number;
  actualKm: number;
  fuelSubsidy: number;
  routeSummaryText: string;
  evidence: RouteEvidenceData;
  isFetchingRoad: boolean;
  onFetchRealRoad: () => void;
  onUpdateKmAndMeta: (patch: {
    actualKm?: number;
    durationMin?: number;
    viaRoad?: string;
    verificationStatus?: VerificationStatus;
    googleScreenshotDataUrl?: string;
  }) => void;
}

const MAP_WIDTH = 520;
const MAP_HEIGHT = 310;

/**
 * 國內出差旅費報核單附件：單日路線與 Google Maps 距離驗證佐證卡
 * 版面參照 Google Maps 左右雙欄樣式（左側起訖站點、時間、公里數與核對區；右側真實道路地圖或官方截圖）
 */
export const ExpenseRouteAttachmentCard: React.FC<ExpenseRouteAttachmentCardProps> = ({
  index,
  dateStr,
  applicantName,
  vehicleType,
  ratePerKm,
  actualKm,
  fuelSubsidy,
  routeSummaryText,
  evidence,
  isFetchingRoad,
  onFetchRealRoad,
  onUpdateKmAndMeta,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [preferScreenshotView, setPreferScreenshotView] = useState<boolean>(true);
  const [pasteNotice, setPasteNotice] = useState<string>('');

  const googleUrl = useMemo(
    () => evidence.googleMapsUrl || buildGoogleMapsDirectionsUrl(evidence.waypoints, vehicleType),
    [evidence.googleMapsUrl, evidence.waypoints, vehicleType]
  );

  const mapLayout = useMemo(
    () => computeStaticMapLayout(evidence.waypoints, evidence.geometry, MAP_WIDTH, MAP_HEIGHT),
    [evidence.waypoints, evidence.geometry]
  );

  // 將上傳或貼上的 Google Maps 截圖壓縮轉存為 Data URL（確保列印與 Word 匯出清晰且不膨脹）
  const processScreenshotFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const maxW = 1280;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.85);
        onUpdateKmAndMeta({
          googleScreenshotDataUrl: compressed,
          verificationStatus: 'google_verified',
        });
        setPreferScreenshotView(true);
        setPasteNotice('已成功附加 Google Maps 距離佐證截圖！');
        setTimeout(() => setPasteNotice(''), 3000);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handlePasteScreenshot = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          processScreenshotFile(file);
          return;
        }
      }
    }
  };

  const statusBadge =
    evidence.verificationStatus === 'google_verified'
      ? { label: 'Google Maps 已核驗', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
      : evidence.verificationStatus === 'osrm'
      ? { label: '真實道路路網已驗證', cls: 'bg-blue-100 text-blue-800 border-blue-300' }
      : { label: '系統推估（建議點右側驗證）', cls: 'bg-amber-100 text-amber-800 border-amber-300' };

  const showingScreenshot = Boolean(evidence.googleScreenshotDataUrl && preferScreenshotView);

  return (
    <div
      onPaste={handlePasteScreenshot}
      tabIndex={0}
      className="bg-white rounded-2xl border-2 border-slate-200 hover:border-blue-300 focus:border-blue-500 outline-none shadow-sm overflow-hidden transition-colors"
    >
      {/* 卡片標頭：附件編號、出差日期、里程、油資與驗證徽章 */}
      <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2.5 py-0.5 rounded-md bg-slate-900 text-white text-xs font-extrabold">
            附件 {index + 1}
          </span>
          <span className="text-sm font-extrabold text-slate-900">
            {dateStr}（{applicantName}）
          </span>
          <span className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border inline-flex items-center gap-1 ${statusBadge.cls}`}>
            <CheckCircle2 size={12} />
            {statusBadge.label}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs font-bold">
          <span className="text-slate-600">
            計價公里：<strong className="text-blue-700 text-sm">{actualKm.toFixed(1)} 公里</strong>
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
            油資補助 NT$ {fuelSubsidy.toLocaleString('zh-TW')}（@{ratePerKm}元）
          </span>
        </div>
      </div>

      {/* 主內容：仿 Google Maps 左右雙欄驗證版面 */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* 左側面板：交通方式、起訖站點列表、路線摘要與 Google Maps 核驗工具 */}
        <div className="lg:col-span-5 p-4 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col justify-between gap-3 bg-white">
          <div className="space-y-3">
            {/* 交通方式頂部列（呼應 Google Maps 頂部切換列） */}
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold ${
                    vehicleType === 'car'
                      ? 'bg-sky-100 text-sky-900 border border-sky-200'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  <Car size={14} />
                  <span>{vehicleType === 'car' ? `${evidence.durationMin} 分` : '汽車'}</span>
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold ${
                    vehicleType === 'motorcycle'
                      ? 'bg-sky-100 text-sky-900 border border-sky-200'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  <Bike size={14} />
                  <span>{vehicleType === 'motorcycle' ? `${evidence.durationMin} 分` : '機車'}</span>
                </span>
              </div>

              <button
                type="button"
                onClick={onFetchRealRoad}
                disabled={isFetchingRoad || evidence.waypoints.length < 2}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-700 border border-blue-200 text-[11px] font-bold cursor-pointer transition-colors"
                title="從開源道路路網重新抓取貼合街道的真實導航距離與路線"
              >
                {isFetchingRoad ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                <span>{isFetchingRoad ? '抓取路網中...' : '抓取真實路網'}</span>
              </button>
            </div>

            {/* 起訖站點清單（仿 Google Maps 圓圈虛線＋終點紅標） */}
            <div className="space-y-1.5">
              {evidence.waypoints.length > 0 ? (
                evidence.waypoints.map((wp, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === evidence.waypoints.length - 1 && evidence.waypoints.length > 1;
                  return (
                    <div key={`wp-${idx}`} className="flex items-center gap-2.5">
                      <div className="w-5 flex flex-col items-center shrink-0">
                        {isLast ? (
                          <MapPin size={15} className="text-rose-600 fill-rose-100" />
                        ) : (
                          <span
                            className={`w-3.5 h-3.5 rounded-full border-2 ${
                              isFirst
                                ? 'bg-white border-slate-800'
                                : 'bg-blue-600 border-blue-600 text-white text-[8px] flex items-center justify-center font-bold'
                            }`}
                          >
                            {!isFirst && idx}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 truncate" title={wp.label}>
                        {wp.label}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  {routeSummaryText || '手動新增之出差行程（無內建座標，可直接貼上 Google Maps 截圖與輸入公里數）'}
                </div>
              )}
            </div>

            {/* Google Maps 風格路線結論列（途經道路 · XX 分 · XX.X 公里） */}
            <div className="rounded-xl border-l-4 border-l-blue-600 border border-slate-200 bg-slate-50/80 px-3 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
                  {vehicleType === 'motorcycle' ? <Bike size={14} className="text-slate-700 shrink-0" /> : <Car size={14} className="text-slate-700 shrink-0" />}
                  <input
                    type="text"
                    value={evidence.viaRoad}
                    onChange={e => onUpdateKmAndMeta({ viaRoad: e.target.value })}
                    placeholder="途經主要道路（例：途經台64線）"
                    className="w-full bg-transparent hover:bg-white focus:bg-white px-1 py-0.5 rounded outline-none text-xs font-extrabold text-slate-900"
                  />
                </div>
                <div className="text-[10px] text-slate-500 pl-5 mt-0.5">
                  {evidence.verificationStatus === 'google_verified'
                    ? '已與 Google Maps 官方距離完成核對'
                    : evidence.verificationStatus === 'osrm'
                    ? '依真實道路路網計算之建議行車路線'
                    : '系統座標推估路線，建議開啟 Google Maps 核驗'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-black text-amber-700 tabular-nums">
                  {evidence.durationMin} 分
                </div>
                <div className="text-xs font-extrabold text-slate-700 tabular-nums">
                  {actualKm.toFixed(1)} 公里
                </div>
              </div>
            </div>
          </div>

          {/* 底部：Google Maps 實景核對連結、手動核對輸入與截圖上傳／Ctrl+V 貼上 */}
          <div className="pt-2.5 border-t border-slate-200 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5 bg-blue-50/70 border border-blue-200 rounded-lg px-2.5 py-1.5">
                <span className="text-[10px] font-extrabold text-blue-800">
                  Google Maps 驗證公里數（連動主表）
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={actualKm}
                    onChange={e =>
                      onUpdateKmAndMeta({
                        actualKm: Math.max(0, Number(e.target.value) || 0),
                        verificationStatus: 'google_verified',
                      })
                    }
                    className="w-full text-sm font-black text-blue-700 bg-white border border-blue-300 rounded px-1.5 py-0.5 outline-none tabular-nums"
                  />
                  <span className="text-[11px] font-bold text-slate-600 shrink-0">公里</span>
                </div>
              </label>

              <label className="flex flex-col gap-0.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                <span className="text-[10px] font-extrabold text-slate-600">
                  預估行車時間
                </span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    value={evidence.durationMin}
                    onChange={e =>
                      onUpdateKmAndMeta({
                        durationMin: Math.max(0, Math.round(Number(e.target.value) || 0)),
                      })
                    }
                    className="w-full text-sm font-black text-slate-800 bg-white border border-slate-300 rounded px-1.5 py-0.5 outline-none tabular-nums"
                  />
                  <span className="text-[11px] font-bold text-slate-600 shrink-0">分鐘</span>
                </div>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <a
                href={googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold transition-colors shadow-2xs"
              >
                <ExternalLink size={13} />
                <span>開啟 Google Maps 驗證距離</span>
              </a>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) processScreenshotFile(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold cursor-pointer transition-colors"
                title="上傳 Google Maps 截圖作為報核單附件（亦支援點選此卡片後直接按 Ctrl+V 貼上截圖）"
              >
                <Upload size={13} />
                <span>上傳截圖</span>
              </button>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <ClipboardPaste size={11} />
                點選本卡片後按 <kbd className="px-1 py-0.2 bg-slate-100 border border-slate-300 rounded text-slate-600 font-bold">Ctrl+V</kbd> 可直接貼上 Google Maps 截圖
              </span>
              {pasteNotice && <span className="text-emerald-600 font-bold">{pasteNotice}</span>}
            </div>
          </div>
        </div>

        {/* 右側面板：真實街道地圖＋藍紫色導航路徑＋「🚗 XX分 / XX.X公里」氣泡（或顯示已上傳之 Google Maps 原版截圖） */}
        <div className="lg:col-span-7 p-3 bg-slate-100/80 flex flex-col gap-2 justify-between">
          {/* 右上模式切換（當已有 Google Maps 截圖時可自由切換檢視） */}
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[11px] font-extrabold text-slate-700">
              {showingScreenshot
                ? '📸 Google Maps 官方路線距離截圖（附件佐證原圖）'
                : '🗺️ 真實道路導航路線預覽（列印附件將自動輸出此視覺卡片）'}
            </span>
            {evidence.googleScreenshotDataUrl && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPreferScreenshotView(true)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                    showingScreenshot ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  <ImageIcon size={11} />
                  <span>Google 截圖</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreferScreenshotView(false)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                    !showingScreenshot ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
                  }`}
                >
                  <MapIcon size={11} />
                  <span>系統路網圖</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateKmAndMeta({
                      googleScreenshotDataUrl: undefined,
                      verificationStatus: evidence.geometry.length > evidence.waypoints.length ? 'osrm' : 'estimated',
                    })
                  }
                  className="p-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 cursor-pointer"
                  title="移除已上傳之 Google Maps 截圖"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )}
          </div>

          {showingScreenshot && evidence.googleScreenshotDataUrl ? (
            <div className="relative rounded-xl overflow-hidden border border-slate-300 bg-white flex items-center justify-center min-h-[310px] max-h-[360px]">
              <img
                src={evidence.googleScreenshotDataUrl}
                alt={`Google Maps 距離佐證_${dateStr}`}
                className="w-full h-full object-contain max-h-[350px]"
              />
              <span className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full bg-emerald-600/95 text-white text-[11px] font-extrabold shadow-md">
                ✓ Google Maps 官方截圖佐證
              </span>
            </div>
          ) : (
            <div
              className="relative mx-auto rounded-xl overflow-hidden border border-slate-300 bg-slate-200 shadow-inner select-none"
              style={{ width: '100%', maxWidth: `${MAP_WIDTH}px`, height: `${MAP_HEIGHT}px` }}
            >
              {/* ESRI 無浮水印街道底圖圖磚 */}
              {mapLayout.tiles.map((t, i) => (
                <img
                  key={`${mapLayout.zoom}-${i}`}
                  src={t.url}
                  alt=""
                  draggable={false}
                  className="absolute max-w-none pointer-events-none"
                  style={{ left: t.left, top: t.top, width: 256, height: 256 }}
                />
              ))}

              {/* 貼合真實街道的 Google Maps 藍紫色導航路線 */}
              <svg
                width={MAP_WIDTH}
                height={MAP_HEIGHT}
                className="absolute inset-0 pointer-events-none z-10"
              >
                {mapLayout.polylineSvgPoints && (
                  <>
                    <polyline
                      points={mapLayout.polylineSvgPoints}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={8.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.94}
                    />
                    <polyline
                      points={mapLayout.polylineSvgPoints}
                      fill="none"
                      stroke="#4338ca"
                      strokeWidth={5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </>
                )}
              </svg>

              {/* 起點、停靠站與終點圖釘 */}
              {mapLayout.markers.map((m, idx) => (
                <div
                  key={`mk-${idx}`}
                  className="absolute z-20 pointer-events-none"
                  style={{
                    left: m.x,
                    top: m.y,
                    transform: m.isEnd && mapLayout.markers.length > 1 ? 'translate(-50%, -100%)' : 'translate(-50%, -50%)',
                  }}
                >
                  {m.isStart ? (
                    <div className="w-4 h-4 rounded-full bg-white border-[3.5px] border-slate-900 shadow-md" />
                  ) : m.isEnd && mapLayout.markers.length > 1 ? (
                    <div className="w-6 h-6 rounded-full bg-rose-600 text-white border-2 border-white shadow-md text-[10px] font-black flex items-center justify-center">
                      終
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-blue-600 text-white border-2 border-white shadow-md text-[10px] font-extrabold flex items-center justify-center">
                      {m.idx}
                    </div>
                  )}
                </div>
              ))}

              {/* 還原 Google Maps 懸浮藍色行車時間與公里氣泡（「🚗 40 分 / 18.8 公里」） */}
              {evidence.waypoints.length >= 2 && (
                <div
                  className="absolute z-30 bg-blue-700 text-white px-2.5 py-1 rounded-lg shadow-lg border-2 border-white pointer-events-none leading-tight"
                  style={{
                    left: mapLayout.midPoint.x,
                    top: mapLayout.midPoint.y,
                    transform: 'translate(-50%, -115%)',
                  }}
                >
                  <div className="flex items-center gap-1 text-xs font-extrabold whitespace-nowrap">
                    {vehicleType === 'motorcycle' ? <Bike size={12} /> : <Car size={12} />}
                    <span>{evidence.durationMin} 分</span>
                  </div>
                  <div className="text-[11px] font-bold opacity-95 whitespace-nowrap">
                    {actualKm.toFixed(1)} 公里
                  </div>
                </div>
              )}

              <div className="absolute bottom-1.5 right-2 z-30 px-2 py-0.5 rounded bg-white/85 text-[9px] font-semibold text-slate-600 pointer-events-none">
                ESRI World Street Map · {evidence.verificationStatus === 'osrm' ? 'OSRM 真實路網' : '座標推估'}
              </div>
            </div>
          )}

          {/* Google Maps 官方驗證網址顯示條（列印附件亦會附上供會計掃描或點開稽核） */}
          <div className="bg-white rounded-lg border border-slate-200 px-2.5 py-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-500">
            <span className="truncate font-mono" title={googleUrl}>
              Google Maps 核驗連結：{googleUrl}
            </span>
            <a
              href={googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-bold shrink-0"
            >
              點此開啟 ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
