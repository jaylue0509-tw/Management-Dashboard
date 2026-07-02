import React, { useMemo } from 'react';
import type { Manager } from '../types';
import { MapPin, Building, Users } from 'lucide-react';

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

  return (
    <div className="card" style={{ padding: 'var(--space-6)', minHeight: '600px' }}>
      <h2 className="text-xl font-bold flex items-center gap-2" style={{ marginBottom: 'var(--space-6)' }}>
        <Building className="text-primary" size={24} />
        區主管門店配置圖
      </h2>
      
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
    </div>
  );
};
