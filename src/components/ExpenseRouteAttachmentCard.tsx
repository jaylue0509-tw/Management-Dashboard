import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  Upload,
  CheckCircle2,
  Trash2,
  Camera,
  ZoomIn,
  Loader2,
  Plus,
  Sparkles,
  Car,
  Bike,
  TrainFront,
  Footprints,
  X,
  MapPin,
} from 'lucide-react';
import type { GeoPoint } from '../data/storeCoordinates';
import {
  buildGoogleMapsDirectionsUrl,
  compressScreenshotFile,
  computeGoogleMapLayout,
  fetchRealRoadRoute,
  formatGoogleDuration,
} from '../utils/road-routing';
import { geocodeTaiwanAddress } from '../utils/address-geocoder';
import { recognizeGoogleMapsScreenshotKm } from '../utils/gmaps-screenshot-ocr';

export type VerificationStatus = 'pending_screenshot' | 'google_verified';

export interface RouteEvidenceData {
  waypoints: GeoPoint[];
  stopLabels: string[];
  /** 沿真實道路展開之 [lat, lng] 折線座標陣列 */
  geometry: [number, number][];
  durationMin: number;
  viaRoad: string;
  verificationStatus: VerificationStatus;
  googleScreenshots: string[];
}

interface ExpenseRouteAttachmentCardProps {
  index: number;
  dateStr: string;
  applicantName: string;
  region?: string;
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
    waypoints?: GeoPoint[];
    geometry?: [number, number][];
    stopLabels?: string[];
    verificationStatus?: VerificationStatus;
    googleScreenshots?: string[];
  }) => void;
}

const MAP_WIDTH = 560;
const MAP_HEIGHT = 340;

/**
 * 將顯示用站點文字清洗為地理編碼查詢字串，保留完整台灣門牌地址（避免含空白地址被截斷）
 */
const extractGeocodeQuery = (labelText: string): string => {
  const withoutRegionTag = labelText.replace(/（台灣[^）]*）/g, '').trim();
  if (!withoutRegionTag) return '';

  // 若格式為「地標別名 220台灣新北市板橋區...」或含郵遞區號＋縣市路名，保留完整台灣地址段
  const fullAddrMatch = withoutRegionTag.match(/(?:\d{3,5}\s*)?(?:台灣|臺灣)?[台臺北中南高新桃竹苗彰雲嘉屏宜花東澎金馬][^\s]*(?:縣|市).+/);
  if (fullAddrMatch && /(?:路|街|大道|段|巷|弄|號)/.test(fullAddrMatch[0])) {
    return fullAddrMatch[0].replace(/^\d{3,5}\s*/, '').replace(/^(?:台灣|臺灣)/, '').trim();
  }

  // 若為東森寵物門市格式（如「東森寵物雲 彰化中正店」），移除品牌前綴以命中內建精準門市座標表
  const storeStripped = withoutRegionTag.replace(/^東森寵物雲?\s*/, '').trim();
  return storeStripped || withoutRegionTag;
};

/**
 * 零用金單據黏存單附件卡：
 * 一鍵直接產生並顯示「點對點距離 真實 Google Maps 路線截圖畫面」（左側起訖站點、途經道路、時間與公里數；右側真實 Google Maps 街道圖＋藍紫導航線＋公里氣泡），
 * 並即時將點對點真實道路公里數連動回主表公式與金額。
 */
