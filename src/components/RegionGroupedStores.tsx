import React, { useMemo, useState } from 'react';
import { groupByRegion, type StoreRegionInfo } from '../utils/store-region';
import { ALL_REGIONS, RegionFilterBar, type RegionCount } from './RegionFilterBar';

type RegionInfoGetter = (store: string) => StoreRegionInfo;

/** 門市數量超過此值才顯示搜尋框，避免少量資料時畫面過於擁擠 */
const SEARCH_THRESHOLD = 6;

/**
 * 共用：分區篩選與關鍵字過濾狀態
 */
const useRegionFilter = <T,>(
  items: T[],
  getStoreName: (item: T) => string,
  getSearchText: (item: T) => string,
  getRegionInfo: RegionInfoGetter
) => {
  const [selectedRegion, setSelectedRegion] = useState<string>(ALL_REGIONS);
  const [keyword, setKeyword] = useState<string>('');

  const allGroups = useMemo(
    () => groupByRegion(items, getStoreName, getRegionInfo),
    [items, getStoreName, getRegionInfo]
  );

  const regionCounts: RegionCount[] = useMemo(
    () => allGroups.map(g => ({ region: g.region, count: g.items.length })),
    [allGroups]
  );

  const visibleGroups = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return allGroups
      .filter(g => selectedRegion === ALL_REGIONS || g.region === selectedRegion)
      .map(g => ({
        ...g,
        items: q
          ? g.items.filter(item =>
              `${getSearchText(item)} ${g.region} ${g.managerLabel}`.toLowerCase().includes(q)
            )
          : g.items,
      }))
      .filter(g => g.items.length > 0);
  }, [allGroups, selectedRegion, keyword, getSearchText]);

  return { selectedRegion, setSelectedRegion, keyword, setKeyword, regionCounts, visibleGroups };
};

const RegionHeader: React.FC<{ region: string; managerLabel: string; count: number }> = ({
  region,
  managerLabel,
  count,
}) => (
  <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-gray-200/80">
    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-extrabold bg-blue-600 text-white shadow-2xs">
        📍 {region}
      </span>
      {managerLabel && <span className="text-xs font-semibold text-gray-600">{managerLabel}</span>}
    </div>
    <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full shrink-0">
      {count} 間
    </span>
  </div>
);

const EmptyHint: React.FC<{ text: string }> = ({ text }) => (
  <div className="text-center py-5 text-xs text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
    {text}
  </div>
);

// ============================================================
// 1. 純門市名稱清單（標籤形式）
// ============================================================

type TagTone = 'default' | 'warning' | 'gray';

const TAG_TONE_CLASS: Record<TagTone, string> = {
  default: 'bg-blue-50 text-blue-700 border-blue-200 hover:shadow-sm hover:-translate-y-px',
  warning: 'bg-amber-50 text-amber-700 border-amber-300 hover:shadow-sm hover:-translate-y-px',
  gray: 'bg-gray-50 text-gray-500 border-gray-200',
};

interface StoreTagsProps {
  stores: string[];
  getRegionInfo: RegionInfoGetter;
  tone?: TagTone;
  emptyText?: string;
  onStoreClick?: (store: string) => void;
}

const identity = (s: string) => s;

/**
 * 依區域分組的門市標籤清單（含分區快選與搜尋）
 */
