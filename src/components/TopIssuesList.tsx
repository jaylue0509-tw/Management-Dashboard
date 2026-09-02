import React, { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  issues: { item: string; count: number; category: string; stores?: { name: string; reportTime?: string; recordId?: string }[] }[];
  onStoreClick?: (recordId: string, storeName: string) => void;
}

export const TopIssuesList: React.FC<Props> = ({ issues, onStoreClick }) => {
  const maxCount = useMemo(() => {
    if (!issues || issues.length === 0) return 0;
    return Math.max(...issues.map(i => i.count));
  }, [issues]);

  if (!issues || issues.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm mt-6">
      <h3 className="text-lg font-bold text-gray-700 mb-1 flex items-center gap-2">
        <AlertCircle size={20} className="text-red-500" />
        高頻缺失 Top 5 警示與未結案追蹤清單
      </h3>
      <p className="text-sm text-gray-500 mb-5">
        全區門市巡店中，被標記為「待改善」或「缺失」最多次的細項排行
      </p>

      <div className="flex flex-col gap-4">
        {issues.slice(0, 5).map((issue, idx) => (
          <div key={idx} className="flex items-center gap-4 p-3 px-4 bg-gray-50 rounded-lg border border-gray-100">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-sm shrink-0
              ${idx < 3 ? 'bg-red-100 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
              {idx + 1}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-gray-600 bg-gray-200 px-2 py-0.5 rounded">
                  {issue.category}
                </span>
                <span className="text-sm font-semibold text-gray-800 truncate">
                  {issue.item}
                </span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                <div 
                  className={`h-full rounded-full ${idx < 3 ? 'bg-red-500' : 'bg-amber-500'}`}
                  style={{ width: `${(issue.count / maxCount) * 100}%` }}
                />
              </div>
              
              {issue.stores && issue.stores.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {issue.stores.map((storeObj, sIdx) => {
                    const isClickable = Boolean(storeObj.recordId && onStoreClick);
                    return (
                      <button 
                        key={sIdx} 
                        onClick={() => isClickable && onStoreClick!(storeObj.recordId!, storeObj.name)}
                        className={`text-xs text-gray-600 bg-white border border-gray-300 px-2 py-1 rounded-md inline-flex items-center gap-1 shadow-sm transition-colors
                          ${isClickable ? 'cursor-pointer hover:border-blue-500 hover:text-blue-700' : 'cursor-default'}`}
                        type="button"
                      >
                        <strong className="font-semibold">{storeObj.name}</strong>
                        {storeObj.reportTime && (
                           <span className="text-[0.7rem] opacity-80">({storeObj.reportTime})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            
            <div className="text-right shrink-0">
              <div className="text-xl font-extrabold text-gray-700 leading-none">{issue.count}</div>
              <div className="text-[0.7rem] text-gray-500 mt-1">次缺失</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
