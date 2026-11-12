import React, { useEffect, useMemo, useState } from 'react';
import type { Manager, VisitRecord } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { getTaipeiDateStr, formatTaipeiReportTime, getTaipeiTodayStr, shiftDateStr } from '../utils/time-utils';
import { normalizeStoreName } from '../utils/store-region';
import { getStoreGeoPoint, getRegionHubPoint, HEADQUARTERS_POINT } from '../data/storeCoordinates';
import { optimizeDailyRoute, type RouteStop } from '../utils/route-optimizer';
import { DEFAULT_SUBSIDY_PER_KM } from '../utils/mileage-calculator';
import { RouteMap } from './RouteMap';
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react';

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
    stops.push({
      id: act.recordId || `stop-${stops.length}`,
      storeName: isSched ? act.actionType : act.storeName || '未註記門市',
      label: act.storeName,
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
 * 巡店路徑地圖：一眼看出主管當天去了哪裡、怎麼走、能不能走得更順
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

  // 外部跳轉帶入的主管／日期需同步
  useEffect(() => {
    if (initialManagerName) setSelectedManagerName(initialManagerName);
  }, [initialManagerName]);
  useEffect(() => {
    if (initialDateStr) setSelectedDate(initialDateStr);
  }, [initialDateStr]);

  // 切換主管或日期時回到實際路線，避免使用者誤以為建議路線是實際行程
  useEffect(() => {
    setViewMode('actual');
    setSelectedStopId(null);
  }, [selectedManagerName, selectedDate]);

  // 主管名單：區主管只看自己；總部依處別篩選
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

  // 只列出當日「有出勤紀錄」的主管，依站數多寡排序
  const activeManagers = useMemo(() => {
    const counter = new Map<string, number>();
    for (const act of dayActivities) {
      if (act.areaManagerName && managerRegionMap.has(act.areaManagerName)) {
        counter.set(act.areaManagerName, (counter.get(act.areaManagerName) || 0) + 1);
      }
    }
    return Array.from(counter.entries())
      .map(([name, count]) => ({ name, count, region: managerRegionMap.get(name) || '' }))
      .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region, 'zh-TW'));
  }, [dayActivities, managerRegionMap]);

  const currentManagerName = activeManagers.some(m => m.name === selectedManagerName)
    ? selectedManagerName
    : activeManagers[0]?.name || '';
  const currentRegion = managerRegionMap.get(currentManagerName) || '新北區';

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
    <div className="space-y-3">
      {/* 第一列：日期 */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedDate(d => shiftDateStr(d, -1))}
          className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 cursor-pointer"
          title="前一天"
        >
          <ChevronLeft size={16} />
        </button>
        <input
          type="date"
          value={selectedDate}
          max={todayStr}
          onChange={e => e.target.value && setSelectedDate(e.target.value)}
          className="text-sm font-bold text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        />
        <span className="text-sm text-slate-500 font-semibold">（週{weekday}）</span>
        <button
          type="button"
          onClick={() => setSelectedDate(d => shiftDateStr(d, 1))}
          disabled={selectedDate >= todayStr}
          className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          title="後一天"
        >
          <ChevronRight size={16} />
        </button>
        {selectedDate !== todayStr && (
          <button
            type="button"
            onClick={() => setSelectedDate(todayStr)}
            className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg cursor-pointer"
          >
            回到今天
          </button>
        )}
        <span className="ml-auto text-xs text-slate-500">
          當天有出勤紀錄：<strong className="text-slate-800">{activeManagers.length}</strong> 位主管
        </span>
      </div>

      {/* 第二列：選擇主管（只顯示當天有紀錄者） */}
      {activeManagers.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 py-16 text-center">
          <div className="text-3xl mb-2">🗺️</div>
          <p className="text-sm font-bold text-slate-700">{selectedDate} 沒有任何巡店或行程紀錄</p>
          <p className="text-xs text-slate-500 mt-1">請用上方箭頭切換到其他日期</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {activeManagers.map(m => {
              const active = m.name === currentManagerName;
              return (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => setSelectedManagerName(m.name)}
                  className={`shrink-0 px-3.5 py-2 rounded-xl border text-sm font-bold transition-colors cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}
                >
                  {m.name}
                  <span className={`ml-1.5 text-xs font-semibold ${active ? 'text-blue-100' : 'text-slate-400'}`}>
                    {m.region}・{m.count} 站
                  </span>
                </button>
              );
            })}
          </div>

          {/* 第三列：結論一句話 + 實際/建議切換 */}
          <div
            className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
              canOptimize ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'
            }`}
          >
            <div className="min-w-0">
              <p className="text-base font-extrabold text-slate-900">
                {analysis.actualStops.length <= 1
                  ? `✅ ${currentManagerName} 當天只有 1 站，無需調整順序`
                  : canOptimize
                    ? `💡 換個順序走，可少開 ${analysis.savedKm} 公里（省 $${analysis.savedCost}、約 ${analysis.savedMinutes} 分鐘）`
                    : `✅ ${currentManagerName} 當天的巡店順序已經很順，沒有繞路`}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                實際共 <strong>{analysis.actualStops.length}</strong> 站・推估
                <strong> {analysis.actualTotalKm} km</strong>・車資
                <strong> ${analysis.actualTotalCost}</strong>
                {canOptimize && (
                  <>
                    {' '}→ 建議路線 <strong className="text-emerald-700">{analysis.optimalTotalKm} km</strong>・
                    <strong className="text-emerald-700">${analysis.optimalTotalCost}</strong>
                  </>
                )}
              </p>
            </div>

            {canOptimize && (
              <div className="inline-flex rounded-lg bg-white border border-slate-200 p-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('actual')}
                  className={`px-3.5 py-1.5 rounded-md text-sm font-bold transition-colors cursor-pointer ${
                    !isOptimalView ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  實際走法
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('optimal')}
                  className={`px-3.5 py-1.5 rounded-md text-sm font-bold transition-colors cursor-pointer ${
                    isOptimalView ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  建議走法
                </button>
              </div>
            )}
          </div>

          {/* 第四列：地圖 + 站點清單 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
            <div className="lg:col-span-2">
              <RouteMap
                stops={shownStops}
                legs={shownLegs}
                hubPoint={analysis.hubPoint}
                color={routeColor}
                selectedStopId={selectedStopId}
                onSelectStop={setSelectedStopId}
              />
              <p className="text-[11px] text-slate-400 mt-1.5">
                ※ 線段為站點間直線示意；里程依道路係數推估，汽車每公里補助 ${DEFAULT_SUBSIDY_PER_KM} 元。可拖曳地圖、點數字查看站點。
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div
                className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between"
                style={{ background: isOptimalView ? '#ecfdf5' : '#eff6ff' }}
              >
                <span className="text-sm font-extrabold" style={{ color: routeColor }}>
                  {isOptimalView ? '建議走法' : '實際走法'}（{shownStops.length} 站）
                </span>
                <span className="text-xs font-bold text-slate-600">
                  {shownKm} km・${shownCost}
                </span>
              </div>

              <ol className="max-h-[470px] overflow-y-auto">
                {/* 出發點 */}
                <li className="px-4 py-2.5 flex items-center gap-3 text-sm text-slate-600 border-b border-slate-100">
                  <span className="w-7 h-7 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs shrink-0">🏠</span>
                  <span className="font-semibold">出發：{analysis.hubPoint.label}</span>
                </li>

                {shownStops.map((stop, idx) => {
                  const leg = shownLegs[idx];
                  const isSelected = selectedStopId === stop.id;
                  const originalOrder = actualOrderById.get(stop.id);
                  const moved = isOptimalView && originalOrder !== stop.orderIndex;
                  return (
                    <li key={stop.id} className="border-b border-slate-100">
                      {leg && (
                        <div className="pl-[30px] pr-4 py-0.5 text-[11px] text-slate-400">
                          ↓ 約 {leg.distanceKm} km
                        </div>
                      )}
                      <div
                        onClick={() => setSelectedStopId(isSelected ? null : stop.id)}
                        className={`px-4 py-2.5 flex items-start gap-3 cursor-pointer transition-colors ${
                          isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className="w-7 h-7 rounded-full text-white font-extrabold text-sm flex items-center justify-center shrink-0"
                          style={{ background: stop.abnormalFlag ? '#dc2626' : routeColor }}
                        >
                          {stop.orderIndex}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-bold text-slate-900">{stop.storeName}</span>
                            {stop.overallRating && !stop.isSchedule && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                {stop.overallRating}
                              </span>
                            )}
                            {stop.abnormalFlag && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">異常</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {isOptimalView
                              ? moved
                                ? `原本是第 ${originalOrder} 站`
                                : '順序不變'
                              : stop.visitTime
                                ? `${stop.visitTime} 回報`
                                : ''}
                          </div>
                          {isSelected && stop.highlightDescription && (
                            <p className="text-xs text-slate-600 mt-1.5 bg-white border border-slate-200 rounded-md p-2 leading-relaxed">
                              {stop.highlightDescription}
                            </p>
                          )}
                        </div>
                        {onJumpToActivity && stop.recordId && !stop.isSchedule && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              onJumpToActivity(stop.storeName, stop.recordId);
                            }}
                            className="shrink-0 text-xs font-bold text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-md flex items-center gap-1 cursor-pointer"
                            title="查看這筆巡店紀錄"
                          >
                            <Eye size={13} /> 紀錄
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}

                {/* 返程 */}
                {shownLegs[shownLegs.length - 1]?.isReturnLeg && (
                  <li className="px-4 py-2.5 flex items-center gap-3 text-sm text-slate-500">
                    <span className="w-7 h-7 rounded-full bg-slate-300 text-white flex items-center justify-center text-xs shrink-0">🏠</span>
                    <span>
                      返回：{analysis.hubPoint.label}
                      <span className="text-xs text-slate-400 ml-1">
                        （約 {shownLegs[shownLegs.length - 1].distanceKm} km）
                      </span>
                    </span>
                  </li>
                )}
              </ol>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
