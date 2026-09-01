import React from 'react';
import type { Manager } from '../types';
import { Users, TrendingUp, ArrowLeft } from 'lucide-react';

interface Props {
  managers: Manager[];
  selectedManager: Manager | null;
  onSelect: (manager: Manager | null) => void;
  timeRangeLabel?: string;
}

export const ManagerList: React.FC<Props> = ({ managers, selectedManager, onSelect, timeRangeLabel = '今日' }) => {
  const displayList = selectedManager
    ? managers.filter(m => m.areaManagerName === selectedManager.areaManagerName)
    : managers;

  const statusConfig = {
    '已完成': { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', dot: '#22c55e' },
    '巡店中': { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', dot: '#3b82f6' },
    '尚未回填': { color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb', dot: '#d1d5db' },
  };

  return (
    <aside style={{
      width: '290px',
      flexShrink: 0,
      background: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      padding: '18px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      height: 'fit-content',
      maxHeight: '80vh',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '28px', height: '28px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '7px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Users size={14} color="#2563eb" />
          </div>
          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#111827' }}>區主管進度</span>
        </div>
        {selectedManager && (
          <button
            onClick={() => onSelect(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '0.75rem', fontWeight: 600,
              color: '#2563eb',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '6px',
              padding: '3px 9px',
              cursor: 'pointer',
            }}
          >
            <ArrowLeft size={11} />
            返回
          </button>
        )}
      </div>

      {/* Stats Row */}
      {!selectedManager && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {[
            { label: '已完成', count: managers.filter(m => m.visitStatus === '已完成').length, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
            { label: '巡店中', count: managers.filter(m => m.visitStatus === '巡店中').length, color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
          ].map(stat => (
            <div key={stat.label} style={{
              background: stat.bg,
              border: `1px solid ${stat.border}`,
              borderRadius: '8px',
              padding: '10px 12px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: stat.color, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{stat.count}</div>
              <div style={{ fontSize: '0.68rem', color: stat.color, marginTop: '3px', fontWeight: 500, opacity: 0.8 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Manager Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', overflowY: 'auto', flex: 1 }}>
        {displayList.map((manager, idx) => {
          const isSelected = selectedManager?.areaManagerName === manager.areaManagerName;
          const status = manager.visitStatus || '尚未回填';
          const cfg = statusConfig[status as keyof typeof statusConfig] || statusConfig['尚未回填'];
          const progressPct = manager.assignedStoreCount
            ? Math.min(100, Math.round(((manager.todayVisitCount || 0) / manager.assignedStoreCount) * 100))
            : 0;

          return (
            <div
              key={idx}
              onClick={() => isSelected ? onSelect(null) : onSelect(manager)}
              style={{
                background: isSelected ? '#eff6ff' : '#ffffff',
                border: `1px solid ${isSelected ? '#bfdbfe' : '#e5e7eb'}`,
                borderRadius: '10px',
                padding: '12px',
                cursor: 'pointer',
                transition: 'all 0.15s',
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={e => {
                if (!isSelected) {
                  (e.currentTarget as HTMLDivElement).style.background = '#f9fafb';
                  (e.currentTarget as HTMLDivElement).style.borderColor = '#d1d5db';
                }
              }}
              onMouseLeave={e => {
                if (!isSelected) {
                  (e.currentTarget as HTMLDivElement).style.background = '#ffffff';
                  (e.currentTarget as HTMLDivElement).style.borderColor = '#e5e7eb';
                }
              }}
            >
              {/* Progress bar at bottom */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0,
                height: '2px',
                width: `${progressPct}%`,
                background: cfg.dot,
                borderRadius: '0 0 0 10px',
                transition: 'width 0.4s',
              }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '7px' }}>
                <div>
                  <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#111827', marginBottom: '1px' }}>
                    {manager.areaManagerName}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>
                    {manager.directorName} · {manager.region}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
                  <span style={{
                    fontSize: '0.67rem', fontWeight: 600,
                    color: cfg.color,
                    background: cfg.bg,
                    border: `1px solid ${cfg.border}`,
                    borderRadius: '99px', padding: '1px 6px',
                    whiteSpace: 'nowrap',
                  }}>{status}</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: '0.74rem', color: '#6b7280' }}>
                  {timeRangeLabel}：<span style={{ color: '#111827', fontWeight: 700 }}>{manager.todayVisitCount || 0}</span>
                  <span style={{ color: '#d1d5db', margin: '0 2px' }}>/</span>
                  <span>{manager.assignedStoreCount} 店</span>
                  {(manager.expectedStayMinutes || 0) > 0 && (
                    <span style={{ color: '#16a34a', marginLeft: '5px', fontWeight: 500 }}>
                      {manager.expectedStayMinutes}分
                    </span>
                  )}
                </div>
                <TrendingUp size={12} color={isSelected ? '#2563eb' : '#d1d5db'} />
              </div>

              {manager.visitedStores && manager.visitedStores.length > 0 && (
                <div style={{
                  marginTop: '7px',
                  fontSize: '0.68rem',
                  color: '#6b7280',
                  background: '#f9fafb',
                  borderRadius: '5px',
                  padding: '4px 7px',
                  lineHeight: 1.6,
                }}>
                  📍 {manager.visitedStores.join('、')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
