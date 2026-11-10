import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { Manager } from '../../types';
import { useStoreRegionLookup } from '../../hooks/use-store-region-lookup';
import { DetailModal } from '../DetailModal';
import { RegionGroupedStoreCards, type RegionStoreCardItem } from '../RegionGroupedStores';

interface Props {
  data: {
    name: string;
    value: number;
    color: string;
    stores?: RegionStoreCardItem[];
  }[];
  managers?: Manager[];
  onStoreSelect?: (storeName: string) => void;
}

const COLORS = ['#3b82f6', '#16a34a', '#d97706', '#e11d48', '#7c3aed', '#0d9488'];

/**
 * 缺失類別風險分佈圓餅圖與分區明細彈窗
 */
export const IssuePieChart: React.FC<Props> = ({ data, managers = [], onStoreSelect }) => {
  const [activeSlice, setActiveSlice] = useState<{
    name: string;
    color: string;
    stores: RegionStoreCardItem[];
  } | null>(null);
  const getRegionInfo = useStoreRegionLookup(managers);

  const hasData = data && data.length > 0;

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-2xs">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="w-2 h-2 rounded-full bg-violet-600" />
            <span className="text-[0.88rem] font-bold text-gray-900">缺失風險分佈</span>
          </div>
          <div className="text-[0.7rem] text-gray-400 ml-4 tracking-wide">
            Issue Risk Distribution（點擊色塊可分區查看門市）
          </div>
        </div>

        {!hasData ? (
          <div className="h-[220px] flex flex-col items-center justify-center text-gray-300 gap-2">
            <div className="text-3xl">🔍</div>
            <div className="text-xs text-gray-400">暫無缺失分佈資料</div>
          </div>
        ) : (
          <div className="h-[220px]">
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
                  onClick={(entry: {
                    name?: string;
                    fill?: string;
                    stores?: RegionStoreCardItem[];
                    payload?: { name?: string; color?: string; stores?: RegionStoreCardItem[] };
                  }) => {
                    const stores = entry.payload?.stores || entry.stores;
                    if (stores && stores.length > 0) {
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

      <DetailModal
        open={Boolean(activeSlice)}
        onClose={() => setActiveSlice(null)}
        maxWidth={580}
        header={
          activeSlice && (
            <div className="flex items-center gap-2.5 flex-wrap">
              <span
                className="w-4 h-4 rounded-full shrink-0"
                style={{ background: activeSlice.color }}
              />
              <h3 className="m-0 text-lg font-extrabold text-gray-800">
                {activeSlice.name} 異常門市名單
              </h3>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700">
                共 {activeSlice.stores.length} 間
              </span>
            </div>
          )
        }
      >
        {activeSlice && (
          <RegionGroupedStoreCards
            items={activeSlice.stores}
            tone="neutral"
            reasonStyle="chips"
            searchPlaceholder="輸入門市、區域、區主管或缺失項目快速查找..."
            getRegionInfo={getRegionInfo}
            onItemClick={
              onStoreSelect
                ? item => {
                    setActiveSlice(null);
                    onStoreSelect(item.name);
                  }
                : undefined
            }
          />
        )}
      </DetailModal>
    </>
  );
};
