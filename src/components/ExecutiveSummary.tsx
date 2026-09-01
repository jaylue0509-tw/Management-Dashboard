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

  if (!summary || !insights || (timeRange !== 'week' && timeRange !== 'month' && timeRange !== 'last_week' && timeRange !== 'all')) {
    return null;
  }

  let rangeText = '本月';
  if (timeRange === 'week') rangeText = '本週';
  if (timeRange === 'last_week') rangeText = '上週';
  if (timeRange === 'all') rangeText = '歷史總計';

  return (
    <div style={{
      marginBottom: '22px',
      padding: '20px 24px',
      background: 'linear-gradient(135deg, #eff6ff 0%, #f5f3ff 100%)',
      borderRadius: '12px',
      border: '1px solid #bfdbfe',
      borderLeft: '4px solid #3b82f6',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Decorative circle */}
      <div style={{
        position: 'absolute', top: '-20px', right: '-20px',
        width: '100px', height: '100px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.1), transparent)',
        pointerEvents: 'none',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <div style={{
          width: '32px', height: '32px',
          background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
          borderRadius: '8px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Sparkles size={16} color="white" />
        </div>
        <div>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e3a8a', lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            高階主管 {rangeText} 營運重點摘要 
            {dateRangeStr && <span style={{ fontSize: '0.8rem', color: '#3b82f6', fontWeight: 600, background: '#dbeafe', padding: '2px 8px', borderRadius: '12px' }}>{dateRangeStr}</span>}
          </h2>
          <div style={{ fontSize: '0.67rem', color: '#93c5fd', letterSpacing: '0.05em', marginTop: '4px' }}>
            EXECUTIVE INSIGHTS
          </div>
        </div>
      </div>

      <p style={{ lineHeight: 1.7, fontSize: '0.875rem', color: '#374151', marginBottom: '16px' }}>
        本區間共完成 <strong style={{ color: '#1d4ed8' }}>{summary.totalVisits}</strong> 筆巡店紀錄，
        投入約 <strong style={{ color: '#1d4ed8' }}>{insights.totalHours}</strong> 小時於門市輔導。
        全台巡店覆蓋率達 <strong style={{ color: '#2563eb' }}>{summary.coverageRate ?? 0}%</strong> 
        （已巡視 {summary.uniqueVisitedStoresCount ?? 0} 家 / 總分派 {summary.assignedStoresCount ?? 0} 家）。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.85rem', color: '#374151' }}>
          <AlertTriangle size={15} color="#e11d48" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            <strong style={{ color: '#be123c' }}>首要營運痛點：</strong>
            {insights.primaryIssue ? (
              <>最需關注的環節為「<strong style={{ color: '#111827' }}>{insights.primaryIssue.category}</strong>」中的
              「<strong style={{ color: '#111827' }}>{insights.primaryIssue.item}</strong>」（累計 {insights.primaryIssue.count} 件異常{insights.primaryIssue.stores && insights.primaryIssue.stores.length > 0 ? `，發生於：${insights.primaryIssue.stores.map(s => s.name).join('、')}` : ''}），建議通報各區主管加強要求。</>
            ) : (
              <span style={{ color: '#6b7280' }}>目前區間尚無異常提報數據。</span>
            )}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.85rem', color: '#374151' }}>
          <TrendingDown size={15} color="#c2410c" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            <strong style={{ color: '#9a3412' }}>模組表現弱勢：</strong>
            {insights.weakestModule.subject ? (
              <>六大模組中，以「<strong style={{ color: '#111827' }}>{insights.weakestModule.subject}</strong>」表現較弱（平均得分 {insights.weakestModule.score} 分），應列為下階段輔導與教育訓練之重點。</>
            ) : (
              <span style={{ color: '#6b7280' }}>目前尚無各模組評分數據。</span>
            )}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.85rem', color: '#374151' }}>
          <Store size={15} color="#b91c1c" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            <strong style={{ color: '#991b1b' }}>高風險門市警示：</strong>
            目前有 <strong style={{ color: '#ef4444' }}>{summary.redLightStores ?? 0}</strong> 家門市被評為「需重點輔導」{(summary.redLightStores ?? 0) > 0 ? '，請盡速安排資源協助改善。' : '。'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.85rem', color: '#374151' }}>
          <Star size={15} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            <strong style={{ color: '#92400e' }}>優良表現：</strong>
            本區間共發掘 <strong style={{ color: '#111827' }}>{summary.highlightCount}</strong> 件好人好事，建議於內部會議中表揚，以凝聚團隊服務士氣。
          </span>
        </div>
      </div>
    </div>
  );
};