export const ExpenseRouteAttachmentCard: React.FC<ExpenseRouteAttachmentCardProps> = ({
  index,
  dateStr,
  region = '新北區',
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
  const autoFetchedRoadRef = useRef<boolean>(false);
  const dirtyStopIndicesRef = useRef<Set<number>>(new Set());

  const [isGeneratingMap, setIsGeneratingMap] = useState(false);
  const [isRecognizingKm, setIsRecognizingKm] = useState(false);
  const [statusBadgeText, setStatusBadgeText] = useState<string>('');
  const [showCustomShots, setShowCustomShots] = useState<boolean>(false);

  const googleUrl = useMemo(
    () => buildGoogleMapsDirectionsUrl(evidence.waypoints, vehicleType, evidence.stopLabels),
    [evidence.waypoints, vehicleType, evidence.stopLabels]
  );

  const mapLayout = useMemo(
    () =>
      computeGoogleMapLayout(
        evidence.waypoints,
        evidence.geometry || [],
        MAP_WIDTH,
        MAP_HEIGHT
      ),
    [evidence.waypoints, evidence.geometry]
  );

  /**
   * 一鍵產生／更新「點對點距離真實 Google Maps」：
   * 1. 若使用者修改了起訖地址文字，自動透過 geocodeTaiwanAddress 轉為精準座標
   * 2. 自動呼叫真實道路引擎取得點對點道路軌跡、途經道路、行車時間與公里數
   * 3. 立即將點對點公里數同步回《零用金單據黏存單》主表金額
   */
  const handleOneClickGenerateGoogleMap = useCallback(
    async (customLabels?: string[], applyKmToForm = true) => {
      const targetLabels = (customLabels ?? evidence.stopLabels).map(s => s.trim()).filter(Boolean);
      setIsGeneratingMap(true);
      setShowCustomShots(false);
      try {
        let resolvedWaypoints: GeoPoint[] = [...evidence.waypoints];

        // 僅在站點數變更、該站點文字曾被使用者編輯、或缺少既有座標時才重跑地理編碼（避免觸發 Nominatim 限速與錯誤截斷）
        if (targetLabels.length >= 2) {
          const isSameLength = targetLabels.length === evidence.waypoints.length;
          const nextPts: GeoPoint[] = [];
          for (let i = 0; i < targetLabels.length; i++) {
            const labelText = targetLabels[i];
            const existingPt = isSameLength ? evidence.waypoints[i] : undefined;
            const isDirty = dirtyStopIndicesRef.current.has(i) || Boolean(customLabels);

            if (
              existingPt &&
              !isDirty &&
              Number.isFinite(existingPt.lat) &&
              Number.isFinite(existingPt.lng)
            ) {
              nextPts.push({ ...existingPt, label: labelText });
              continue;
            }

            const query = extractGeocodeQuery(labelText);
            const geo = await geocodeTaiwanAddress(query || labelText);
            if (geo) {
              nextPts.push({ lat: geo.lat, lng: geo.lng, label: labelText });
              dirtyStopIndicesRef.current.delete(i);
            } else if (existingPt) {
              nextPts.push({ ...existingPt, label: labelText });
            }
          }
          if (nextPts.length >= 2) {
            resolvedWaypoints = nextPts;
          }
        }

        if (resolvedWaypoints.length >= 2) {
          const road = await fetchRealRoadRoute(resolvedWaypoints, region);
          const nextKm = applyKmToForm && road.distanceKm > 0 ? road.distanceKm : actualKm;
          onUpdateEvidence({
            waypoints: resolvedWaypoints,
            geometry: road.geometry,
            durationMin: road.durationMin,
            viaRoad: road.viaRoad,
            ...(applyKmToForm && road.distanceKm > 0 ? { actualKm: nextKm } : {}),
            verificationStatus: 'google_verified',
          });
          setStatusBadgeText(`已連動點對點距離：${nextKm.toFixed(1)} 公里（${formatGoogleDuration(road.durationMin)}）`);
          window.setTimeout(() => setStatusBadgeText(''), 4500);
        }
      } finally {
        setIsGeneratingMap(false);
      }
    },
    [evidence.stopLabels, evidence.waypoints, region, actualKm, onUpdateEvidence]
  );

  // 開啟時自動載入真實道路折線與點對點距離（無須手動再按一次）
  useEffect(() => {
    if (
      !autoFetchedRoadRef.current &&
      evidence.waypoints.length >= 2 &&
      (!evidence.geometry || evidence.geometry.length <= evidence.waypoints.length)
    ) {
      autoFetchedRoadRef.current = true;
      handleOneClickGenerateGoogleMap(undefined, true);
    }
  }, [evidence.waypoints, evidence.geometry, handleOneClickGenerateGoogleMap]);

  /**
   * 若使用者貼上或上傳外部截圖，自動 OCR 辨識截圖中之公里數並連動主表
   */
  const runAutoOcrAndLink = useCallback(
    async (imageDataUrl: string) => {
      setIsRecognizingKm(true);
      try {
        const result = await recognizeGoogleMapsScreenshotKm(imageDataUrl);
        if (result.distanceKm !== null && result.distanceKm > 0) {
          onUpdateEvidence({
            actualKm: result.distanceKm,
            ...(result.durationMin !== null ? { durationMin: result.durationMin } : {}),
            verificationStatus: 'google_verified',
          });
          setStatusBadgeText(`已從截圖帶入 ${result.distanceKm} 公里`);
          window.setTimeout(() => setStatusBadgeText(''), 4500);
        }
      } catch {
        // 忽略 OCR 例外
      } finally {
        setIsRecognizingKm(false);
      }
    },
    [onUpdateEvidence]
  );

  const handleFiles = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    try {
      const addedUrls: string[] = [];
      for (const file of imageFiles) {
        const dataUrl = await compressScreenshotFile(file);
        addedUrls.push(dataUrl);
      }
      const nextList = [...evidence.googleScreenshots, ...addedUrls];
      onUpdateEvidence({
        googleScreenshots: nextList,
        verificationStatus: 'google_verified',
      });
      setShowCustomShots(true);
      if (addedUrls.length > 0) {
        await runAutoOcrAndLink(addedUrls[0]);
      }
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

  const handleUpdateStopLabel = (stopIdx: number, val: string) => {
    dirtyStopIndicesRef.current.add(stopIdx);
    const next = [...evidence.stopLabels];
    next[stopIdx] = val;
    onUpdateEvidence({ stopLabels: next });
  };

  const handleAddStop = () => {
    const next = [...evidence.stopLabels];
    // 插入於終點（返程點）之前
    const insertIdx = Math.max(1, next.length - 1);
    next.splice(insertIdx, 0, '');
    dirtyStopIndicesRef.current.add(insertIdx);
    onUpdateEvidence({ stopLabels: next });
  };

  const handleRemoveStop = (stopIdx: number) => {
    if (evidence.stopLabels.length <= 2) return;
    const next = evidence.stopLabels.filter((_, i) => i !== stopIdx);
    onUpdateEvidence({ stopLabels: next });
    handleOneClickGenerateGoogleMap(next, true);
  };

  const durShort = formatGoogleDuration(evidence.durationMin, false);
  const durLong = formatGoogleDuration(evidence.durationMin, true);

  return (
    <div
      onPaste={handlePaste}
      tabIndex={0}
      className="bg-white rounded-2xl border border-slate-300 outline-none shadow-sm overflow-hidden"
    >
      {/* 頂部標題與一鍵 Google 截圖連動工具列 */}
      <div className="bg-slate-900 text-white px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="px-2.5 py-0.5 rounded-md bg-amber-400 text-slate-950 text-xs font-extrabold shrink-0">
            附件 {index + 1}
          </span>
          <span className="text-xs sm:text-sm font-extrabold text-white shrink-0">
            {dateStr}
          </span>
          {routeSummaryText && (
            <span className="text-xs text-slate-300 truncate max-w-[280px] sm:max-w-[380px]" title={routeSummaryText}>
              {routeSummaryText}
            </span>
          )}
          {(isGeneratingMap || isRecognizingKm) ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 border border-indigo-400/40">
              <Loader2 size={11} className="animate-spin" />
              <span>計算點對點距離中...</span>
            </span>
          ) : statusBadgeText ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/25 text-emerald-200 border border-emerald-400/40">
              <Sparkles size={11} />
              <span>{statusBadgeText}</span>
            </span>
          ) : (
            <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 實際公里數與實付油資（直接連動零用金單據黏存單） */}
          <div className="inline-flex items-center gap-1 bg-slate-800 border border-slate-600 rounded-lg px-2 py-1">
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
              className="w-14 text-right text-xs font-extrabold text-amber-300 bg-transparent outline-none tabular-nums"
              title="點對點實際公里數（修改即連動黏存單金額）"
            />
            <span className="text-[11px] font-bold text-slate-300">km</span>
            <span className="text-xs font-extrabold text-emerald-300 pl-1.5 border-l border-slate-600">
              ${fuelSubsidy.toLocaleString('zh-TW')}
            </span>
          </div>

          <button
            type="button"
            onClick={() => handleOneClickGenerateGoogleMap(undefined, true)}
            disabled={isGeneratingMap}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer transition-colors shadow-2xs"
            title="一鍵重新定位點對點起訖地址並產出真實 Google Maps 距離畫面"
          >
            {isGeneratingMap ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
            <span>一鍵 Google 截圖</span>
          </button>

          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors"
            title="於新分頁打開 Google Maps"
          >
            <ExternalLink size={12} />
            <span className="hidden sm:inline">開啟 Google Maps</span>
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
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-bold cursor-pointer"
            title="從手機相簿或電腦上傳自訂截圖"
          >
            <Upload size={12} />
          </button>
        </div>
      </div>

      {/* 主畫面：直接呈現「點對點距離 真實 Google Maps」雙欄畫面（與真實 Google Maps 網頁截圖 1:1 一致） */}
      {showCustomShots && evidence.googleScreenshots.length > 0 ? (
        <div className="p-3 bg-slate-50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">已附加自訂截圖</span>
            <button
              type="button"
              onClick={() => setShowCustomShots(false)}
              className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
            >
              返回點對點 Google Maps 畫面
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {evidence.googleScreenshots.map((dataUrl, imgIdx) => (
              <div key={`shot-${imgIdx}`} className="relative rounded-lg overflow-hidden border border-slate-200 bg-white">
                <img
                  src={dataUrl}
                  alt={`附件_${index + 1}`}
                  onClick={() => onPreviewImage?.(dataUrl)}
                  className="w-full max-h-[380px] object-contain cursor-zoom-in mx-auto"
                />
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  {onPreviewImage && (
                    <button
                      type="button"
                      onClick={() => onPreviewImage(dataUrl)}
                      className="p-1.5 rounded-lg bg-slate-900/75 text-white cursor-pointer"
                    >
                      <ZoomIn size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const next = evidence.googleScreenshots.filter((_, i) => i !== imgIdx);
                      onUpdateEvidence({ googleScreenshots: next });
                      if (next.length === 0) setShowCustomShots(false);
                    }}
                    className="p-1.5 rounded-lg bg-rose-600 text-white cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 bg-white">
          {/* 左側：Google Maps 點對點起訖地址、交通時間與「途經... XX分 / XX.X公里」面板 */}
          <div className="lg:col-span-5 p-3.5 sm:p-4 border-b lg:border-b-0 lg:border-r border-[#dadce0] flex flex-col justify-between gap-3 bg-white">
            <div className="space-y-3">
              {/* 頂部交通工具圖示列（仿 Google Maps 樣式） */}
              <div className="flex items-center justify-between pb-2.5 border-b border-[#e8eaed] text-[#5f6368]">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div
                    className={`flex flex-col items-center px-3 py-1 rounded-full text-[11px] font-bold ${
                      vehicleType === 'car' ? 'bg-[#d2e3fc] text-[#174ea6]' : 'text-[#5f6368]'
                    }`}
                  >
                    <Car size={16} />
                    <span className="mt-0.5">{durShort}</span>
                  </div>
                  <div
                    className={`flex flex-col items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      vehicleType === 'motorcycle' ? 'bg-[#d2e3fc] text-[#174ea6]' : 'text-[#5f6368]'
                    }`}
                  >
                    <Bike size={16} />
                    <span className="mt-0.5">{durShort}</span>
                  </div>
                  <div className="flex flex-col items-center px-2 py-1 text-[11px] text-[#70757a]">
                    <TrainFront size={15} />
                    <span className="mt-0.5">--</span>
                  </div>
                  <div className="flex flex-col items-center px-2 py-1 text-[11px] text-[#70757a]">
                    <Footprints size={15} />
                    <span className="mt-0.5">--</span>
                  </div>
                </div>
              </div>

              {/* 點對點起訖地址清單（可直接編輯任一地址，按 Enter 立即重新定位計算點對點距離） */}
              <div className="space-y-2">
                {evidence.stopLabels.map((label, sIdx) => {
                  const isLast = sIdx === evidence.stopLabels.length - 1 && evidence.stopLabels.length > 1;
                  return (
                    <div key={`gstop-${sIdx}`} className="flex items-center gap-2">
                      <div className="w-5 flex flex-col items-center justify-center shrink-0">
                        {isLast ? (
                          <MapPin size={16} className="text-[#d93025]" />
                        ) : (
                          <span className="w-3 h-3 rounded-full border-2 border-[#3c4043] bg-white inline-block" />
                        )}
                      </div>
                      <input
                        type="text"
                        value={label}
                        onChange={e => handleUpdateStopLabel(sIdx, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleOneClickGenerateGoogleMap(undefined, true);
                          }
                        }}
                        placeholder={sIdx === 0 ? '輸入起點地址...' : '輸入停靠門市或目的地地址...'}
                        className="flex-1 text-xs font-medium text-[#202124] bg-white border border-[#80868b] focus:border-[#1a73e8] rounded-lg px-3 py-2 outline-none transition-colors"
                      />
                      {evidence.stopLabels.length > 2 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveStop(sIdx)}
                          className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                          title="移除此停靠點"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}

                <div className="flex items-center justify-between pt-0.5 pl-1">
                  <button
                    type="button"
                    onClick={handleAddStop}
                    className="inline-flex items-center gap-2 text-xs font-semibold text-[#3c4043] hover:text-[#1a73e8] cursor-pointer"
                  >
                    <span className="w-5 h-5 rounded-full border border-[#5f6368] flex items-center justify-center">
                      <Plus size={12} />
                    </span>
                    <span>新增目的地</span>
                  </button>

                  <span className="text-[11px] font-semibold text-[#1a73e8]">選項</span>
                </div>
              </div>
            </div>

            {/* 底部：Google Maps 路線結論（途經國道1號 · 1 小時 7 分 · 37.4 公里） */}
            <div className="pt-2 border-t border-[#e8eaed] space-y-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-[#1a73e8] px-1">
                <span>📱 將路線傳送至手機</span>
                <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  🔗 開啟連結
                </a>
              </div>

              <div className="border-t border-[#e8eaed] pt-2.5 pl-3 border-l-4 border-l-[#1a73e8] flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  {vehicleType === 'motorcycle' ? (
                    <Bike size={18} className="text-[#202124] mt-0.5 shrink-0" />
                  ) : (
                    <Car size={18} className="text-[#202124] mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#202124] truncate">
                      {evidence.viaRoad || '途經主要幹道'}
                    </div>
                    <div className="text-xs text-[#70757a] mt-0.5">
                      據路況，此為目前最快路線
                    </div>
                    <div className="text-[11px] font-bold text-[#188038] mt-1">
                      油資試算：{actualKm.toFixed(1)} 公里 × {ratePerKm} 元 = ${fuelSubsidy.toLocaleString('zh-TW')} 元
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-[#b06000] whitespace-nowrap">
                    {durShort}
                  </div>
                  <div className="text-sm font-bold text-[#5f6368] whitespace-nowrap mt-0.5">
                    {actualKm.toFixed(1)} 公里
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 右側：真實 Google Maps 繁體中文街道底圖 (`mt1.google.com`) ＋ 藍紫色點對點路線 ＋ 懸浮時間公里氣泡 */}
          <div className="lg:col-span-7 bg-[#e8eaed] flex items-center justify-center p-2 sm:p-3 overflow-hidden">
            <div
              className="relative rounded-xl overflow-hidden border border-[#dadce0] bg-[#e5e3df] shadow-inner select-none mx-auto"
              style={{ width: '100%', maxWidth: `${MAP_WIDTH}px`, height: `${MAP_HEIGHT}px` }}
            >
              {/* 真實 Google Maps 繁體中文圖磚 */}
              {mapLayout.tiles.map((t, i) => (
                <img
                  key={`gtile-${mapLayout.zoom}-${i}`}
                  src={t.url}
                  alt=""
                  draggable={false}
                  className="absolute max-w-none pointer-events-none"
                  style={{ left: t.left, top: t.top, width: 256, height: 256 }}
                />
              ))}

              {/* 頂部 Google Maps 搜尋框與分類膠囊裝飾 */}
              <div className="absolute top-2.5 left-3 right-3 z-20 flex items-center gap-1.5 pointer-events-none overflow-hidden">
                <div className="bg-white rounded-full shadow-md px-3 py-1.5 text-xs text-[#5f6368] font-medium flex items-center gap-2 min-w-[160px] border border-slate-200/80">
                  <span>🔍</span>
                  <span>沿著路線搜尋...</span>
                </div>
                <div className="bg-white rounded-full shadow-md px-2.5 py-1 text-[11px] font-bold text-[#3c4043] whitespace-nowrap hidden sm:block">
                  ⛽ 加油站
                </div>
                <div className="bg-white rounded-full shadow-md px-2.5 py-1 text-[11px] font-bold text-[#3c4043] whitespace-nowrap hidden md:block">
                  🔌 電動車充電
                </div>
              </div>

              {/* 貼合真實道路的 Google Maps 藍紫色雙層路線 */}
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
                      stroke="#1e1b98"
                      strokeWidth={8.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <polyline
                      points={mapLayout.polylineSvgPoints}
                      fill="none"
                      stroke="#4262ff"
                      strokeWidth={5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </>
                )}
              </svg>

              {/* 點對點起點／停靠站圓點與終點紅標 */}
              {mapLayout.markers.map((m, idx) => (
                <div
                  key={`gmk-${idx}`}
                  className="absolute z-20 pointer-events-none"
                  style={{
                    left: m.x,
                    top: m.y,
                    transform:
                      m.isEnd && mapLayout.markers.length > 1
                        ? 'translate(-50%, -95%)'
                        : 'translate(-50%, -50%)',
                  }}
                >
                  {m.isEnd && mapLayout.markers.length > 1 ? (
                    <span className="text-xl drop-shadow-md">📍</span>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="w-3.5 h-3.5 rounded-full bg-white border-[3px] border-[#202124] shadow-md block" />
                      {!m.isStart && (
                        <span className="bg-white/95 text-[#202124] text-[10px] font-extrabold px-1.5 py-0.5 rounded shadow border border-slate-200 whitespace-nowrap max-w-[140px] truncate">
                          {m.label.replace(/（[^）]*）/g, '')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Google Maps 經典深藍色路線時間與公里數氣泡 */}
              {evidence.waypoints.length >= 2 && (
                <div
                  className="absolute z-30 bg-[#174ea6] text-white px-2.5 py-1.5 rounded-md shadow-xl border border-white/40 pointer-events-none leading-tight"
                  style={{
                    left: mapLayout.midPoint.x,
                    top: mapLayout.midPoint.y,
                    transform: 'translate(-50%, -115%)',
                  }}
                >
                  <div className="flex items-center gap-1 text-xs font-extrabold whitespace-nowrap">
                    {vehicleType === 'motorcycle' ? <Bike size={12} /> : <Car size={12} />}
                    <span>{durLong}</span>
                  </div>
                  <div className="text-xs font-extrabold whitespace-nowrap mt-0.5">
                    {actualKm.toFixed(1)} 公里
                  </div>
                </div>
              )}

              {/* 左下角圖層方塊與右下角 Google Maps 標誌 */}
              <div className="absolute bottom-2 left-2.5 z-20 w-12 h-12 rounded-lg bg-slate-900 text-white border-2 border-white shadow-md flex items-end justify-center pb-1 text-[9px] font-bold pointer-events-none">
                <span>◇ 圖層</span>
              </div>
              <div
                className="absolute bottom-1.5 right-2.5 z-20 text-xs font-extrabold text-[#3c4043] pointer-events-none"
                style={{ textShadow: '0 0 3px #fff, 0 0 3px #fff' }}
              >
                Google Maps
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
