import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, Clock, Sparkles, Users, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL, getAuthHeaders } from '../api/api';
import { getTaipeiDateStr, getTaipeiTodayStr, shiftDateStr } from '../utils/time-utils';
import { normalizeStoreName, getBusinessDepartment } from '../utils/store-region';
import type { Manager, VisitRecord } from '../types';
import type { PlannedScheduleItem, RosterPerson } from './PlannedSchedulePanel';
import { BEAUTY_DIRECTORS_CONFIG } from '../data/beautyAuditConfig';

interface Props {
  managers: Manager[];
  allActivities: VisitRecord[];
  onOpenFullPlanner: () => void;
}

/**
 * 依據基準日期 (YYYY-MM-DD) 計算該週週一與週日（支援 weekOffset）
 */
const getWeekRange = (baseDateStr: string, weekOffset = 0) => {
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + weekOffset * 7));
  const dow = dt.getUTCDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + diffToMon));
  const sun = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6));
  return {
    start: mon.toISOString().slice(0, 10),
    end: sun.toISOString().slice(0, 10),
  };
};

/**
 * 戰情牆首頁獨立區塊 — 長官速覽：每一位區經理 ＆ 美容總監預排行程動向
 * 讓高階長官一打開首頁無須翻頁，1 秒掌握「今日／明日／本週／下週（第2週一整週）」每一位主管規劃去哪間門市、誰尚未排程
 */
