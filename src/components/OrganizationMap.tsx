import React, { useMemo } from 'react';
import type { Manager } from '../types';
import { MapPin, Building, Users } from 'lucide-react';
import { importManagers } from '../api/api';

interface Props {
  managers: Manager[];
}

const groupBy = <T, K extends keyof any>(list: T[], getKey: (item: T) => K) =>
  list.reduce((previous, currentItem) => {
    const group = getKey(currentItem);
    if (!previous[group]) previous[group] = [];
    previous[group].push(currentItem);
    return previous;
  }, {} as Record<K, T[]>);

export const OrganizationMap: React.FC<Props> = ({ managers }) => {
  const groupedData = useMemo(() => {
    return groupBy(managers, m => `${m.department}|${m.directorName}`);
  }, [managers]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(line => line.trim().length > 0);
      if (lines.length < 2) return alert('CSV 檔案內容為空！');
      
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const required = ['department', 'directorName', 'region', 'areaManagerName', 'storeName'];
      const missing = required.filter(r => !headers.includes(r));
      
      if (missing.length > 0) {
        return alert(`CSV 標題列錯誤！缺少以下欄位：${missing.join(', ')}`);
      }
      
      const newManagers: Manager[] = [];
      for (let i = 1; i < lines.length; i++) {
        // Handle basic CSV splitting (ignoring commas inside quotes for simplicity)
        const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
        const m: any = {};
        headers.forEach((h, idx) => { m[h] = cols[idx] || ''; });
        newManagers.push(m as Manager);
      }
      
      try {
        const success = await importManagers(newManagers);
        if (success) {
          alert(`成功匯入 ${newManagers.length} 筆門市資料！畫面即將重新整理。`);
          window.location.reload();
        } else {
          alert('匯入失敗，後端 API 未回應成功。');
        }
      } catch (err) {
        alert('匯入發生錯誤：' + err);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="card" style={{ padding: 'var(--space-6)', minHeight: '600px' }}>
      <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-6)' }}>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Building className="text-primary" size={24} />
          區主管門店配置圖
        </h2>
        
        <div>
          <label 
            className="btn btn-primary" 
            style={{ cursor: 'pointer', backgroundColor: 'var(--color-info)', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            <span>📥 上傳 CSV 匯入完整名單</span>
            <input 
              type="file" 
              accept=".csv" 
              style={{ display: 'none' }} 
              onChange={handleFileUpload} 
              onClick={(e) => { (e.target as HTMLInputElement).value = '' }}
            />
          </label>
        </div>
      </div>
      
      {managers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--color-secondary-500)' }}>
          <Building size={48} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>尚無組織架構資料</h3>
          <p>請點擊右上方的按鈕，匯入您的 CSV 配置圖檔案！</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
        {Object.entries(groupedData).map(([deptKey, deptManagers]) => {
          const [dept, director] = deptKey.split('|');
          const regions = groupBy(deptManagers, m => m.region);

          return (
            <div key={deptKey} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
              {/* Department Header */}
              <div className="flex justify-between items-center" style={{ backgroundColor: 'var(--color-secondary-50)', padding: '12px 16px', borderBottom: '1px solid var(--border-color)' }}>
                <div className="font-bold text-lg text-gray-900">{dept}</div>
                <div className="text-sm text-gray-700">處長：{director}</div>
              </div>
              
              {/* Regions */}
              <div className="flex flex-col gap-6" style={{ padding: '16px' }}>
                {Object.entries(regions).map(([region, regManagers]) => {
                  const areaManagers = groupBy(regManagers, m => m.areaManagerName);
                  
                  return (
                    <div key={region} className="flex flex-col gap-4">
                      <div className="font-semibold text-primary flex items-center gap-2">
                        <MapPin size={18} />
                        <span style={{ fontSize: '1.1rem' }}>{region}</span>
                      </div>
                      
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
                        gap: '16px', 
                        paddingLeft: '24px' 
                      }}>
                        {Object.entries(areaManagers).map(([areaManager, stores]) => (
                          <div key={areaManager} style={{ 
                            backgroundColor: 'white', 
                            border: '1px solid var(--color-secondary-100)', 
                            boxShadow: 'var(--shadow-sm)', 
                            borderRadius: 'var(--radius-md)', 
                            padding: '12px' 
                          }}>
                            <div className="font-medium text-gray-900 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-secondary-100)', paddingBottom: '8px', marginBottom: '8px' }}>
                              <Users size={16} style={{ color: 'var(--color-secondary-500)' }} />
                              {areaManager}
                            </div>
                            <ul className="flex flex-col gap-2">
                              {stores.map(store => (
                                <li key={store.storeName} className="flex justify-between items-center text-sm text-gray-700">
                                  <span>{store.storeName}</span>
                                  {store.beautyLeader && store.beautyLeader !== '無' && (
                                    <span style={{ 
                                      fontSize: '0.7rem', 
                                      backgroundColor: 'var(--color-error-100)', 
                                      color: 'var(--color-error)', 
                                      padding: '2px 6px', 
                                      borderRadius: '4px' 
                                    }}>
                                      {store.beautyLeader}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
};
