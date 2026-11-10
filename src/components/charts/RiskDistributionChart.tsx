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

const cleanSliceTitle = (rawName: string) => rawName.replace(/^(?:🔴|🟡|🟢)\s*/u, '').trim();

/**
 * 門市風險評級分佈圓餅圖與分區明細彈窗
 */
export const RiskDistributionChart: React.FC<Props> = ({ data, managers = [], onStoreSelect }) => {
  const [activeSlice, setActiveSlice] = useState<{
    name: string;
    color: string;
    stores: RegionStoreCardItem[];
  } | null>(null);
  const getRegionInfo = useStoreRegionLookup(managers);

  if (!data || data.length === 0) return null;

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-2xs flex flex-col h-[320px]">
        <h3 className="text-base font-bold text-gray-700 mb-1">門市風險評級分佈圖</h3>
        <p className="text-xs text-gray-500 mb-4">
          全區門市最新一次巡店之綜合評價（點擊色塊可分區查看門市）
        </p>

        <div className="flex-1 min-h-0 relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
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
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                itemStyle={{ color: '#374151', fontWeight: 600 }}
              />
              <Legend verticalAlign="bottom" height={36} iconType="circle" />
            </PieChart>
          </ResponsiveContainer>

          <div className="absolute top-[45%] left-1/2 -translate-x-1/2 -translate-y-1/2 -mt-[18px] text-center pointer-events-none">
            <div className="text-2xl font-extrabold text-gray-800 leading-none">
              {data.reduce((a, b) => a + b.value, 0)}
            </div>
            <div className="text-[0.7rem] text-gray-500 font-medium">總店數</div>
          </div>
        </div>
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
                {cleanSliceTitle(activeSlice.name)} 門市名單
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
