import React from 'react';
import type { Manager } from '../types';

interface Props {
  managers: Manager[];
  selectedManager: Manager | null;
  onSelect: (manager: Manager | null) => void;
}

export const ManagerList: React.FC<Props> = ({ managers, selectedManager, onSelect }) => {
  return (
    <aside className="card mobile-w-full" style={{ width: '320px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-4)' }}>
        <h2 className="text-lg font-bold text-gray-900">區主管進度</h2>
        {selectedManager && (
          <button 
            onClick={() => onSelect(null)}
            className="text-sm font-medium"
            style={{ 
              color: 'var(--color-primary-600)', 
              background: 'var(--color-primary-50)',
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              marginBottom: '4px'
            }}
          >
            ← 返回列表
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3" style={{ overflowY: 'auto', flex: 1 }}>
        {(selectedManager ? managers.filter(m => m.areaManagerName === selectedManager.areaManagerName) : managers).map((manager, idx) => {
          const isSelected = selectedManager?.areaManagerName === manager.areaManagerName;
          
          let statusBadgeClass = 'badge-gray';
          if (manager.visitStatus === '巡店中') statusBadgeClass = 'badge-info';
          if (manager.visitStatus === '已完成') statusBadgeClass = 'badge-success';
          
          return (
            <div 
              key={idx} 
              className="card"
              style={{ 
                padding: 'var(--space-3)', 
                cursor: 'pointer',
                border: isSelected ? '2px solid var(--color-primary-500)' : '1px solid transparent',
                boxShadow: isSelected ? 'var(--shadow-md)' : 'none',
                backgroundColor: isSelected ? 'var(--color-primary-50)' : 'var(--bg-surface)'
              }}
              onClick={() => {
                if (isSelected) {
                  onSelect(null);
                } else {
                  onSelect(manager);
                }
              }}
            >
              <div className="flex justify-between items-start" style={{ marginBottom: 'var(--space-2)' }}>
                <strong className="text-gray-900">{manager.areaManagerName}</strong>
                <span className={`badge ${statusBadgeClass}`}>{manager.visitStatus}</span>
              </div>
              <div className="text-sm text-gray-500" style={{ marginBottom: '4px' }}>
                區經理: {manager.directorName}
              </div>
              <div className="text-sm text-gray-500 flex justify-between">
                <span>{manager.region} ({manager.assignedStoreCount}店)</span>
                <span>今日: {manager.todayVisitCount} 筆 {((manager as any).expectedStayMinutes || 0) > 0 && `(${(manager as any).expectedStayMinutes}分)`}</span>
              </div>
              {((manager as any).visitedStores && (manager as any).visitedStores.length > 0) && (
                <div className="text-xs text-gray-700 mt-2" style={{ marginTop: '8px', padding: '6px', backgroundColor: 'var(--color-secondary-50)', borderRadius: 'var(--radius-sm)' }}>
                  <strong>本日巡店：</strong>{(manager as any).visitedStores.join(', ')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