export const ExecutivePlannedOverview: React.FC<Props> = ({
  managers,
  allActivities,
  onOpenFullPlanner,
}) => {
  const { user } = useAuth();
  const todayStr = getTaipeiTodayStr();
  const tomorrowStr = useMemo(() => shiftDateStr(todayStr, 1), [todayStr]);
  const thisWeek = useMemo(() => getWeekRange(todayStr, 0), [todayStr]);
  const nextWeek = useMemo(() => getWeekRange(todayStr, 1), [todayStr]);

  const [quickDay, setQuickDay] = useState<'today' | 'tomorrow' | 'this_week' | 'next_week'>('today');
  const [deptFilter, setDeptFilter] = useState<'all' | '營業一處' | '營業二處' | 'beauty'>('all');
  const [onlyUnplanned, setOnlyUnplanned] = useState<boolean>(false);
  const [schedules, setSchedules] = useState<PlannedScheduleItem[]>([]);
  const [areaRoster, setAreaRoster] = useState<RosterPerson[]>([]);
  const [beautyRoster, setBeautyRoster] = useState<RosterPerson[]>([]);

  const activeDateStr = quickDay === 'today' ? todayStr : tomorrowStr;

  const fetchQuickSchedules = useCallback(async () => {
    try {
      // 單次請求取得「本週週一 ～ 下週週日（完整兩週 14 天）」預排，切換四種視圖皆零額外 API 請求
      const params = new URLSearchParams({
        start_date: thisWeek.start,
        end_date: nextWeek.end,
      });
      const res = await fetch(`${API_BASE_URL}/planned-schedules?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return;
      const json = await res.json();
      setSchedules(Array.isArray(json.schedules) ? json.schedules : []);
      if (Array.isArray(json.areaManagers)) setAreaRoster(json.areaManagers);
      if (Array.isArray(json.beautyDirectors)) setBeautyRoster(json.beautyDirectors);
    } catch {
      // 網路暫時異常時退回本地組織名冊
    }
  }, [thisWeek.start, nextWeek.end]);

  useEffect(() => {
    fetchQuickSchedules();
  }, [fetchQuickSchedules]);

  // 保底名冊（API 尚未回傳前先由 managers 組裝，畫面零閃爍）
  const effectivePeople = useMemo(() => {
    let mgrs: RosterPerson[] = areaRoster;
    if (mgrs.length === 0 && user?.role !== 'beauty_director') {
      const map = new Map<string, RosterPerson>();
      for (const m of managers) {
        if (!m.storeName || m.storeName.includes('測試')) continue;
        const name = (m.areaManagerName || '').trim();
        if (!name || name === '無' || name === '陳育廷') continue;
        if (!map.has(name)) {
          map.set(name, {
            name,
            role: 'manager',
            title: '區經理',
            department: getBusinessDepartment(m.region) || m.department || '',
            supervisor: m.directorName || '',
            region: m.region || '',
            nickname: '',
            stores: [],
          });
        }
      }
      mgrs = Array.from(map.values());
    }

    let bds: RosterPerson[] = beautyRoster;
    if (bds.length === 0 && user?.role !== 'manager') {
      bds = BEAUTY_DIRECTORS_CONFIG.filter(b =>
        user?.role === 'beauty_director' ? b.name === user.name : true
      ).map(b => ({
        name: b.name,
        role: 'beauty_director',
        title: '美容總監',
        department: b.department,
        supervisor: b.supervisor,
        region: b.department === '美容一處' ? '北區/宜花/嘉南' : '中彰雲/高屏',
        nickname: b.nickname,
        stores: [],
      }));
    }

    const combined = [...mgrs.filter(p => p.name !== '陳育廷').map(p => ({
      ...p,
      department: getBusinessDepartment(p.region) || p.department,
    })), ...bds];
    return combined.filter(p => {
      if (deptFilter === 'beauty') return p.role === 'beauty_director';
      if (deptFilter === '營業一處' || deptFilter === '營業二處') {
        return p.role === 'manager' && p.department === deptFilter;
      }
      return true;
    });
  }, [areaRoster, beautyRoster, managers, user, deptFilter]);

  // 實際已執行紀錄比對（自動標示「✓ 已到店」）
  const actualDoneSet = useMemo(() => {
    const set = new Set<string>();
    for (const act of allActivities) {
      const d = getTaipeiDateStr(act.createdAt);
      const mgr = (act.areaManagerName || '').trim();
      if (!d || !mgr) continue;
      if (['總部行程', '會議行程', '特殊行程'].includes(act.actionType || '')) {
        set.add(`${mgr}|${d}|__SCH__`);
      } else if (act.storeName) {
        set.add(`${mgr}|${d}|${normalizeStoreName(act.storeName)}`);
      }
    }
    return set;
  }, [allActivities]);

  const matchesQuickScope = useCallback(
    (s: PlannedScheduleItem) => {
      if (quickDay === 'this_week') {
        return s.scheduleDate >= thisWeek.start && s.scheduleDate <= thisWeek.end;
      }
      if (quickDay === 'next_week') {
        return s.scheduleDate >= nextWeek.start && s.scheduleDate <= nextWeek.end;
      }
      return s.scheduleDate === activeDateStr;
    },
    [quickDay, thisWeek.start, thisWeek.end, nextWeek.start, nextWeek.end, activeDateStr]
  );

  const rowsForDay = useMemo(() => {
    const list = effectivePeople.map(person => {
      const items = schedules.filter(
        s => s.personName === person.name && matchesQuickScope(s)
      );
      return { person, items };
    });
    if (onlyUnplanned) {
      return list.filter(r => r.items.length === 0);
    }
    return list;
  }, [effectivePeople, schedules, matchesQuickScope, onlyUnplanned]);

  const summaryCounts = useMemo(() => {
    let plannedPeople = 0;
    let unplannedPeople = 0;
    let totalStops = 0;
    for (const p of effectivePeople) {
      const cnt = schedules.filter(
        s => s.personName === p.name && matchesQuickScope(s)
      ).length;
      if (cnt > 0) {
        plannedPeople++;
        totalStops += cnt;
      } else {
        unplannedPeople++;
      }
    }
    return { plannedPeople, unplannedPeople, totalStops, totalPeople: effectivePeople.length };
  }, [effectivePeople, schedules, matchesQuickScope]);

  return (
    <section className="mb-5 bg-white rounded-2xl border border-indigo-200/90 shadow-xs overflow-hidden">
      {/* 標題與快速切換列 */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-3.5 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 rounded-md bg-amber-300 text-slate-950 text-[11px] font-black">
            長官速覽
          </span>
          <h3 className="text-sm sm:text-base font-extrabold flex items-center gap-1.5">
            <Calendar size={16} className="text-amber-300" />
            <span>區經理 ＆ 美容總監 預排行程動向</span>
          </h3>
          <span className="text-xs text-indigo-200 font-semibold">
            （已排 <strong className="text-emerald-300">{summaryCounts.plannedPeople}</strong> /{' '}
            {summaryCounts.totalPeople} 位 · 共 {summaryCounts.totalStops} 個行程點）
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-between sm:justify-end">
          {/* 今日 / 明日 / 本週 / 下週（第 2 週一整週）一鍵切換（零額外 API 請求） */}
          <div className="inline-flex rounded-xl bg-white/10 p-0.5 border border-white/15 flex-wrap">
            <button
              type="button"
              onClick={() => setQuickDay('today')}
              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                quickDay === 'today' ? 'bg-amber-300 text-slate-950' : 'text-slate-200 hover:text-white'
              }`}
            >
              今日 ({todayStr.slice(5).replace('-', '/')})
            </button>
            <button
              type="button"
              onClick={() => setQuickDay('tomorrow')}
              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                quickDay === 'tomorrow' ? 'bg-amber-300 text-slate-950' : 'text-slate-200 hover:text-white'
              }`}
            >
              明日 ({tomorrowStr.slice(5).replace('-', '/')})
            </button>
            <button
              type="button"
              onClick={() => setQuickDay('this_week')}
              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                quickDay === 'this_week' ? 'bg-amber-300 text-slate-950' : 'text-slate-200 hover:text-white'
              }`}
            >
              本週 ({thisWeek.start.slice(5).replace('-', '/')}~{thisWeek.end.slice(5).replace('-', '/')})
            </button>
            <button
              type="button"
              onClick={() => setQuickDay('next_week')}
              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                quickDay === 'next_week' ? 'bg-amber-300 text-slate-950' : 'text-slate-200 hover:text-white'
              }`}
            >
              第2週 ({nextWeek.start.slice(5).replace('-', '/')}~{nextWeek.end.slice(5).replace('-', '/')})
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenFullPlanner}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-extrabold shadow-xs cursor-pointer transition-colors whitespace-nowrap"
          >
            <span>開啟雙週預排週曆</span>
            <ArrowRight size={13} />
          </button>
        </div>
      </div>

      {/* 管理員快速過濾列（處別切換 ＋ 未排程預警篩選） */}
      {user?.role === 'admin' && (
        <div className="px-3.5 sm:px-5 py-2 bg-slate-50 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {(
              [
                { id: 'all', label: '全體主管' },
                { id: '營業一處', label: '👔 營業一處' },
                { id: '營業二處', label: '👔 營業二處' },
                { id: 'beauty', label: '🌸 美容總監' },
              ] as const
            ).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDeptFilter(tab.id)}
                className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                  deptFilter === tab.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {summaryCounts.unplannedPeople > 0 && (
            <button
              type="button"
              onClick={() => setOnlyUnplanned(prev => !prev)}
              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border inline-flex items-center gap-1 cursor-pointer transition-colors ${
                onlyUnplanned
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
              }`}
            >
              <AlertCircle size={13} />
              <span>
                {onlyUnplanned
                  ? `顯示全部人員`
                  : `僅看尚未排程（${summaryCounts.unplannedPeople} 位）`}
              </span>
            </button>
          )}
        </div>
      )}

      {/* 緊湊速覽網格：一眼看完每一位區經理與美容總監去哪裡 */}
      <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
        {rowsForDay.map(({ person, items }) => {
          const isBeauty = person.role === 'beauty_director';
          const hasPlan = items.length > 0;
          return (
            <div
              key={`${person.role}-${person.name}`}
              onClick={onOpenFullPlanner}
              className={`rounded-xl border p-2.5 flex flex-col justify-between gap-2 cursor-pointer transition-all hover:shadow-xs ${
                !hasPlan
                  ? 'bg-slate-50/70 border-dashed border-slate-300'
                  : isBeauty
                  ? 'bg-rose-50/40 border-rose-200 hover:border-rose-400'
                  : 'bg-blue-50/30 border-blue-200/80 hover:border-blue-400'
              }`}
              title="點擊開啟完整預排行程週曆"
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  {isBeauty ? (
                    <Sparkles size={13} className="text-rose-600 shrink-0" />
                  ) : (
                    <Users size={13} className="text-blue-600 shrink-0" />
                  )}
                  <span className="text-xs sm:text-sm font-extrabold text-slate-900 truncate">
                    {person.name}
                    {person.nickname ? ` (${person.nickname})` : ''}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.2 rounded shrink-0 ${
                      isBeauty
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-slate-200/80 text-slate-700'
                    }`}
                  >
                    {isBeauty ? person.department : person.region || person.department || '區經理'}
                  </span>
                </div>

                {!hasPlan ? (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100/80 px-1.5 py-0.5 rounded shrink-0">
                    未排程
                  </span>
                ) : (
                  <span className="text-[10px] font-extrabold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full shrink-0">
                    {items.length} 站
                  </span>
                )}
              </div>

              {hasPlan ? (
                <div className="flex flex-wrap gap-1">
                  {items.map(it => {
                    const isDone = it.storeName
                      ? actualDoneSet.has(
                          `${it.personName}|${it.scheduleDate}|${normalizeStoreName(it.storeName)}`
                        )
                      : actualDoneSet.has(`${it.personName}|${it.scheduleDate}|__SCH__`);

                    return (
                      <span
                        key={it.id}
                        className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                          isDone
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-slate-800 border-slate-200'
                        }`}
                      >
                        {(quickDay === 'this_week' || quickDay === 'next_week') && (
                          <span className={isDone ? 'text-emerald-100 text-[10px]' : 'text-indigo-500 text-[10px]'}>
                            {it.scheduleDate.slice(5).replace('-', '/')}
                          </span>
                        )}
                        {it.timeSlot !== '全天' && (
                          <span className={isDone ? 'text-emerald-100 text-[10px]' : 'text-slate-400 text-[10px]'}>
                            [{it.timeSlot}]
                          </span>
                        )}
                        <span>{it.storeName || it.scheduleType}</span>
                        {isDone ? (
                          <CheckCircle2 size={11} className="shrink-0" />
                        ) : (
                          <Clock size={10} className="text-slate-400 shrink-0" />
                        )}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 flex items-center justify-between">
                  <span>
                    尚未填寫
                    {quickDay === 'today'
                      ? '今日'
                      : quickDay === 'tomorrow'
                      ? '明日'
                      : quickDay === 'this_week'
                      ? '本週'
                      : '第2週（下週）'}
                    預排行程
                  </span>
                  <span className="text-blue-600 font-bold">+ 點擊排程</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
