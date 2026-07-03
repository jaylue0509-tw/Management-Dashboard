import React, { useMemo } from 'react';
import type { Manager } from '../types';
import { MapPin, Building, Users } from 'lucide-react';
import { importManagers } from '../api/api';
import Papa from 'papaparse';

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
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const data = results.data as any[];
        if (data.length === 0) return alert('CSV 檔案內容為空！');
        
        const headerMap: Record<string, keyof Manager> = {
          '處別': 'department',
          '處長': 'directorName',
          '區域': 'region',
          '區主管': 'areaManagerName',
          '副區主管': 'deputyManagerName',
          '門市': 'storeName',
          '美容區組長/總監': 'beautyLeader'
        };

        const newManagers: Manager[] = [];
        let lastDept = '';
        let lastDirector = '';

        for (const row of data) {
          const m: Partial<Manager> = { todayVisitCount: 0, assignedStoreCount: 0, hasAbnormal: false, visitStatus: '尚未回填' };
          
          for (const [chKey, enKey] of Object.entries(headerMap)) {
            // Find key in row that includes the Chinese word (handles weird hidden characters)
            const actualKey = Object.keys(row).find(k => k.includes(chKey));
            const rawVal = actualKey ? row[actualKey] || '' : '';
            // Remove newlines and extra spaces inside fields
            m[enKey] = String(rawVal).replace(/\s+/g, ' ').trim() as never;
          }
          
          // 如果處別或處長空白，則繼承上一筆資料（解決 Excel 合併儲存格產生的空白問題）
          if (m.department) lastDept = m.department; else m.department = lastDept;
          if (m.directorName) lastDirector = m.directorName; else m.directorName = lastDirector;
          
          if (m.storeName) {
            newManagers.push(m as Manager);
          }
        }
        
        if (newManagers.length === 0) {
          return alert('找不到任何門市資料！請確認您的 CSV 第一列標題是否為：\n處別, 處長, 區域, 區主管, 副區主管, 門市, 美容區組長/總監');
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
      },
      error: (err) => {
        alert('解析 CSV 發生錯誤：' + err.message);
      }
    });
  };

  return (
    <div className="card" style={{ 
      padding: 'var(--space-6)', 
      minHeight: '600px',
      background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
      border: 'none',
      boxShadow: 'var(--shadow-md)'
    }}>
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
            <div key={deptKey} style={{ 
              border: '1px solid rgba(255, 255, 255, 0.4)', 
              borderRadius: 'var(--radius-lg)', 
              overflow: 'hidden',
              background: 'rgba(255, 255, 255, 0.3)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.05)'
            }}>
              {/* Department Header */}
              <div className="flex justify-between items-center" style={{ backgroundColor: 'rgba(255, 255, 255, 0.4)', padding: '12px 16px', borderBottom: '1px solid rgba(255, 255, 255, 0.4)' }}>
                <div className="font-bold text-lg text-gray-900">{dept || '未分類處別'}</div>
                <div className="text-sm text-gray-800 font-medium">處長：{director || '未設定'}</div>
              </div>
              
              {/* Regions */}
              <div className="flex flex-row gap-8" style={{ padding: '16px', overflowX: 'auto', flexWrap: 'nowrap' }}>
                {Object.entries(regions).map(([region, regManagers]) => {
                  const areaManagers = groupBy(regManagers, m => m.areaManagerName);
                  
                  return (
                    <div key={region} className="flex flex-col gap-4" style={{ minWidth: '320px', width: '320px', flexShrink: 0 }}>
                      <div className="font-semibold text-primary flex items-center justify-center gap-2" style={{ borderBottom: '2px solid var(--color-primary-100)', paddingBottom: '8px' }}>
                        <MapPin size={18} />
                        <span style={{ fontSize: '1.1rem' }}>{region}</span>
                      </div>
                      
                      <div className="flex flex-row flex-wrap items-stretch gap-4" style={{ paddingLeft: '0' }}>
                        {Object.entries(areaManagers).map(([areaManager, stores]) => (
                          <div key={areaManager} style={{ 
                            background: 'rgba(255, 255, 255, 0.65)', 
                            border: '1px solid rgba(255, 255, 255, 0.8)', 
                            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.05)', 
                            borderRadius: 'var(--radius-md)', 
                            padding: '16px',
                            flex: '1 1 100%',
                            maxWidth: '100%',
                            textAlign: 'center'
                          }}>
                            <div className="font-bold text-gray-900 flex items-center justify-center gap-2" style={{ borderBottom: '1px solid var(--color-secondary-100)', paddingBottom: '8px', marginBottom: '12px' }}>
                              <Users size={18} className="text-primary" />
                              {areaManager}
                            </div>
                            <ul style={{ 
                              display: 'grid', 
                              gridTemplateColumns: 'repeat(2, 1fr)', 
                              gap: '12px 8px'
                            }}>
                              {stores.map(store => (
                                <li key={store.storeName} className="flex flex-col items-center justify-center gap-1 text-sm text-gray-700 text-center" style={{ padding: '4px' }}>
                                  <span className="font-medium">{store.storeName}</span>
                                  {store.beautyLeader && store.beautyLeader !== '無' && (
                                    <span style={{ 
                                      fontSize: '0.7rem', 
                                      backgroundColor: 'var(--color-error-100)', 
                                      color: 'var(--color-error)', 
                                      padding: '2px 6px', 
                                      borderRadius: '4px',
                                      whiteSpace: 'nowrap'
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
