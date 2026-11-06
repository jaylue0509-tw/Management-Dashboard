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
import { AlertTriangle, CheckCircle2, ClipboardSignature, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { normalizeUtcIso, getTaipeiDateStr, formatTaipeiReportTime, getMinutesAgo } from '../utils/time-utils';

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

const getTaipeiTodayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

const shiftDateStr = (dateStr: string, deltaDays: number) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
};

const getTaipeiWeekBounds = (baseDateStr: string, offsetWeeks = 0) => {
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetWeeks * 7));
  const dayOfWeek = dt.getUTCDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mon = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + diffToMonday));
  const sun = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6));
  return {
    start: mon.toISOString().slice(0, 10),
    end: sun.toISOString().slice(0, 10),
  };
};

export const DashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'map'>('dashboard');
  const [allActivities, setAllActivities] = useState<VisitRecord[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [actionItems, setActionItems] = useState<any[]>([]);
  const [selectedManager, setSelectedManager] = useState<Manager | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<string>('day');
  const [customStartDate, setCustomStartDate] = useState<string>(() => getTaipeiTodayStr());
  const [customEndDate, setCustomEndDate] = useState<string>(() => getTaipeiTodayStr());
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resolvingStore, setResolvingStore] = useState<{
    store: string;
    reasons: string[];
    reportTime?: string;
    recordId?: string;
    region?: string;
    areaManagerName?: string;
  } | null>(null);
  const [isSubmittingResolve, setIsSubmittingResolve] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [quickScheduleType, setQuickScheduleType] = useState<'總部行程' | '會議行程' | '特殊行程'>('總部行程');
  const [quickScheduleNote, setQuickScheduleNote] = useState('');
  const [quickScheduleDuration, setQuickScheduleDuration] = useState(240);
  const [quickScheduleManager, setQuickScheduleManager] = useState('');
  const [quickScheduleDate, setQuickScheduleDate] = useState<string>(() => getTaipeiTodayStr());
  const [isSubmittingSchedule, setIsSubmittingSchedule] = useState(false);
  const [focusedRecord, setFocusedRecord] = useState<{ id: string; ts: number } | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleTimeRangeChange = (nextRange: string) => {
    const todayStr = getTaipeiTodayStr();
    setTimeRange(nextRange);
    if (nextRange === 'day') {
      setCustomStartDate(todayStr);
      setCustomEndDate(todayStr);
    } else if (nextRange === 'week') {
      const w = getTaipeiWeekBounds(todayStr, 0);
      setCustomStartDate(w.start);
      setCustomEndDate(w.end);
    } else if (nextRange === 'last_week') {
      const w = getTaipeiWeekBounds(todayStr, -1);
      setCustomStartDate(w.start);
      setCustomEndDate(w.end);
    } else if (nextRange === 'month') {
      setCustomStartDate(`${todayStr.slice(0, 7)}-01`);
      setCustomEndDate(todayStr);
    }
  };

  const activities = useMemo(() => {
    if (timeRange === 'all') return allActivities;
    const todayStr = getTaipeiTodayStr();
    let startStr = customStartDate || todayStr;
    let endStr = customEndDate || startStr;
    if (timeRange === 'day') {
      startStr = customStartDate || todayStr;
      endStr = startStr;
    } else if (timeRange === 'week') {
      const w = getTaipeiWeekBounds(customStartDate || todayStr, 0);
      startStr = w.start;
      endStr = w.end;
    } else if (timeRange === 'last_week') {
      const w = getTaipeiWeekBounds(todayStr, -1);
      startStr = w.start;
      endStr = w.end;
    } else if (timeRange === 'month') {
      const baseMonth = (customStartDate || todayStr).slice(0, 7);
      return allActivities.filter(a => getTaipeiDateStr(a.createdAt).startsWith(baseMonth));
    }
    if (startStr > endStr) {
      const tmp = startStr;
      startStr = endStr;
      endStr = tmp;
    }
    return allActivities.filter(a => {
      const dStr = getTaipeiDateStr(a.createdAt);
      return dStr >= startStr && dStr <= endStr;
    });
  }, [allActivities, timeRange, customStartDate, customEndDate]);

  const handleQuickSubmitSchedule = async () => {
    if (isSubmittingSchedule) return;
    const targetMgr = user?.role === 'manager' ? user.name : (quickScheduleManager || user?.name || '區主管');
    const noteText = quickScheduleNote.trim() || `執行當日${quickScheduleType}`;
    setIsSubmittingSchedule(true);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const apiBase = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';
      const mgrRecord = managers.find(m => m.areaManagerName === targetMgr);
      const res = await fetch(`${apiBase}/visit-records`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          storeName: quickScheduleType,
          region: mgrRecord?.region || '',
          department: mgrRecord?.department || '',
          areaManagerName: targetMgr,
          jobTitle: '區主管',
          actionType: quickScheduleType,
          expectedStayMinutes: quickScheduleDuration || 240,
          tags: [quickScheduleType, '當日行程'],
          immediateImprovement: '',
          highlightDescription: noteText,
          abnormalFlag: false,
          photoPairs: [],
          createdAt: quickScheduleDate === getTaipeiTodayStr()
            ? new Date().toISOString()
            : new Date(`${quickScheduleDate}T09:00:00+08:00`).toISOString()
        })
      });
      if (res.ok) {
        setScheduleModalOpen(false);
        setQuickScheduleNote('');
        await fetchData(true);
      } else {
        alert('行程登記失敗，請稍後再試');
      }
    } catch (e) {
      console.error(e);
      alert('網路連線異常，請稍後再試');
    } finally {
      setIsSubmittingSchedule(false);
    }
  };

  const handleResolveStorePdca = async (storeName: string) => {
    if (isSubmittingResolve) return;
    setIsSubmittingResolve(true);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const apiBase = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';
      const res = await fetch(`${apiBase}/pdca/resolve-store`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ storeName, resolvedBy: user?.name || '區主管' })
      });
      if (res.ok) {
        setResolvingStore(null);
        await fetchData(true);
        alert(`✅ 已將「${storeName}」標記為改善完成結案！`);
      } else {
        alert('結案儲存失敗，請稍後再試');
      }
    } catch (e) {
      console.error(e);
      alert('網路連線異常，請稍後再試');
    } finally {
      setIsSubmittingResolve(false);
    }
  };

  const fetchData = async (isBackground = false) => {
    if (!isBackground && managers.length === 0 && allActivities.length === 0) setLoading(true);
    else setIsRefreshing(true);

    try {
      const data = await getDashboardData('all', 'all');
      if (data) {
        let validManagers = (data.managers || []).filter((m: any) => !m.storeName?.includes('測試') && !m.storeName?.includes('文心秀泰'));
        let validActivities = (data.activities || []).filter((a: any) => {
          if (a.storeName?.includes('測試') || a.storeName?.includes('文心秀泰')) return false;
          if (a.recordId === '0ec0b2f0-45ee-44e6-8db4-4a6fddd15d3c') return false;
          if (Array.isArray(a.newActionItems) && a.newActionItems.some((item: any) => item?.desc?.includes('測試'))) return false;
          return true;
        }).map((a: any) => {
          // NOTE: 統一轉為帶 Z 的 UTC 字串，並即時計算距今分鐘數，避免今日篩選與回報時間偏移 8 小時
          const createdAt = normalizeUtcIso(a.createdAt);
          return { ...a, createdAt, timeAgoMinutes: getMinutesAgo(createdAt) };
        });
        let validActionItems = (data.actionItems || []).filter((i: any) => {
          if (i.storeName?.includes('測試') || i.storeName?.includes('文心秀泰')) return false;
          if (i.desc?.includes('測試') || i.issueDescription?.includes('測試')) return false;
          if (i.sourceRecordId === '0ec0b2f0-45ee-44e6-8db4-4a6fddd15d3c' || i.visitRecordId === '0ec0b2f0-45ee-44e6-8db4-4a6fddd15d3c') return false;
          return true;
        });

        if (user?.role === 'manager') {
          const mgrName = user.name;
          const assignedStores = new Set(user.assigned_stores || []);
          validManagers = validManagers.filter((m: any) => m.areaManagerName === mgrName || assignedStores.has(m.storeName));
          validActivities = validActivities.filter((a: any) => a.areaManagerName === mgrName || assignedStores.has(a.storeName));
          validActionItems = validActionItems.filter((i: any) => assignedStores.has(i.storeName) || i.assignee === mgrName || i.createdBy === mgrName);
        }

        setManagers(validManagers);
        setAllActivities(validActivities);
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
  }, []);

  const uniqueManagers = useMemo(() => {
    let sourceManagers = managers;
    if (user?.role === 'manager') {
      sourceManagers = managers.filter(m => m.areaManagerName === user.name || (user.assigned_stores && user.assigned_stores.includes(m.storeName)));
    }
    const grouped = groupBy(sourceManagers, m => m.areaManagerName);
    let entries = Object.entries(grouped);
    if (user?.role === 'manager') {
      entries = entries.filter(([name]) => name === user.name);
    }
    const SPECIAL_TYPES = new Set(['總部行程', '會議行程', '特殊行程']);
    return entries.map(([name, stores]) => {
      // 找出該主管於目前所選時間區間 / 指定日期內的動態
      const periodActivities = activities.filter(a => a.areaManagerName === name);

      const periodStoreActivities = periodActivities.filter(a => !SPECIAL_TYPES.has(a.actionType));
      const periodScheduleActivities = periodActivities.filter(a => SPECIAL_TYPES.has(a.actionType));

      // 找出該主管在所選區間內填寫了哪些「獨立的門市」
      const visitedStores = Array.from(new Set(periodStoreActivities.map(a => a.storeName)));
      const todaySchedules = periodScheduleActivities.map(a => ({
        type: a.actionType,
        note: a.highlightDescription || a.immediateImprovement || a.storeName || a.actionType,
        duration: a.expectedStayMinutes
      }));

      const todayVisitCount = visitedStores.length;
      const assignedStoreCount = stores.length;
      const region = stores[0]?.region || '';
      const expectedStayByStore = new Map<string, number>();
      periodActivities.forEach(a => {
        const key = `${a.actionType}-${a.storeName}`;
        const existing = expectedStayByStore.get(key) || 0;
        if ((a.expectedStayMinutes || 0) > existing) {
          expectedStayByStore.set(key, a.expectedStayMinutes || 0);
        }
      });
      const expectedStayMinutes = Array.from(expectedStayByStore.values()).reduce((acc, curr) => acc + curr, 0);

      let visitStatus: '尚未回填' | '巡店中' | '已完成' | '總部行程' | '會議行程' | '特殊行程' = '尚未回填';
      if (todaySchedules.length > 0 && todayVisitCount === 0) {
        visitStatus = todaySchedules[0].type as '總部行程' | '會議行程' | '特殊行程';
      } else if (todayVisitCount > 0 && todayVisitCount < assignedStoreCount) {
        visitStatus = '巡店中';
      } else if (todayVisitCount > 0 && todayVisitCount >= assignedStoreCount) {
        visitStatus = '已完成';
      }

      return {
        ...stores[0],
        areaManagerName: name,
        region,
        assignedStoreCount,
        todayVisitCount,
        visitStatus,
        visitedStores,
        todaySchedules,
        expectedStayMinutes
      };
    });
  }, [managers, activities, user]);

  const filteredManagers = useMemo(() => {
    // 區主管只看自己，不受處別篩選干擾
    if (user?.role === 'manager') return uniqueManagers;
    if (selectedDepartment === 'all') return uniqueManagers;

    // 將「營業一處」轉為「一處」作為關鍵字比對
    const keyword = selectedDepartment.replace('營業', '');
    return uniqueManagers.filter(m => m.department.includes(keyword) || m.department === selectedDepartment);
  }, [uniqueManagers, selectedDepartment, user]);

  const filteredActivities = useMemo(() => {
    // 區主管只看自己與轄下門市的動態
    if (user?.role === 'manager') return activities;
    if (selectedDepartment === 'all') return activities;
    const validManagerNames = new Set(filteredManagers.map(m => m.areaManagerName));
    return activities.filter(a => validManagerNames.has(a.areaManagerName));
  }, [activities, filteredManagers, selectedDepartment, user]);

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
    const moduleScores = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const moduleCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

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
      'core-1': '環境異味與清潔', 'core-2': '櫃檯焦點陳列', 'core-3': '人員狀態與迎賓',
      '1-1': '檔期 POP 與宣傳物', '1-2': '主題陳列與佈置', '1-3': '檔期主打商品備貨', '1-4': '結帳區加價購專區',
      '2-1': '排面平整與拉面', '2-2': '效期與先進先出', '2-3': '臨期品與損耗處置', '2-4': '高單價與高損品防竊', '2-5': 'PB 與高毛利商品陳列',
      '3-1': '美容房環境與衛生', '3-2': '美容操作 SOP 與安全', '3-3': '活體照護與環境', '3-4': '保健/醫療專區維護',
      '4-1': '儀容儀態與招呼', '4-2': '專業導購與衛教', '4-3': '櫃檯結帳與附加銷售',
      '5-1': '門面與整體環境清潔', '5-2': '賣場氣氛與燈光空調', '5-3': '後勤倉庫與公安動線', '5-4': '系統與設備安全運作',
      '6-1': '業績與 KPI 指標跟進', '6-2': '人員 1-on-1 面談紀錄', '6-3': '團隊士氣與排班合理性'
    };

    targetActivities.forEach(a => {
      if (a.actionType === '總部行程' || a.actionType === '會議行程' || a.actionType === '特殊行程') {
        a.abnormalFlag = false;
        return;
      }
      const coreAbnormals = (a as any).coreChecks
        ? Object.entries((a as any).coreChecks).filter(([_, val]) => val === '缺失')
        : [];
      const categoryAbnormals = a.categoryChecks
        ? Object.entries(a.categoryChecks).filter(([_, val]) => val === '缺失' || val === '待改善')
        : [];
      const abnormalChecks = [...coreAbnormals, ...categoryAbnormals];

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

      const reportTime = formatTaipeiReportTime(a.createdAt);

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
      { subject: '行銷檔期', A: moduleCounts[1] ? Math.round((moduleScores[1] / moduleCounts[1]) * 100) : 0, fullMark: 100 },
      { subject: '陳列損耗', A: moduleCounts[2] ? Math.round((moduleScores[2] / moduleCounts[2]) * 100) : 0, fullMark: 100 },
      { subject: '寵物專業', A: moduleCounts[3] ? Math.round((moduleScores[3] / moduleCounts[3]) * 100) : 0, fullMark: 100 },
      { subject: '人員服務', A: moduleCounts[4] ? Math.round((moduleScores[4] / moduleCounts[4]) * 100) : 0, fullMark: 100 },
      { subject: '環境設備', A: moduleCounts[5] ? Math.round((moduleScores[5] / moduleCounts[5]) * 100) : 0, fullMark: 100 },
      { subject: '經營數據', A: moduleCounts[6] ? Math.round((moduleScores[6] / moduleCounts[6]) * 100) : 0, fullMark: 100 },
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
      const reportTime = formatTaipeiReportTime(activity.createdAt);

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

        const reportTime = formatTaipeiReportTime(data.activity.createdAt);
        return { store, reasons, reportTime };
      });

    const periodStoreActivities = targetActivities.filter(
      a => !['總部行程', '會議行程', '特殊行程'].includes(a.actionType || '')
    );
    const visitStoresList = Array.from(new Set(periodStoreActivities.map(a => a.storeName)));

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
      if ((activity as any).coreChecks) {
        Object.entries((activity as any).coreChecks).forEach(([key, val]) => {
          if (val === '缺失' && ITEM_NAMES[key]) {
            reasons.push(`${ITEM_NAMES[key]} (${val})`);
          }
        });
      }
      if (activity.categoryChecks) {
        Object.entries(activity.categoryChecks).forEach(([key, val]) => {
          if (val === '缺失' || val === '待改善') {
            if (ITEM_NAMES[key]) {
              reasons.push(`${ITEM_NAMES[key]} (${val})`);
            } else {
              reasons.push(`${key} (${val})`);
            }
          }
        });
      }
      if (reasons.length === 0 && activity.immediateImprovement) {
        const lines = activity.immediateImprovement.split('\n').filter((line: string) => line.trim() && !line.includes('紀錄缺失項目'));
        for (const line of lines) {
          const sepIdx = line.indexOf('：') !== -1 ? line.indexOf('：') : line.indexOf(':');
          const hasSep = sepIdx !== -1;
          const title = hasSep ? line.substring(0, sepIdx).trim() : line;
          const content = hasSep ? line.substring(sepIdx + 1).trim() : '';
          const isNeutral = title.includes('姓名') || title.includes('簽名') || title.includes('反饋') || title.includes('店名');
          const isOk = hasSep ? (!content || content === '無' || content === '無缺失' || content === '正常') : (title === '無' || title === '無缺失' || title === '正常');
          if (!isNeutral && !isOk) {
            reasons.push(hasSep ? `${title}：${content}` : title);
          }
        }
      }
      if (reasons.length === 0) reasons.push('有異常事項待複查');

      const reportTime = formatTaipeiReportTime(activity.createdAt);
      const normStore = normalizeStore(store);
      const matchedMgr = managers.find(m => normalizeStore(m.storeName) === normStore);
      const region = activity.region || matchedMgr?.region || '未分區';
      const areaManagerName = activity.areaManagerName || matchedMgr?.areaManagerName || '';

      return {
        store,
        region,
        areaManagerName,
        reasons,
        reportTime,
        recordId: activity.recordId,
        pdcaResolved: !!(activity as any).pdcaResolved
      };
    });

    const visitedStoresList = Array.from(visitedStoresSet);
    const unvisitedStoresList = allAssignedStoresList.filter(s => !visitedStoresSet.has(s));

    const resolvedAbnormalStores = abnormalStoresList.filter(s => s.pdcaResolved).map(s => s.store);
    const closedPdcaStores = Array.from(new Set([
      ...validActionItems.filter(ai => ai.status === 'Closed').map(ai => ai.storeName),
      ...resolvedAbnormalStores
    ]));
    const unresolvedList = abnormalStoresList.filter(s => !s.pdcaResolved && !closedPdcaStores.includes(s.store));
    const openPdcaStores = Array.from(new Set([
      ...validActionItems.filter(ai => ai.status !== 'Closed').map(ai => ai.storeName),
      ...unresolvedList.map(s => s.store)
    ]));
    const totalPdcaStoresCount = closedPdcaStores.length + openPdcaStores.length;
    const computedPdcaRate = totalPdcaStoresCount > 0
      ? Math.round((closedPdcaStores.length / totalPdcaStoresCount) * 100)
      : pdcaRate;

    return {
      dynamicSummary: {
        totalVisits: periodStoreActivities.length,
        completedManagersCount: 0,
        pendingManagersCount: 0,
        visitedStoresCount: 0,
        abnormalIssuesCount: abnormalCount,
        improvementIssuesCount: 0,
        totalExpectedStayMinutes: expectedStay,
        highlightCount: highlightCount,
        coverageRate,
        pdcaRate: computedPdcaRate,
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
      unresolvedStores: unresolvedList
    };
  }, [targetActivities, actionItems]);

  // NOTE: 將未結案門市依「區域」分組，提供各區主管與督導一眼掌握轄區數量與門市
  const groupedUnresolvedStores = useMemo(() => {
    const map = new Map<string, { region: string; areaManagerName: string; stores: typeof unresolvedStores }>();
    unresolvedStores.forEach(s => {
      const reg = s.region || '未分區';
      if (!map.has(reg)) {
        map.set(reg, {
          region: reg,
          areaManagerName: s.areaManagerName || '',
          stores: []
        });
      }
      const grp = map.get(reg)!;
      grp.stores.push(s);
      if (!grp.areaManagerName && s.areaManagerName) {
        grp.areaManagerName = s.areaManagerName;
      }
    });
    return Array.from(map.values()).sort((a, b) => b.stores.length - a.stores.length);
  }, [unresolvedStores]);

  /**
   * 點擊儀表板上的任一門市標籤，自動滾動定位並展開下方「即時巡店動態」中的該門市細節
   */
  const handleJumpToStore = (storeName: string, preferredRecordId?: string) => {
    const norm = (s: string) => (s || '').trim().replace(/店$/, '');
    const targetNorm = norm(storeName);

    let matched = preferredRecordId
      ? targetActivities.find(a => a.recordId === preferredRecordId)
      : targetActivities.find(a => norm(a.storeName) === targetNorm);

    if (!matched) {
      matched = preferredRecordId
        ? filteredActivities.find(a => a.recordId === preferredRecordId)
        : filteredActivities.find(a => norm(a.storeName) === targetNorm);
      if (matched && selectedManager) {
        setSelectedManager(null);
      }
    }

    if (!matched) {
      matched = preferredRecordId
        ? activities.find(a => a.recordId === preferredRecordId)
        : activities.find(a => norm(a.storeName) === targetNorm);
      if (matched) {
        if (selectedDepartment !== 'all') setSelectedDepartment('all');
        if (selectedManager) setSelectedManager(null);
      }
    }

    if (!matched) {
      matched = preferredRecordId
        ? allActivities.find(a => a.recordId === preferredRecordId)
        : allActivities.find(a => norm(a.storeName) === targetNorm);
      if (matched) {
        setTimeRange('all');
        if (selectedDepartment !== 'all') setSelectedDepartment('all');
        if (selectedManager) setSelectedManager(null);
      }
    }

    if (!matched) return;

    const targetId = matched.recordId;
    setActiveTab('dashboard');
    setFocusedRecord({ id: targetId, ts: Date.now() });

    setTimeout(() => {
      const el = document.getElementById(`activity-${targetId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-pulse');
        setTimeout(() => el.classList.remove('highlight-pulse'), 2500);
      }
    }, 150);
  };

  return (
    <div style={{ minHeight: '100vh', paddingBottom: '40px', background: '#f4f6f9' }}>
      <HeaderBar
        selectedDepartment={selectedDepartment}
        onDepartmentChange={setSelectedDepartment}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />

      <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '0 24px' }}>
        {/* Tab Bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '14px',
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

        {/* 時間區間（今日／本週／上週／本月／全部）與自選日期快速篩選列 */}
        <div className="mb-4 bg-white border border-gray-200 rounded-2xl p-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-3">
          {/* 左側：今日 / 本週 / 上週 / 本月 / 自選日期 / 所有紀錄 快速切換 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {([
              { id: 'day', label: '今日' },
              { id: 'week', label: '本週' },
              { id: 'last_week', label: '上週' },
              { id: 'month', label: '本月' },
              { id: 'custom', label: '📅 自選日期' },
              { id: 'all', label: '所有紀錄' },
            ] as const).map(opt => {
              const active = timeRange === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleTimeRangeChange(opt.id)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* 右側：日期選擇器（支援單日快速前後切換、本週前後週切換、或自訂起迄日期） */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                if (timeRange === 'week' || timeRange === 'last_week') {
                  const prevW = getTaipeiWeekBounds(customStartDate || getTaipeiTodayStr(), -1);
                  setCustomStartDate(prevW.start);
                  setCustomEndDate(prevW.end);
                  setTimeRange('custom');
                } else {
                  const prevDay = shiftDateStr(customStartDate || getTaipeiTodayStr(), -1);
                  setCustomStartDate(prevDay);
                  setCustomEndDate(prevDay);
                  setTimeRange('day');
                }
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer"
              title={timeRange === 'week' || timeRange === 'last_week' ? '切換至前一週' : '切換至前一天'}
            >
              ◀ {timeRange === 'week' || timeRange === 'last_week' ? '前一週' : '前一日'}
            </button>

            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1">
              <span className="text-[11px] font-bold text-gray-500">日期：</span>
              <input
                type="date"
                value={customStartDate}
                onChange={e => {
                  const val = e.target.value;
                  if (!val) return;
                  setCustomStartDate(val);
                  if (timeRange === 'day') {
                    setCustomEndDate(val);
                  } else if (timeRange === 'week') {
                    const w = getTaipeiWeekBounds(val, 0);
                    setCustomStartDate(w.start);
                    setCustomEndDate(w.end);
                  } else {
                    if (val > customEndDate) setCustomEndDate(val);
                    setTimeRange('custom');
                  }
                }}
                className="text-xs font-semibold text-gray-800 bg-transparent outline-none cursor-pointer"
              />
              {(timeRange === 'week' || timeRange === 'last_week' || timeRange === 'month' || timeRange === 'custom') && (
                <>
                  <span className="text-xs text-gray-400 font-bold">～</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={e => {
                      const val = e.target.value;
                      if (!val) return;
                      setCustomEndDate(val);
                      if (val < customStartDate) setCustomStartDate(val);
                      setTimeRange('custom');
                    }}
                    className="text-xs font-semibold text-gray-800 bg-transparent outline-none cursor-pointer"
                  />
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                if (timeRange === 'week' || timeRange === 'last_week') {
                  const nextW = getTaipeiWeekBounds(customStartDate || getTaipeiTodayStr(), 1);
                  setCustomStartDate(nextW.start);
                  setCustomEndDate(nextW.end);
                  setTimeRange('custom');
                } else {
                  const nextDay = shiftDateStr(customStartDate || getTaipeiTodayStr(), 1);
                  setCustomStartDate(nextDay);
                  setCustomEndDate(nextDay);
                  setTimeRange('day');
                }
              }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer"
              title={timeRange === 'week' || timeRange === 'last_week' ? '切換至下一週' : '切換至後一天'}
            >
              {timeRange === 'week' || timeRange === 'last_week' ? '下一週' : '後一日'} ▶
            </button>

            {customStartDate !== getTaipeiTodayStr() && timeRange === 'day' && (
              <button
                type="button"
                onClick={() => handleTimeRangeChange('day')}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 cursor-pointer"
              >
                回到今日
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            {/* 當日總部行程／會議行程／特殊行程 狀態與快速登記列 */}
            <div className="mb-5 bg-white border border-indigo-100 rounded-2xl p-4 shadow-xs flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1 rounded-full text-xs font-extrabold">
                    📅 當日行程／其他任務
                  </span>
                  <span className="text-xs text-gray-500 font-medium">
                    若有總部、會議或特殊任務，請點選右側按鈕登記，系統將自動顯示於上方與主管進度中
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {(['總部行程', '會議行程', '特殊行程'] as const).map(sType => (
                    <button
                      key={sType}
                      type="button"
                      onClick={() => {
                        setQuickScheduleType(sType);
                        if (!quickScheduleManager && uniqueManagers.length > 0) {
                          setQuickScheduleManager(user?.role === 'manager' ? user.name : uniqueManagers[0].areaManagerName);
                        }
                        setScheduleModalOpen(true);
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold border border-indigo-200 bg-indigo-50/70 text-indigo-700 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                    >
                      <span>{sType === '總部行程' ? '🏢' : sType === '會議行程' ? '📅' : '⭐'}</span>
                      <span>+ {sType}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 顯示今日已登記特殊行程之區主管清單 */}
              {filteredManagers.some(m => m.todaySchedules && m.todaySchedules.length > 0) && (
                <div className="pt-2.5 border-t border-gray-100 flex flex-wrap gap-2">
                  {filteredManagers
                    .filter(m => m.todaySchedules && m.todaySchedules.length > 0)
                    .map(m =>
                      (m.todaySchedules || []).map((sch, sIdx) => (
                        <div
                          key={`${m.areaManagerName}-${sIdx}`}
                          className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 px-3 py-1.5 rounded-xl text-xs"
                        >
                          <span className="font-extrabold text-indigo-900">
                            {sch.type === '總部行程' ? '🏢' : sch.type === '會議行程' ? '📅' : '⭐'} {m.areaManagerName}（{m.region}）
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white font-bold text-[11px]">
                            {sch.type}
                          </span>
                          <span className="text-gray-700 font-semibold">
                            {sch.note}
                          </span>
                        </div>
                      ))
                    )}
                </div>
              )}
            </div>

            {/* 當日行程快速登記彈窗 */}
            {scheduleModalOpen && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200"
                onClick={() => setScheduleModalOpen(false)}
              >
                <div
                  className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 relative"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setScheduleModalOpen(false)}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"
                  >
                    <X size={20} />
                  </button>

                  <h3 className="text-lg font-bold text-gray-900 mb-1">
                    登記當日行程／其他任務
                  </h3>
                  <p className="text-xs text-gray-500 mb-4">
                    登記後將顯示於戰情牆上方與左側區主管狀態中，避免顯示為「尚未回填」
                  </p>

                  {user?.role === 'admin' && (
                    <div className="mb-4">
                      <label className="block text-xs font-bold text-gray-700 mb-1.5">選擇區主管</label>
                      <select
                        value={quickScheduleManager}
                        onChange={e => setQuickScheduleManager(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        {uniqueManagers.map(m => (
                          <option key={m.areaManagerName} value={m.areaManagerName}>
                            {m.areaManagerName}（{m.region}）
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="mb-4">
                    <label className="block text-xs font-bold text-gray-700 mb-1.5">行程日期</label>
                    <input
                      type="date"
                      value={quickScheduleDate}
                      onChange={e => setQuickScheduleDate(e.target.value || getTaipeiTodayStr())}
                      className="w-full border border-gray-200 rounded-xl px-3.5 py-2 text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block text-xs font-bold text-gray-700 mb-1.5">行程類型</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['總部行程', '會議行程', '特殊行程'] as const).map(t => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setQuickScheduleType(t)}
                          className={`py-2.5 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                            quickScheduleType === t
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                              : 'bg-white text-gray-700 border-gray-200 hover:bg-indigo-50'
                          }`}
                        >
                          {t === '總部行程' ? '🏢 ' : t === '會議行程' ? '📅 ' : '⭐ '}
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-xs font-bold text-gray-700 mb-1.5">
                      任務說明（選填，可點選下方快速標籤）
                    </label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {['總部營運會議', '教育訓練課程', '跨區專案支援', '盤點／展店籌備', '部門主管會議'].map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setQuickScheduleNote(preset)}
                          className="text-[11px] px-2.5 py-1 rounded-full bg-gray-100 hover:bg-indigo-100 text-gray-700 hover:text-indigo-700 font-semibold transition-colors cursor-pointer"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={quickScheduleNote}
                      onChange={e => setQuickScheduleNote(e.target.value)}
                      placeholder={`例如：參加${quickScheduleType}、總部月會...`}
                      className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="mb-5">
                    <label className="block text-xs font-bold text-gray-700 mb-1.5">預計行程時數</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { mins: 120, label: '2 小時 (120分)' },
                        { mins: 240, label: '半天 (240分)' },
                        { mins: 480, label: '全天 (480分)' },
                      ].map(d => (
                        <button
                          key={d.mins}
                          type="button"
                          onClick={() => setQuickScheduleDuration(d.mins)}
                          className={`py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                            quickScheduleDuration === d.mins
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-500'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSubmittingSchedule}
                    onClick={handleQuickSubmitSchedule}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-bold rounded-xl text-sm shadow-md transition-colors cursor-pointer"
                  >
                    {isSubmittingSchedule ? '正在儲存行程...' : `✅ 確認登記「${quickScheduleType}」`}
                  </button>
                </div>
              </div>
            )}

            {/* Unresolved Issues Reminder Banner (依區域清晰劃分數量與門市) */}
            {unresolvedStores.length > 0 && (
              <div className="mb-6 bg-gradient-to-r from-red-500 via-rose-500 to-red-600 rounded-2xl p-1 shadow-lg animate-in slide-in-from-top-4 fade-in duration-500">
                <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 sm:p-5 text-white flex flex-col gap-4">
                  {/* 頂部標題與統計列 */}
                  <div className="flex items-start sm:items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="bg-white/20 p-2 rounded-xl shrink-0 shadow-sm">
                        <AlertTriangle size={22} className="text-white animate-pulse" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-extrabold text-lg tracking-wide text-white">未結案提醒</h3>
                          <span className="bg-white text-rose-700 px-2.5 py-0.5 rounded-full text-xs font-black shadow-sm">
                            共 {unresolvedStores.length} 間門市待追蹤
                          </span>
                          <span className="bg-black/20 text-white/95 px-2.5 py-0.5 rounded-full text-xs font-semibold border border-white/20">
                            涵蓋 {groupedUnresolvedStores.length} 個區域
                          </span>
                        </div>
                        <p className="text-red-50 text-xs sm:text-sm font-medium opacity-90 mt-0.5">
                          以下門市巡檢發現缺失且尚未完成 PDCA 結案，已依區域劃分如下，請點選門市進行複查或結案：
                        </p>
                      </div>
                    </div>

                    {/* 區域數量快速摘要膠囊列 */}
                    <div className="flex items-center flex-wrap gap-1.5">
                      {groupedUnresolvedStores.map(g => (
                        <span
                          key={g.region}
                          className="text-xs bg-black/25 text-white px-2.5 py-1 rounded-lg border border-white/25 font-bold flex items-center gap-1 shadow-sm"
                        >
                          <span className="text-amber-300">●</span> {g.region}：{g.stores.length} 店
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* 依區域分組卡片 (清楚劃分各區、數量、負責主管與待處理門市) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 mt-1">
                    {groupedUnresolvedStores.map(group => (
                      <div
                        key={group.region}
                        className="bg-white/15 hover:bg-white/20 border border-white/25 rounded-xl p-3.5 flex flex-col justify-between gap-3 transition-all shadow-sm"
                      >
                        {/* 區域標題與負責主管 */}
                        <div className="flex items-center justify-between pb-2 border-b border-white/20">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-300 shadow-sm" />
                            <span className="font-extrabold text-sm sm:text-base text-white tracking-wide">
                              {group.region}
                            </span>
                            {group.areaManagerName && (
                              <span className="text-xs bg-white/25 text-white px-2 py-0.5 rounded-md font-semibold">
                                主管：{group.areaManagerName}
                              </span>
                            )}
                          </div>
                          <span className="text-xs bg-red-600/80 text-white px-2 py-0.5 rounded-full font-bold border border-red-300/40">
                            {group.stores.length} 間待結案
                          </span>
                        </div>

                        {/* 該區域待結案門市按鈕 */}
                        <div className="flex flex-wrap gap-2">
                          {group.stores.map(s => (
                            <button
                              key={s.store}
                              type="button"
                              onClick={() => setResolvingStore(s)}
                              className="w-full sm:w-auto bg-white hover:bg-rose-50 text-rose-700 active:scale-95 transition-all px-3 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-md flex items-center justify-between sm:justify-start gap-2 cursor-pointer border border-white/90 hover:shadow-lg"
                            >
                              <span className="flex items-center gap-1">
                                <span className="text-rose-500">📍</span>
                                <span>{s.store}</span>
                              </span>
                              <span className="text-[11px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-black">
                                點選處理 ➔
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 未結案門市追蹤與結案彈窗 */}
            {resolvingStore && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200"
                onClick={() => setResolvingStore(null)}
              >
                <div
                  className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 relative"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setResolvingStore(null)}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"
                  >
                    <X size={20} />
                  </button>
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                      <AlertTriangle size={20} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-bold text-gray-900">{resolvingStore.store}</h3>
                        {resolvingStore.region && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                            {resolvingStore.region}
                          </span>
                        )}
                        {resolvingStore.areaManagerName && (
                          <span className="text-xs font-semibold text-gray-500">
                            (主管：{resolvingStore.areaManagerName})
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        未結案缺失追蹤 {resolvingStore.reportTime ? `· 回報時間：${resolvingStore.reportTime}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3.5 mb-5 max-h-48 overflow-y-auto">
                    <div className="text-xs font-bold text-rose-800 mb-2">待改善 / 異常原因：</div>
                    <ul className="space-y-1.5">
                      {resolvingStore.reasons.map((r, i) => (
                        <li key={i} className="text-sm text-rose-900 font-medium flex items-start gap-2">
                          <span className="text-rose-500 mt-0.5">•</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <button
                      type="button"
                      onClick={() => navigate(`/audit?store=${encodeURIComponent(resolvingStore.store)}`)}
                      className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 transition-colors cursor-pointer"
                    >
                      <ClipboardSignature size={17} />
                      前往巡店複查 / 拍照存證
                    </button>

                    <button
                      type="button"
                      disabled={isSubmittingResolve}
                      onClick={() => handleResolveStorePdca(resolvingStore.store)}
                      className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20 transition-colors cursor-pointer"
                    >
                      <CheckCircle2 size={17} />
                      {isSubmittingResolve ? '正在結案處理中...' : '確認現場已改善（直接結案）'}
                    </button>

                    {resolvingStore.recordId && (
                      <button
                        type="button"
                        onClick={() => {
                          const targetStore = resolvingStore.store;
                          const targetId = resolvingStore.recordId;
                          setResolvingStore(null);
                          handleJumpToStore(targetStore, targetId);
                        }}
                        className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Search size={14} />
                        定位查看下方原始巡店紀錄
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'dashboard' ? (
              <>
                {(() => {
                  const fmtShort = (d: string) => d ? d.slice(5).replace('-', '/') : '';
                  const todayStr = getTaipeiTodayStr();
                  let timeRangeText = '全部';
                  if (timeRange === 'day') {
                    timeRangeText = customStartDate === todayStr ? '今日' : `${fmtShort(customStartDate)}`;
                  } else if (timeRange === 'week') {
                    timeRangeText = `本週 ${fmtShort(customStartDate)}~${fmtShort(customEndDate)}`;
                  } else if (timeRange === 'last_week') {
                    timeRangeText = `上週 ${fmtShort(customStartDate)}~${fmtShort(customEndDate)}`;
                  } else if (timeRange === 'month') {
                    timeRangeText = '本月';
                  } else if (timeRange === 'custom') {
                    timeRangeText = customStartDate === customEndDate
                      ? `${fmtShort(customStartDate)}`
                      : `${fmtShort(customStartDate)}~${fmtShort(customEndDate)}`;
                  }
                  const fullRegionLabel = `${selectedDepartment === 'all' ? '全區' : selectedDepartment} (${timeRangeText})`;
                  return <SummaryCards summary={dynamicSummary} regionLabel={fullRegionLabel} periodLabel={timeRangeText} onStoreSelect={handleJumpToStore} />;
                })()}

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
                  <CoverageRadarChart data={radarData} />
                  <RiskDistributionChart data={riskData} onStoreSelect={handleJumpToStore} />
                  <IssuePieChart data={pieData} onStoreSelect={handleJumpToStore} />
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
                    onStoreSelect={handleJumpToStore}
                    timeRangeLabel={
                      timeRange === 'day'
                        ? (customStartDate === getTaipeiTodayStr() ? '今日' : customStartDate.slice(5).replace('-', '/'))
                        : timeRange === 'week'
                        ? '本週'
                        : timeRange === 'last_week'
                        ? '上週'
                        : timeRange === 'month'
                        ? '本月'
                        : timeRange === 'custom'
                        ? (customStartDate === customEndDate
                            ? customStartDate.slice(5).replace('-', '/')
                            : `${customStartDate.slice(5).replace('-', '/')}~${customEndDate.slice(5).replace('-', '/')}`)
                        : '累計'
                    }
                  />
                  <main style={{ flex: 1, width: '100%', minWidth: 0 }}>
                    <TopIssuesList
                      issues={topIssues}
                      onStoreClick={(recordId, storeName) => {
                        handleJumpToStore(storeName, recordId);
                      }}
                    />
                    <div style={{ marginTop: '24px' }}>
                      <ActivityWall activities={targetActivities} actionItems={actionItems} focusedRecord={focusedRecord} />
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
