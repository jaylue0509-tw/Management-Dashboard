import React, { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { Manager } from '../types';
import { MapPin, Building, Users, Sparkles, UserCheck } from 'lucide-react';
import { importManagers } from '../api/api';
import { normalizeRegionName, compareRegion, getBusinessDepartment, getBusinessDirector } from '../utils/store-region';
import {
  getBeautyDirectorByRegion,
  isRegionInBeautyDirectorScope,
} from '../data/beautyAuditConfig';
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
  const { user } = useAuth();

  const filteredManagers = useMemo(() => {
    if (user?.role === 'manager') {
      return managers.filter(
        m =>
          m.areaManagerName === user.name ||
          m.deputyManagerName === user.name ||
          (user.assigned_stores && user.assigned_stores.includes(m.storeName))
      );
    }
    if (user?.role === 'beauty_director') {
      return managers.filter(
        m =>
          isRegionInBeautyDirectorScope(m.region, user.department) ||
          (user.assigned_stores && user.assigned_stores.includes(m.storeName))
      );
    }
    return managers;
  }, [managers, user]);

  const groupedData = useMemo(() => {
    return groupBy(filteredManagers, m => {
      const region = normalizeRegionName(m.region) || m.region;
      return getBusinessDepartment(region) || m.department || '未分類處別';
    });
  }, [filteredManagers]);

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
          '區經理': 'areaManagerName', // 支援新版欄位名稱
          '副區主管': 'deputyManagerName',
          '門市': 'storeName',
          '店名': 'storeName', // 支援別名
          'St Name': 'storeName', // 支援英文別名
          '美容區組長/總監': 'beautyLeader'
        };

        const newManagers: Manager[] = [];
        let lastDept = '';
        let lastDirector = '';

        // Extract enKeys to initialize them
        const allEnKeys = Array.from(new Set(Object.values(headerMap)));

        for (const row of data) {
          const m: Partial<Manager> = { todayVisitCount: 0, assignedStoreCount: 0, hasAbnormal: false, visitStatus: '尚未回填' };
          
          // Initialize all expected string fields to empty string to prevent Pydantic validation errors
          for (const key of allEnKeys) {
            m[key] = '' as never;
          }
          
          for (const [chKey, enKey] of Object.entries(headerMap)) {
            // Find key in row that exactly matches or includes the Chinese/English word
            // We only set it if it hasn't been set yet (to allow multiple aliases mapping to the same enKey)
            const actualKey = Object.keys(row).find(k => k.includes(chKey) || k.toLowerCase() === chKey.toLowerCase());
            if (actualKey && !m[enKey]) {
                const rawVal = row[actualKey] || '';
                // Remove newlines and extra spaces inside fields
                m[enKey] = String(rawVal).replace(/\s+/g, ' ').trim() as never;
            }
          }
          
          // 如果處別或處長空白，則繼承上一筆資料（解決 Excel 合併儲存格產生的空白問題）
          if (m.department) lastDept = m.department; else m.department = lastDept;
          if (m.directorName) lastDirector = m.directorName; else m.directorName = lastDirector;

          // 依現行營業處組織對照表統一補齊處別與處長姓名
          const normalizedRegion = normalizeRegionName(m.region);
          const resolvedDept = getBusinessDepartment(normalizedRegion) || m.department || '';
          const resolvedDirector = getBusinessDirector(resolvedDept, normalizedRegion) || m.directorName || '';
          m.department = resolvedDept;
          m.directorName = resolvedDirector;
          
          if (m.storeName) {
            newManagers.push(m as Manager);
          }
        }
        
        if (newManagers.length === 0) {
          return alert('找不到任何門市資料！請確認您的 CSV 標題是否有包含「門市」或「St Name」。');
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
    <div
      className="card p-3.5 sm:p-6"
      style={{
        minHeight: '600px',
        background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
        border: 'none',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4 sm:mb-6">
        <h2 className="text-base sm:text-xl font-bold flex items-center gap-2">
          <Building className="text-primary shrink-0" size={22} />
          <span>
            {user?.role === 'beauty_director'
              ? `${user.name}${user.nickname ? ` (${user.nickname})` : ''} 美容總監轄屬門店配置（${user.department || ''}）`
              : user?.role === 'manager'
              ? `${user.name} 區主管轄區門店配置`
              : '區主管門店配置圖'}
          </span>
        </h2>
        
        {user?.role === 'admin' && (
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
        )}
      </div>
      
      {filteredManagers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--color-secondary-500)' }}>
          <Building size={48} style={{ margin: '0 auto 1rem', opacity: 0.2 }} />
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>尚無組織架構資料</h3>
          <p>請點擊右上方的按鈕，匯入您的 CSV 配置圖檔案！</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
        {Object.entries(groupedData)
          .sort(([a], [b]) => {
            const rank = (key: string) => key.startsWith('營業一處') ? 0 : key.startsWith('營業二處') ? 1 : 2;
            return rank(a) - rank(b) || a.localeCompare(b, 'zh-Hant');
          })
          .map(([dept, deptManagers]) => {
          const director =
            getBusinessDirector(dept) ||
            deptManagers.find(m => m.directorName?.trim())?.directorName?.trim() ||
            '';
          const regions = groupBy(deptManagers, m => normalizeRegionName(m.region) || m.region);

          return (
            <div key={dept} style={{ 
              border: '1px solid rgba(255, 255, 255, 0.4)', 
              borderRadius: 'var(--radius-lg)', 
              overflow: 'hidden',
              background: 'rgba(255, 255, 255, 0.3)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.05)'
            }}>
              {/* Department Header */}
              <div className="flex flex-wrap justify-between items-center gap-2.5" style={{ backgroundColor: 'rgba(255, 255, 255, 0.5)', padding: '12px 16px', borderBottom: '1px solid rgba(255, 255, 255, 0.5)' }}>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <div className="font-extrabold text-lg text-gray-900">{dept || '未分類處別'}</div>
                  <span className="text-xs font-bold text-sky-800 bg-sky-100/90 border border-sky-200 px-2.5 py-0.5 rounded-full">
                    {Object.keys(regions).length} 區 · {deptManagers.length} 店
                  </span>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/90 border border-indigo-200 shadow-2xs text-sm font-extrabold text-indigo-900">
                  <UserCheck size={15} className="text-indigo-600 shrink-0" />
                  <span>{director ? `${director} 處長` : '處長：未設定'}</span>
                </div>
              </div>
              
              {/* Regions（手機端支援 snap 左右滑動卡片，不超出螢幕寬度） */}
              {Object.keys(regions).length > 1 && (
                <div className="sm:hidden px-3.5 pt-2 text-[11px] font-bold text-sky-900/70">
                  ← 左右滑動切換各區域（共 {Object.keys(regions).length} 區）→
                </div>
              )}
              <div
                className="flex flex-row gap-4 sm:gap-8 p-3.5 sm:p-4 overflow-x-auto no-scrollbar snap-x snap-mandatory"
                style={{ flexWrap: 'nowrap' }}
              >
                {Object.entries(regions).sort(([a], [b]) => compareRegion(a, b)).map(([region, regManagers]) => {
                  const areaManagers = groupBy(regManagers, m => m.areaManagerName);
                  const beautyDir = getBeautyDirectorByRegion(region);
                  
                  return (
                    <div
                      key={region}
                      className="flex flex-col gap-3.5 sm:gap-4 w-[84vw] max-w-[320px] sm:w-[320px] shrink-0 snap-start"
                    >
                      <div className="flex flex-col items-center gap-1" style={{ borderBottom: '2px solid var(--color-primary-100)', paddingBottom: '8px' }}>
                        <div className="font-semibold text-primary flex items-center justify-center gap-2">
                          <MapPin size={18} />
                          <span style={{ fontSize: '1.1rem' }}>{region}（{regManagers.length} 店）</span>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-100 border border-rose-300 text-rose-800 text-[11px] font-extrabold">
                          <Sparkles size={11} />
                          {beautyDir.department}：{beautyDir.name}（{beautyDir.nickname}）
                        </span>
                      </div>
                      
                      <div className="flex flex-row flex-wrap items-stretch gap-4" style={{ paddingLeft: '0' }}>
                        {Object.entries(areaManagers).map(([areaManager, stores]) => {
                          const deputyMgr = stores.find(s => s.deputyManagerName)?.deputyManagerName;
                          return (
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
                            <div className="font-bold text-gray-900 flex flex-col items-center justify-center gap-1.5" style={{ borderBottom: '1px solid var(--color-secondary-100)', paddingBottom: '8px', marginBottom: '12px' }}>
                              <div className="flex items-center justify-center gap-2">
                                <Users size={18} className="text-primary" />
                                <span>區域主管：{areaManager || '待指派'}</span>
                              </div>
                              {deputyMgr && (
                                <div className="text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-2.5 py-0.5 rounded-full">
                                  副區主管：{deputyMgr}
                                </div>
                              )}
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
                          );
                        })}
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
