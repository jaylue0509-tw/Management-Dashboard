import React, { useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Manager } from '../types';
import { Users, TrendingUp, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  managers: Manager[];
  selectedManager: Manager | null;
  onSelect: (manager: Manager | null) => void;
  timeRangeLabel?: string;
  onStoreSelect?: (storeName: string) => void;
}

export const ManagerList: React.FC<Props> = ({
  managers,
  selectedManager,
  onSelect,
  timeRangeLabel = '今日',
  onStoreSelect,
}) => {
  const { user } = useAuth();
  const [isMobileExpanded, setIsMobileExpanded] = useState(true);

  const displayList = useMemo(() => {
    const base = selectedManager
      ? managers.filter(m => m.areaManagerName === selectedManager.areaManagerName)
      : managers;
    return [...base].sort((a, b) => {
      const aActive = (a.todayVisitCount || 0) > 0 || (a.todaySchedules?.length || 0) > 0 ? 1 : 0;
      const bActive = (b.todayVisitCount || 0) > 0 || (b.todaySchedules?.length || 0) > 0 ? 1 : 0;
      if (bActive !== aActive) return bActive - aActive;
      return (b.todayVisitCount || 0) - (a.todayVisitCount || 0);
    });
  }, [managers, selectedManager]);

  const statusConfig = {
    '已完成': { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', dot: '#22c55e' },
    '巡店中': { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', dot: '#3b82f6' },
    '總部行程': { color: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe', dot: '#6366f1' },
    '會議行程': { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', dot: '#8b5cf6' },
    '特殊行程': { color: '#d97706', bg: '#fffbeb', border: '#fde68a', dot: '#f59e0b' },
    '尚未回填': { color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb', dot: '#d1d5db' },
  };

  return (
    <aside className="w-full md:w-[270px] lg:w-[300px] shrink-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-[18px] flex flex-col gap-3.5 h-fit md:max-h-[82vh] shadow-sm">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '28px', height: '28px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '7px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Users size={14} color="#2563eb" />
          </div>
          <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#111827' }}>
            {user?.role === 'manager' ? '我的巡店進度' : '區主管進度'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {!selectedManager && displayList.length > 3 && (
            <button
              type="button"
              onClick={() => setIsMobileExpanded(prev => !prev)}
              className="md:hidden flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1 cursor-pointer"
            >
              <span>{isMobileExpanded ? '收合列表' : `展開全部 (${displayList.length})`}</span>
              {isMobileExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
          {selectedManager && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '0.75rem', fontWeight: 600,
                color: '#2563eb',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '6px',
                padding: '4px 10px',
                cursor: 'pointer',
              }}
            >
              <ArrowLeft size={11} />
              返回
            </button>
          )}
        </div>
      </div>

      {/* Stats Row */}
      {!selectedManager && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', flexShrink: 0 }}>
          {[
            { label: '已完成', count: managers.filter(m => m.visitStatus === '已完成').length, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
            { label: '巡店中', count: managers.filter(m => m.visitStatus === '巡店中').length, color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
            { label: '公務行程', count: managers.filter(m => ['總部行程', '會議行程', '特殊行程'].includes(m.visitStatus || '') || (m.todaySchedules && m.todaySchedules.length > 0)).length, color: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe' },
          ].map(stat => (
            <div key={stat.label} style={{
              background: stat.bg,
              border: `1px solid ${stat.border}`,
              borderRadius: '8px',
              padding: '8px 6px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: stat.color, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{stat.count}</div>
              <div style={{ fontSize: '0.68rem', color: stat.color, marginTop: '3px', fontWeight: 600, opacity: 0.9 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Manager Cards */}
      <div className="flex flex-col gap-2.5 md:overflow-y-auto md:flex-1 md:pr-0.5">
        {displayList.map((manager, idx) => {
          const isHiddenOnMobile = !isMobileExpanded && !selectedManager && idx >= 3;
          const isSelected = selectedManager?.areaManagerName === manager.areaManagerName;
          const status = manager.visitStatus || '尚未回填';
          const cfg = statusConfig[status as keyof typeof statusConfig] || statusConfig['尚未回填'];
          const hasSchedule = !!(manager.todaySchedules && manager.todaySchedules.length > 0);
          const progressPct = hasSchedule && (manager.todayVisitCount || 0) === 0
            ? 100
            : manager.assignedStoreCount
            ? Math.min(100, Math.round(((manager.todayVisitCount || 0) / manager.assignedStoreCount) * 100))
            : 0;

          return (
            <div
              key={manager.areaManagerName || idx}
              onClick={() => isSelected ? onSelect(null) : onSelect(manager)}
              className={isHiddenOnMobile ? 'hidden md:block' : 'block'}
              style={{
                flexShrink: 0,
                background: isSelected ? '#eff6ff' : '#ffffff',
                border: `1px solid ${isSelected ? '#93c5fd' : '#e5e7eb'}`,
                borderRadius: '10px',
                padding: '13px 14px',
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
                height: '3px',
                width: `${progressPct}%`,
                background: cfg.dot,
                borderRadius: '0 0 0 10px',
                transition: 'width 0.4s',
              }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#111827', marginBottom: '2px', lineHeight: 1.3 }}>
                    {manager.areaManagerName}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#6b7280', lineHeight: 1.3 }}>
                    {manager.directorName ? `${manager.directorName} · ` : ''}{manager.region}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 600,
                    color: cfg.color,
                    background: cfg.bg,
                    border: `1px solid ${cfg.border}`,
                    borderRadius: '99px', padding: '2px 8px',
                    whiteSpace: 'nowrap',
                  }}>{status}</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ fontSize: '0.78rem', color: '#4b5563' }}>
                  {timeRangeLabel}：<span style={{ color: '#111827', fontWeight: 700 }}>{manager.todayVisitCount || 0}</span>
                  <span style={{ color: '#9ca3af', margin: '0 3px' }}>/</span>
                  <span>{manager.assignedStoreCount} 店</span>
                  {(manager.expectedStayMinutes || 0) > 0 && (
                    <span style={{ color: '#16a34a', marginLeft: '6px', fontWeight: 600 }}>
                      · {manager.expectedStayMinutes}分
                    </span>
                  )}
                </div>
                <TrendingUp size={13} color={isSelected ? '#2563eb' : '#d1d5db'} style={{ flexShrink: 0 }} />
              </div>

              {manager.todaySchedules && manager.todaySchedules.length > 0 && (
                <div style={{
                  marginTop: '8px',
                  fontSize: '0.74rem',
                  color: '#4338ca',
                  background: '#eef2ff',
                  border: '1px solid #c7d2fe',
                  borderRadius: '7px',
                  padding: '6px 9px',
                  lineHeight: 1.5,
                  fontWeight: 600,
                }}>
                  {manager.todaySchedules.map((sch, sIdx) => (
                    <div key={sIdx}>
                      {sch.type === '總部行程' ? '🏢' : sch.type === '會議行程' ? '📅' : '⭐'} {sch.type}：{sch.note}
                    </div>
                  ))}
                </div>
              )}

              {manager.visitedStores && manager.visitedStores.length > 0 && (
                <div style={{
                  marginTop: '8px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '5px',
                }}>
                  {manager.visitedStores.map((st, sIdx) => (
                    <button
                      key={sIdx}
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onStoreSelect?.(st);
                      }}
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        color: '#2563eb',
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '6px',
                        padding: '3px 8px',
                        cursor: onStoreSelect ? 'pointer' : 'default',
                        transition: 'all 0.15s',
                      }}
                      title="點擊自動移至該門市細節"
                    >
                      📍 {st}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {!isMobileExpanded && !selectedManager && displayList.length > 3 && (
          <button
            type="button"
            onClick={() => setIsMobileExpanded(true)}
            className="md:hidden w-full py-2.5 text-xs font-bold text-blue-600 bg-blue-50/70 hover:bg-blue-100 border border-blue-200 rounded-xl flex items-center justify-center gap-1 cursor-pointer transition-colors"
          >
            <span>展開其餘 {displayList.length - 3} 位區主管進度</span>
            <ChevronDown size={14} />
          </button>
        )}
      </div>
    </aside>
  );
};
