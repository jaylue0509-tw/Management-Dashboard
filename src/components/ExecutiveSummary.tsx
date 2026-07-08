import React, { useMemo } from 'react';
import type { VisitRecord, DashboardSummary } from '../types';
import { Sparkles, AlertTriangle, Star } from 'lucide-react';

interface Props {
  activities: VisitRecord[];
  summary: DashboardSummary | null;
  timeRange: string;
}

export const ExecutiveSummary: React.FC<Props> = ({ activities, summary, timeRange }) => {
  const insights = useMemo(() => {
    if (!summary || activities.length === 0) return null;

    const totalHours = Math.round(summary.totalExpectedStayMinutes / 60);

    // 找出最積極的區主管
    const managerCounts: Record<string, number> = {};
    activities.forEach(a => {
      managerCounts[a.areaManagerName] = (managerCounts[a.areaManagerName] || 0) + 1;
    });
    
    let topManager = '';
    let maxVisits = 0;
    Object.entries(managerCounts).forEach(([name, count]) => {
      if (count > maxVisits) {
        maxVisits = count;
        topManager = name;
      }
    });

    // 找出異常熱區
    const regionAbnormalCounts: Record<string, number> = {};
    activities.filter(a => a.abnormalFlag).forEach(a => {
      regionAbnormalCounts[a.region] = (regionAbnormalCounts[a.region] || 0) + 1;
    });

    let topAbnormalRegion = '';
    let maxAbnormal = 0;
    Object.entries(regionAbnormalCounts).forEach(([region, count]) => {
      if (count > maxAbnormal) {
        maxAbnormal = count;
        topAbnormalRegion = region;
      }
    });

    return {
      totalHours,
      topManager,
      maxVisits,
      topAbnormalRegion,
      maxAbnormal
    };
  }, [activities, summary]);

  if (!summary || !insights || (timeRange !== 'week' && timeRange !== 'month')) {
    return null;
  }

  const rangeText = timeRange === 'week' ? '本週' : '本月';

  return (
    <div className="card" style={{ 
      marginBottom: 'var(--space-6)', 
      padding: 'var(--space-6)',
      background: 'linear-gradient(to right, var(--color-primary-50), #ffffff)',
      borderLeft: '4px solid var(--color-primary-500)'
    }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-3)' }}>
        <Sparkles size={20} className="text-primary" />
        <h2 className="text-lg font-bold text-gray-900">
          高階主管 {rangeText} 營運重點摘要
        </h2>
      </div>
      
      <p className="text-gray-700" style={{ lineHeight: '1.6', fontSize: '1.05rem', marginBottom: 'var(--space-3)' }}>
        本區間總計完成 <strong>{summary.totalVisits}</strong> 筆巡店紀錄，累計投入約 <strong>{insights.totalHours}</strong> 小時於門市輔導。
        {insights.topManager && (
          <span>其中表現最積極的主管為 <strong>{insights.topManager}</strong>（共完成 {insights.maxVisits} 筆）。</span>
        )}
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-gray-700">
          <AlertTriangle size={18} style={{ color: 'var(--color-error)' }} />
          <span>
            <strong>異常狀態：</strong>共回報 <strong>{summary.abnormalIssuesCount}</strong> 件異常
            {insights.topAbnormalRegion && `，主要集中於「${insights.topAbnormalRegion}」`}。
          </span>
        </div>
        
        <div className="flex items-center gap-2 text-gray-700">
          <Star size={18} style={{ color: 'var(--color-warning)' }} />
          <span>
            <strong>優良事蹟：</strong>各區共提報了 <strong>{summary.highlightCount}</strong> 件好人好事，展現了良好的服務文化。
          </span>
        </div>
      </div>
    </div>
  );
};
