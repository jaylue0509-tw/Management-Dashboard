import React, { useState, useMemo } from 'react';
import type { DashboardSummary, Manager } from '../types';
import { TrendingUp, CheckCircle, AlertTriangle, ClipboardList, Zap, MapPin, Search } from 'lucide-react';
import { storeRegions } from '../data/storeRegions';

interface Props {
  summary: DashboardSummary | null;
  managers?: Manager[];
  onStoreSelect?: (storeName: string, recordId?: string) => void;
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  valueColor: string;
  iconBg: string;
  borderTop: string;
  trend?: string;
  trendColor?: string;
  description?: string;
  storeList?: string[];
  unvisitedList?: string[];
  openPdcaList?: string[];
  redLightStoresList?: { store: string; reasons: string[]; reportTime?: string; recordId?: string }[];
  abnormalStoresList?: { store: string; reasons: string[]; reportTime?: string; recordId?: string }[];
  subText?: React.ReactNode;
  onClick?: () => void;
}

const normalizeStoreName = (name: string): string => (name || '').trim().replace(/店$/, '');

const REGION_ORDER = Object.keys(storeRegions);

const StoreTag: React.FC<{
  store: string;
  type?: 'default' | 'danger' | 'warning' | 'gray';
  onClick?: () => void;
}> = ({ store, type = 'default', onClick }) => {
  let bg = '#eff6ff';
  let color = '#1d4ed8';
  let border = '#bfdbfe';
  if (type === 'danger') {
    bg = '#fef2f2';
    color = '#b91c1c';
    border = '#fca5a5';
  }
  if (type === 'warning') {
    bg = '#fffbeb';
    color = '#b45309';
    border = '#fcd34d';
  }
  if (type === 'gray') {
    bg = '#f9fafb';
    color = '#6b7280';
    border = '#e5e7eb';
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        fontSize: '0.76rem',
        fontWeight: 600,
        color,
        background: bg,
        border: `1px solid ${border}`,
        padding: '4px 10px',
        borderRadius: '7px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(-1px)';
          e.currentTarget.style.boxShadow = '0 2px 6px rgba(37, 99, 235, 0.15)';
        }
      }}
      onMouseLeave={e => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }
      }}
    >
      <span>{store}</span>
      {onClick && <span style={{ fontSize: '0.68rem', opacity: 0.8 }}>➔</span>}
    </button>
  );
};

interface RegionGroupedStoreListProps {
  stores: string[];
  tagType?: 'default' | 'danger' | 'warning' | 'gray';
  emptyText?: string;
  getRegionInfo: (store: string) => { region: string; managerLabel: string };
  onStoreClick?: (store: string) => void;
}

/**
 * 依區域分組顯示門市清單，支援頂部區域快速篩選膠囊與關鍵字搜尋
 */
