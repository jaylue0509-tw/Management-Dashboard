import React, { useEffect, useMemo, useState } from 'react';
import type { Manager, VisitRecord } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { getTaipeiDateStr, formatTaipeiReportTime, getTaipeiTodayStr, shiftDateStr } from '../utils/time-utils';
import { normalizeStoreName } from '../utils/store-region';
import { getStoreGeoPoint, getRegionHubPoint, HEADQUARTERS_POINT } from '../data/storeCoordinates';
import { optimizeDailyRoute, type RouteStop } from '../utils/route-optimizer';
import { DEFAULT_SUBSIDY_PER_KM } from '../utils/mileage-calculator';
import { RouteMap } from './RouteMap';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Eye,
  TrendingDown,
  Sparkles,
  CheckCircle2,
  Clock,
  Compass,
  ArrowRight,
} from 'lucide-react';

interface Props {
  allActivities: VisitRecord[];
  managers: Manager[];
  selectedDepartment?: string;
  initialDateStr?: string;
  initialManagerName?: string;
  onJumpToActivity?: (storeName: string, recordId?: string) => void;
}

type RouteViewMode = 'actual' | 'optimal';

const SCHEDULE_TYPES = new Set(['總部行程', '會議行程', '特殊行程']);
const ACTUAL_COLOR = '#2563eb';
const OPTIMAL_COLOR = '#059669';
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 將活動紀錄轉為地圖站點（同日連續同店去重）
 */
const buildStops = (acts: VisitRecord[], region: string): RouteStop[] => {
  const sorted = [...acts].sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  );
  const stops: RouteStop[] = [];
  for (const act of sorted) {
    const isSched = SCHEDULE_TYPES.has(act.actionType);
    const prev = stops[stops.length - 1];
    if (prev && !isSched && !prev.isSchedule && normalizeStoreName(prev.storeName) === normalizeStoreName(act.storeName)) {
      continue;
    }
    const geoPoint = (() => {
      if (act.actionType === '總部行程') return HEADQUARTERS_POINT;
      if (isSched) {
        const text = `${act.storeName || ''} ${act.highlightDescription || ''}`;
        if (text.includes('總部')) return HEADQUARTERS_POINT;
        return getRegionHubPoint(region);
      }
      return getStoreGeoPoint(act.storeName, region);
    })();

    // 格式化顯示名稱：若是特殊行程且有內容，顯示行程內容
    const displayLabel = isSched
      ? act.highlightDescription ? `${act.actionType}：${act.highlightDescription}` : act.actionType
      : act.storeName || '未註記門市';

    stops.push({
      id: act.recordId || `stop-${stops.length}`,
      storeName: displayLabel,
      label: displayLabel,
      geoPoint,
      visitTime: formatTaipeiReportTime(act.createdAt).split(' ')[1] || '',
      actionType: act.actionType,
      recordId: act.recordId,
      overallRating: act.overallRating,
      abnormalFlag: act.abnormalFlag,
      highlightDescription: act.highlightDescription || act.immediateImprovement,
      orderIndex: stops.length + 1,
      isSchedule: isSched,
    });
  }
  return stops;
};

/**
 * 現代化旗艦級巡店路徑地圖與車程最佳化面板
 */
