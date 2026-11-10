import React, { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { MapPin, Search } from 'lucide-react';
import { storeRegions } from '../../data/storeRegions';
import type { Manager } from '../../types';

interface IssueStoreItem {
  name: string;
  reasons: string[];
  reportTime?: string;
}

interface Props {
  data: {
    name: string;
    value: number;
    color: string;
    stores?: IssueStoreItem[];
  }[];
  managers?: Manager[];
  onStoreSelect?: (storeName: string) => void;
}

const COLORS = ['#3b82f6', '#16a34a', '#d97706', '#e11d48', '#7c3aed', '#0d9488'];
const normalizeStoreName = (name: string): string => (name || '').trim().replace(/店$/, '');
const REGION_ORDER = Object.keys(storeRegions);

export const IssuePieChart: React.FC<Props> = ({ data, managers = [], onStoreSelect }) => {
  const [activeSlice, setActiveSlice] = useState<{
    name: string;
    color: string;
    stores: IssueStoreItem[];
  } | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string>('全部');
  const [keyword, setKeyword] = useState<string>('');

  const hasData = data && data.length > 0;

  // 建立門市 -> 區域與負責主管對照表
  const storeRegionLookup = useMemo(() => {
    const map = new Map<string, { region: string; managerLabel: string }>();
    for (const [region, stores] of Object.entries(storeRegions)) {
      for (const st of stores) {
        map.set(normalizeStoreName(st), { region, managerLabel: '' });
      }
    }
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

  const regionSummary = useMemo(() => {
    if (!activeSlice) return [];
    const map = new Map<string, number>();
    for (const s of activeSlice.stores) {
      const { region } = getRegionInfo(s.name);
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
  }, [activeSlice, storeRegionLookup]);

  const groupedStores = useMemo(() => {
    if (!activeSlice) return [];
    const q = keyword.trim().toLowerCase();
    const map = new Map<string, { region: string; managerLabel: string; stores: IssueStoreItem[] }>();

    for (const s of activeSlice.stores) {
      const info = getRegionInfo(s.name);
      if (selectedRegion !== '全部' && info.region !== selectedRegion) continue;
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !info.region.toLowerCase().includes(q) &&
        !info.managerLabel.toLowerCase().includes(q) &&
        !(s.reasons || []).some(r => r.toLowerCase().includes(q))
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
      map.get(info.region)!.stores.push(s);
    }

    return Array.from(map.values()).sort((a, b) => {
      const idxA = REGION_ORDER.indexOf(a.region);
      const idxB = REGION_ORDER.indexOf(b.region);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return b.stores.length - a.stores.length;
    });
  }, [activeSlice, selectedRegion, keyword, storeRegionLookup]);

  return (
    <>
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          padding: '20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#7c3aed' }} />
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#111827' }}>缺失風險分佈</span>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginLeft: '16px', letterSpacing: '0.04em' }}>
            Issue Risk Distribution（點擊色塊可分區查看門市）
          </div>
        </div>

        {!hasData ? (
          <div
            style={{
              height: '220px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#d1d5db',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '2rem' }}>🔍</div>
            <div style={{ fontSize: '0.82rem', color: '#9ca3af' }}>暫無缺失分佈資料</div>
          </div>
        ) : (
          <div style={{ height: '220px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={0}
                  onClick={(entry: any) => {
                    const stores = entry.payload?.stores || entry.stores;
                    if (stores && stores.length > 0) {
                      setSelectedRegion('全部');
                      setKeyword('');
                      setActiveSlice({
                        name: entry.name || entry.payload?.name || '',
                        color: entry.fill || entry.payload?.color || '',
                        stores,
                      });
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                  }}
                  itemStyle={{ color: '#374151', fontSize: '0.85rem' }}
                />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '0.8rem' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {activeSlice && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px',
            zIndex: 9999,
            animation: 'fadeIn 0.2s ease-out',
          }}
          onClick={() => setActiveSlice(null)}
        >
          <div
            className="bg-white rounded-2xl p-4 sm:p-6 max-w-[580px] w-full max-h-[86vh] flex flex-col relative shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setActiveSlice(null)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#9ca3af',
                fontSize: '1.2rem',
              }}
            >
              ✕
            </button>

            <div className="flex items-center gap-2.5 mb-3 pr-7">
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  background: activeSlice.color,
                  borderRadius: '50%',
                  flexShrink: 0,
                }}
              />
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#1f2937', margin: 0 }}>
                {activeSlice.name} 異常門市名單
              </h3>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700">
                共 {activeSlice.stores.length} 間
              </span>
            </div>

            {/* 分區快選膠囊列 & 搜尋框 */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 mb-3 flex flex-col gap-2 shrink-0">
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
                  全部區域 ({activeSlice.stores.length})
                </button>
                {regionSummary.map(r => {
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

              {activeSlice.stores.length > 4 && (
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={keyword}
                    onChange={e => setKeyword(e.target.value)}
                    placeholder="輸入門市、區域、區主管或缺失項目快速查找..."
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

            {/* 分區門市清單 */}
            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
              {groupedStores.length === 0 ? (
                <div className="text-center py-6 text-xs text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  找不到符合篩選條件的門市
                </div>
              ) : (
                groupedStores.map(group => (
                  <div
                    key={group.region}
                    className="bg-slate-50/70 border border-gray-200 rounded-xl p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-gray-200/80">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-extrabold bg-blue-600 text-white shadow-2xs">
                          📍 {group.region}
                        </span>
                        {group.managerLabel && (
                          <span className="text-xs font-semibold text-gray-600">
                            {group.managerLabel}
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                        {group.stores.length} 間門市
                      </span>
                    </div>

                    <div className="flex flex-col gap-2">
                      {group.stores.map((s, i) => (
                        <div
                          key={`${s.name}-${i}`}
                          onClick={() => {
                            if (onStoreSelect) {
                              setActiveSlice(null);
                              onStoreSelect(s.name);
                            }
                          }}
                          style={{
                            padding: '11px 13px',
                            background: '#ffffff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '10px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            cursor: onStoreSelect ? 'pointer' : 'default',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => {
                            if (onStoreSelect) {
                              e.currentTarget.style.borderColor = '#93c5fd';
                              e.currentTarget.style.boxShadow = '0 2px 8px rgba(37, 99, 235, 0.1)';
                            }
                          }}
                          onMouseLeave={e => {
                            if (onStoreSelect) {
                              e.currentTarget.style.borderColor = '#e5e7eb';
                              e.currentTarget.style.boxShadow = 'none';
                            }
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.95rem', color: '#1d4ed8', fontWeight: 700 }}>
                                📍 {s.name}
                              </span>
                              {onStoreSelect && (
                                <span
                                  style={{
                                    fontSize: '0.7rem',
                                    color: '#2563eb',
                                    background: '#eff6ff',
                                    border: '1px solid #bfdbfe',
                                    padding: '1px 7px',
                                    borderRadius: '99px',
                                    fontWeight: 600,
                                  }}
                                >
                                  查看細節 ➔
                                </span>
                              )}
                            </div>
                            {s.reportTime && (
                              <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                                回報時間：{s.reportTime}
                              </span>
                            )}
                          </div>
                          {s.reasons && s.reasons.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {s.reasons.map((r, rIdx) => (
                                <span
                                  key={rIdx}
                                  style={{
                                    fontSize: '0.75rem',
                                    color: '#b91c1c',
                                    background: '#fee2e2',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontWeight: 500,
                                  }}
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
