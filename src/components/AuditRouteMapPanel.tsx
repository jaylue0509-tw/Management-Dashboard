import React, { useState, useMemo } from 'react';
import type { Manager, VisitRecord } from '../types';
import { getTaipeiDateStr, formatTaipeiReportTime, getTaipeiTodayStr, shiftDateStr } from '../utils/time-utils';
import { normalizeStoreName } from '../utils/store-region';
import { getStoreGeoPoint, getRegionHubPoint, HEADQUARTERS_POINT } from '../data/storeCoordinates';
import { optimizeDailyRoute, type RouteStop, type RouteOptimizationResult } from '../utils/route-optimizer';
import { DEFAULT_SUBSIDY_PER_KM } from '../utils/mileage-calculator';
import { TaiwanRouteMap } from './TaiwanRouteMap';
import {
  Calendar,
  User,
  Clock,
  Eye,
} from 'lucide-react';

interface Props {
  allActivities: VisitRecord[];
  managers: Manager[];
  selectedDepartment?: string;
  initialDateStr?: string;
  initialManagerName?: string;
  onJumpToActivity?: (storeName: string, recordId?: string) => void;
}

const SCHEDULE_TYPES = new Set(['總部行程', '會議行程', '特殊行程']);

export const AuditRouteMapPanel: React.FC<Props> = ({
  allActivities,
  managers,
  selectedDepartment = '全部處別',
  initialDateStr,
  initialManagerName,
  onJumpToActivity,
}) => {
  // 目前選擇的日期 (YYYY-MM-DD)
  const [selectedDate, setSelectedDate] = useState<string>(initialDateStr || getTaipeiTodayStr());

  // 目前選取的區主管姓名 (若為空則為全區或第一位)
  const [selectedManagerName, setSelectedManagerName] = useState<string>(initialManagerName || '');

  // 是否開啟最佳化路徑對比線
  const [showOptimalComparison, setShowOptimalComparison] = useState<boolean>(true);

  // 目前選取的單一站點 ID
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  // 篩選處別後的區主管清單
  const filteredManagers = useMemo(() => {
    let list = managers;
    if (selectedDepartment && selectedDepartment !== '全部處別') {
      list = list.filter(m => m.department === selectedDepartment);
    }
    // 依主管姓名去重並以所屬區域排序
    const map = new Map<string, Manager>();
    for (const m of list) {
      if (m.areaManagerName && !map.has(m.areaManagerName)) {
        map.set(m.areaManagerName, m);
      }
    }
    return Array.from(map.values());
  }, [managers, selectedDepartment]);

  // 當日所有活動紀錄（依台北日期字串歸類）
  const dayActivities = useMemo(() => {
    return allActivities.filter(a => {
      const actDate = getTaipeiDateStr(a.createdAt);
      return actDate === selectedDate;
    });
  }, [allActivities, selectedDate]);

  // 當日各主管之活動統計 (包含巡店數與行程)
  const activeManagersSummary = useMemo(() => {
    const summaryMap: Record<string, { visits: number; schedules: number; manager: Manager }> = {};

    for (const m of filteredManagers) {
      summaryMap[m.areaManagerName] = { visits: 0, schedules: 0, manager: m };
    }

    for (const act of dayActivities) {
      const name = act.areaManagerName;
      if (!name) continue;
      if (!summaryMap[name]) {
        const found = filteredManagers.find(m => m.areaManagerName === name);
        if (found) summaryMap[name] = { visits: 0, schedules: 0, manager: found };
      }
      if (summaryMap[name]) {
        if (SCHEDULE_TYPES.has(act.actionType)) {
          summaryMap[name].schedules++;
        } else {
          summaryMap[name].visits++;
        }
      }
    }

    return Object.entries(summaryMap).map(([name, data]) => ({
      name,
      visits: data.visits,
      schedules: data.schedules,
      totalActs: data.visits + data.schedules,
      region: data.manager.region,
      department: data.manager.department,
    }));
  }, [filteredManagers, dayActivities]);

  // 確定當前作用中的主管姓名（若未選，優先選當日有巡店的主管）
  const currentManagerName = useMemo(() => {
    if (selectedManagerName) return selectedManagerName;
    const firstActive = activeManagersSummary.find(m => m.totalActs > 0);
    if (firstActive) return firstActive.name;
    return filteredManagers[0]?.areaManagerName || '';
  }, [selectedManagerName, activeManagersSummary, filteredManagers]);

  // 當前主管所屬區域與資料
  const currentManagerObj = useMemo(() => {
    return filteredManagers.find(m => m.areaManagerName === currentManagerName);
  }, [filteredManagers, currentManagerName]);

  const currentRegion = currentManagerObj?.region || '新北區';

  // 解析當前主管於當日的巡店站點
  const currentRawStops = useMemo((): RouteStop[] => {
    if (!currentManagerName) return [];

    const acts = dayActivities
      .filter(a => a.areaManagerName === currentManagerName)
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

    // 去除同日連續重複門市
    const distinctStops: RouteStop[] = [];
    for (const act of acts) {
      const isSched = SCHEDULE_TYPES.has(act.actionType);
      const prev = distinctStops[distinctStops.length - 1];
      if (
        prev &&
        !isSched &&
        !prev.isSchedule &&
        normalizeStoreName(prev.storeName) === normalizeStoreName(act.storeName)
      ) {
        continue;
      }

      const geoPoint = (() => {
        if (act.actionType === '總部行程') return HEADQUARTERS_POINT;
        if (isSched) {
          const text = `${act.storeName || ''} ${act.highlightDescription || ''}`;
          if (text.includes('總部')) return HEADQUARTERS_POINT;
          const hub = getRegionHubPoint(currentRegion);
          return { ...hub, label: `${act.actionType}（${act.highlightDescription || hub.label}）` };
        }
        return getStoreGeoPoint(act.storeName, currentRegion);
      })();

      const timeStr = formatTaipeiReportTime(act.createdAt).split(' ')[1] || '';

      distinctStops.push({
        id: act.recordId || `stop-${distinctStops.length}`,
        storeName: isSched ? act.actionType : (act.storeName || '未註記門市'),
        label: isSched ? `${act.actionType}：${act.highlightDescription || ''}` : act.storeName,
        geoPoint,
        visitTime: timeStr,
        actionType: act.actionType,
        recordId: act.recordId,
        overallRating: act.overallRating,
        abnormalFlag: act.abnormalFlag,
        highlightDescription: act.highlightDescription || act.immediateImprovement,
        orderIndex: distinctStops.length + 1,
        isSchedule: isSched,
      });
    }

    return distinctStops;
  }, [dayActivities, currentManagerName, currentRegion]);

  // 運行路徑最佳化演算法
  const routeAnalysis = useMemo((): RouteOptimizationResult => {
    return optimizeDailyRoute(
      currentManagerName,
      currentRegion,
      selectedDate,
      currentRawStops,
      DEFAULT_SUBSIDY_PER_KM
    );
  }, [currentManagerName, currentRegion, selectedDate, currentRawStops]);

  // 快速切換前一天、今天、後一天
  const handleShiftDate = (days: number) => {
    setSelectedDate(prev => shiftDateStr(prev, days));
  };

  return (
    <div className="space-y-4">
      {/* 頂部操作控制列 */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* 左側：日期切換與選擇器 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 gap-2">
            <Calendar size={15} className="text-slate-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={e => e.target.value && setSelectedDate(e.target.value)}
              className="text-xs font-bold text-slate-800 bg-transparent outline-none cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleShiftDate(-1)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-700 transition-colors cursor-pointer"
            >
              前一日
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(getTaipeiTodayStr())}
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-bold transition-colors cursor-pointer ${
                selectedDate === getTaipeiTodayStr()
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
              }`}
            >
              今日
            </button>
            <button
              type="button"
              onClick={() => handleShiftDate(1)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 font-bold text-slate-700 transition-colors cursor-pointer"
            >
              後一日
            </button>
          </div>
        </div>

        {/* 右側：主管切換選單 */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500 flex items-center gap-1">
            <User size={14} /> 主管切換：
          </label>
          <select
            value={currentManagerName}
            onChange={e => setSelectedManagerName(e.target.value)}
            className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 cursor-pointer"
          >
            {activeManagersSummary.map(m => (
              <option key={m.name} value={m.name}>
                {m.name}（{m.region} · 當日 {m.visits} 門市 {m.schedules > 0 ? `+ ${m.schedules} 行程` : ''}）
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 區主管快速膠囊橫列 (顯示當日巡店活力) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
        {activeManagersSummary.map(m => {
          const isActive = m.name === currentManagerName;
          const hasVisits = m.totalActs > 0;
          return (
            <button
              key={m.name}
              type="button"
              onClick={() => setSelectedManagerName(m.name)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all shrink-0 flex items-center gap-2 cursor-pointer ${
                isActive
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs ring-2 ring-blue-400/20'
                  : hasVisits
                  ? 'bg-white text-slate-800 border-slate-300 hover:border-blue-400 hover:bg-blue-50/40'
                  : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span className="flex items-center gap-1">
                <span>{m.name}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${
                  isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  {m.region}
                </span>
              </span>
              {hasVisits ? (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                  isActive ? 'bg-emerald-400 text-slate-950' : 'bg-blue-100 text-blue-700'
                }`}>
                  {m.visits} 店
                </span>
              ) : (
                <span className="text-[10px] text-slate-400">無行程</span>
              )}
            </button>
          );
        })}
      </div>

      {/* 主面板網格：左側地圖 (7 Cols) + 右側最佳化建議與行程時間軸 (5 Cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* 左側地圖 (LG: 7 Cols) */}
        <div className="lg:col-span-7 space-y-3">
          <TaiwanRouteMap
            actualStops={routeAnalysis.actualStops}
            actualLegs={routeAnalysis.actualLegs}
            optimalStops={routeAnalysis.optimalStops}
            optimalLegs={routeAnalysis.optimalLegs}
            hubPoint={routeAnalysis.hubPoint}
            managerName={currentManagerName}
            region={currentRegion}
            showOptimalComparison={showOptimalComparison}
            onToggleOptimalComparison={setShowOptimalComparison}
            selectedStopId={selectedStopId}
            onSelectStop={s => setSelectedStopId(s ? s.id : null)}
          />

          {/* 地圖下方快捷說明條 */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between text-xs text-slate-600 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800">💡 互動指引：</span>
              <span>滑鼠滾輪縮放、按住滑鼠左鍵可拖曳地圖；點擊節點查看門市詳細評估。</span>
            </div>
            <div className="flex items-center gap-3 font-semibold text-slate-700">
              <span>汽車補助推估單價：<strong>${DEFAULT_SUBSIDY_PER_KM} 元/km</strong></span>
            </div>
          </div>
        </div>

        {/* 右側：車程最佳化建議核心卡片 + 當日巡店時間軸 (LG: 5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* 最佳化效益分析總覽卡片 */}
          <div className={`rounded-2xl border p-4.5 shadow-sm transition-all ${
            routeAnalysis.isAlreadyOptimal
              ? 'bg-gradient-to-br from-emerald-50/80 via-white to-blue-50/50 border-emerald-200'
              : 'bg-gradient-to-br from-amber-50/80 via-white to-orange-50/40 border-amber-300'
          }`}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                  routeAnalysis.isAlreadyOptimal
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : 'bg-amber-100 text-amber-800 border-amber-300'
                }`}>
                  {routeAnalysis.isAlreadyOptimal ? '🌟 最佳合理巡店路徑' : '💡 發現更佳節能路徑'}
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-1.5 flex items-center gap-2">
                  <span>🚗</span>
                  <span>{currentManagerName} 當日巡店車程分析</span>
                </h3>
              </div>

              {/* 效率評分環形/膠囊 */}
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-500 block">路徑效率</span>
                <span className={`text-xl font-extrabold ${
                  routeAnalysis.efficiencyScore >= 90
                    ? 'text-emerald-600'
                    : routeAnalysis.efficiencyScore >= 75
                    ? 'text-blue-600'
                    : 'text-amber-600'
                }`}>
                  {routeAnalysis.efficiencyScore}%
                </span>
              </div>
            </div>

            {/* 三項核心指標 (總里程 / 最佳里程 / 節省效益) */}
            <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-200/80 my-3 text-center">
              <div>
                <span className="text-[10px] font-semibold text-slate-500 block">實際總里程</span>
                <span className="text-sm font-extrabold text-slate-800">
                  {routeAnalysis.actualTotalKm} <span className="text-[10px] font-normal">km</span>
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  ${routeAnalysis.actualTotalCost} 元
                </span>
              </div>

              <div>
                <span className="text-[10px] font-semibold text-emerald-700 block">最佳化里程</span>
                <span className="text-sm font-extrabold text-emerald-600">
                  {routeAnalysis.optimalTotalKm} <span className="text-[10px] font-normal">km</span>
                </span>
                <span className="text-[10px] text-emerald-600/80 block mt-0.5">
                  ${routeAnalysis.optimalTotalCost} 元
                </span>
              </div>

              <div>
                <span className="text-[10px] font-semibold text-amber-700 block">預估可節省</span>
                <span className="text-sm font-extrabold text-amber-600">
                  {routeAnalysis.savedKm > 0 ? `-${routeAnalysis.savedKm}` : '0'} <span className="text-[10px] font-normal">km</span>
                </span>
                <span className="text-[10px] text-amber-600/80 block mt-0.5">
                  省 ${routeAnalysis.savedCost} 元
                </span>
              </div>
            </div>

            {/* 建議摘要文字 */}
            <p className="text-xs font-semibold text-slate-700 leading-relaxed">
              {routeAnalysis.suggestionText}
            </p>

            {/* 具體建議要點 (Bullets) */}
            {routeAnalysis.adviceBullets.length > 0 && (
              <div className="mt-3 bg-white/90 rounded-xl p-3 border border-slate-200/80 space-y-1.5 text-xs text-slate-600">
                {routeAnalysis.adviceBullets.map((bullet, idx) => (
                  <div key={idx} className="flex items-start gap-1.5">
                    <span className="text-blue-500 font-bold mt-0.5 shrink-0">•</span>
                    <span className="leading-relaxed">{bullet}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 巡店行程時間軸與各站明細 (Timeline) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Clock size={16} className="text-blue-600" />
                <span>當日巡店順序與停留明細</span>
                <span className="text-xs font-normal text-slate-500">
                  （{routeAnalysis.actualStops.length} 站）
                </span>
              </h4>
              <button
                type="button"
                onClick={() => setShowOptimalComparison(!showOptimalComparison)}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
              >
                {showOptimalComparison ? '隱藏建議路徑' : '顯示建議路徑'}
              </button>
            </div>

            {routeAnalysis.actualStops.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                當日無門市巡店或行程打卡紀錄
              </div>
            ) : (
              <div className="relative pl-5 border-l-2 border-blue-200 space-y-4 my-2 ml-2">
                {/* 出發起點 */}
                <div className="relative">
                  <span className="absolute -left-[27px] top-1 w-4 h-4 rounded-full bg-amber-400 border-2 border-white shadow-xs flex items-center justify-center text-[8px] font-bold text-slate-900">
                    ★
                  </span>
                  <div className="text-xs">
                    <span className="font-bold text-slate-700">出發起點：{routeAnalysis.hubPoint.label}</span>
                  </div>
                </div>

                {/* 各站巡查點 */}
                {routeAnalysis.actualStops.map((stop, idx) => {
                  const isSelected = selectedStopId === stop.id;
                  const leg = routeAnalysis.actualLegs[idx];

                  return (
                    <div
                      key={stop.id}
                      onClick={() => setSelectedStopId(isSelected ? null : stop.id)}
                      className={`relative p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50/80 border-blue-400 shadow-sm ring-1 ring-blue-300'
                          : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/70 hover:border-slate-300'
                      }`}
                    >
                      {/* 時間軸節點徽章 */}
                      <span className={`absolute -left-[29px] top-3.5 w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center border-2 border-white shadow-xs ${
                        stop.abnormalFlag ? 'bg-red-500' : stop.isSchedule ? 'bg-indigo-600' : 'bg-blue-600'
                      }`}>
                        {stop.orderIndex}
                      </span>

                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5 flex-wrap">
                            <span>{stop.storeName}</span>
                            {stop.overallRating && (
                              <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold border ${
                                stop.overallRating === '特優' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                                stop.overallRating === '優' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                stop.overallRating === '良' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                'bg-red-100 text-red-700 border-red-200'
                              }`}>
                                {stop.overallRating}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            到店：<span className="font-semibold text-slate-700">{stop.visitTime || '未載明'}</span>
                            {leg && (
                              <span className="ml-2 text-slate-400">
                                · 車程距上站約 {leg.distanceKm} km (${leg.subsidyCost}元)
                              </span>
                            )}
                          </div>
                        </div>

                        {/* 跳轉至戰情牆查核按鈕 */}
                        {onJumpToActivity && stop.recordId && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              onJumpToActivity(stop.storeName, stop.recordId);
                            }}
                            className="text-[11px] font-bold text-blue-600 hover:text-blue-800 bg-white border border-blue-200 px-2 py-1 rounded-md shadow-2xs hover:bg-blue-50 transition-colors shrink-0 flex items-center gap-1"
                          >
                            <Eye size={12} />
                            <span>查看紀錄</span>
                          </button>
                        )}
                      </div>

                      {stop.highlightDescription && (
                        <p className="text-[11px] text-slate-600 mt-2 bg-white p-2 rounded-lg border border-slate-200/60 leading-relaxed">
                          {stop.highlightDescription}
                        </p>
                      )}
                    </div>
                  );
                })}

                {/* 返程起點 */}
                <div className="relative">
                  <span className="absolute -left-[27px] top-1 w-4 h-4 rounded-full bg-slate-400 border-2 border-white shadow-xs flex items-center justify-center text-[8px] font-bold text-white">
                    ✓
                  </span>
                  <div className="text-xs">
                    <span className="font-semibold text-slate-600">
                      返程至：{routeAnalysis.hubPoint.label}
                      {routeAnalysis.actualLegs[routeAnalysis.actualLegs.length - 1]?.isReturnLeg && (
                        <span className="text-slate-400 ml-1.5">
                          （約 {routeAnalysis.actualLegs[routeAnalysis.actualLegs.length - 1].distanceKm} km）
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
