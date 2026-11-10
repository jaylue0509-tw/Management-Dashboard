import React, { useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { Manager } from '../types';
import { useStoreRegionLookup } from '../hooks/use-store-region-lookup';
import { compareRegion, groupByRegion } from '../utils/store-region';
import { ALL_REGIONS, RegionFilterBar, type RegionCount } from './RegionFilterBar';

interface IssueStoreObj {
  name: string;
  reportTime?: string;
  recordId?: string;
}

interface Props {
  issues: {
    item: string;
    count: number;
    category: string;
    stores?: IssueStoreObj[];
  }[];
  managers?: Manager[];
  onStoreClick?: (recordId: string, storeName: string) => void;
}

const getStoreName = (s: IssueStoreObj) => s.name;

/**
 * 高頻缺失 Top 5 警示與未結案追蹤清單（含分區快選與門市定位）
 */
export const TopIssuesList: React.FC<Props> = ({ issues, managers = [], onStoreClick }) => {
  const [selectedRegion, setSelectedRegion] = useState<string>(ALL_REGIONS);
  const getRegionInfo = useStoreRegionLookup(managers);

  const topFive = useMemo(() => (issues || []).slice(0, 5), [issues]);

  // 統計涉及的各區域門市筆數
  const regionSummary = useMemo(() => {
    const countByRegion = new Map<string, number>();
    let total = 0;
    for (const issue of topFive) {
      for (const s of issue.stores || []) {
        const { region } = getRegionInfo(s.name);
        countByRegion.set(region, (countByRegion.get(region) || 0) + 1);
        total++;
      }
    }
    const regions: RegionCount[] = Array.from(countByRegion.entries())
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => compareRegion(a.region, b.region));
    return { regions, total };
  }, [topFive, getRegionInfo]);

  const maxCount = useMemo(
    () => (topFive.length > 0 ? Math.max(...topFive.map(i => i.count)) : 0),
    [topFive]
  );

  if (topFive.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 shadow-sm mt-6">
      <div className="mb-3">
        <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-1 flex items-center gap-2">
          <AlertCircle size={20} className="text-red-500 shrink-0" />
          <span>高頻缺失 Top 5 警示與未結案追蹤清單</span>
        </h3>
        <p className="text-xs sm:text-sm text-gray-500">
          全區門市巡店中，被標記為「待改善」或「缺失」最多次的細項排行（已依區域分組標示）
        </p>
      </div>

      {regionSummary.regions.length > 1 && (
        <div className="mb-4">
          <RegionFilterBar
            regions={regionSummary.regions}
            total={regionSummary.total}
            selectedRegion={selectedRegion}
            onRegionChange={setSelectedRegion}
            label="分區篩選"
          />
        </div>
      )}

      <div className="flex flex-col gap-3.5">
        {topFive.map((issue, idx) => {
          const allGroups = groupByRegion(issue.stores || [], getStoreName, getRegionInfo);
          const visibleGroups =
            selectedRegion === ALL_REGIONS
              ? allGroups
              : allGroups.filter(g => g.region === selectedRegion);

          if (selectedRegion !== ALL_REGIONS && visibleGroups.length === 0) return null;

          return (
            <div
              key={issue.item}
              className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-100"
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-sm shrink-0 mt-0.5 ${
                  idx < 3 ? 'bg-red-100 text-red-600' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {idx + 1}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-xs font-semibold text-gray-600 bg-gray-200 px-2 py-0.5 rounded">
                    {issue.category}
                  </span>
                  <span className="text-sm font-bold text-gray-800">{issue.item}</span>
                </div>

                <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-2.5">
                  <div
                    className={`h-full rounded-full ${idx < 3 ? 'bg-red-500' : 'bg-amber-500'}`}
                    style={{ width: `${maxCount > 0 ? (issue.count / maxCount) * 100 : 0}%` }}
                  />
                </div>

                {visibleGroups.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {visibleGroups.map(group => (
                      <div key={group.region} className="flex items-center flex-wrap gap-1.5">
                        <span className="text-[11px] font-extrabold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md shrink-0">
                          📍 {group.region} ({group.items.length})
                        </span>
                        {group.items.map((storeObj, sIdx) => {
                          const isClickable = Boolean(storeObj.recordId && onStoreClick);
                          return (
                            <button
                              key={`${storeObj.name}-${sIdx}`}
                              type="button"
                              disabled={!isClickable}
                              onClick={() => isClickable && onStoreClick!(storeObj.recordId!, storeObj.name)}
                              title="點擊自動移至下方該門市巡店細節"
                              className={`text-xs text-gray-700 bg-white border border-gray-300 px-2.5 py-1 rounded-md inline-flex items-center gap-1 shadow-2xs transition-colors ${
                                isClickable
                                  ? 'cursor-pointer hover:border-blue-500 hover:text-blue-700 hover:bg-blue-50/40'
                                  : 'cursor-default'
                              }`}
                            >
                              <strong className="font-semibold">{storeObj.name}</strong>
                              {storeObj.reportTime && (
                                <span className="text-[0.68rem] text-gray-500">({storeObj.reportTime})</span>
                              )}
                              {isClickable && (
                                <span className="text-[0.65rem] text-blue-600 font-bold">➔</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-right shrink-0">
                <div className="text-xl font-extrabold text-gray-700 leading-none">{issue.count}</div>
                <div className="text-[0.7rem] text-gray-500 mt-1">次缺失</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