export const RegionGroupedStoreTags: React.FC<StoreTagsProps> = ({
  stores,
  getRegionInfo,
  tone = 'default',
  emptyText = '目前無門市紀錄',
  onStoreClick,
}) => {
  const { selectedRegion, setSelectedRegion, keyword, setKeyword, regionCounts, visibleGroups } =
    useRegionFilter(stores, identity, identity, getRegionInfo);

  if (stores.length === 0) return <EmptyHint text={emptyText} />;

  return (
    <div className="flex flex-col gap-2.5">
      <RegionFilterBar
        regions={regionCounts}
        total={stores.length}
        selectedRegion={selectedRegion}
        onRegionChange={setSelectedRegion}
        keyword={keyword}
        onKeywordChange={stores.length > SEARCH_THRESHOLD ? setKeyword : undefined}
      />
      {visibleGroups.length === 0 ? (
        <EmptyHint text="找不到符合篩選條件的門市" />
      ) : (
        visibleGroups.map(group => (
          <div key={group.region} className="bg-white border border-gray-200 rounded-xl p-3 shadow-2xs">
            <RegionHeader region={group.region} managerLabel={group.managerLabel} count={group.items.length} />
            <div className="flex flex-wrap gap-1.5">
              {group.items.map(store => (
                <button
                  key={store}
                  type="button"
                  disabled={!onStoreClick}
                  onClick={() => onStoreClick?.(store)}
                  className={`text-xs font-semibold border px-2.5 py-1 rounded-md inline-flex items-center gap-1 transition-all ${
                    TAG_TONE_CLASS[tone]
                  } ${onStoreClick ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <span>{store}</span>
                  {onStoreClick && <span className="text-[0.68rem] opacity-75">➔</span>}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

// ============================================================
// 2. 含原因／回報時間／分數的門市卡片清單
// ============================================================

export interface RegionStoreCardItem {
  name: string;
  reasons?: string[];
  reportTime?: string;
  recordId?: string;
  score?: number;
}

type CardTone = 'neutral' | 'danger' | 'warning';

const CARD_TONE: Record<CardTone, { card: string; title: string; reason: string; badge: string }> = {
  neutral: {
    card: 'bg-white border-gray-200 hover:border-blue-300',
    title: 'text-blue-700',
    reason: 'text-rose-600',
    badge: 'bg-blue-50 text-blue-600 border-blue-200',
  },
  danger: {
    card: 'bg-red-50 border-red-300 hover:border-red-400',
    title: 'text-red-700',
    reason: 'text-red-900',
    badge: 'bg-red-100 text-red-700 border-red-200',
  },
  warning: {
    card: 'bg-amber-50 border-amber-300 hover:border-amber-400',
    title: 'text-amber-700',
    reason: 'text-amber-900',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
  },
};

const scoreColor = (score: number) => (score >= 80 ? 'text-emerald-500' : score >= 60 ? 'text-amber-500' : 'text-red-500');

interface StoreCardsProps {
  items: RegionStoreCardItem[];
  getRegionInfo: RegionInfoGetter;
  tone?: CardTone;
  reasonStyle?: 'list' | 'chips';
  emptyText?: string;
  searchPlaceholder?: string;
  onItemClick?: (item: RegionStoreCardItem) => void;
}

const getItemName = (item: RegionStoreCardItem) => item.name;
const getItemSearchText = (item: RegionStoreCardItem) => `${item.name} ${(item.reasons || []).join(' ')}`;

/**
 * 依區域分組的門市明細卡片（含分區快選與搜尋）
 */
export const RegionGroupedStoreCards: React.FC<StoreCardsProps> = ({
  items,
  getRegionInfo,
  tone = 'neutral',
  reasonStyle = 'list',
  emptyText = '目前無門市紀錄',
  searchPlaceholder = '輸入門市、區域、區主管或原因快速查找...',
  onItemClick,
}) => {
  const { selectedRegion, setSelectedRegion, keyword, setKeyword, regionCounts, visibleGroups } =
    useRegionFilter(items, getItemName, getItemSearchText, getRegionInfo);
  const toneCls = CARD_TONE[tone];

  if (items.length === 0) return <EmptyHint text={emptyText} />;

  return (
    <div className="flex flex-col gap-3">
      <RegionFilterBar
        regions={regionCounts}
        total={items.length}
        selectedRegion={selectedRegion}
        onRegionChange={setSelectedRegion}
        keyword={keyword}
        onKeywordChange={items.length > 4 ? setKeyword : undefined}
        searchPlaceholder={searchPlaceholder}
      />
      {visibleGroups.length === 0 ? (
        <EmptyHint text="找不到符合篩選條件的門市" />
      ) : (
        visibleGroups.map(group => (
          <div key={group.region} className="bg-slate-50/70 border border-gray-200 rounded-xl p-3">
            <RegionHeader region={group.region} managerLabel={group.managerLabel} count={group.items.length} />
            <div className="flex flex-col gap-2">
              {group.items.map((item, idx) => (
                <div
                  key={`${item.name}-${idx}`}
                  onClick={() => onItemClick?.(item)}
                  className={`border rounded-[10px] px-3.5 py-2.5 flex items-start justify-between gap-2.5 transition-all ${
                    toneCls.card
                  } ${onItemClick ? 'cursor-pointer hover:shadow-sm' : ''}`}
                >
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[0.92rem] font-bold ${toneCls.title}`}>📍 {item.name}</span>
                      {onItemClick && (
                        <span className={`text-[0.68rem] font-semibold border px-1.5 py-px rounded-full ${toneCls.badge}`}>
                          查看細節 ➔
                        </span>
                      )}
                    </div>
                    {item.reportTime && <span className="text-xs text-gray-500">回報時間：{item.reportTime}</span>}
                    {item.reasons && item.reasons.length > 0 && (
                      reasonStyle === 'chips' ? (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {item.reasons.map((r, i) => (
                            <span key={i} className="text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded">
                              {r}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <ul className={`list-disc pl-4 mt-0.5 text-xs leading-snug space-y-0.5 ${toneCls.reason}`}>
                          {item.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      )
                    )}
                  </div>
                  {item.score !== undefined && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-gray-500">風險分數</span>
                      <span className={`text-base font-extrabold ${scoreColor(item.score)}`}>{item.score}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

