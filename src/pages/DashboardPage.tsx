import React, { useEffect, useState, useMemo } from 'react';
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

const groupBy = <T, K extends keyof any>(list: T[], getKey: (item: T) => K) =>
  list.reduce((previous, currentItem) => {
    const group = getKey(currentItem);
    if (!previous[group]) previous[group] = [];
    previous[group].push(currentItem);
    return previous;
  }, {} as Record<K, T[]>);

export const DashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'map'>('dashboard');
  const [activities, setActivities] = useState<VisitRecord[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [selectedManager, setSelectedManager] = useState<Manager | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const today = new Date().toISOString().split('T')[0];
        const [, actData, mgrData] = await Promise.all([
          getDashboardSummary(today), // Keep the fetch call to not break the API promise array but ignore the result
          getActivityWall(today, 'all'),
          getManagers()
        ]);
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

  const uniqueManagers = useMemo(() => {
    const grouped = groupBy(managers, m => m.areaManagerName);
    return Object.entries(grouped).map(([name, stores]) => {
      // 找出該主管今日填寫的動態
      const managerActivities = activities.filter(a => a.areaManagerName === name);
      // 找出該主管今日填寫了哪些「獨立的門市」
      const visitedStores = Array.from(new Set(managerActivities.map(a => a.storeName)));
      
      const todayVisitCount = visitedStores.length;
      const assignedStoreCount = stores.length;
      const region = stores[0]?.region || '';
      const expectedStayMinutes = managerActivities.reduce((acc, curr) => acc + (curr.expectedStayMinutes || 0), 0);
      
      let visitStatus: '尚未回填' | '巡店中' | '已完成' = '尚未回填';
      if (todayVisitCount > 0 && todayVisitCount < assignedStoreCount) visitStatus = '巡店中';
      if (todayVisitCount > 0 && todayVisitCount >= assignedStoreCount) visitStatus = '已完成';

      return {
        ...stores[0],
        areaManagerName: name,
        region,
        assignedStoreCount,
        todayVisitCount,
        visitStatus,
        visitedStores,
        expectedStayMinutes
      };
    });
  }, [managers, activities]);

  const filteredManagers = useMemo(() => {
    if (selectedDepartment === 'all') return uniqueManagers;
    
    // 將「營業一處」轉為「一處」作為關鍵字比對
    const keyword = selectedDepartment.replace('營業', ''); 
    return uniqueManagers.filter(m => m.department.includes(keyword) || m.department === selectedDepartment);
  }, [uniqueManagers, selectedDepartment]);

  const filteredActivities = useMemo(() => {
    if (selectedDepartment === 'all') return activities;
    const validManagerNames = new Set(filteredManagers.map(m => m.areaManagerName));
    return activities.filter(a => validManagerNames.has(a.areaManagerName));
  }, [activities, filteredManagers, selectedDepartment]);

  const dynamicSummary = useMemo(() => {
    let targetActivities = filteredActivities;
    if (selectedManager) {
      targetActivities = filteredActivities.filter(a => a.areaManagerName === selectedManager.areaManagerName);
    }
    
    let abnormalCount = 0;
    let highlightCount = 0;
    
    targetActivities.forEach(a => {
      if (a.abnormalFlag) abnormalCount++;
      if (a.highlightDescription) highlightCount++;
    });

    return {
      totalVisits: targetActivities.length,
      completedManagersCount: 0,
      pendingManagersCount: 0,
      visitedStoresCount: 0,
      abnormalIssuesCount: abnormalCount,
      improvementIssuesCount: 0,
      totalExpectedStayMinutes: 0,
      highlightCount: highlightCount
    } as DashboardSummary;
  }, [filteredActivities, selectedManager]);

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1440px', margin: '0 auto' }}>
      <HeaderBar 
        selectedDepartment={selectedDepartment}
        onDepartmentChange={setSelectedDepartment}
      />
      
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
              <SummaryCards summary={dynamicSummary} />
              
              <div className="flex flex-col md:flex-row" style={{ gap: 'var(--space-6)', alignItems: 'flex-start' }}>
                <ManagerList 
                  managers={filteredManagers} 
                  selectedManager={selectedManager} 
                  onSelect={setSelectedManager} 
                />
                
                <main className="w-full md:w-auto" style={{ flex: 1 }}>
                  <ActivityWall activities={filteredActivities} />
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
