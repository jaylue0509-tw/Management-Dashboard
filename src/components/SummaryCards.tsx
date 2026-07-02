import React from 'react';
import type { DashboardSummary } from '../types';

interface Props {
  summary: DashboardSummary | null;
}

export const SummaryCards: React.FC<Props> = ({ summary }) => {
  if (!summary) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
      <div className="card">
        <div className="text-sm text-gray-500 font-medium">今日巡店總筆數</div>
        <div className="text-4xl font-bold text-primary" style={{ marginTop: 'var(--space-2)' }}>{summary.totalVisits}</div>
      </div>
      <div className="card">
        <div className="text-sm text-gray-500 font-medium">發現異常事項</div>
        <div className="text-4xl font-bold" style={{ color: 'var(--color-error)', marginTop: 'var(--space-2)' }}>{summary.abnormalIssuesCount}</div>
      </div>
      <div className="card">
        <div className="text-sm text-gray-500 font-medium">預計停留總時數</div>
        <div className="text-4xl font-bold" style={{ color: 'var(--color-success)', marginTop: 'var(--space-2)' }}>
          {summary.totalExpectedStayMinutes} <span className="text-base text-gray-500 font-normal">分</span>
        </div>
      </div>
      <div className="card">
        <div className="text-sm text-gray-500 font-medium">優良表現分享</div>
        <div className="text-4xl font-bold" style={{ color: 'var(--color-warning)', marginTop: 'var(--space-2)' }}>{summary.highlightCount}</div>
      </div>
    </div>
  );
};
