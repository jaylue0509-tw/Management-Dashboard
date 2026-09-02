import React, { useEffect, useState, useMemo } from 'react';
import { HeaderBar } from '../components/HeaderBar';
import { SummaryCards } from '../components/SummaryCards';
import { ExecutiveSummary } from '../components/ExecutiveSummary';
import { ActivityWall } from '../components/ActivityWall';
import { ManagerList } from '../components/ManagerList';
import { OrganizationMap } from '../components/OrganizationMap';
import type { DashboardSummary, Manager, VisitRecord } from '../types';
import { getDashboardData } from '../api/api';
import { RefreshCw } from 'lucide-react';
import { CoverageRadarChart } from '../components/charts/CoverageRadarChart';
import { IssuePieChart } from '../components/charts/IssuePieChart';
import { RiskDistributionChart } from '../components/charts/RiskDistributionChart';
import { TopIssuesList } from '../components/TopIssuesList';
import { useAuth } from '../contexts/AuthContext';
import { AlertTriangle } from 'lucide-react';

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
  const [actionItems, setActionItems] = useState<any[]>([]);
  const [selectedManager, setSelectedManager] = useState<Manager | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { user } = useAuth();

  const fetchData = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    else setIsRefreshing(true);
    
    try {
      const data = await getDashboardData(timeRange, 'all');
      if (data) {
        let validManagers = data.managers.filter((m: any) => !m.storeName?.includes('測試'));
        let validActivities = data.activities.filter((a: any) => !a.storeName?.includes('測試'));
        let validActionItems = data.actionItems.filter((i: any) => !i.storeName?.includes('測試'));

        if (user?.role === 'manager' && user.assigned_stores) {
          validManagers = validManagers.filter((m: any) => user.assigned_stores.includes(m.storeName));
          validActivities = validActivities.filter((a: any) => user.assigned_stores.includes(a.storeName));
          validActionItems = validActionItems.filter((i: any) => user.assigned_stores.includes(i.storeName));
        }

        setManagers(validManagers);
        setActivities(validActivities);
        setActionItems(validActionItems);
      }
    } catch (err) {
      console.error("Failed to load dashboard data", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData(); // 初始載入

    // 設定 5 分鐘自動背景輪詢 (減少多餘的查詢負擔)
    const intervalId = setInterval(() => {
      fetchData(true);
    }, 300000);

    return () => clearInterval(intervalId);
  }, [timeRange]);

  const uniqueManagers = useMemo(() => {
    const grouped = groupBy(managers, m => m.areaManagerName);
    return Object.entries(grouped).map(([name, stores]) => {
      // 找出該主管所有動態
      const managerActivities = activities.filter(a => a.areaManagerName === name);
      
      // 過濾出「今日」的動態
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
      const todayActivities = managerActivities.filter(a => {
        if (!a.createdAt) return false;
        const dStr = new Date(a.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
        return dStr === todayStr;
      });

      // 找出該主管今日填寫了哪些「獨立的門市」
      const visitedStores = Array.from(new Set(todayActivities.map(a => a.storeName)));
      
      const todayVisitCount = visitedStores.length;
      const assignedStoreCount = stores.length;
      const region = stores[0]?.region || '';
      const expectedStayByStore = new Map<string, number>();
      todayActivities.forEach(a => {
        const existing = expectedStayByStore.get(a.storeName) || 0;
        if ((a.expectedStayMinutes || 0) > existing) {
          expectedStayByStore.set(a.storeName, a.expectedStayMinutes || 0);
        }
      });
      const expectedStayMinutes = Array.from(expectedStayByStore.values()).reduce((acc, curr) => acc + curr, 0);
      
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

  const targetActivities = useMemo(() => {
    if (selectedManager) {
      return filteredActivities.filter(a => a.areaManagerName === selectedManager.areaManagerName);
    }
    return filteredActivities;
  }, [filteredActivities, selectedManager]);

  const { dynamicSummary, radarData, pieData, riskData, topIssues, unresolvedStores } = useMemo(() => {
    let abnormalCount = 0;
    let highlightCount = 0;
    const expectedStayByStore = new Map<string, number>();
    
    // Calculate Coverage
    let redLightStoresCount = 0;
    const moduleScores = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
    const moduleCounts = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
    
    const latestRatingByStore = new Map<string, { rating: string, activity: VisitRecord }>();
    let subItemCounts: Record<string, number> = {};
    
    // Calculate Issues
    let issuesDistribution = {
      '行銷檔期': 0,
      '陳列損耗': 0,
      '寵物專業': 0,
      '人員服務': 0,
      '環境設備': 0,
      '經營數據': 0
    };
    
    let subItemStores: Record<string, Map<string, { reportTime: string, recordId: string }>> = {};
    let issuesStores: Record<string, Map<string, { reasons: string[], reportTime: string }>> = {
      '行銷檔期': new Map(), '陳列損耗': new Map(), '寵物專業': new Map(),
      '人員服務': new Map(), '環境設備': new Map(), '經營數據': new Map()
    };

    const CATEGORY_NAMES = ['行銷與檔期執行', '商品陳列與損耗管理', '寵物專業服務與照護', '人員服務與顧客體驗', '門市環境與設備安全', '經營數據與團隊管理'];
    const ITEM_NAMES: Record<string, string> = {
      '1-1': '檔期 POP 與宣傳物', '1-2': '主題陳列與佈置', '1-3': '檔期主打商品備貨', '1-4': '結帳區加價購專區',
      '2-1': '排面平整與拉面', '2-2': '效期與先進先出', '2-3': '臨期品與損耗處置', '2-4': '高單價與高損品防竊', '2-5': 'PB 與高毛利商品陳列',
      '3-1': '美容房環境與衛生', '3-2': '美容操作 SOP 與安全', '3-3': '活體照護與環境', '3-4': '保健/醫療專區維護',
      '4-1': '儀容儀態與招呼', '4-2': '專業導購與衛教', '4-3': '櫃檯結帳與附加銷售',
      '5-1': '門面與整體環境清潔', '5-2': '賣場氣氛與燈光空調', '5-3': '後勤倉庫與公安動線', '5-4': '系統與設備安全運作',
      '6-1': '業績與 KPI 指標跟進', '6-2': '人員 1-on-1 面談紀錄', '6-3': '團隊士氣與排班合理性'
    };

    targetActivities.forEach(a => {
      const abnormalChecks = a.categoryChecks 
        ? Object.entries(a.categoryChecks).filter(([_, val]) => val === '缺失' || val === '待改善')
        : [];
        
      let hasRealDefectInNotes = false;
      if (a.immediateImprovement) {
        const lines = a.immediateImprovement.split('\n').filter(line => line.trim() && !line.includes('紀錄缺失項目'));
        for (const line of lines) {
          const sepIdx = line.indexOf('：') !== -1 ? line.indexOf('：') : line.indexOf(':');
          const hasSep = sepIdx !== -1;
          const title = hasSep ? line.substring(0, sepIdx).trim() : line;
          const content = hasSep ? line.substring(sepIdx + 1).trim() : '';
          
          const isNeutral = title.includes('姓名') || title.includes('簽名') || title.includes('反饋') || title.includes('店名');
          const isOk = hasSep
            ? (!content || content === '無' || content === '無缺失' || content === '正常')
            : (title === '無' || title === '無缺失' || title === '正常');
            
          if (!isNeutral && !isOk) {
            hasRealDefectInNotes = true;
            break;
          }
        }
      }
      
      if (abnormalChecks.length > 0 || hasRealDefectInNotes) {
        abnormalCount++;
        // If we want to override the property so that ActivityWall gets it cleanly, we can do:
        a.abnormalFlag = true;
      } else {
        a.abnormalFlag = false;
      }

      if (a.highlightDescription) highlightCount++;
      if (a.overallRating === '需重點輔導') redLightStoresCount++;
      
      if (!latestRatingByStore.has(a.storeName)) {
        latestRatingByStore.set(a.storeName, { rating: a.overallRating || '良好', activity: a });
      }
      
      const storeKey = `${a.areaManagerName}-${a.storeName}`;
      const existing = expectedStayByStore.get(storeKey) || 0;
      if ((a.expectedStayMinutes || 0) > existing) {
        expectedStayByStore.set(storeKey, a.expectedStayMinutes || 0);
      }
      
      let reportTime = '';
      if (a.createdAt) {
        const d = new Date(a.createdAt);
        const m = d.getMonth() + 1;
        const dd = d.getDate();
        const hh = d.getHours().toString().padStart(2, '0');
        const mm = d.getMinutes().toString().padStart(2, '0');
        reportTime = `${m}/${dd} ${hh}:${mm}`;
      }
      
      // Compute Module Scores from categoryChecks
      if (a.categoryChecks) {
        Object.entries(a.categoryChecks).forEach(([key, val]) => {
          const mod = parseInt(key.split('-')[0]);
          if (mod >= 1 && mod <= 6 && val !== 'N/A') {
            moduleCounts[mod as keyof typeof moduleCounts]++;
            if (val === '合格') moduleScores[mod as keyof typeof moduleScores]++;
            if (val === '缺失' || val === '待改善') {
               subItemCounts[key] = (subItemCounts[key] || 0) + 1;
               if (!subItemStores[key]) subItemStores[key] = new Map();
               
               if (!subItemStores[key].has(a.storeName)) {
                 subItemStores[key].set(a.storeName, { reportTime, recordId: a.recordId });
               }
            }
            if (val === '缺失') {
               const mapping = ['行銷檔期', '陳列損耗', '寵物專業', '人員服務', '環境設備', '經營數據'];
               const catName = mapping[mod - 1];
               issuesDistribution[catName as keyof typeof issuesDistribution]++;
               
               if (!issuesStores[catName].has(a.storeName)) {
                  issuesStores[catName].set(a.storeName, { reasons: [], reportTime });
               }
               // Check if it's a known item, otherwise format legacy codes or use custom text
               let reasonText = ITEM_NAMES[key];
               if (!reasonText) {
                   if (/^\d-\d+$/.test(key)) {
                       reasonText = `其他${catName}異常`;
                   } else {
                       reasonText = key;
                   }
               }
               issuesStores[catName].get(a.storeName)?.reasons.push(reasonText);
            }
          }
        });
      }
    });

    const expectedStay = Array.from(expectedStayByStore.values()).reduce((acc, curr) => acc + curr, 0);

    // Compute PDCA Rate
    let pdcaRate = -1;
    const validActionItems = actionItems.filter(ai => targetActivities.some(ta => ta.storeName === ai.storeName));
    if (validActionItems.length > 0) {
      const closed = validActionItems.filter(ai => ai.status === 'Closed').length;
      pdcaRate = Math.round((closed / validActionItems.length) * 100);
    }
    
    // Compute Radar Data
    const rData = [
      { subject: '行銷檔期', A: moduleCounts[1] ? Math.round((moduleScores[1]/moduleCounts[1])*100) : 0, fullMark: 100 },
      { subject: '陳列損耗', A: moduleCounts[2] ? Math.round((moduleScores[2]/moduleCounts[2])*100) : 0, fullMark: 100 },
      { subject: '寵物專業', A: moduleCounts[3] ? Math.round((moduleScores[3]/moduleCounts[3])*100) : 0, fullMark: 100 },
      { subject: '人員服務', A: moduleCounts[4] ? Math.round((moduleScores[4]/moduleCounts[4])*100) : 0, fullMark: 100 },
      { subject: '環境設備', A: moduleCounts[5] ? Math.round((moduleScores[5]/moduleCounts[5])*100) : 0, fullMark: 100 },
      { subject: '經營數據', A: moduleCounts[6] ? Math.round((moduleScores[6]/moduleCounts[6])*100) : 0, fullMark: 100 },
    ];
    
    // Correctly calculate total assigned stores based on the raw managers list filtered by department
    const keyword = selectedDepartment === 'all' ? '' : selectedDepartment.replace('營業', '');
    const validRawManagers = selectedDepartment === 'all'
      ? managers
      : managers.filter(m => m.department.includes(keyword) || m.department === selectedDepartment);
      
    const normalizeStore = (s: string) => (s || '').trim().replace(/店$/, '');
    const allAssignedStoresList = Array.from(new Set(validRawManagers.map(m => m.storeName)));
    const assignedStoresNormalized = new Map(allAssignedStoresList.map(s => [normalizeStore(s), s]));
    const totalAssignedStores = allAssignedStoresList.length;
    
    // Only count visited stores that match an assigned store (fuzzily by ignoring trailing '店')
    const visitedStoresSet = new Set<string>();
    targetActivities.forEach(a => {
      const norm = normalizeStore(a.storeName);
      if (assignedStoresNormalized.has(norm)) {
        visitedStoresSet.add(assignedStoresNormalized.get(norm)!);
      }
    });
    
    const uniqueVisitedStoresInPeriod = visitedStoresSet.size;
    const coverageRate = totalAssignedStores > 0 ? Math.round((uniqueVisitedStoresInPeriod / totalAssignedStores) * 100) : 0;
    // Compute Pie Data
    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
    const pData = Object.entries(issuesDistribution)
      .filter(([_, val]) => val > 0)
      .map(([name, value], idx) => ({ 
         name, 
         value, 
         color: colors[idx % colors.length],
         stores: Array.from(issuesStores[name].entries()).map(([storeName, data]) => ({
             name: storeName,
             reasons: data.reasons,
             reportTime: data.reportTime
         }))
      }));

    // Compute Risk Distribution
    let riskCounts = { '良好': 0, '需追蹤': 0, '需重點輔導': 0 };
    let riskStores: { [key: string]: { name: string; score: number; reportTime: string; reasons: string[] }[] } = { '良好': [], '需追蹤': [], '需重點輔導': [] };
    latestRatingByStore.forEach(({ rating, activity }, store) => {
        let score = 100;
        let totalChecks = 0;
        let passedChecks = 0;
        if (activity.categoryChecks) {
            Object.values(activity.categoryChecks).forEach(val => {
                if (val !== 'N/A') {
                    totalChecks++;
                    if (val === '合格') passedChecks++;
                }
            });
        }
        if (totalChecks > 0) {
            score = Math.round((passedChecks / totalChecks) * 100);
            // Cap score based on overall rating to avoid logical contradiction
            if ((rating === '需追蹤' || rating === '待追蹤') && score >= 80) {
                score = 79; // Force into yellow range
            } else if (rating === '需重點輔導' && score >= 60) {
                score = 59; // Force into red range
            }
        } else {
            if (rating === '良好') score = 90;
            else if (rating === '需追蹤' || rating === '待追蹤') score = 75;
            else if (rating === '需重點輔導') score = 50;
        }
        let reportTime = '';
        if (activity.createdAt) {
           const d = new Date(activity.createdAt);
           const m = d.getMonth() + 1;
           const dd = d.getDate();
           const hh = d.getHours().toString().padStart(2, '0');
           const mm = d.getMinutes().toString().padStart(2, '0');
           reportTime = `${m}/${dd} ${hh}:${mm}`;
        }

        const reasons: string[] = [];
        if (activity.categoryChecks) {
          Object.entries(activity.categoryChecks).forEach(([key, val]) => {
            if (val === '缺失' || val === '待改善') {
              if (ITEM_NAMES[key]) {
                reasons.push(`${ITEM_NAMES[key]}`);
              } else {
                const text = /^\d-\d+$/.test(key) ? `其他異常` : key;
                reasons.push(`${text}`);
              }
            }
          });
        }
        if (reasons.length === 0) reasons.push(rating === '良好' ? '各項指標表現優異' : '綜合評估為異常');

        if (rating === '良好') { riskCounts['良好']++; riskStores['良好'].push({ name: store, score, reportTime, reasons }); }
        if (rating === '需追蹤' || rating === '待追蹤') { riskCounts['需追蹤']++; riskStores['需追蹤'].push({ name: store, score, reportTime, reasons }); }
        if (rating === '需重點輔導') { riskCounts['需重點輔導']++; riskStores['需重點輔導'].push({ name: store, score, reportTime, reasons }); }
    });
    const riskData = [
       { name: '🟢 良好', value: riskCounts['良好'], color: '#10B981', stores: riskStores['良好'] },
       { name: '🟡 需追蹤', value: riskCounts['需追蹤'], color: '#F59E0B', stores: riskStores['需追蹤'] },
       { name: '🔴 需重點輔導', value: riskCounts['需重點輔導'], color: '#EF4444', stores: riskStores['需重點輔導'] }
    ].filter(d => d.value > 0);

    // Compute Top Issues
    const topIssues = Object.entries(subItemCounts)
       .sort((a, b) => b[1] - a[1])
       .slice(0, 5)
       .map(([key, count]) => {
           const mod = parseInt(key.split('-')[0]);
           return {
               category: CATEGORY_NAMES[mod - 1] || '自訂',
               item: ITEM_NAMES[key] || (/^\d-\d+$/.test(key) ? `其他${CATEGORY_NAMES[mod - 1] || '模組'}異常` : key),
               count,
               stores: Array.from(subItemStores[key]?.entries() || []).map(([name, data]) => ({ name, reportTime: data.reportTime, recordId: data.recordId }))
           };
       });

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    const todayActivitiesList = targetActivities.filter(a => {
       if (!a.createdAt) return false;
       const dStr = new Date(a.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
       return dStr === todayStr;
    });
    
    // Build store lists
    const redLightStoresList = Array.from(latestRatingByStore.entries())
      .filter(([_, data]) => data.rating === '需重點輔導')
      .map(([store, data]) => {
        const reasons: string[] = [];
        if (data.activity.categoryChecks) {
          Object.entries(data.activity.categoryChecks).forEach(([key, val]) => {
            if (val === '缺失' || val === '待改善') {
              if (ITEM_NAMES[key]) {
                reasons.push(`${ITEM_NAMES[key]} (${val})`);
              } else {
                const text = /^\d-\d+$/.test(key) ? `其他異常` : key;
                reasons.push(`${text} (${val})`);
              }
            }
          });
        }
        if (reasons.length === 0) reasons.push('綜合評估紅燈');
        
        let reportTime = '';
        if (data.activity.createdAt) {
           const d = new Date(data.activity.createdAt);
           const m = d.getMonth() + 1;
           const dd = d.getDate();
           const hh = d.getHours().toString().padStart(2, '0');
           const mm = d.getMinutes().toString().padStart(2, '0');
           reportTime = `${m}/${dd} ${hh}:${mm}`;
        }
        return { store, reasons, reportTime };
      });
      
    const visitStoresList = Array.from(new Set(todayActivitiesList.map(a => a.storeName)));
    
    // Group abnormal activities by store and take the latest one
    const latestAbnormalByStore = new Map<string, any>();
    targetActivities.forEach(a => {
       if (a.abnormalFlag) {
          if (!latestAbnormalByStore.has(a.storeName)) {
             latestAbnormalByStore.set(a.storeName, a);
          }
       }
    });

    const abnormalStoresList = Array.from(latestAbnormalByStore.entries()).map(([store, activity]) => {
      const reasons: string[] = [];
      if (activity.categoryChecks) {
        Object.entries(activity.categoryChecks).forEach(([key, val]) => {
          if (val === '缺失' || val === '待改善') {
            if (ITEM_NAMES[key]) {
              reasons.push(`${ITEM_NAMES[key]} (${val})`);
            }
          }
        });
      }
      if (reasons.length === 0) reasons.push('有異常事項');
      
      let reportTime = '';
      if (activity.createdAt) {
         const d = new Date(activity.createdAt);
         const m = d.getMonth() + 1;
         const dd = d.getDate();
         const hh = d.getHours().toString().padStart(2, '0');
         const mm = d.getMinutes().toString().padStart(2, '0');
         reportTime = `${m}/${dd} ${hh}:${mm}`;
      }
      return { store, reasons, reportTime };
    });
    
    const visitedStoresList = Array.from(visitedStoresSet);
    const unvisitedStoresList = allAssignedStoresList.filter(s => !visitedStoresSet.has(s));
    
    const closedPdcaStores = Array.from(new Set(validActionItems.filter(ai => ai.status === 'Closed').map(ai => ai.storeName)));
    const openPdcaStores = Array.from(new Set(validActionItems.filter(ai => ai.status !== 'Closed').map(ai => ai.storeName)));

    return {
      dynamicSummary: {
        totalVisits: todayActivitiesList.length,
        completedManagersCount: 0,
        pendingManagersCount: 0,
        visitedStoresCount: 0,
        abnormalIssuesCount: abnormalCount,
        improvementIssuesCount: 0,
        totalExpectedStayMinutes: expectedStay,
        highlightCount: highlightCount,
        coverageRate,
        pdcaRate,
        redLightStores: redLightStoresCount,
        assignedStoresCount: totalAssignedStores,
        uniqueVisitedStoresCount: uniqueVisitedStoresInPeriod,
        coverageStoresInfo: { visited: visitedStoresList, unvisited: unvisitedStoresList },
        pdcaStoresInfo: { closed: closedPdcaStores, open: openPdcaStores },
        redLightStoresList: redLightStoresList,
        visitStoresList: visitStoresList,
        abnormalStoresList: abnormalStoresList
      } as DashboardSummary,
      radarData: rData,
      pieData: pData,
      riskData,
      topIssues,
      unresolvedStores: abnormalStoresList.filter(s => !closedPdcaStores.includes(s.store))
    };
  }, [targetActivities, actionItems]);

  return (
    <div style={{ minHeight: '100vh', paddingBottom: '40px', background: '#f4f6f9' }}>
      <HeaderBar
        selectedDepartment={selectedDepartment}
        onDepartmentChange={setSelectedDepartment}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      />

      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '0 24px' }}>
        {/* Tab Bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '22px',
          borderBottom: '1px solid #e5e7eb',
        }}>
          <div style={{ display: 'flex', gap: '4px' }}>
            {[
              { id: 'dashboard', label: '即時動態牆' },
              { id: 'map', label: '區主管門店配置' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as 'dashboard' | 'map')}
                style={{
                  padding: '10px 18px',
                  fontSize: '0.88rem',
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === tab.id
                    ? '2px solid #2563eb'
                    : '2px solid transparent',
                  color: activeTab === tab.id
                    ? '#2563eb'
                    : '#9ca3af',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  marginBottom: '-1px',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Refresh Button */}
          <button
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '7px 14px',
              background: '#f9fafb',
              color: isRefreshing ? '#d1d5db' : '#6b7280',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: isRefreshing ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              marginBottom: '8px',
            }}
          >
            <RefreshCw size={13} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            {isRefreshing ? '更新中...' : '立即更新'}
          </button>
        </div>

        {loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* Unresolved Issues Reminder Banner */}
            {unresolvedStores.length > 0 && (
              <div className="mb-6 bg-gradient-to-r from-red-500 to-rose-500 rounded-2xl p-1 shadow-lg animate-in slide-in-from-top-4 fade-in duration-500">
                <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 sm:p-5 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-white/20 p-2 rounded-lg mt-0.5 sm:mt-0">
                      <AlertTriangle size={24} className="text-white animate-pulse" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
                        未結案提醒 
                        <span className="bg-red-600/50 px-2 py-0.5 rounded-full text-xs font-semibold border border-red-400/30">
                          {unresolvedStores.length} 間門市
                        </span>
                      </h3>
                      <p className="text-red-50 text-sm font-medium opacity-90 leading-relaxed max-w-2xl">
                        以下門市巡檢發現缺失，且尚未完成 PDCA 結案，請持續追蹤改善進度直到結案為止：
                        {unresolvedStores.map(s => s.store).join('、')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'dashboard' ? (
              <>
                {(() => {
                  const timeRangeText = timeRange === 'day' ? '今日' : timeRange === 'week' ? '本週' : timeRange === 'last_week' ? '上週' : timeRange === 'month' ? '本月' : '全部';
                  const fullRegionLabel = `${selectedDepartment === 'all' ? '全區' : selectedDepartment} (${timeRangeText})`;
                  return <SummaryCards summary={dynamicSummary} regionLabel={fullRegionLabel} />;
                })()}

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
                  <CoverageRadarChart data={radarData} />
                  <RiskDistributionChart data={riskData} />
                  <IssuePieChart data={pieData} />
                </div>

                {/* Executive Summary */}
                {!selectedManager && (
                  <ExecutiveSummary 
                    activities={filteredActivities} 
                    summary={dynamicSummary} 
                    timeRange={timeRange} 
                    topIssues={topIssues}
                    radarData={radarData}
                  />
                )}

                {/* Main Content: Manager List + Activity Wall */}
                <div className="flex flex-col md:flex-row gap-6" style={{ alignItems: 'flex-start' }}>
                  <ManagerList
                    managers={filteredManagers}
                    selectedManager={selectedManager}
                    onSelect={setSelectedManager}
                    timeRangeLabel={timeRange === 'day' ? '今日' : timeRange === 'week' ? '本週' : '本月'}
                  />
                  <main style={{ flex: 1, width: '100%', minWidth: 0 }}>
                    <TopIssuesList 
                      issues={topIssues} 
                      onStoreClick={(recordId) => {
                        const el = document.getElementById(`activity-${recordId}`);
                        if (el) {
                          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          el.classList.add('highlight-pulse');
                          setTimeout(() => el.classList.remove('highlight-pulse'), 2000);
                        } else {
                          // If not found, it might be filtered out because of selectedManager,
                          // clear selectedManager first?
                          // Actually, targetActivities determines ActivityWall. If the issue is in topIssues,
                          // it's in targetActivities.
                        }
                      }}
                    />
                    <div style={{ marginTop: '24px' }}>
                      <ActivityWall activities={targetActivities} actionItems={actionItems} />
                    </div>
                  </main>
                </div>
              </>
            ) : (
              <OrganizationMap managers={managers} />
            )}
          </>
        )}
      </div>
    </div>
  );
};
