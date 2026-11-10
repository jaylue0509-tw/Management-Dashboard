import React, { useMemo, useState } from 'react';
import { AlertCircle, MapPin } from 'lucide-react';
import { storeRegions } from '../data/storeRegions';
import type { Manager } from '../types';

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

const normalizeStoreName = (name: string): string => (name || '').trim().replace(/店$/, '');
const REGION_ORDER = Object.keys(storeRegions);

export const TopIssuesList: React.FC<Props> = ({ issues, managers = [], onStoreClick }) => {
  const [selectedRegion, setSelectedRegion] = useState<string>('全部');

  // 建立門市 -> 區域對照表
  const storeRegionLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const [region, stores] of Object.entries(storeRegions)) {
      for (const st of stores) {
        map.set(normalizeStoreName(st), region);
      }
    }
    for (const m of managers) {
      if (!m.storeName) continue;
      const norm = normalizeStoreName(m.storeName);
      const reg = m.region === '台南區' ? '嘉南區' : (m.region || map.get(norm) || '其他區域');
      map.set(norm, reg);
    }
    return map;
  }, [managers]);

  const getStoreRegion = (storeName: string): string => {
    const norm = normalizeStoreName(storeName);
    return storeRegionLookup.get(norm) || '其他區域';
  };

  // 統計涉及的區域
  const availableRegions = useMemo(() => {
    if (!issues || issues.length === 0) return [];
    const regionSet = new Set<string>();
    issues.slice(0, 5).forEach(issue => {
      (issue.stores || []).forEach(s => {
        regionSet.add(getStoreRegion(s.name));
      });
    });
    return Array.from(regionSet).sort((a, b) => {
      const idxA = REGION_ORDER.indexOf(a);
      const idxB = REGION_ORDER.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [issues, storeRegionLookup]);

  const maxCount = useMemo(() => {
    if (!issues || issues.length === 0) return 0;
    return Math.max(...issues.map(i => i.count));
  }, [issues]);

  if (!issues || issues.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 shadow-sm mt-6">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-gray-800 mb-1 flex items-center gap-2">
            <AlertCircle size={20} className="text-red-500 shrink-0" />
            <span>高頻缺失 Top 5 警示與未結案追蹤清單</span>
          </h3>
          <p className="text-xs sm:text-sm text-gray-500">
            全區門市巡店中，被標記為「待改善」或「缺失」最多次的細項排行（已依區域分組標示）
          </p>
        </div>
      </div>

      {/* 頂部區域快速篩選膠囊 */}
      {availableRegions.length > 1 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 mb-4 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1 mr-0.5">
            <MapPin size={12} className="text-blue-600" />
            分區篩選：
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
            全部區域
          </button>
          {availableRegions.map(reg => {
            const active = selectedRegion === reg;
            return (
              <button
                key={reg}
                type="button"
                onClick={() => setSelectedRegion(active ? '全部' : reg)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50 hover:text-blue-600'
                }`}
              >
                {reg}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-3.5">
        {issues.slice(0, 5).map((issue, idx) => {
          const filteredStores = (issue.stores || []).filter(
            s => selectedRegion === '全部' || getStoreRegion(s.name) === selectedRegion
          );
          if (selectedRegion !== '全部' && filteredStores.length === 0) return null;

          // 依區域分組該缺失項目的門市
          const storesByRegion = new Map<string, IssueStoreObj[]>();
          filteredStores.forEach(s => {
            const reg = getStoreRegion(s.name);
            if (!storesByRegion.has(reg)) storesByRegion.set(reg, []);
            storesByRegion.get(reg)!.push(s);
          });
          const sortedRegionEntries = Array.from(storesByRegion.entries()).sort(([regA], [regB]) => {
            const idxA = REGION_ORDER.indexOf(regA);
            const idxB = REGION_ORDER.indexOf(regB);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            return regA.localeCompare(regB);
          });

          return (
            <div key={idx} className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-100">
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
                  <span className="text-sm font-bold text-gray-800">
                    {issue.item}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-2.5">
                  <div
                    className={`h-full rounded-full ${idx < 3 ? 'bg-red-500' : 'bg-amber-500'}`}
                    style={{ width: `${(issue.count / maxCount) * 100}%` }}
                  />
                </div>

                {sortedRegionEntries.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {sortedRegionEntries.map(([regionName, regionStores]) => (
                      <div key={regionName} className="flex items-center flex-wrap gap-1.5">
                        <span className="text-[11px] font-extrabold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md shrink-0">
                          📍 {regionName} ({regionStores.length})
                        </span>
                        {regionStores.map((storeObj, sIdx) => {
                          const isClickable = Boolean(storeObj.recordId && onStoreClick);
                          return (
                            <button
                              key={sIdx}
                              onClick={() => isClickable && onStoreClick!(storeObj.recordId!, storeObj.name)}
                              className={`text-xs text-gray-700 bg-white border border-gray-300 px-2.5 py-1 rounded-md inline-flex items-center gap-1 shadow-2xs transition-colors ${
                                isClickable ? 'cursor-pointer hover:border-blue-500 hover:text-blue-700 hover:bg-blue-50/40' : 'cursor-default'
                              }`}
                              type="button"
                              title="點擊自動移至下方該門市巡店細節"
                            >
                              <strong className="font-semibold">{storeObj.name}</strong>
                              {storeObj.reportTime && (
                                <span className="text-[0.68rem] text-gray-500">({storeObj.reportTime})</span>
                              )}
                              {isClickable && <span className="text-[0.65rem] text-blue-600 font-bold">➔</span>}
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