const RegionGroupedStoreList: React.FC<RegionGroupedStoreListProps> = ({
  stores,
  tagType = 'default',
  emptyText = '目前無門市紀錄',
  getRegionInfo,
  onStoreClick,
}) => {
  const [selectedRegion, setSelectedRegion] = useState<string>('全部');
  const [keyword, setKeyword] = useState<string>('');

  const groupedByRegion = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const map = new Map<string, { region: string; managerLabel: string; stores: string[] }>();

    for (const store of stores) {
      const info = getRegionInfo(store);
      if (
        q &&
        !store.toLowerCase().includes(q) &&
        !info.region.toLowerCase().includes(q) &&
        !info.managerLabel.toLowerCase().includes(q)
      ) {
        continue;
      }
      if (!map.has(info.region)) {
        map.set(info.region, {
          region: info.region,
          managerLabel: info.managerLabel,
          stores: [],
        });
      }
      map.get(info.region)!.stores.push(store);
    }

    return Array.from(map.values()).sort((a, b) => {
      const idxA = REGION_ORDER.indexOf(a.region);
      const idxB = REGION_ORDER.indexOf(b.region);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return b.stores.length - a.stores.length;
    });
  }, [stores, getRegionInfo, keyword]);

  // 全部區域統計（不受關鍵字過濾影響之頂部區域頁籤）
  const allRegionsSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const store of stores) {
      const { region } = getRegionInfo(store);
      map.set(region, (map.get(region) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => {
        const idxA = REGION_ORDER.indexOf(a.region);
        const idxB = REGION_ORDER.indexOf(b.region);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return b.count - a.count;
      });
  }, [stores, getRegionInfo]);

  const visibleGroups = useMemo(() => {
    if (selectedRegion === '全部') return groupedByRegion;
    return groupedByRegion.filter(g => g.region === selectedRegion);
  }, [groupedByRegion, selectedRegion]);

  if (!stores || stores.length === 0) {
    return <div className="text-xs text-gray-400 py-3">{emptyText}</div>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* 區域快速篩選膠囊列 + 搜尋框 */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex flex-col gap-2">
        {allRegionsSummary.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1 mr-0.5">
              <MapPin size={12} className="text-blue-600" />
              分區快選：
            </span>
            <button
              type="button"
              onClick={() => setSelectedRegion('全部')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                selectedRegion === '全部'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50 hover:text-blue-600'
              }`}
            >
              全部區域 ({stores.length})
            </button>
            {allRegionsSummary.map(r => {
              const active = selectedRegion === r.region;
              return (
                <button
                  key={r.region}
                  type="button"
                  onClick={() => setSelectedRegion(active ? '全部' : r.region)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50 hover:text-blue-600'
                  }`}
                >
                  {r.region} ({r.count})
                </button>
              );
            })}
          </div>
        )}

        {stores.length > 6 && (
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="輸入門市、區域或區主管名稱快速查找..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* 分區門市卡片區塊 */}
      {visibleGroups.length === 0 ? (
        <div className="text-center py-4 text-xs text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
          找不到符合篩選條件的門市
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visibleGroups.map(group => (
            <div
              key={group.region}
              className="bg-white border border-gray-200 rounded-xl p-3 shadow-2xs"
            >
              <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-gray-100">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-extrabold bg-blue-50 text-blue-700 border border-blue-200">
                    📍 {group.region}
                  </span>
                  {group.managerLabel && (
                    <span className="text-xs font-semibold text-gray-500">
                      {group.managerLabel}
                    </span>
                  )}
                </div>
                <span className="text-xs font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                  {group.stores.length} 間門市
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.stores.map(store => (
                  <StoreTag
                    key={store}
                    store={store}
                    type={tagType}
                    onClick={onStoreClick ? () => onStoreClick(store) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface DetailedStoreItem {
  store: string;
  reasons: string[];
  reportTime?: string;
  recordId?: string;
}

interface RegionGroupedDetailListProps {
  items: DetailedStoreItem[];
  variant: 'danger' | 'warning';
  getRegionInfo: (store: string) => { region: string; managerLabel: string };
  onStoreClick?: (store: string, recordId?: string) => void;
}

/**
 * 依區域分組顯示含異常／紅燈原因的門市卡片清單
 */
const RegionGroupedDetailList: React.FC<RegionGroupedDetailListProps> = ({
  items,
  variant,
  getRegionInfo,
  onStoreClick,
}) => {
  const [selectedRegion, setSelectedRegion] = useState<string>('全部');

  const grouped = useMemo(() => {
    const map = new Map<string, { region: string; managerLabel: string; list: DetailedStoreItem[] }>();
    for (const item of items) {
      const info = getRegionInfo(item.store);
      if (!map.has(info.region)) {
        map.set(info.region, {
          region: info.region,
          managerLabel: info.managerLabel,
          list: [],
        });
      }
      map.get(info.region)!.list.push(item);
    }
    return Array.from(map.values()).sort((a, b) => {
      const idxA = REGION_ORDER.indexOf(a.region);
      const idxB = REGION_ORDER.indexOf(b.region);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      return b.list.length - a.list.length;
    });
  }, [items, getRegionInfo]);

  const visibleGroups = useMemo(() => {
    if (selectedRegion === '全部') return grouped;
    return grouped.filter(g => g.region === selectedRegion);
  }, [grouped, selectedRegion]);

  if (!items || items.length === 0) {
    return <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>目前無門市紀錄</span>;
  }

  const isDanger = variant === 'danger';

  return (
    <div className="flex flex-col gap-3">
      {grouped.length > 1 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1 mr-0.5">
            <MapPin size={12} className="text-blue-600" />
            分區快選：
          </span>
          <button
            type="button"
            onClick={() => setSelectedRegion('全部')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
              selectedRegion === '全部'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50'
            }`}
          >
            全部區域 ({items.length})
          </button>
          {grouped.map(g => {
            const active = selectedRegion === g.region;
            return (
              <button
                key={g.region}
                type="button"
                onClick={() => setSelectedRegion(active ? '全部' : g.region)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50'
                }`}
              >
                {g.region} ({g.list.length})
              </button>
            );
          })}
        </div>
      )}

      {visibleGroups.map(group => (
        <div key={group.region} className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-gray-100">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-extrabold bg-blue-50 text-blue-700 border border-blue-200">
                📍 {group.region}
              </span>
              {group.managerLabel && (
                <span className="text-xs font-semibold text-gray-500">{group.managerLabel}</span>
              )}
            </div>
            <span className="text-xs font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
              {group.list.length} 間
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {group.list.map(item => (
              <div
                key={item.store}
                onClick={() => onStoreClick?.(item.store, item.recordId)}
                style={{
                  background: isDanger ? '#fef2f2' : '#fffbeb',
                  border: `1px solid ${isDanger ? '#fca5a5' : '#fcd34d'}`,
                  padding: '10px 14px',
                  borderRadius: '8px',
                  cursor: onStoreClick ? 'pointer' : 'default',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '4px' }}>
                  <div style={{ fontWeight: 700, color: isDanger ? '#b91c1c' : '#b45309', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>📍 {item.store}</span>
                    {onStoreClick && (
                      <span style={{ fontSize: '0.7rem', background: isDanger ? '#fee2e2' : '#fef3c7', padding: '1px 6px', borderRadius: '99px' }}>
                        查看細節 ➔
                      </span>
                    )}
                  </div>
                  {item.reportTime && (
                    <div style={{ fontSize: '0.75rem', color: isDanger ? '#991b1b' : '#92400e', background: isDanger ? '#fee2e2' : '#fef3c7', padding: '2px 6px', borderRadius: '4px' }}>
                      回報時間: {item.reportTime}
                    </div>
                  )}
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px', color: isDanger ? '#7f1d1d' : '#92400e', fontSize: '0.8rem', lineHeight: '1.4' }}>
                  {item.reasons.map((r, i) => (
                    <li key={i} style={{ marginBottom: '2px' }}>{r}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const MetricCard: React.FC<MetricCardProps & { className?: string }> = ({
  icon, label, value, unit, valueColor, iconBg, borderTop, trend, trendColor, subText, onClick, className = ''
}) => (
  <div
    onClick={onClick}
    className={`p-3.5 sm:p-5 ${className}`}
    style={{
      background: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      borderTop: `3px solid ${borderTop}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      transition: 'box-shadow 0.15s, transform 0.15s',
      cursor: 'pointer',
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.09)';
      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)';
      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
    }}
  >
    <div className="flex items-start justify-between mb-2.5 sm:mb-3.5">
      <div
        className="w-8 h-8 sm:w-[38px] sm:h-[38px] rounded-[10px] flex items-center justify-center"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
      {trend && (
        <span style={{
          fontSize: '0.7rem', fontWeight: 600,
          color: trendColor || '#16a34a',
          background: trendColor === '#e11d48' ? '#fff1f2' : '#f0fdf4',
          border: `1px solid ${trendColor === '#e11d48' ? '#fecdd3' : '#bbf7d0'}`,
          borderRadius: '99px', padding: '2px 8px',
        }}>{trend}</span>
      )}
    </div>

    <div className="text-gray-500 text-xs sm:text-[0.78rem] font-medium tracking-wide mb-1 sm:mb-1.5">
      {label}
    </div>

    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
      <span
        className="text-3xl sm:text-[2.4rem] font-extrabold leading-none tracking-tight tabular-nums"
        style={{ color: valueColor }}
      >
        {value}
      </span>
      {unit && (
        <span className="text-xs sm:text-[0.95rem] font-medium text-gray-400">
          {unit}
        </span>
      )}
    </div>
    {subText && (
      <div className="mt-1.5 text-xs sm:text-[0.82rem] text-gray-500 font-semibold leading-snug">
        {subText}
      </div>
    )}
  </div>
);

export const SummaryCards: React.FC<Props & { regionLabel?: string; periodLabel?: string }> = ({
  summary,
  managers = [],
  regionLabel = '全區',
  periodLabel = '今日',
  onStoreSelect,
}) => {
  const [activeCard, setActiveCard] = useState<MetricCardProps | null>(null);
  const [coverageSubTab, setCoverageSubTab] = useState<'visited' | 'unvisited'>('visited');
  const [pdcaSubTab, setPdcaSubTab] = useState<'open' | 'closed'>('open');

  // 建立門市 -> 區域與負責主管對照表
  const storeRegionLookup = useMemo(() => {
    const map = new Map<string, { region: string; managerLabel: string }>();

    // 先從靜態 storeRegions 建立基礎映射
    for (const [region, stores] of Object.entries(storeRegions)) {
      for (const st of stores) {
        map.set(normalizeStoreName(st), { region, managerLabel: '' });
      }
    }

    // 再結合後端 managers 主檔補齊區主管與副區主管姓名
    for (const m of managers) {
      if (!m.storeName) continue;
      const norm = normalizeStoreName(m.storeName);
      const reg = m.region === '台南區' ? '嘉南區' : (m.region || map.get(norm)?.region || '其他區域');
      const mgrText = m.deputyManagerName
        ? `${m.areaManagerName} · 副區主管：${m.deputyManagerName}`
        : m.areaManagerName || '';
      map.set(norm, { region: reg, managerLabel: mgrText });
    }

    return map;
  }, [managers]);

  const getRegionInfo = (storeName: string): { region: string; managerLabel: string } => {
    const norm = normalizeStoreName(storeName);
    return storeRegionLookup.get(norm) || { region: '其他區域', managerLabel: '' };
  };

  if (!summary) return null;

  const totalCoverageStores =
    (summary.coverageStoresInfo?.visited?.length || 0) +
    (summary.coverageStoresInfo?.unvisited?.length || 0);

  const cards: MetricCardProps[] = [
    {
      icon: <TrendingUp size={19} color="#2563eb" />,
      label: '巡店覆蓋率（區間）',
      value: summary.coverageRate ?? 0,
      unit: '%',
      valueColor: '#2563eb',
      iconBg: '#eff6ff',
      borderTop: '#3b82f6',
      subText: (
        <span style={{ color: '#3b82f6', background: '#eff6ff', padding: '2px 8px', borderRadius: '4px' }}>
          {regionLabel === 'all' ? '全區' : regionLabel}：已巡視 {summary.coverageStoresInfo?.visited?.length || 0} / {totalCoverageStores} 間
        </span>
      ),
      description: '目前所選時間區間內，已實際完成巡視的門市數量，佔該區主管名下總分派負責門市總數的百分比。此指標反映出主管是否有落實對旗下所有店點的走動式管理。',
      storeList: summary.coverageStoresInfo?.visited || [],
      unvisitedList: summary.coverageStoresInfo?.unvisited || [],
    },
    {
      icon: <CheckCircle size={19} color="#16a34a" />,
      label: 'PDCA 結案率',
      value: summary.pdcaRate === -1 ? '-' : (summary.pdcaRate ?? 0),
      unit: summary.pdcaRate === -1 ? '' : '%',
      valueColor: '#16a34a',
      iconBg: '#f0fdf4',
      borderTop: '#22c55e',
      description: '在巡店過程中被開立需要追蹤改善的項目 (PDCA) 裡，目前狀態已經被主管確認並標記為「Closed (已結案)」的項目比例。結案率越高，代表門市執行力與改善效率越好。',
      storeList: summary.pdcaStoresInfo?.closed || [],
      openPdcaList: summary.pdcaStoresInfo?.open || [],
    },
    {
      icon: <AlertTriangle size={19} color="#e11d48" />,
      label: '紅燈預警門市',
      value: summary.redLightStores ?? 0,
      unit: '店',
      valueColor: '#e11d48',
      iconBg: '#fff1f2',
      borderTop: '#f43f5e',
      description: '在最近一次的巡店紀錄中，整體綜合評核結果被標記為最危險等級（需重點輔導 / 紅燈）的門市家數。建議高階主管優先調派資源或特別關注這些門市的營運狀況。',
      redLightStoresList: summary.redLightStoresList || [],
    },
    {
      icon: <ClipboardList size={19} color="#7c3aed" />,
      label: `${periodLabel}回報次數`,
      value: summary.totalVisits,
      unit: '筆',
      valueColor: '#7c3aed',
      iconBg: '#f5f3ff',
      borderTop: '#8b5cf6',
      description: `在所選區間 (${periodLabel}) 系統成功接收到來自前線區主管所送出的「巡店紀錄表單」總筆數。可依下方區域快速篩選並點選門市直接定位觀看明細。`,
      storeList: summary.visitStoresList || [],
    },
    {
      icon: <Zap size={19} color="#d97706" />,
      label: '發現異常事項',
      value: summary.abnormalIssuesCount,
      unit: '項',
      valueColor: '#d97706',
      iconBg: '#fffbeb',
      borderTop: '#f59e0b',
      description: '在目前所選時間區間內，所有巡店紀錄表單中，針對細項查核被勾選為「待改善」或是「缺失」的總數累計。此數字越高，代表前線營運流程可能出現較大問題。',
      abnormalStoresList: summary.abnormalStoresList || [],
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3.5 mb-5">
        {cards.map((card, idx) => (
          <MetricCard
            key={idx}
            {...card}
            className={idx === 0 ? 'col-span-2 sm:col-span-1' : ''}
            onClick={() => {
              setCoverageSubTab('visited');
              setPdcaSubTab((card.openPdcaList?.length || 0) > 0 ? 'open' : 'closed');
              setActiveCard(card);
            }}
          />
        ))}
      </div>

      {activeCard && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px',
            zIndex: 9999,
            animation: 'fadeIn 0.2s ease-out',
          }}
          onClick={() => setActiveCard(null)}
        >
          <div
            className="bg-white rounded-2xl p-4 sm:p-6 max-w-[620px] w-full max-h-[88vh] flex flex-col relative shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setActiveCard(null)}
              style={{
                position: 'absolute', top: '16px', right: '16px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#9ca3af', fontSize: '1.2rem',
              }}
            >
              ✕
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{
                width: '46px', height: '46px',
                background: activeCard.iconBg,
                borderRadius: '12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {React.cloneElement(activeCard.icon as React.ReactElement, { size: 23 } as any)}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#111827', fontWeight: 700 }}>{activeCard.label}</h3>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginTop: '2px' }}>
                  <span style={{ fontSize: '1.45rem', fontWeight: 800, color: activeCard.valueColor }}>{activeCard.value}</span>
                  <span style={{ fontSize: '0.95rem', color: '#6b7280' }}>{activeCard.unit}</span>
                </div>
              </div>
            </div>
            <div style={{
              background: '#f9fafb',
              padding: '12px 14px',
              borderRadius: '10px',
              border: '1px solid #e5e7eb',
              color: '#374151',
              fontSize: '0.86rem',
              lineHeight: 1.55,
              marginBottom: '14px',
              flexShrink: 0,
            }}>
              {activeCard.description}
            </div>

            {/* Store List Section (分區瀏覽與點選定位) */}
            <div className="overflow-y-auto pr-1 flex-1" style={{ maxHeight: '54vh' }}>
              {/* 1. 巡店覆蓋率（區間）：已巡視 vs 尚未巡視（支援切換與分區） */}
              {activeCard.label === '巡店覆蓋率（區間）' && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCoverageSubTab('visited')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                          coverageSubTab === 'visited'
                            ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-blue-50'
                        }`}
                      >
                        ✅ 已巡視門市 ({activeCard.storeList?.length || 0})
                      </button>
                      <button
                        type="button"
                        onClick={() => setCoverageSubTab('unvisited')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                          coverageSubTab === 'unvisited'
                            ? 'bg-slate-700 text-white border-slate-700 shadow-2xs'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        ⏳ 尚未巡視門市 ({activeCard.unvisitedList?.length || 0})
                      </button>
                    </div>
                    {coverageSubTab === 'visited' && onStoreSelect && (activeCard.storeList?.length || 0) > 0 && (
                      <span className="text-xs text-blue-600 font-semibold">點擊門市自動移至下方細節</span>
                    )}
                  </div>

                  {coverageSubTab === 'visited' ? (
                    <RegionGroupedStoreList
                      stores={activeCard.storeList || []}
                      tagType="default"
                      emptyText="目前尚無已巡視門市"
                      getRegionInfo={getRegionInfo}
                      onStoreClick={
                        onStoreSelect
                          ? s => {
                              setActiveCard(null);
                              onStoreSelect(s);
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <RegionGroupedStoreList
                      stores={activeCard.unvisitedList || []}
                      tagType="gray"
                      emptyText="太棒了！全數門市皆已完成巡視"
                      getRegionInfo={getRegionInfo}
                    />
                  )}
                </div>
              )}

              {/* 2. PDCA 結案率：待改善 vs 已結案（支援切換與分區） */}
              {activeCard.label === 'PDCA 結案率' && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPdcaSubTab('open')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                          pdcaSubTab === 'open'
                            ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-amber-50'
                        }`}
                      >
                        ⏳ 待改善／追蹤中 ({activeCard.openPdcaList?.length || 0})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPdcaSubTab('closed')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                          pdcaSubTab === 'closed'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-emerald-50'
                        }`}
                      >
                        ✅ 已結案門市 ({activeCard.storeList?.length || 0})
                      </button>
                    </div>
                    {onStoreSelect && (
                      <span className="text-xs text-blue-600 font-semibold">點擊門市自動移至下方細節</span>
                    )}
                  </div>

                  {pdcaSubTab === 'open' ? (
                    <RegionGroupedStoreList
                      stores={activeCard.openPdcaList || []}
                      tagType="warning"
                      emptyText="目前無待改善門市"
                      getRegionInfo={getRegionInfo}
                      onStoreClick={
                        onStoreSelect
                          ? s => {
                              setActiveCard(null);
                              onStoreSelect(s);
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <RegionGroupedStoreList
                      stores={activeCard.storeList || []}
                      tagType="default"
                      emptyText="目前無已結案門市"
                      getRegionInfo={getRegionInfo}
                      onStoreClick={
                        onStoreSelect
                          ? s => {
                              setActiveCard(null);
                              onStoreSelect(s);
                            }
                          : undefined
                      }
                    />
                  )}
                </div>
              )}

              {/* 3. 紅燈預警門市（分區顯示） */}
              {activeCard.label === '紅燈預警門市' && (
                <div className="flex flex-col gap-2.5">
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>紅燈門市與原因（共 {activeCard.redLightStoresList?.length || 0} 間）</span>
                    {onStoreSelect && (activeCard.redLightStoresList?.length || 0) > 0 && (
                      <span style={{ fontSize: '0.72rem', color: '#2563eb', fontWeight: 600 }}>點擊門市自動移至下方細節</span>
                    )}
                  </div>
                  <RegionGroupedDetailList
                    items={activeCard.redLightStoresList || []}
                    variant="danger"
                    getRegionInfo={getRegionInfo}
                    onStoreClick={
                      onStoreSelect
                        ? (s, rid) => {
                            setActiveCard(null);
                            onStoreSelect(s, rid);
                          }
                        : undefined
                    }
                  />
                </div>
              )}

              {/* 4. 發現異常事項（分區顯示） */}
              {activeCard.label === '發現異常事項' && (
                <div className="flex flex-col gap-2.5">
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#374151', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>相關異常門市清單（共 {activeCard.abnormalStoresList?.length || 0} 間）</span>
                    {onStoreSelect && (activeCard.abnormalStoresList?.length || 0) > 0 && (
                      <span style={{ fontSize: '0.72rem', color: '#2563eb', fontWeight: 600 }}>點擊門市自動移至下方細節</span>
                    )}
                  </div>
                  <RegionGroupedDetailList
                    items={activeCard.abnormalStoresList || []}
                    variant="warning"
                    getRegionInfo={getRegionInfo}
                    onStoreClick={
                      onStoreSelect
                        ? (s, rid) => {
                            setActiveCard(null);
                            onStoreSelect(s, rid);
                          }
                        : undefined
                    }
                  />
                </div>
              )}

              {/* 5. 區間回報次數（如：今日／本週／上週回報次數）：分區顯示與快速查找點選 */}
              {activeCard.label !== '巡店覆蓋率（區間）' &&
                activeCard.label !== 'PDCA 結案率' &&
                activeCard.label !== '紅燈預警門市' &&
                activeCard.label !== '發現異常事項' && (
                  <div className="flex flex-col gap-2.5">
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                      <span>已回報門市分區清單（共 {activeCard.storeList?.length || 0} 間門市）</span>
                      {onStoreSelect && (activeCard.storeList?.length || 0) > 0 && (
                        <span style={{ fontSize: '0.74rem', color: '#2563eb', fontWeight: 600 }}>點擊門市自動移至下方細節 ➔</span>
                      )}
                    </div>
                    <RegionGroupedStoreList
                      stores={activeCard.storeList || []}
                      tagType="default"
                      emptyText="目前無門市紀錄"
                      getRegionInfo={getRegionInfo}
                      onStoreClick={
                        onStoreSelect
                          ? s => {
                              setActiveCard(null);
                              onStoreSelect(s);
                            }
                          : undefined
                      }
                    />
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
