import React, { useMemo, useState, lazy, Suspense } from 'react';
import {
  Car,
  Bike,
  Calendar,
  Download,
  ChevronDown,
  ChevronUp,
  MapPin,
  ShieldCheck,
  Navigation,
  Search,
  FileSpreadsheet,
  Home,
  X,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { Manager, VisitRecord } from '../types';
import type { GeoPoint } from '../data/storeCoordinates';
import {
  DEFAULT_SUBSIDY_PER_KM,
  MOTORCYCLE_SUBSIDY_PER_KM,
  buildExpenseDashboardReport,
  type DailyRouteRecord,
  type ManagerExpenseItem,
  type MileageCalcMode,
} from '../utils/mileage-calculator';
import {
  customHubToGeoPoint,
  geocodeTaiwanAddress,
  loadCustomHubPoints,
  saveCustomHubPoints,
  type StoredCustomHubs,
} from '../utils/address-geocoder';

// 延後動態載入《國內出差旅費報核單》彈窗，維持車資頁輕量化
const TravelExpenseReimbursementModal = lazy(() =>
  import('./TravelExpenseReimbursementModal').then(m => ({
    default: m.TravelExpenseReimbursementModal,
  }))
);

interface Props {
  allActivities: VisitRecord[];
  periodActivities: VisitRecord[];
  managers: Manager[];
  selectedDepartment: string;
  initialDateStr: string;
  onStoreSelect?: (storeName: string, recordId?: string) => void;
  onOpenRouteMap?: (managerName: string, dateStr?: string) => void;
}

const ALL_REGIONS = '全部區域';

const formatCurrency = (amount: number): string =>
  `NT$ ${Math.round(amount).toLocaleString('zh-TW')}`;

/**
 * 單日路線分段明細列
 */
const RouteLegTimeline: React.FC<{
  route: DailyRouteRecord;
  onStoreSelect?: (storeName: string, recordId?: string) => void;
  onOpenRouteMap?: (managerName: string, dateStr?: string) => void;
}> = ({ route, onStoreSelect, onOpenRouteMap }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2.5 border-b border-slate-100">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-2.5 py-0.5 rounded-md bg-indigo-600 text-white text-xs font-extrabold">
          📅 {route.dateStr}
        </span>
        <span className="text-xs font-bold text-slate-700">
          巡視 {route.storeVisitCount} 店
          {route.scheduleCount > 0 ? ` · 公務行程 ${route.scheduleCount} 筆` : ''}
        </span>
      </div>
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-xs font-bold text-slate-600">
          單日里程：<strong className="text-blue-700">{route.totalKm.toFixed(1)} km</strong>
        </span>
        <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-extrabold">
          單日車資：{formatCurrency(route.totalSubsidy)}
        </span>
        {onOpenRouteMap && (
          <button
            type="button"
            onClick={() => onOpenRouteMap(route.managerName, route.dateStr)}
            className="text-[11px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            title="在地圖上查看此路徑與最佳化建議"
          >
            <span>🗺️ 查看地圖路徑</span>
          </button>
        )}
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {route.legs.map((leg, idx) => {
        const isStoreTarget = !leg.isReturnLeg && leg.recordId && onStoreSelect;
        return (
          <React.Fragment key={idx}>
            {idx === 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                🏠 {leg.fromLabel}
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold text-[11px]">
              <span>➔</span>
              <span>{leg.distanceKm.toFixed(1)} km</span>
              <span className="text-emerald-700">(${leg.subsidyCost})</span>
            </span>
            {isStoreTarget ? (
              <button
                type="button"
                onClick={() => onStoreSelect(leg.toLabel, leg.recordId)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold cursor-pointer transition-colors"
                title="點擊跳轉至該筆巡店紀錄細節"
              >
                <span>📍 {leg.toLabel}</span>
                {leg.visitTime && <span className="text-[10px] text-indigo-500">({leg.visitTime})</span>}
              </button>
            ) : (
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md font-semibold border ${
                  leg.isReturnLeg
                    ? 'bg-slate-100 text-slate-600 border-slate-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                <span>{leg.isReturnLeg ? '🏠' : '📍'} {leg.toLabel}</span>
                {leg.visitTime && <span className="text-[10px] opacity-75">({leg.visitTime})</span>}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  </div>
);

/**
 * 最高管理權限專屬：巡店車程里程推估與每月車資補助核算面板
 */
export const MileageExpensePanel: React.FC<Props> = ({
  allActivities,
  periodActivities,
  managers,
  selectedDepartment,
  initialDateStr,
  onStoreSelect,
  onOpenRouteMap,
}) => {
  const { user } = useAuth();
  const [targetDateStr, setTargetDateStr] = useState<string>(initialDateStr);
  const [targetMonthKey, setTargetMonthKey] = useState<string>(initialDateStr.slice(0, 7));
  const [ratePerKm, setRatePerKm] = useState<number>(DEFAULT_SUBSIDY_PER_KM);
  const [mode, setMode] = useState<MileageCalcMode>('round_trip');
  const [includeSchedule, setIncludeSchedule] = useState<boolean>(true);
  const [selectedRegion, setSelectedRegion] = useState<string>(ALL_REGIONS);
  const [keyword, setKeyword] = useState<string>('');
  const [expandedManager, setExpandedManager] = useState<string | null>(null);
  const [onlyShowActive, setOnlyShowActive] = useState<boolean>(false);

  // 自訂出發起始點地址狀態（支援全體通用或個別主管專屬設定，自動持久化至 localStorage）
  const [customHubs, setCustomHubs] = useState<StoredCustomHubs>(() => loadCustomHubPoints());
  const [hubTargetScope, setHubTargetScope] = useState<string>('__global__');
  const [addressInput, setAddressInput] = useState<string>(() => loadCustomHubPoints().global?.address || '');
  const [isGeocoding, setIsGeocoding] = useState<boolean>(false);
  const [geocodeStatus, setGeocodeStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 《東森寵物雲 國內出差旅費報核單》彈窗狀態
  const [reimbursementModal, setReimbursementModal] = useState<{
    open: boolean;
    managerName: string;
    scope: 'month' | 'day';
  }>({ open: false, managerName: '', scope: 'month' });

  // 當外層日期篩選變更時，同步更新目標單日與月份
  React.useEffect(() => {
    if (initialDateStr) {
      setTargetDateStr(initialDateStr);
      setTargetMonthKey(initialDateStr.slice(0, 7));
    }
  }, [initialDateStr]);

  // 將自訂起始點轉換成里程計算引擎可用之座標映射
  const customHubPointsByManager = useMemo(() => {
    const map: Record<string, GeoPoint> = {};
    for (const [mgrName, cfg] of Object.entries(customHubs.byManager || {})) {
      const pt = customHubToGeoPoint(cfg);
      if (pt) map[mgrName] = pt;
    }
    return map;
  }, [customHubs.byManager]);

  const globalCustomHubPoint = useMemo(
    () => customHubToGeoPoint(customHubs.global),
    [customHubs.global]
  );

  // 切換起始點設定對象時，自動回填該對象目前儲存之起始點地址
  const handleSelectHubTargetScope = (nextScope: string) => {
    setHubTargetScope(nextScope);
    setGeocodeStatus(null);
    if (nextScope === '__global__') {
      setAddressInput(customHubs.global?.address || '');
    } else {
      setAddressInput(customHubs.byManager[nextScope]?.address || '');
    }
  };

  // 解析起始點地址並套用至車資推算（同步連動報核單與巡店路徑地圖）
  const handleApplyStartAddress = async (presetAddress?: string) => {
    const query = (presetAddress ?? addressInput).trim();
    if (!query) {
      setGeocodeStatus({ type: 'error', text: '請先輸入起始點地址、行政區、地標或門市名稱' });
      return;
    }
    if (presetAddress !== undefined) setAddressInput(presetAddress);

    setIsGeocoding(true);
    setGeocodeStatus(null);
    try {
      const resolved = await geocodeTaiwanAddress(query);
      if (!resolved) {
        setGeocodeStatus({
          type: 'error',
          text: `無法定位「${query}」，建議包含縣市與行政區（例如：新北市板橋區文化路一段）或直接輸入門市名稱`,
        });
        return;
      }

      const nextStored: StoredCustomHubs =
        hubTargetScope === '__global__'
          ? { ...customHubs, global: resolved }
          : {
              ...customHubs,
              byManager: {
                ...customHubs.byManager,
                [hubTargetScope]: resolved,
              },
            };

      setCustomHubs(nextStored);
      saveCustomHubPoints(nextStored);

      const targetLabel = hubTargetScope === '__global__' ? '全體主管通用起點' : `${hubTargetScope} 專屬起點`;
      const sourceLabel =
        resolved.source === 'nominatim'
          ? '街道門牌精準定位'
          : resolved.source === 'store'
          ? '門市座標定位'
          : resolved.source === 'headquarters'
          ? '總部座標'
          : resolved.source === 'coordinates'
          ? '經緯度座標'
          : '行政區中心定位';

      setGeocodeStatus({
        type: 'success',
        text: `已套用【${targetLabel}】：${resolved.address}（${sourceLabel} · ${resolved.lat.toFixed(4)}, ${resolved.lng.toFixed(4)}），里程與車資已即時重算！`,
      });
    } finally {
      setIsGeocoding(false);
    }
  };

  // 移除自訂起始點（恢復預設區域中心）
  const handleRemoveCustomHub = (targetKey: string) => {
    const nextStored: StoredCustomHubs =
      targetKey === '__global__'
        ? { ...customHubs, global: null }
        : {
            ...customHubs,
            byManager: Object.fromEntries(
              Object.entries(customHubs.byManager).filter(([k]) => k !== targetKey)
            ),
          };
    setCustomHubs(nextStored);
    saveCustomHubPoints(nextStored);
    if (hubTargetScope === targetKey) {
      setAddressInput('');
    }
    setGeocodeStatus({
      type: 'success',
      text: targetKey === '__global__' ? '已清除全體通用起點，恢復依各區域預設中心推算' : `已清除「${targetKey}」專屬起點，恢復預設推算`,
    });
  };

  const report = useMemo(
    () =>
      buildExpenseDashboardReport({
        allActivities,
        periodActivities,
        managers,
        selectedDepartment,
        targetDateStr,
        targetMonthKey,
        ratePerKm,
        mode,
        includeSchedule,
        customHubPointsByManager,
        globalCustomHubPoint,
      }),
    [
      allActivities,
      periodActivities,
      managers,
      selectedDepartment,
      targetDateStr,
      targetMonthKey,
      ratePerKm,
      mode,
      includeSchedule,
      customHubPointsByManager,
      globalCustomHubPoint,
    ]
  );

  const regionOptions = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of report.managersReport) {
      map.set(m.region, (map.get(m.region) || 0) + 1);
    }
    return Array.from(map.entries()).map(([region, count]) => ({ region, count }));
  }, [report.managersReport]);

  const visibleManagers = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return report.managersReport.filter(m => {
      if (selectedRegion !== ALL_REGIONS && m.region !== selectedRegion) return false;
      if (onlyShowActive && m.dayKm === 0 && m.monthKm === 0) return false;
      if (
        q &&
        !m.managerName.toLowerCase().includes(q) &&
        !m.region.toLowerCase().includes(q) &&
        !m.department.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [report.managersReport, selectedRegion, onlyShowActive, keyword]);

  // 嚴格權限防護：僅最高管理員 (admin) 可見
  if (user?.role !== 'admin') return null;

  const handleExportCsv = () => {
    const headers = [
      '處別',
      '區域',
      '主管姓名',
      '職務',
      '轄下店數',
      `指定日(${report.targetDateStr})巡店數`,
      `指定日(${report.targetDateStr})推估里程(km)`,
      `指定日(${report.targetDateStr})推算車資(NT$)`,
      `指定日(${report.targetDateStr})行程路線`,
      `月份(${report.targetMonthKey})出勤天數`,
      `月份(${report.targetMonthKey})累計巡店數`,
      `月份(${report.targetMonthKey})累計里程(km)`,
      `月份(${report.targetMonthKey})累計車資加總(NT$)`,
      '每公里補助單價(NT$)',
    ];

    const rows = visibleManagers.map((m: ManagerExpenseItem) => {
      const routeText = m.dayRoute
        ? m.dayRoute.legs.map((l, i) => (i === 0 ? `${l.fromLabel} ➔ ${l.toLabel}` : l.toLabel)).join(' ➔ ')
        : '無出勤紀錄';
      return [
        m.department,
        m.region,
        m.managerName,
        m.roleLabel,
        m.assignedStoreCount,
        m.dayVisitCount,
        m.dayKm.toFixed(1),
        m.daySubsidy,
        `"${routeText.replace(/"/g, '""')}"`,
        m.monthActiveDays,
        m.monthVisitCount,
        m.monthKm.toFixed(1),
        m.monthSubsidy,
        report.ratePerKm,
      ].join(',');
    });

    const totalRow = [
      '總計',
      selectedRegion,
      `共 ${visibleManagers.length} 位主管`,
      '-',
      '-',
      visibleManagers.reduce((s, m) => s + m.dayVisitCount, 0),
      visibleManagers.reduce((s, m) => s + m.dayKm, 0).toFixed(1),
      visibleManagers.reduce((s, m) => s + m.daySubsidy, 0),
      '""',
      visibleManagers.reduce((s, m) => s + m.monthActiveDays, 0),
      visibleManagers.reduce((s, m) => s + m.monthVisitCount, 0),
      visibleManagers.reduce((s, m) => s + m.monthKm, 0).toFixed(1),
      visibleManagers.reduce((s, m) => s + m.monthSubsidy, 0),
      report.ratePerKm,
    ].join(',');

    const csvContent = `\uFEFF${headers.join(',')}\n${rows.join('\n')}\n${totalRow}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `巡店車程里程與預估費用報表_${report.targetMonthKey}_${report.targetDateStr}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 最高權限橫幅與控制列 */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-4 sm:p-6 shadow-lg border border-indigo-500/30">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-white/10">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-300 shrink-0">
              <Car size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-400 text-slate-950">
                  <ShieldCheck size={13} /> 最高管理權限專屬
                </span>
                <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white">
                  區主管巡店車程里程與預估車資補助中心
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-indigo-200 mt-1">
                依據每位區主管每日巡店先後順序與台灣各門市實際地理座標，自動推算行車路線里程 × 汽車每公里補助{' '}
                <strong className="text-amber-300">{ratePerKm} 元</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() =>
                setReimbursementModal({
                  open: true,
                  managerName: visibleManagers[0]?.managerName || report.managersReport[0]?.managerName || '',
                  scope: 'month',
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs sm:text-sm font-extrabold shadow-md cursor-pointer transition-all"
            >
              <FileSpreadsheet size={16} />
              <span>產生《國內出差旅費報核單》</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs sm:text-sm font-extrabold shadow-md cursor-pointer transition-all"
            >
              <Download size={16} />
              <span>匯出 CSV 報表</span>
            </button>
          </div>
        </div>

        {/* 日期、月份、單價與計算模式設定列 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4">
          {/* 1. 選擇單日（查看當天推算費用） */}
          <div className="bg-white/10 border border-white/15 rounded-xl p-3 flex flex-col gap-1">
            <label className="text-[11px] font-bold text-indigo-200 flex items-center gap-1.5">
              <Calendar size={13} className="text-amber-300" />
              指定單日（當天推算費用）
            </label>
            <input
              type="date"
              value={targetDateStr}
              onChange={e => {
                if (e.target.value) {
                  setTargetDateStr(e.target.value);
                  setTargetMonthKey(e.target.value.slice(0, 7));
                }
              }}
              className="bg-slate-900/80 text-white text-sm font-bold rounded-lg px-3 py-1.5 border border-white/20 outline-none focus:border-amber-400 cursor-pointer"
            />
          </div>

          {/* 2. 選擇月份（查看每月車程費用加總） */}
          <div className="bg-white/10 border border-white/15 rounded-xl p-3 flex flex-col gap-1">
            <label className="text-[11px] font-bold text-indigo-200 flex items-center gap-1.5">
              <Calendar size={13} className="text-emerald-300" />
              統計月份（每月車程費用加總）
            </label>
            <select
              value={targetMonthKey}
              onChange={e => setTargetMonthKey(e.target.value)}
              className="bg-slate-900/80 text-white text-sm font-bold rounded-lg px-3 py-1.5 border border-white/20 outline-none focus:border-amber-400 cursor-pointer"
            >
              {report.availableMonths.map(m => (
                <option key={m} value={m}>
                  {m.replace('-', ' 年 ')} 月份累計加總
                </option>
              ))}
            </select>
          </div>

          {/* 3. 路線推估模式 */}
          <div className="bg-white/10 border border-white/15 rounded-xl p-3 flex flex-col gap-1">
            <label className="text-[11px] font-bold text-indigo-200 flex items-center gap-1.5">
              <Navigation size={13} className="text-sky-300" />
              車程路線推估模式
            </label>
            <select
              value={mode}
              onChange={e => setMode(e.target.value as MileageCalcMode)}
              className="bg-slate-900/80 text-white text-xs sm:text-sm font-bold rounded-lg px-2.5 py-1.5 border border-white/20 outline-none focus:border-amber-400 cursor-pointer"
            >
              <option value="round_trip">🏠 含起始點出發／回程＋跨店移動</option>
              <option value="store_only">📍 僅計門市間跨店移動（首店➔末店）</option>
            </select>
          </div>

          {/* 4. 每公里補助單價（汽車 6.5 / 機車 3）& 公務行程納入開關 */}
          <div className="bg-white/10 border border-white/15 rounded-xl p-3 flex flex-col justify-between gap-1.5">
            <div className="flex items-center justify-between gap-1.5 flex-wrap">
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setRatePerKm(DEFAULT_SUBSIDY_PER_KM)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-extrabold cursor-pointer transition-colors ${
                    ratePerKm === DEFAULT_SUBSIDY_PER_KM
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-slate-900/60 text-indigo-200 hover:bg-white/15'
                  }`}
                  title="依公司報核單註2：汽車每公里補助 6.5 元"
                >
                  <Car size={11} />
                  <span>汽車6.5</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRatePerKm(MOTORCYCLE_SUBSIDY_PER_KM)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-extrabold cursor-pointer transition-colors ${
                    ratePerKm === MOTORCYCLE_SUBSIDY_PER_KM
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-slate-900/60 text-indigo-200 hover:bg-white/15'
                  }`}
                  title="依公司報核單註2：機車每公里補助 3 元"
                >
                  <Bike size={11} />
                  <span>機車3</span>
                </button>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="50"
                  value={ratePerKm}
                  onChange={e => setRatePerKm(Math.max(0, Number(e.target.value) || DEFAULT_SUBSIDY_PER_KM))}
                  className="w-14 bg-slate-900/80 text-amber-300 text-xs sm:text-sm font-extrabold text-center rounded-lg px-1.5 py-0.5 border border-amber-400/40 outline-none"
                />
                <span className="text-[11px] font-bold text-white">元/km</span>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-indigo-100 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeSchedule}
                onChange={e => setIncludeSchedule(e.target.checked)}
                className="rounded text-amber-400 focus:ring-0 cursor-pointer"
              />
              <span>納入總部／會議／特殊公務行程里程</span>
            </label>
          </div>
        </div>

        {/* 5. 起始點地址輸入計算列（支援全體通用或指定區主管專屬出發點，自動連動里程、報核單與地圖） */}
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="bg-white/10 border border-indigo-400/30 rounded-xl p-3 flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 text-xs font-extrabold text-amber-300">
                  <Home size={14} />
                  自訂出發／返程起始點地址計算
                </span>
                <span className="text-[11px] text-indigo-200">
                  輸入住家地址、公司地址、行政區或門市名稱，立即定位並重算車資、報核單與巡店地圖
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleApplyStartAddress('總部大樓')}
                disabled={isGeocoding}
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-indigo-100 border border-white/15 cursor-pointer transition-colors"
              >
                快速套用：總部大樓（中和）
              </button>
            </div>

            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
              <select
                value={hubTargetScope}
                onChange={e => handleSelectHubTargetScope(e.target.value)}
                className="bg-slate-900/90 text-white text-xs font-bold rounded-lg px-3 py-2 border border-white/20 outline-none focus:border-amber-400 cursor-pointer md:w-56 shrink-0"
              >
                <option value="__global__">🌐 套用對象：全體主管通用起點</option>
                {report.managersReport.map(m => (
                  <option key={`hub-opt-${m.managerName}`} value={m.managerName}>
                    👤 專屬起點：{m.managerName}（{m.region}）
                  </option>
                ))}
              </select>

              <div className="flex-1 relative">
                <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-300 pointer-events-none" />
                <input
                  type="text"
                  value={addressInput}
                  onChange={e => setAddressInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleApplyStartAddress();
                    }
                  }}
                  placeholder="輸入起始點地址（例：新北市板橋區文化路一段188號、桃園中壢火車站、或門市名稱）..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-900/90 text-white placeholder-indigo-300/60 text-xs sm:text-sm font-medium rounded-lg border border-white/20 outline-none focus:border-amber-400"
                />
              </div>

              <button
                type="button"
                onClick={() => handleApplyStartAddress()}
                disabled={isGeocoding}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer transition-colors shrink-0 shadow-xs"
              >
                {isGeocoding ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>定位計算中...</span>
                  </>
                ) : (
                  <>
                    <Navigation size={14} />
                    <span>定位並重算車資</span>
                  </>
                )}
              </button>
            </div>

            {/* 定位狀態即時回饋 */}
            {geocodeStatus && (
              <div
                className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border ${
                  geocodeStatus.type === 'success'
                    ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                    : 'bg-rose-500/20 border-rose-400/40 text-rose-200'
                }`}
              >
                {geocodeStatus.type === 'success' ? '✅ ' : '⚠️ '}
                {geocodeStatus.text}
              </div>
            )}

            {/* 已生效的自訂起始點列表（一鍵清除可恢復預設區域中心） */}
            {(customHubs.global || Object.keys(customHubs.byManager).length > 0) && (
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[11px] font-bold text-indigo-200">已套用自訂起點：</span>
                {customHubs.global && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-300/50 text-amber-200 text-[11px] font-bold">
                    <span>🌐 全體通用：{customHubs.global.address}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomHub('__global__')}
                      className="hover:text-white cursor-pointer"
                      title="移除全體通用起點"
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
                {Object.entries(customHubs.byManager).map(([mgrName, cfg]) => (
                  <span
                    key={`chip-${mgrName}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-400/20 border border-sky-300/50 text-sky-100 text-[11px] font-bold"
                  >
                    <span>👤 {mgrName}：{cfg.address}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomHub(mgrName)}
                      className="hover:text-white cursor-pointer"
                      title={`移除 ${mgrName} 專屬起點`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 四大費用指標總覽卡（當天推算 vs 每月加總） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* 卡片 1：當天推算總費用 */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-2xs border-t-4 border-t-blue-600">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-extrabold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
              📅 當天推算費用 ({targetDateStr.slice(5).replace('-', '/')})
            </span>
            <span className="text-xs font-bold text-gray-400">@{ratePerKm}元/km</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-blue-700 tracking-tight tabular-nums my-1">
            {formatCurrency(report.dayTotalSubsidy)}
          </div>
          <div className="text-xs text-gray-600 font-semibold flex items-center justify-between pt-2 border-t border-gray-100">
            <span>當日總里程：<strong className="text-gray-900">{report.dayTotalKm.toFixed(1)} km</strong></span>
            <span>{report.dayActiveManagers} 位主管 · {report.dayTotalVisits} 店次</span>
          </div>
        </div>

        {/* 卡片 2：當月車程費用加總 */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-2xs border-t-4 border-t-emerald-600">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
              🗓️ 每月車程費用加總 ({targetMonthKey})
            </span>
            <span className="text-xs font-bold text-gray-400">全月累計</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-700 tracking-tight tabular-nums my-1">
            {formatCurrency(report.monthTotalSubsidy)}
          </div>
          <div className="text-xs text-gray-600 font-semibold flex items-center justify-between pt-2 border-t border-gray-100">
            <span>當月總里程：<strong className="text-gray-900">{report.monthTotalKm.toFixed(1)} km</strong></span>
            <span>{report.monthTotalActiveDays} 出勤人日 · {report.monthTotalVisits} 店次</span>
          </div>
        </div>

        {/* 卡片 3：平均每位出勤主管月車資 & 日均里程 */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-2xs border-t-4 border-t-amber-500">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-extrabold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
              🚗 出勤日均里程與車資
            </span>
            <span className="text-xs font-bold text-gray-400">{targetMonthKey} 均值</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-600 tracking-tight tabular-nums my-1">
            {report.monthTotalActiveDays > 0
              ? `${(report.monthTotalKm / report.monthTotalActiveDays).toFixed(1)} km / 日`
              : '0.0 km / 日'}
          </div>
          <div className="text-xs text-gray-600 font-semibold flex items-center justify-between pt-2 border-t border-gray-100">
            <span>
              日均車資：
              <strong className="text-gray-900">
                {report.monthTotalActiveDays > 0
                  ? formatCurrency(report.monthTotalSubsidy / report.monthTotalActiveDays)
                  : 'NT$ 0'}
              </strong>
            </span>
            <span>
              單店平均：
              {report.monthTotalVisits > 0
                ? formatCurrency(report.monthTotalSubsidy / report.monthTotalVisits)
                : 'NT$ 0'}
            </span>
          </div>
        </div>

        {/* 卡片 4：目前戰情牆所選區間總計 */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-2xs border-t-4 border-t-purple-600">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-extrabold text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-0.5 rounded-full">
              🔍 戰情牆目前篩選區間合計
            </span>
            <span className="text-xs font-bold text-gray-400">連動頂部篩選</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-purple-700 tracking-tight tabular-nums my-1">
            {formatCurrency(report.periodTotalSubsidy)}
          </div>
          <div className="text-xs text-gray-600 font-semibold flex items-center justify-between pt-2 border-t border-gray-100">
            <span>區間總里程：<strong className="text-gray-900">{report.periodTotalKm.toFixed(1)} km</strong></span>
            <span>區間巡視 {report.periodTotalVisits} 店次</span>
          </div>
        </div>
      </div>

      {/* 各區主管費用總表（每一位區主管的當天推算費用 ＋ 每月車程費用加總） */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 shadow-xs flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-gray-900 flex items-center gap-2">
              <span>👥 每一位區主管巡店里程與車資補助總表</span>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                共 {visibleManagers.length} 位主管
              </span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              同時呈現每位區主管之「指定當日（{targetDateStr}）推算費用」與「{targetMonthKey} 整月車程費用加總」；點擊任一主管可展開每日行車路線與分段公里數明細
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <label className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={onlyShowActive}
                onChange={e => setOnlyShowActive(e.target.checked)}
                className="rounded text-blue-600 cursor-pointer"
              />
              <span>僅顯示有出勤紀錄主管</span>
            </label>

            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="搜尋區主管或區域..."
                className="pl-8 pr-7 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => setKeyword('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 分區快選膠囊列 */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1 mr-0.5">
            <MapPin size={12} className="text-blue-600" />
            分區篩選：
          </span>
          <button
            type="button"
            onClick={() => setSelectedRegion(ALL_REGIONS)}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
              selectedRegion === ALL_REGIONS
                ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50'
            }`}
          >
            {ALL_REGIONS} ({report.managersReport.length})
          </button>
          {regionOptions.map(r => {
            const active = selectedRegion === r.region;
            return (
              <button
                key={r.region}
                type="button"
                onClick={() => setSelectedRegion(active ? ALL_REGIONS : r.region)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50'
                }`}
              >
                {r.region} ({r.count})
              </button>
            );
          })}
        </div>

        {/* 每位區主管卡片／明細列 */}
        <div className="flex flex-col gap-3">
          {visibleManagers.map(m => {
            const isExpanded = expandedManager === m.managerName;
            return (
              <div
                key={m.managerName}
                className={`rounded-2xl border transition-all overflow-hidden ${
                  isExpanded
                    ? 'border-blue-400 bg-blue-50/20 shadow-md'
                    : 'border-gray-200 bg-white hover:border-blue-300 shadow-2xs'
                }`}
              >
                {/* 主管摘要列 */}
                <div
                  onClick={() => setExpandedManager(isExpanded ? null : m.managerName)}
                  className="p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 cursor-pointer"
                >
                  {/* 左側：主管身分與轄區資訊 */}
                  <div className="flex items-center gap-3 min-w-[220px]">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white font-extrabold text-sm flex items-center justify-center shrink-0 shadow-xs">
                      {m.managerName.slice(0, 1)}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-base font-extrabold text-gray-900">{m.managerName}</span>
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                            m.roleLabel === '副區主管'
                              ? 'bg-sky-50 text-sky-700 border-sky-200'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          }`}
                        >
                          {m.roleLabel}
                        </span>
                        <span className="text-xs font-extrabold px-2 py-0.5 rounded-md bg-blue-600 text-white">
                          📍 {m.region}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 font-medium">
                        {m.department || '營運處'} · 轄下負責 {m.assignedStoreCount} 間門市
                      </div>
                      {(customHubs.byManager[m.managerName] || customHubs.global) && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">
                          <Home size={10} />
                          <span>
                            出發起點：{(customHubs.byManager[m.managerName] || customHubs.global)?.address}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 中間：當天推算費用 vs 當月累計費用 雙欄並列 */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-1">
                    {/* 1. 當天推算費用 */}
                    <div
                      className={`rounded-xl p-3 border flex items-center justify-between gap-2 ${
                        m.dayKm > 0
                          ? 'bg-blue-50/70 border-blue-200'
                          : 'bg-gray-50 border-gray-200/80 opacity-80'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-blue-800 flex items-center gap-1">
                          <span>📅 當天推算 ({targetDateStr.slice(5).replace('-', '/')})</span>
                        </div>
                        <div className="text-xs text-gray-600 font-semibold mt-0.5 truncate">
                          {m.dayKm > 0 ? (
                            <>
                              行駛 <strong className="text-blue-700">{m.dayKm.toFixed(1)} km</strong> · 巡視{' '}
                              {m.dayVisitCount} 店
                              {m.dayScheduleCount > 0 ? ` + 公務 ${m.dayScheduleCount}` : ''}
                            </>
                          ) : (
                            <span className="text-gray-400">當日無巡店里程紀錄</span>
                          )}
                        </div>
                        {m.dayRoute && m.dayRoute.visitedStores.length > 0 && (
                          <div className="text-[11px] text-blue-700 font-semibold mt-0.5 truncate">
                            路線：{m.dayRoute.visitedStores.join(' ➔ ')}
                          </div>
                        )}
                        {onOpenRouteMap && m.dayRoute && m.dayRoute.visitedStores.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenRouteMap(m.managerName, targetDateStr);
                            }}
                            className="mt-1.5 text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-white border border-blue-200 px-2 py-0.5 rounded shadow-2xs hover:bg-blue-50 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <span>🗺️ 地圖路徑與最佳化</span>
                          </button>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`text-lg font-black tabular-nums ${
                            m.daySubsidy > 0 ? 'text-blue-700' : 'text-gray-400'
                          }`}
                        >
                          {formatCurrency(m.daySubsidy)}
                        </div>
                        <div className="text-[10px] text-gray-500 font-semibold">當日車資</div>
                      </div>
                    </div>

                    {/* 2. 每月車程費用加總 */}
                    <div
                      className={`rounded-xl p-3 border flex items-center justify-between gap-2 ${
                        m.monthKm > 0
                          ? 'bg-emerald-50/70 border-emerald-200'
                          : 'bg-gray-50 border-gray-200/80 opacity-80'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-emerald-800 flex items-center gap-1">
                          <span>🗓️ {targetMonthKey.slice(5)}月累計加總</span>
                        </div>
                        <div className="text-xs text-gray-600 font-semibold mt-0.5">
                          {m.monthKm > 0 ? (
                            <>
                              累計 <strong className="text-emerald-700">{m.monthKm.toFixed(1)} km</strong> · 出勤{' '}
                              {m.monthActiveDays} 天 / {m.monthVisitCount} 店次
                            </>
                          ) : (
                            <span className="text-gray-400">本月尚無出勤里程紀錄</span>
                          )}
                        </div>
                        {m.monthActiveDays > 0 && (
                          <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                            日均 {(m.monthKm / m.monthActiveDays).toFixed(1)} km · 日均車資{' '}
                            {formatCurrency(m.monthSubsidy / m.monthActiveDays)}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`text-lg font-black tabular-nums ${
                            m.monthSubsidy > 0 ? 'text-emerald-700' : 'text-gray-400'
                          }`}
                        >
                          {formatCurrency(m.monthSubsidy)}
                        </div>
                        <div className="text-[10px] text-gray-500 font-semibold">當月加總</div>
                      </div>
                    </div>
                  </div>

                  {/* 右側：產生報核單、設定起點與展開每日明細按鈕 */}
                  <div className="flex items-center justify-end gap-1.5 flex-wrap shrink-0">
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setReimbursementModal({
                          open: true,
                          managerName: m.managerName,
                          scope: 'month',
                        });
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-extrabold bg-amber-50 hover:bg-amber-400 text-amber-900 hover:text-slate-950 border border-amber-300 transition-colors cursor-pointer"
                      title={`開啟 ${m.managerName} 的《國內出差旅費報核單》（自動連動本月路線與公里數）`}
                    >
                      <FileSpreadsheet size={13} />
                      <span>報核單</span>
                    </button>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        handleSelectHubTargetScope(m.managerName);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 transition-colors cursor-pointer"
                      title={`為 ${m.managerName} 設定專屬起始點地址`}
                    >
                      <Home size={13} />
                      <span>設起點</span>
                    </button>
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-blue-100 text-gray-700 hover:text-blue-700 transition-colors">
                      <span>{isExpanded ? '收合路線明細' : `明細 (${m.monthDailyRoutes.length}日)`}</span>
                      {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </span>
                  </div>
                </div>

                {/* 展開區塊：該區主管當日＆當月每一天之詳細路線與分段車程 */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 bg-slate-50 border-t border-gray-200 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-extrabold text-slate-700">
                        🛣️ {m.managerName}（{m.region}）— {targetMonthKey} 每日巡店行車軌跡與分段車資試算（每公里補助{' '}
                        {ratePerKm} 元）
                      </span>
                      <span className="text-xs text-blue-600 font-semibold">
                        點擊路線中之門市名稱可直接跳轉至巡店報告
                      </span>
                    </div>

                    {m.monthDailyRoutes.length === 0 ? (
                      <div className="text-center py-6 text-xs text-gray-400 bg-white rounded-xl border border-dashed border-gray-200">
                        {m.managerName} 於 {targetMonthKey} 尚無巡店或公務行程紀錄
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        {m.monthDailyRoutes.map(route => (
                          <RouteLegTimeline
                            key={route.dateStr}
                            route={route}
                            onStoreSelect={onStoreSelect}
                            onOpenRouteMap={onOpenRouteMap}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 《東森寵物雲股份有限公司 國內出差旅費報核單》雙向連動彈窗 */}
      {reimbursementModal.open && (
        <Suspense fallback={null}>
          <TravelExpenseReimbursementModal
            isOpen={reimbursementModal.open}
            onClose={() => setReimbursementModal(prev => ({ ...prev, open: false }))}
            managersReport={report.managersReport}
            initialManagerName={reimbursementModal.managerName}
            targetMonthKey={targetMonthKey}
            targetDateStr={targetDateStr}
            initialRatePerKm={ratePerKm}
            initialScope={reimbursementModal.scope}
          />
        </Suspense>
      )}
    </div>
  );
};

