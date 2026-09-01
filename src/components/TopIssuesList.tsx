import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  issues: { item: string; count: number; category: string; stores?: { name: string; reportTime?: string; recordId?: string }[] }[];
  onStoreClick?: (recordId: string, storeName: string) => void;
}

export const TopIssuesList: React.FC<Props> = ({ issues, onStoreClick }) => {
  if (!issues || issues.length === 0) return null;

  const maxCount = Math.max(...issues.map(i => i.count));

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      padding: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      marginTop: '24px'
    }}>
      <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#374151', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <AlertCircle size={20} className="text-red-500" />
        高頻缺失 Top 5 警示與未結案追蹤清單
      </h3>
      <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '20px' }}>
        全區門市巡店中，被標記為「待改善」或「缺失」最多次的細項排行
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {issues.slice(0, 5).map((issue, idx) => (
          <div key={idx} style={{
            display: 'flex', alignItems: 'center', gap: '16px',
            padding: '12px 16px',
            background: '#f9fafb',
            borderRadius: '8px',
            border: '1px solid #f3f4f6'
          }}>
            <div style={{
              width: '28px', height: '28px',
              borderRadius: '50%',
              background: idx < 3 ? '#fee2e2' : '#f3f4f6',
              color: idx < 3 ? '#ef4444' : '#6b7280',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '0.9rem'
            }}>
              {idx + 1}
            </div>
            
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#4b5563', background: '#e5e7eb', padding: '2px 8px', borderRadius: '4px' }}>
                  {issue.category}
                </span>
                <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {issue.item}
                </span>
              </div>
              <div style={{ width: '100%', height: '6px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ 
                  height: '100%', 
                  width: `${(issue.count / maxCount) * 100}%`,
                  background: idx < 3 ? '#ef4444' : '#f59e0b',
                  borderRadius: '4px'
                }} />
              </div>
              
              {issue.stores && issue.stores.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {issue.stores.map((storeObj, sIdx) => (
                    <span 
                      key={sIdx} 
                      onClick={() => storeObj.recordId && onStoreClick && onStoreClick(storeObj.recordId, storeObj.name)}
                      style={{ 
                        fontSize: '0.75rem', 
                        color: '#4b5563', 
                        background: '#ffffff', 
                        border: '1px solid #d1d5db',
                        padding: '4px 8px', 
                        borderRadius: '6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        cursor: storeObj.recordId && onStoreClick ? 'pointer' : 'default',
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={(e) => {
                         if (storeObj.recordId && onStoreClick) {
                             e.currentTarget.style.borderColor = '#3b82f6';
                             e.currentTarget.style.color = '#1d4ed8';
                         }
                      }}
                      onMouseLeave={(e) => {
                         if (storeObj.recordId && onStoreClick) {
                             e.currentTarget.style.borderColor = '#d1d5db';
                             e.currentTarget.style.color = '#4b5563';
                         }
                      }}
                    >
                      <strong style={{ fontWeight: 600 }}>{storeObj.name}</strong>
                      {storeObj.reportTime && (
                         <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>({storeObj.reportTime})</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
            
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#374151' }}>{issue.count}</div>
              <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>次缺失</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
