import React, { useMemo, useState } from 'react';
import { Clock, ChevronDown, ChevronUp, MapPin, ArrowUpRight, AlertCircle } from 'lucide-react';
import type { Manager, VisitRecord } from '../types';
import { normalizeRegionName, normalizeStoreName, compareRegion } from '../utils/store-region';
import { getTaipeiDateStr, getTaipeiTodayStr } from '../utils/time-utils';

interface OverdueStoreItem {
  storeName: string;
  region: string;
  areaManagerName: string;
  lastVisitDate: string | null;
  daysSinceVisit: number | null; // null 代表尚無任何巡店紀錄
}

interface OverdueStoresBannerProps {
  managers: Manager[];
  allActivities: VisitRecord[];
  selectedDepartment?: string;
  selectedManager?: Manager | null;
  onNavigateAudit: (storeName: string) => void;
}

const SCHEDULE_TYPES = new Set(['總部行程', '會議行程', '特殊行程']);

/**
 * 計算兩個 YYYY-MM-DD 日期之間的天數差
 */
const diffDays = (fromDateStr: string, toDateStr: string): number => {
  const from = new Date(`${fromDateStr}T00:00:00+08:00`).getTime();
  const to = new Date(`${toDateStr}T00:00:00+08:00`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86400000));
};

/**
 * 逾期未巡門市週期預警橫幅
 * 自動比對負責門市與歷史實地巡店紀錄，協助總部與區主管迅速發現漏巡或久未巡視之門市
 */
