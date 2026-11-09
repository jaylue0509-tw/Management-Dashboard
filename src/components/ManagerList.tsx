import React, { useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Manager } from '../types';
import { Users, TrendingUp, ArrowLeft, ChevronDown, ChevronUp, Compass } from 'lucide-react';

export type ManagerStatusFilter = 'all' | 'completed' | 'visiting' | 'schedule' | 'unvisited';

interface Props {
  managers: Manager[];
  selectedManager: Manager | null;
  onSelect: (manager: Manager | null) => void;
  timeRangeLabel?: string;
  onStoreSelect?: (storeName: string) => void;
  onScheduleSelect?: (managerName: string, scheduleType?: string) => void;
  onStatusFilterSelect?: (filter: ManagerStatusFilter, matchedManagers: Manager[]) => void;
}

export const ManagerList: React.FC<Props> = ({
  managers,
  selectedManager,
  onSelect,
  timeRangeLabel = '今日',
  onStoreSelect,
  onScheduleSelect,
  onStatusFilterSelect,
}) => {
  const { user } = useAuth();
  const [isMobileExpanded, setIsMobileExpanded] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ManagerStatusFilter>('all');

  const isScheduleManager = (m: Manager) =>
    ['總部行程', '會議行程', '特殊行程'].includes(m.visitStatus || '') ||
    Boolean(m.todaySchedules && m.todaySchedules.length > 0);

  const matchStatusFilter = (m: Manager, filter: ManagerStatusFilter): boolean => {
    if (filter === 'all') return true;
    if (filter === 'completed') return m.visitStatus === '已完成';
    if (filter === 'visiting') return m.visitStatus === '巡店中';
    if (filter === 'schedule') return isScheduleManager(m);
    if (filter === 'unvisited') return (m.visitStatus || '尚未回填') === '尚未回填' && !isScheduleManager(m);
    return true;
  };

  const displayList = useMemo(() => {
    const base = selectedManager
      ? managers.filter(m => m.areaManagerName === selectedManager.areaManagerName)
      : managers.filter(m => matchStatusFilter(m, statusFilter));
    return [...base].sort((a, b) => {
      const aActive = (a.todayVisitCount || 0) > 0 || (a.todaySchedules?.length || 0) > 0 ? 1 : 0;
      const bActive = (b.todayVisitCount || 0) > 0 || (b.todaySchedules?.length || 0) > 0 ? 1 : 0;
      if (bActive !== aActive) return bActive - aActive;
      return (b.todayVisitCount || 0) - (a.todayVisitCount || 0);
    });
  }, [managers, selectedManager, statusFilter]);

  const statusConfig = {
    '已完成': { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', dot: '#22c55e' },
    '巡店中': { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', dot: '#3b82f6' },
    '總部行程': { color: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe', dot: '#6366f1' },
    '會議行程': { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', dot: '#8b5cf6' },
    '特殊行程': { color: '#d97706', bg: '#fffbeb', border: '#fde68a', dot: '#f59e0b' },
    '尚未回填': { color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb', dot: '#d1d5db' },
  };

  const statsItems: {
    key: ManagerStatusFilter;
    label: string;
    count: number;
    color: string;
    bg: string;
    border: string;
    activeRing: string;
  }[] = [
    {
      key: 'completed',
      label: '已完成',
      count: managers.filter(m => m.visitStatus === '已完成').length,
      color: '#16a34a',
      bg: '#f0fdf4',
      border: '#bbf7d0',
      activeRing: '#16a34a',
    },
    {
      key: 'visiting',
      label: '巡店中',
      count: managers.filter(m => m.visitStatus === '巡店中').length,
      color: '#2563eb',
      bg: '#eff6ff',
      border: '#bfdbfe',
      activeRing: '#2563eb',
    },
    {
      key: 'schedule',
      label: '公務行程',
      count: managers.filter(m => isScheduleManager(m)).length,
      color: '#4f46e5',
      bg: '#eef2ff',
      border: '#c7d2fe',
      activeRing: '#4f46e5',
    },
  ];

  const handleStatBoxClick = (targetKey: ManagerStatusFilter) => {
    const nextFilter: ManagerStatusFilter = statusFilter === targetKey ? 'all' : targetKey;
    setStatusFilter(nextFilter);
    setIsMobileExpanded(true);
    if (selectedManager) {
      onSelect(null);
    }
    const matched = managers.filter(m => matchStatusFilter(m, nextFilter));
    onStatusFilterSelect?.(nextFilter, matched);

    // 若篩選出對應主管，自動平滑定位至第一張區主管卡片或右側動態牆
    if (nextFilter !== 'all' && matched.length > 0) {
      setTimeout(() => {
        const firstMgr = matched[0];
        const cardEl = document.getElementById(`manager-card-${firstMgr.areaManagerName}`);
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 80);
    }
  };

  const scrollToManagerCard = (mgrName: string) => {
    setIsMobileExpanded(true);
    setTimeout(() => {
      const el = document.getElementById(`manager-card-${mgrName}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.35)';
        setTimeout(() => {
          el.style.boxShadow = '';
        }, 1600);
      }
    }, 60);
  };

  return (
    <aside
      id="section-managers"
      className="w-full md:w-[280px] lg:w-[310px] shrink-0 bg-white rounded-xl border border-gray-200 p-4 sm:p-[18px] flex flex-col gap-3.5 h-fit md:max-h-[84vh] shadow-sm"
    >
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
          {statusFilter !== 'all' && !selectedManager && (
            <button
              type="button"
              onClick={() => handleStatBoxClick(statusFilter)}
              className="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-2 py-1 cursor-pointer transition-colors"
            >
              顯示全部 ({managers.length})
            </button>
          )}
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

      {/* 可點擊連動的統計數字卡 (已完成 / 巡店中 / 公務行程) */}
      {!selectedManager && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            {statsItems.map(stat => {
              const isActive = statusFilter === stat.key;
              return (
                <button
                  key={stat.key}
                  type="button"
                  onClick={() => handleStatBoxClick(stat.key)}
                  title={`點擊篩選並定位「${stat.label}」之區主管與動態明細`}
                  style={{
                    background: stat.bg,
                    border: isActive ? `2px solid ${stat.activeRing}` : `1px solid ${stat.border}`,
                    borderRadius: '10px',
                    padding: isActive ? '7px 5px' : '8px 6px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    boxShadow: isActive ? `0 3px 10px ${stat.border}` : 'none',
                    transform: isActive ? 'translateY(-1px)' : 'none',
                  }}
                >
                  <div style={{
                    fontSize: '1.35rem',
                    fontWeight: 800,
                    color: stat.color,
                    lineHeight: 1.1,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {stat.count}
                  </div>
                  <div style={{
                    fontSize: '0.68rem',
                    color: stat.color,
                    marginTop: '3px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2px',
                  }}>
                    <span>{stat.label}</span>
                    <span style={{ fontSize: '0.6rem', opacity: 0.75 }}>{isActive ? '✕' : '➔'}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 區域／主管快速定位索引列 */}
          {managers.length > 1 && (
            <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                  <Compass size={11} className="text-blue-600" />
                  {statusFilter === 'all'
                    ? '區主管快速索引（點選定位）'
                    : `已篩選「${statsItems.find(s => s.key === statusFilter)?.label}」(${displayList.length} 人)`}
                </span>
                {statusFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => handleStatBoxClick(statusFilter)}
                    className="text-[10px] text-blue-600 font-bold hover:underline cursor-pointer"
                  >
                    清除篩選
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {displayList.map(m => {
                  const hasAct = (m.todayVisitCount || 0) > 0;
                  const hasSch = isScheduleManager(m);
                  return (
                    <button
                      key={m.areaManagerName}
                      type="button"
                      onClick={() => {
                        scrollToManagerCard(m.areaManagerName);
                        if (statusFilter === 'schedule' && hasSch) {
                          onScheduleSelect?.(m.areaManagerName);
                        } else if (hasAct && m.visitedStores && m.visitedStores.length > 0) {
                          onStoreSelect?.(m.visitedStores[0]);
                        } else if (hasSch) {
                          onScheduleSelect?.(m.areaManagerName);
                        }
                      }}
                      className={`text-[11px] px-2 py-0.5 rounded-md font-semibold border transition-all cursor-pointer flex items-center gap-1 ${
                        hasAct
                          ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                          : hasSch
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                      title={`${m.region} - ${m.areaManagerName}${m.deputyManagerName ? `（副區主管：${m.deputyManagerName}）` : ''}（點擊自動定位至畫面明細）`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{
                          background: hasAct ? '#2563eb' : hasSch ? '#4f46e5' : '#d1d5db',
                        }}
                      />
                      <span>{m.areaManagerName}{m.deputyManagerName ? ` · ${m.deputyManagerName}` : ''}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manager Cards */}
      <div className="flex flex-col gap-2.5 md:overflow-y-auto md:flex-1 md:pr-0.5">
        {displayList.length === 0 ? (
          <div className="text-center py-6 px-3 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-xs text-gray-500">
            目前無符合「{statsItems.find(s => s.key === statusFilter)?.label || '篩選條件'}」的區主管紀錄
            <div className="mt-2">
              <button
                type="button"
                onClick={() => handleStatBoxClick(statusFilter)}
                className="text-blue-600 font-bold hover:underline cursor-pointer"
              >
                返回顯示全部主管
              </button>
            </div>
          </div>
        ) : (
          displayList.map((manager, idx) => {
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
                id={`manager-card-${manager.areaManagerName}`}
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
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#111827', marginBottom: '3px', lineHeight: 1.3, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px' }}>
                      <span>{manager.areaManagerName}</span>
                      {manager.deputyManagerName && (
                        <span style={{
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          color: '#0369a1',
                          background: '#e0f2fe',
                          border: '1px solid #bae6fd',
                          borderRadius: '5px',
                          padding: '1px 6px',
                          whiteSpace: 'nowrap',
                        }}>
                          副區主管：{manager.deputyManagerName}
                        </span>
                      )}
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
                  <div
                    onClick={e => {
                      e.stopPropagation();
                      onScheduleSelect?.(manager.areaManagerName, manager.todaySchedules?.[0]?.type);
                    }}
                    style={{
                      marginTop: '8px',
                      fontSize: '0.74rem',
                      color: '#4338ca',
                      background: '#eef2ff',
                      border: '1px solid #c7d2fe',
                      borderRadius: '7px',
                      padding: '6px 9px',
                      lineHeight: 1.5,
                      fontWeight: 600,
                      cursor: onScheduleSelect ? 'pointer' : 'default',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                    }}
                    title="點擊自動移至下方公務行程明細"
                  >
                    <div>
                      {manager.todaySchedules.map((sch, sIdx) => (
                        <div key={sIdx}>
                          {sch.type === '總部行程' ? '🏢' : sch.type === '會議行程' ? '📅' : '⭐'} {sch.type}：{sch.note}
                        </div>
                      ))}
                    </div>
                    {onScheduleSelect && (
                      <span style={{ fontSize: '0.68rem', color: '#4f46e5', fontWeight: 800, flexShrink: 0 }}>
                        定位 ➔
                      </span>
                    )}
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
                        📍 {st} ➔
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

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
