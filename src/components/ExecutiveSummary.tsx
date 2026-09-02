import React, { useMemo } from 'react';
import type { VisitRecord, DashboardSummary } from '../types';
import { Sparkles, AlertTriangle, Star, TrendingDown, Store } from 'lucide-react';

interface Props {
  activities: VisitRecord[];
  summary: DashboardSummary | null;
  timeRange: string;
  topIssues?: { category: string; item: string; count: number; stores?: { name: string; reportTime?: string }[] }[];
  radarData?: { subject: string; A: number; fullMark: number }[];
}

export const ExecutiveSummary: React.FC<Props> = ({ activities, summary, timeRange, topIssues = [], radarData = [] }) => {
  const insights = useMemo(() => {
    if (!summary || activities.length === 0) return null;

    const totalHours = Math.round(summary.totalExpectedStayMinutes / 60);

    // 找出最弱勢模組
    let weakestModule = { subject: '', score: 100 };
    radarData.forEach(r => {
      if (r.A < weakestModule.score && r.A > 0) {
        weakestModule = { subject: r.subject, score: r.A };
      }
    });

    const primaryIssue = topIssues.length > 0 ? topIssues[0] : null;

    return {
      totalHours,
      weakestModule,
      primaryIssue
    };
  }, [activities, summary, topIssues, radarData]);

  const dateRangeStr = useMemo(() => {
    if (!activities || activities.length === 0) return '';
    const dates = activities
      .map(a => a.createdAt ? new Date(a.createdAt).getTime() : 0)
      .filter(t => t > 0);
      
    if (dates.length === 0) return '';
    
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    
    const formatDate = (d: Date) => `${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
    
    if (formatDate(minDate) === formatDate(maxDate)) {
       return `(${formatDate(minDate)})`;
    }
    return `(${formatDate(minDate)} - ${formatDate(maxDate)})`;
  }, [activities]);

  if (!summary || !insights || !['week', 'month', 'last_week', 'all'].includes(timeRange)) {
    return null;
  }

  const rangeTextMap: Record<string, string> = {
    week: '本週',
    month: '本月',
    last_week: '上週',
    all: '歷史總計'
  };
  const rangeText = rangeTextMap[timeRange] || '本月';

  return (
    <div className="mb-6 p-5 sm:p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200 border-l-4 border-l-blue-500 relative overflow-hidden">
      {/* Decorative circle */}
      <div className="absolute -top-5 -right-5 w-24 h-24 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.1),transparent)] pointer-events-none" />

      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center shrink-0 shadow-sm">
          <Sparkles size={16} className="text-white" />
        </div>
        <div>
          <h2 className="text-[0.95rem] font-bold text-blue-900 leading-tight flex items-center gap-2 flex-wrap">
            高階主管 {rangeText} 營運重點摘要 
            {dateRangeStr && (
              <span className="text-xs text-blue-600 font-semibold bg-blue-100 px-2 py-0.5 rounded-full">
                {dateRangeStr}
              </span>
            )}
          </h2>
          <div className="text-[0.65rem] text-blue-400 tracking-wider mt-1 font-semibold">
            EXECUTIVE INSIGHTS
          </div>
        </div>
      </div>

      <p className="leading-relaxed text-sm text-gray-700 mb-5">
        本區間共完成 <strong className="text-blue-700 font-bold">{summary.totalVisits}</strong> 筆巡店紀錄，
        投入約 <strong className="text-blue-700 font-bold">{insights.totalHours}</strong> 小時於門市輔導。
        全台巡店覆蓋率達 <strong className="text-blue-600 font-bold">{summary.coverageRate ?? 0}%</strong> 
        （已巡視 {summary.uniqueVisitedStoresCount ?? 0} 家 / 總分派 {summary.assignedStoresCount ?? 0} 家）。
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 text-sm text-gray-700 bg-white/60 p-3 rounded-lg border border-white/40">
          <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            <strong className="text-rose-700 font-semibold">首要營運痛點：</strong>
            {insights.primaryIssue ? (
              <>最需關注的環節為「<strong className="text-gray-900 font-semibold">{insights.primaryIssue.category}</strong>」中的
              「<strong className="text-gray-900 font-semibold">{insights.primaryIssue.item}</strong>」（累計 {insights.primaryIssue.count} 件異常{insights.primaryIssue.stores && insights.primaryIssue.stores.length > 0 ? `，發生於：${insights.primaryIssue.stores.map(s => s.name).join('、')}` : ''}），建議通報各區主管加強要求。</>
            ) : (
              <span className="text-gray-500">目前區間尚無異常提報數據。</span>
            )}
          </span>
        </div>

        <div className="flex items-start gap-2 text-sm text-gray-700 bg-white/60 p-3 rounded-lg border border-white/40">
          <TrendingDown size={16} className="text-orange-600 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            <strong className="text-orange-800 font-semibold">模組表現弱勢：</strong>
            {insights.weakestModule.subject ? (
              <>六大模組中，以「<strong className="text-gray-900 font-semibold">{insights.weakestModule.subject}</strong>」表現較弱（平均得分 {insights.weakestModule.score} 分），應列為下階段輔導與教育訓練之重點。</>
            ) : (
              <span className="text-gray-500">目前尚無各模組評分數據。</span>
            )}
          </span>
        </div>

        <div className="flex items-start gap-2 text-sm text-gray-700 bg-white/60 p-3 rounded-lg border border-white/40">
          <Store size={16} className="text-red-700 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            <strong className="text-red-800 font-semibold">高風險門市警示：</strong>
            目前有 <strong className="text-red-500 font-bold">{summary.redLightStores ?? 0}</strong> 家門市被評為「需重點輔導」{(summary.redLightStores ?? 0) > 0 ? '，請盡速安排資源協助改善。' : '。'}
          </span>
        </div>

        <div className="flex items-start gap-2 text-sm text-gray-700 bg-white/60 p-3 rounded-lg border border-white/40">
          <Star size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            <strong className="text-amber-800 font-semibold">優良表現：</strong>
            本區間共發掘 <strong className="text-gray-900 font-semibold">{summary.highlightCount}</strong> 件好人好事，建議於內部會議中表揚，以凝聚團隊服務士氣。
          </span>
        </div>
      </div>
    </div>
  );
};