export const AuditRouteMapPanel: React.FC<Props> = ({
  allActivities,
  managers,
  selectedDepartment = 'all',
  initialDateStr,
  initialManagerName,
  onJumpToActivity,
}) => {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState<string>(initialDateStr || getTaipeiTodayStr());
  const [selectedManagerName, setSelectedManagerName] = useState<string>(initialManagerName || '');
  const [viewMode, setViewMode] = useState<RouteViewMode>('actual');
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  // 外部跳轉帶入的主管／日期同步
  useEffect(() => {
    if (initialManagerName) setSelectedManagerName(initialManagerName);
  }, [initialManagerName]);
  useEffect(() => {
    if (initialDateStr) setSelectedDate(initialDateStr);
  }, [initialDateStr]);

  // 切換主管或日期時自動回到實際路線模式
  useEffect(() => {
    setViewMode('actual');
    setSelectedStopId(null);
  }, [selectedManagerName, selectedDate]);

  // 主管名單與區域映射
  const managerRegionMap = useMemo(() => {
    const isAllDept = !selectedDepartment || selectedDepartment === 'all' || selectedDepartment === '全部處別';
    const keyword = isAllDept ? '' : selectedDepartment.replace('營業', '');
    const map = new Map<string, string>();
    for (const m of managers) {
      if (!m.areaManagerName) continue;
      if (user?.role === 'manager' && m.areaManagerName !== user.name) continue;
      if (keyword && !(m.department || '').includes(keyword)) continue;
      if (!map.has(m.areaManagerName)) map.set(m.areaManagerName, m.region);
    }
    return map;
  }, [managers, selectedDepartment, user]);

  const dayActivities = useMemo(
    () => allActivities.filter(a => getTaipeiDateStr(a.createdAt) === selectedDate),
    [allActivities, selectedDate]
  );

  // 當日有出勤紀錄的主管清單
  const activeManagers = useMemo(() => {
    const counter = new Map<string, { count: number; stores: string[] }>();
    for (const act of dayActivities) {
      if (act.areaManagerName && managerRegionMap.has(act.areaManagerName)) {
        const item = counter.get(act.areaManagerName) || { count: 0, stores: [] };
        item.count++;
        if (act.storeName && !item.stores.includes(act.storeName)) item.stores.push(act.storeName);
        counter.set(act.areaManagerName, item);
      }
    }
    return Array.from(counter.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        storeCount: data.stores.length,
        region: managerRegionMap.get(name) || '',
      }))
      .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region, 'zh-TW'));
  }, [dayActivities, managerRegionMap]);

  const currentManagerName = activeManagers.some(m => m.name === selectedManagerName)
    ? selectedManagerName
    : activeManagers[0]?.name || '';
  const currentRegion = managerRegionMap.get(currentManagerName) || '新北區';

  // 最佳化分析引擎
  const analysis = useMemo(() => {
    const acts = dayActivities.filter(a => a.areaManagerName === currentManagerName);
    const stops = buildStops(acts, currentRegion);
    return optimizeDailyRoute(currentManagerName, currentRegion, selectedDate, stops, DEFAULT_SUBSIDY_PER_KM);
  }, [dayActivities, currentManagerName, currentRegion, selectedDate]);

  const canOptimize = analysis.actualStops.length > 1 && !analysis.isAlreadyOptimal;
  const isOptimalView = viewMode === 'optimal' && canOptimize;
  const shownStops = isOptimalView ? analysis.optimalStops : analysis.actualStops;
  const shownLegs = isOptimalView ? analysis.optimalLegs : analysis.actualLegs;
  const shownKm = isOptimalView ? analysis.optimalTotalKm : analysis.actualTotalKm;
  const shownCost = isOptimalView ? analysis.optimalTotalCost : analysis.actualTotalCost;
  const routeColor = isOptimalView ? OPTIMAL_COLOR : ACTUAL_COLOR;

  const actualOrderById = useMemo(() => {
    const map = new Map<string, number>();
    analysis.actualStops.forEach(s => map.set(s.id, s.orderIndex));
    return map;
  }, [analysis.actualStops]);

  const todayStr = getTaipeiTodayStr();
  const weekday = WEEKDAYS[new Date(`${selectedDate}T00:00:00+08:00`).getDay()];

  return (
    <div className="space-y-4">
      {/* 頂部操作與篩選導航欄 */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        {/* 左側：日期切換群 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 gap-1">
            <button
              type="button"
              onClick={() => setSelectedDate(d => shiftDateStr(d, -1))}
              className="p-1.5 rounded-lg hover:bg-slate-200/70 text-slate-700 transition-colors cursor-pointer"
              title="前一天"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center gap-1.5 px-2">
              <Calendar size={15} className="text-blue-600" />
              <input
                type="date"
                value={selectedDate}
                max={todayStr}
                onChange={e => e.target.value && setSelectedDate(e.target.value)}
                className="text-xs sm:text-sm font-extrabold text-slate-800 bg-transparent outline-none cursor-pointer"
              />
              <span className="text-xs font-bold text-slate-500">（週{weekday}）</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDate(d => shiftDateStr(d, 1))}
              disabled={selectedDate >= todayStr}
              className="p-1.5 rounded-lg hover:bg-slate-200/70 text-slate-700 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="後一天"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {selectedDate !== todayStr && (
            <button
              type="button"
              onClick={() => setSelectedDate(todayStr)}
              className="text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
            >
              回到今日
            </button>
          )}
        </div>

        {/* 右側：統計摘要徽章 */}
        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-500 font-medium">
            當日巡店主管：<strong className="text-slate-900 font-extrabold text-sm">{activeManagers.length}</strong> 位
          </div>
          <div className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-bold border border-slate-200">
            汽油補助核算標準：${DEFAULT_SUBSIDY_PER_KM} 元/km
          </div>
        </div>
      </div>

      {activeManagers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 py-20 text-center shadow-xs">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-2xl text-slate-400">
            <Compass size={32} />
          </div>
          <h3 className="text-base font-bold text-slate-800">{selectedDate} 尚無任何門市巡店或行程打卡</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            您可以透過上方箭頭切換至昨日或更早的日期，檢視過往巡店路線與最佳化軌跡。
          </p>
        </div>
      ) : (
        <>
          {/* 主管快捷切換膠囊橫列 */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
            {activeManagers.map(m => {
              const active = m.name === currentManagerName;
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => setSelectedManagerName(m.name)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all shrink-0 flex items-center gap-2 cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-500/20'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50/50'
                  }`}
                >
                  <span className="text-sm font-extrabold">{m.name}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {m.region}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-extrabold ${
                      active ? 'bg-amber-400 text-slate-950' : 'bg-blue-50 text-blue-700 border border-blue-200'
                    }`}
                  >
                    {m.count} 站
                  </span>
                </button>
              );
            })}
          </div>

          {/* 核心決策橫幅：最佳化分析效益與路徑切換 */}
          <div
            className={`rounded-2xl border p-4.5 shadow-xs transition-all ${
              canOptimize
                ? 'bg-gradient-to-r from-amber-500/10 via-amber-50/60 to-white border-amber-300'
                : 'bg-gradient-to-r from-emerald-500/10 via-emerald-50/60 to-white border-emerald-300'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* 左側：分析結論與效益指標 */}
              <div className="space-y-1.5 min-w-[280px]">
                <div className="flex items-center gap-2">
                  <span
                    className={`p-1.5 rounded-xl ${
                      canOptimize ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {canOptimize ? <TrendingDown size={18} /> : <CheckCircle2 size={18} />}
                  </span>
                  <h3 className="text-base font-extrabold text-slate-900">
                    {analysis.actualStops.length <= 1
                      ? `${currentManagerName} 當日僅單一站點，路徑已是最短直達`
                      : canOptimize
                      ? `發現最佳化巡店順序：預估可省下 ${analysis.savedKm} km 車程！`
                      : `${currentManagerName} 當日巡店順序已達最優路線，無繞路折返`}
                  </h3>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-600 flex-wrap pl-8">
                  <span>
                    實際路線：<strong>{analysis.actualTotalKm} km</strong>（預估車資{' '}
                    <strong className="text-blue-700">${analysis.actualTotalCost}</strong> 元）
                  </span>
                  {canOptimize && (
                    <>
                      <ArrowRight size={13} className="text-slate-400" />
                      <span className="text-emerald-800 font-bold">
                        最佳化路線：<strong>{analysis.optimalTotalKm} km</strong>（車資{' '}
                        <strong>${analysis.optimalTotalCost}</strong> 元）
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 font-extrabold text-[11px] border border-amber-200">
                        省 ${analysis.savedCost} 元 · 約省 {analysis.savedMinutes} 分鐘車程
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* 右側：實際走法 vs 建議走法 Tab 切換按鈕 */}
              {canOptimize && (
                <div className="inline-flex rounded-xl bg-white border border-slate-200 p-1 shadow-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode('actual')}
                    className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                      !isOptimalView
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    實際走法路線
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('optimal')}
                    className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      isOptimalView
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    <Sparkles size={13} />
                    <span>建議最優路線</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 主畫面：左側無水印真實街道地圖 (7 Cols) + 右側巡店時間軸 (5 Cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* 左側真實街道地圖 */}
            <div className="lg:col-span-7 space-y-2">
              <RouteMap
                stops={shownStops}
                legs={shownLegs}
                hubPoint={analysis.hubPoint}
                color={routeColor}
                selectedStopId={selectedStopId}
                onSelectStop={setSelectedStopId}
                height={580}
              />
              <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                <span>※ 點擊地圖上的站點 Pin 或右側清單可切換檢視；支援滑鼠拖曳與滾輪自由縮放。</span>
                <span>當前視圖：{isOptimalView ? '建議最優路徑' : '實際巡店軌跡'}</span>
              </div>
            </div>

            {/* 右側巡店順序時間軸 */}
            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
              <div
                className="px-4 py-3 border-b flex items-center justify-between"
                style={{
                  background: isOptimalView ? '#ecfdf5' : '#eff6ff',
                  borderColor: isOptimalView ? '#a7f3d0' : '#bfdbfe',
                }}
              >
                <div>
                  <h4 className="text-sm font-extrabold" style={{ color: routeColor }}>
                    {isOptimalView ? '💡 建議最佳巡店順序' : '🚗 當日實際巡店明細'}
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    共 {shownStops.length} 站 · 總里程 {shownKm} km · 車資 ${shownCost}
                  </p>
                </div>

                {isOptimalView && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                    推薦順序
                  </span>
                )}
              </div>

              <div className="p-4 overflow-y-auto max-h-[500px] space-y-3.5">
                {/* 1. 出發基地 */}
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-amber-400 text-slate-900 text-xs font-black flex items-center justify-center shrink-0 shadow-xs mt-0.5">
                    ★
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-extrabold text-slate-800 block">
                      出發起點：{analysis.hubPoint.label}
                    </span>
                    <span className="text-[11px] text-slate-400">區域巡查出發基地</span>
                  </div>
                </div>

                {/* 2. 各站順序清單 */}
                {shownStops.map((stop, idx) => {
                  const leg = shownLegs[idx];
                  const isSelected = selectedStopId === stop.id;
                  const originalOrder = actualOrderById.get(stop.id);
                  const moved = isOptimalView && originalOrder !== stop.orderIndex;

                  return (
                    <div key={stop.id} className="space-y-2">
                      {/* 兩站之間的行駛里程指示線 */}
                      {leg && (
                        <div className="flex items-center gap-2 pl-3.5 py-0.5 text-[11px] text-slate-400 font-semibold">
                          <div className="w-0.5 h-4 bg-slate-200" />
                          <span>開車約 {leg.distanceKm} km（補助 ${leg.subsidyCost} 元）</span>
                        </div>
                      )}

                      {/* 站點卡片 */}
                      <div
                        onClick={() => setSelectedStopId(isSelected ? null : stop.id)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-blue-50/80 border-blue-400 shadow-xs ring-1 ring-blue-300'
                            : 'bg-slate-50/70 border-slate-200/90 hover:bg-slate-100/80'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span
                              className="w-6 h-6 rounded-full text-white font-extrabold text-xs flex items-center justify-center shrink-0 mt-0.5 shadow-2xs"
                              style={{ background: stop.abnormalFlag ? '#dc2626' : routeColor }}
                            >
                              {stop.orderIndex}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-extrabold text-slate-900">{stop.storeName}</span>
                                {stop.overallRating && !stop.isSchedule && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-200/80 text-slate-700">
                                    {stop.overallRating}
                                  </span>
                                )}
                                {stop.abnormalFlag && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-700">
                                    異常
                                  </span>
                                )}
                              </div>

                              <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                                {stop.visitTime && (
                                  <span className="flex items-center gap-1">
                                    <Clock size={11} className="text-slate-400" />
                                    <span>{stop.visitTime} 到店</span>
                                  </span>
                                )}
                                {isOptimalView && (
                                  <span className={moved ? 'text-amber-700 font-bold' : 'text-slate-400'}>
                                    {moved ? `（原本為第 ${originalOrder} 站）` : '（順序不變）'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 查看完整巡檢報告捷徑 */}
                          {onJumpToActivity && stop.recordId && !stop.isSchedule && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                onJumpToActivity(stop.storeName, stop.recordId);
                              }}
                              className="text-[11px] font-bold text-blue-600 hover:text-blue-800 bg-white border border-blue-200 px-2 py-1 rounded-md shadow-2xs hover:bg-blue-50 transition-colors shrink-0 flex items-center gap-1 cursor-pointer"
                            >
                              <Eye size={12} />
                              <span>報告</span>
                            </button>
                          )}
                        </div>

                        {/* 重點備註 */}
                        {stop.highlightDescription && (
                          <p className="text-[11px] text-slate-600 mt-2 bg-white/90 p-2 rounded-lg border border-slate-200/80 leading-relaxed">
                            {stop.highlightDescription}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* 3. 返回基地 */}
                {shownLegs[shownLegs.length - 1]?.isReturnLeg && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-2 pl-3.5 py-0.5 text-[11px] text-slate-400 font-semibold">
                      <div className="w-0.5 h-4 bg-slate-200" />
                      <span>
                        返程開車約 {shownLegs[shownLegs.length - 1].distanceKm} km（補助 $
                        {shownLegs[shownLegs.length - 1].subsidyCost} 元）
                      </span>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-full bg-slate-300 text-slate-700 text-xs font-black flex items-center justify-center shrink-0">
                        🏠
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-extrabold text-slate-700 block">
                          返程：{analysis.hubPoint.label}
                        </span>
                        <span className="text-[11px] text-slate-400">當日巡店行程圓滿完成</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
