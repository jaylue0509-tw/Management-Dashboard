import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  ShieldAlert,
  CheckCircle2,
  ClipboardCheck,
  Users,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import type { VisitRecord } from '../types';
import { ActivityWall } from './ActivityWall';
import { formatTaipeiReportTime } from '../utils/time-utils';
import { BEAUTY_CORE_SAFETY_ITEMS } from '../data/beautyAuditConfig';

interface Props {
  allActivities: VisitRecord[];
  actionItems: any[];
  onEditActivity?: (activity: VisitRecord) => void;
  canEditActivity?: (activity: VisitRecord) => boolean;
}

/**
 * 高層戰情看板 — 美容住宿專項視角
 * 彙整全區美容總監巡店紀錄、零容忍安全紅線違規率、高風險重點輔導門市、美容待辦結案率與 1-on-1 技術輔導筆記
 */
export const BeautyDashboardPanel: React.FC<Props> = ({
  allActivities,
  actionItems,
  onEditActivity,
  canEditActivity,
}) => {
  const navigate = useNavigate();

  const beautyActivities = useMemo(
    () =>
      allActivities.filter(
        a => a.auditType === 'beauty' || a.actionType === '美容總監巡店'
      ),
    [allActivities]
  );

  const stats = useMemo(() => {
    const totalCount = beautyActivities.length;
    const uniqueStores = new Set(beautyActivities.map(a => a.storeName)).size;

    let redlineViolatedCount = 0;
    const highRiskRecords: VisitRecord[] = [];
    const coachingRecords: VisitRecord[] = [];

    for (const act of beautyActivities) {
      const core = act.coreChecks || {};
      const hasCoreFail =
        Boolean(act.coreRedlineViolated) ||
        BEAUTY_CORE_SAFETY_ITEMS.some(c => {
          const val = core[c.id];
          return val === '違規' || val === '待改善' || val === '缺失';
        });
      if (hasCoreFail) redlineViolatedCount++;

      const rating = String(act.overallRating || '');
      if (hasCoreFail || rating.includes('高風險') || rating === '需重點輔導') {
        highRiskRecords.push(act);
      }

      if (act.coachingConducted || (act.coachingNotes && act.coachingNotes.trim())) {
        coachingRecords.push(act);
      }
    }

    const redlineRate =
      totalCount > 0 ? Math.round((redlineViolatedCount / totalCount) * 100) : 0;

    const beautyActions = (actionItems || []).filter(
      item => item?.auditDepartment === '美容' || item?.category === '美容安全紅線' || item?.category === '美容交辦事項'
    );
    const closedActions = beautyActions.filter(i => i.status === 'Closed').length;
    const openActions = beautyActions.filter(i => (i.status || 'Open') === 'Open').length;
    const closeRate =
      beautyActions.length > 0 ? Math.round((closedActions / beautyActions.length) * 100) : 100;

    return {
      totalCount,
      uniqueStores,
      redlineViolatedCount,
      redlineRate,
      highRiskRecords,
      coachingRecords: coachingRecords.slice(0, 6),
      beautyActionsTotal: beautyActions.length,
      openActions,
      closeRate,
    };
  }, [beautyActivities, actionItems]);

  return (
    <div className="flex flex-col gap-5">
      {/* 專項視角橫幅 */}
      <div className="bg-gradient-to-r from-rose-700 via-fuchsia-700 to-purple-800 text-white rounded-2xl p-4 sm:p-6 shadow-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
            <Sparkles size={22} className="text-amber-300" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-300 text-slate-950">
                美容住宿專項視角
              </span>
              <h2 className="text-base sm:text-xl font-extrabold">
                美容總監巡店與住宿安全紅線戰情中心
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-rose-100 mt-1">
              即時監控全區美容防墜／異味／門鎖安全紅線違規率、高風險重點輔導門市、跨部門待辦結案與美容師 1-on-1 技術培育動態
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/beauty-audit')}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-300 hover:bg-amber-200 text-slate-950 text-xs sm:text-sm font-black shadow-sm cursor-pointer transition-colors"
        >
          <Plus size={16} />
          <span>填寫美容總監巡店表</span>
        </button>
      </div>

      {/* 四大專項 KPI 卡（手機 2×2 緊湊排布，首屏即可一覽全部核心指標） */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
        <div className="bg-white rounded-2xl border border-slate-200 border-t-4 border-t-fuchsia-600 p-3 sm:p-4 shadow-2xs">
          <div className="text-[11px] sm:text-xs font-extrabold text-fuchsia-700 flex items-center gap-1 sm:gap-1.5">
            <ClipboardCheck size={14} className="shrink-0" />
            <span className="truncate">美容專項巡檢總次</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-1 tabular-nums">
            {stats.totalCount} <span className="text-xs sm:text-sm font-bold text-slate-500">次</span>
          </div>
          <div className="text-[11px] sm:text-xs text-slate-500 font-semibold mt-1 sm:mt-1.5 truncate">
            涵蓋 <strong className="text-slate-800">{stats.uniqueStores}</strong> 間門市
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 border-t-4 border-t-rose-600 p-3 sm:p-4 shadow-2xs">
          <div className="text-[11px] sm:text-xs font-extrabold text-rose-700 flex items-center gap-1 sm:gap-1.5">
            <ShieldAlert size={14} className="shrink-0" />
            <span className="truncate">安全紅線違規率</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-rose-600 mt-1 tabular-nums">
            {stats.redlineRate}%
          </div>
          <div className="text-[11px] sm:text-xs text-slate-500 font-semibold mt-1 sm:mt-1.5 truncate">
            觸發紅線 <strong className="text-rose-700">{stats.redlineViolatedCount}</strong> 筆
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 border-t-4 border-t-amber-500 p-3 sm:p-4 shadow-2xs">
          <div className="text-[11px] sm:text-xs font-extrabold text-amber-700 flex items-center gap-1 sm:gap-1.5">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="truncate">高風險重點輔導</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-600 mt-1 tabular-nums">
            {stats.highRiskRecords.length} <span className="text-xs sm:text-sm font-bold text-slate-500">筆</span>
          </div>
          <div className="text-[11px] sm:text-xs text-slate-500 font-semibold mt-1 sm:mt-1.5 truncate">
            {stats.highRiskRecords.length > 0
              ? `最新：${stats.highRiskRecords[0].storeName}`
              : '無高風險預警門市'}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 border-t-4 border-t-emerald-600 p-3 sm:p-4 shadow-2xs">
          <div className="text-[11px] sm:text-xs font-extrabold text-emerald-700 flex items-center gap-1 sm:gap-1.5">
            <CheckCircle2 size={14} className="shrink-0" />
            <span className="truncate">美容待辦結案率</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-600 mt-1 tabular-nums">
            {stats.closeRate}%
          </div>
          <div className="text-[11px] sm:text-xs text-slate-500 font-semibold mt-1 sm:mt-1.5 truncate">
            未結案 <strong className="text-rose-600">{stats.openActions}</strong> / {stats.beautyActionsTotal} 筆
          </div>
        </div>
      </div>

      {/* 最新 1-on-1 技術指導與團隊培育筆記 */}
      {stats.coachingRecords.length > 0 && (
        <div className="bg-white rounded-2xl border border-fuchsia-200 p-4 sm:p-5 shadow-2xs">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-1.5">
              <Users size={16} className="text-fuchsia-600" />
              近期美容師 1-on-1 技術指導與考核備忘
            </h3>
            <span className="text-xs font-bold text-fuchsia-700">
              最近 {stats.coachingRecords.length} 筆
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {stats.coachingRecords.map(rec => (
              <div
                key={rec.recordId}
                className="p-3 rounded-xl bg-fuchsia-50/50 border border-fuchsia-200/80 space-y-1"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-extrabold text-slate-900">
                    {rec.storeName}
                    {rec.beautyLeaderName ? `（美容組長：${rec.beautyLeaderName}）` : ''}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {formatTaipeiReportTime(rec.createdAt)}
                  </span>
                </div>
                {rec.coachingTargets && rec.coachingTargets.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {rec.coachingTargets.map(t => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-800 text-[10px] font-bold"
                      >
                        指導對象：{t}
                      </span>
                    ))}
                  </div>
                )}
                {rec.coachingNotes && (
                  <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed pt-0.5">
                    {rec.coachingNotes}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 美容總監巡店即時動態牆 */}
      {beautyActivities.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-rose-300 p-10 text-center space-y-3">
          <div className="text-base font-extrabold text-slate-800">
            目前尚未有美容總監巡店紀錄
          </div>
          <p className="text-xs text-slate-500">
            點擊下方按鈕填寫第一筆《美容總監巡店表》，資料將即時彙整至此專項看板並與區經理待辦跨部門連動！
          </p>
          <button
            type="button"
            onClick={() => navigate('/beauty-audit')}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold shadow-sm cursor-pointer"
          >
            <Plus size={15} />
            <span>立即填寫美容總監巡店表</span>
          </button>
        </div>
      ) : (
        <ActivityWall
          activities={beautyActivities}
          actionItems={actionItems}
          onEditActivity={onEditActivity}
          canEditActivity={canEditActivity}
        />
      )}
    </div>
  );
};
