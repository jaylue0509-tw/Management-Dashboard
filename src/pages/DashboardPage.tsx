import React, { useEffect, useState } from 'react';
import { HeaderBar } from '../components/HeaderBar';
import { SummaryCards } from '../components/SummaryCards';
import { ActivityWall } from '../components/ActivityWall';
import { ManagerList } from '../components/ManagerList';
import { OrganizationMap } from '../components/OrganizationMap';
import type { DashboardSummary, Manager, VisitRecord } from '../types';
import { getDashboardSummary, getActivityWall, getManagers } from '../api/api';

const DashboardSkeleton = () => (
  <div className="animate-pulse flex flex-col gap-6" style={{ marginTop: 'var(--space-6)' }}>
    {/* Summary Cards Skeleton */}
    <div className="flex gap-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="skeleton-box" style={{ flex: 1, height: '120px', borderRadius: 'var(--radius-lg)' }}></div>
      ))}
    </div>
    {/* Layout Skeleton */}
    <div className="flex gap-6" style={{ alignItems: 'flex-start' }}>
      <div className="skeleton-box" style={{ width: '350px', height: '600px', borderRadius: 'var(--radius-lg)' }}></div>
      <div className="skeleton-box" style={{ flex: 1, height: '600px', borderRadius: 'var(--radius-lg)' }}></div>
    </div>
  </div>
);

export const DashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'map'>('dashboard');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [activities, setActivities] = useState<VisitRecord[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [selectedManager, setSelectedManager] = useState<Manager | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const today = new Date().toISOString().split('T')[0];
        const [sumData, actData, mgrData] = await Promise.all([
          getDashboardSummary(today),
          getActivityWall(today, 'all'),
          getManagers()
        ]);
        setSummary(sumData);
        setActivities(actData);
        setManagers(mgrData);
      } catch (err) {
        console.error("Failed to load dashboard data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1440px', margin: '0 auto' }}>
      <HeaderBar />
      
      {/* 頁籤切換 */}
      <div className="flex gap-4" style={{ marginBottom: 'var(--space-6)', borderBottom: '1px solid var(--border-color)' }}>
        <button 
          onClick={() => setActiveTab('dashboard')}
          style={{
            padding: '12px 16px',
            fontSize: '1.125rem',
            fontWeight: 500,
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'dashboard' ? '3px solid var(--color-primary-500)' : '3px solid transparent',
            color: activeTab === 'dashboard' ? 'var(--color-primary-500)' : 'var(--color-secondary-500)',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          即時動態牆
        </button>
        <button 
          onClick={() => setActiveTab('map')}
          style={{
            padding: '12px 16px',
            fontSize: '1.125rem',
            fontWeight: 500,
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'map' ? '3px solid var(--color-primary-500)' : '3px solid transparent',
            color: activeTab === 'map' ? 'var(--color-primary-500)' : 'var(--color-secondary-500)',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          區主管門店配置圖
        </button>
      </div>

      {loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {activeTab === 'dashboard' ? (
            <>
              <SummaryCards summary={summary} />
              
              <div className="flex gap-6" style={{ alignItems: 'flex-start' }}>
                <ManagerList 
                  managers={managers} 
                  selectedManager={selectedManager} 
                  onSelect={setSelectedManager} 
                />
                
                <main style={{ flex: 1 }}>
                  <ActivityWall activities={activities} />
                </main>
              </div>
            </>
          ) : (
            <OrganizationMap managers={managers} />
          )}
        </>
      )}
    </div>
  );
};
