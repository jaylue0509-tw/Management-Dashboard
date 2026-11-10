import React from 'react';
import { MapPin, Search } from 'lucide-react';

export interface RegionCount {
  region: string;
  count: number;
}

interface Props {
  regions: RegionCount[];
  total: number;
  selectedRegion: string;
  onRegionChange: (region: string) => void;
  /** 傳入時顯示搜尋框 */
  keyword?: string;
  onKeywordChange?: (keyword: string) => void;
  searchPlaceholder?: string;
  label?: string;
}

export const ALL_REGIONS = '全部';

const pillClass = (active: boolean) =>
  `px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
    active
      ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
      : 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50 hover:text-blue-600'
  }`;

/**
 * 分區快選膠囊列（可選搜尋框），供各彈窗與清單共用
 */
export const RegionFilterBar: React.FC<Props> = ({
  regions,
  total,
  selectedRegion,
  onRegionChange,
  keyword,
  onKeywordChange,
  searchPlaceholder = '輸入門市、區域或區主管快速查找...',
  label = '分區快選',
}) => {
  const showPills = regions.length > 1;
  const showSearch = onKeywordChange !== undefined;
  if (!showPills && !showSearch) return null;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex flex-col gap-2 shrink-0">
      {showPills && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1 mr-0.5">
            <MapPin size={12} className="text-blue-600" />
            {label}：
          </span>
          <button
            type="button"
            onClick={() => onRegionChange(ALL_REGIONS)}
            className={pillClass(selectedRegion === ALL_REGIONS)}
          >
            全部區域 ({total})
          </button>
          {regions.map(r => {
            const active = selectedRegion === r.region;
            return (
              <button
                key={r.region}
                type="button"
                onClick={() => onRegionChange(active ? ALL_REGIONS : r.region)}
                className={pillClass(active)}
              >
                {r.region} ({r.count})
              </button>
            );
          })}
        </div>
      )}

      {showSearch && (
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={keyword}
            onChange={e => onKeywordChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => onKeywordChange('')}
              aria-label="清除搜尋"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
};