export const OverdueStoresBanner: React.FC<OverdueStoresBannerProps> = ({
  managers,
  allActivities,
  selectedDepartment = 'all',
  selectedManager = null,
  onNavigateAudit,
}) => {
  const [thresholdDays, setThresholdDays] = useState<7 | 14 | 30>(14);
  const [expanded, setExpanded] = useState(false);

  const overdueData = useMemo(() => {
    const todayStr = getTaipeiTodayStr();

    // 依處別與所選區主管過濾門市清單（與覆蓋率分母口徑完全一致）
    const keyword = selectedDepartment === 'all' ? '' : selectedDepartment.replace('營業', '');
    const deptManagers = selectedDepartment === 'all'
      ? managers
      : managers.filter(m => (m.department || '').includes(keyword) || m.department === selectedDepartment);
    const scopedManagers = selectedManager
      ? deptManagers.filter(
          m =>
            normalizeRegionName(m.region) === normalizeRegionName(selectedManager.region) ||
            m.areaManagerName === selectedManager.areaManagerName
        )
      : deptManagers;

    // 1. 建立每間門市的最後一次「實地巡店」日期索引（忽略公務行程）
    const latestVisitByNormStore = new Map<string, string>();
    for (const act of allActivities) {
      if (!act.storeName || SCHEDULE_TYPES.has(act.actionType || '')) continue;
      const dateStr = getTaipeiDateStr(act.createdAt);
      if (!dateStr) continue;
      const norm = normalizeStoreName(act.storeName);
      const prev = latestVisitByNormStore.get(norm);
      if (!prev || dateStr > prev) {
        latestVisitByNormStore.set(norm, dateStr);
      }
    }

    // 2. 去重負責門市，篩選出超過 thresholdDays 天未巡視或從未巡檢的門市
    const seenStores = new Set<string>();
    const items: OverdueStoreItem[] = [];

    for (const m of scopedManagers) {
      if (!m.storeName) continue;
      const norm = normalizeStoreName(m.storeName);
      if (seenStores.has(norm)) continue;
      seenStores.add(norm);

      const lastVisitDate = latestVisitByNormStore.get(norm) || null;
      const daysSinceVisit = lastVisitDate ? diffDays(lastVisitDate, todayStr) : null;

      if (daysSinceVisit === null || daysSinceVisit >= thresholdDays) {
        items.push({
          storeName: m.storeName,
          region: normalizeRegionName(m.region || '其他區域'),
          areaManagerName: m.areaManagerName || '未指派',
          lastVisitDate,
          daysSinceVisit,
        });
      }
    }

    // 依區域排序，同區內「從未巡檢」最優先，其次依逾期天數由大到小排序
    items.sort((a, b) => {
      const regCmp = compareRegion(a.region, b.region);
      if (regCmp !== 0) return regCmp;
      if (a.daysSinceVisit === null && b.daysSinceVisit !== null) return -1;
      if (a.daysSinceVisit !== null && b.daysSinceVisit === null) return 1;
      return (b.daysSinceVisit ?? 9999) - (a.daysSinceVisit ?? 9999);
    });

    // 依區域分組
    const groupedMap = new Map<string, OverdueStoreItem[]>();
    for (const item of items) {
      const arr = groupedMap.get(item.region) || [];
      arr.push(item);
      groupedMap.set(item.region, arr);
    }

    const neverVisitedCount = items.filter(i => i.daysSinceVisit === null).length;

    return {
      totalStores: seenStores.size,
      overdueCount: items.length,
      neverVisitedCount,
      groups: Array.from(groupedMap.entries()).map(([region, stores]) => ({ region, stores })),
    };
  }, [managers, allActivities, thresholdDays, selectedDepartment, selectedManager]);

  if (overdueData.totalStores === 0 || overdueData.overdueCount === 0) {
    return null;
  }

  return (
    <div className="mb-6 bg-amber-50/90 border border-amber-200 rounded-2xl shadow-2xs overflow-hidden">
      {/* 精簡摘要條（點擊可展開完整分區清單） */}
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="flex items-center gap-2.5 text-left cursor-pointer group flex-1 min-w-[240px]"
        >
          <span className="w-8 h-8 rounded-xl bg-amber-100 border border-amber-300/80 text-amber-700 flex items-center justify-center shrink-0">
            <Clock size={16} />
          </span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs sm:text-sm font-extrabold text-amber-950">
              巡店週期預警：有{' '}
              <span className="text-rose-600 text-sm sm:text-base font-black">
                {overdueData.overdueCount}
              </span>{' '}
              間門市超過 {thresholdDays} 天未實地巡視
            </span>
            {overdueData.neverVisitedCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                <AlertCircle size={11} />
                含 {overdueData.neverVisitedCount} 間近期尚無紀錄
              </span>
            )}
          </div>
        </button>

        {/* 右側：天數門檻切換與展開按鈕 */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center bg-white border border-amber-200 rounded-lg p-0.5">
            {([7, 14, 30] as const).map(days => (
              <button
                key={days}
                type="button"
                onClick={() => setThresholdDays(days)}
                className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                  thresholdDays === days
                    ? 'bg-amber-500 text-white shadow-2xs'
                    : 'text-amber-800 hover:bg-amber-50'
                }`}
              >
                &ge; {days} 天
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setExpanded(prev => !prev)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white hover:bg-amber-100/70 text-amber-900 border border-amber-300 text-xs font-extrabold transition-colors cursor-pointer"
          >
            <span>{expanded ? '收合名單' : '展開名單'}</span>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* 展開後：依區域列出逾期門市並支援一鍵發起巡店 */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-amber-200/80 bg-white/60 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {overdueData.groups.map(group => (
            <div
              key={group.region}
              className="bg-white border border-amber-200/80 rounded-xl p-3 shadow-2xs flex flex-col gap-2"
            >
              <div className="flex items-center justify-between pb-1.5 border-b border-amber-100">
                <span className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                  <MapPin size={13} className="text-amber-600" />
                  {group.region}
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  {group.stores.length} 間待巡
                </span>
              </div>

              <div className="flex flex-col gap-1.5 max-h-[210px] overflow-y-auto pr-0.5">
                {group.stores.map(store => (
                  <div
                    key={store.storeName}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50/90 hover:bg-amber-50/80 border border-slate-100 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {store.storeName}
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                        <span>{store.areaManagerName}</span>
                        <span>·</span>
                        {store.daysSinceVisit === null ? (
                          <span className="text-rose-600 font-bold">尚無巡店紀錄</span>
                        ) : (
                          <span className="text-amber-700 font-bold">
                            已 {store.daysSinceVisit} 天未巡（上次 {store.lastVisitDate?.slice(5).replace('-', '/')}）
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onNavigateAudit(store.storeName)}
                      className="shrink-0 inline-flex items-center gap-0.5 px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white border border-blue-200 hover:border-blue-600 text-[11px] font-bold transition-colors cursor-pointer"
                      title={`前往填報 ${store.storeName} 巡店紀錄`}
                    >
                      <span>去巡店</span>
                      <ArrowUpRight size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
