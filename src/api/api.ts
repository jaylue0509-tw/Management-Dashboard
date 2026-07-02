import type { DashboardSummary, Manager, VisitRecord } from '../types';

// ==========================================
// API 網址設定：使用環境變數中的 Python FastAPI 網址
// ==========================================
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

// ==========================================
// Mock Data (假資料，作為無資料庫或網路錯誤時的 Fallback)
// ==========================================
const MOCK_SUMMARY: DashboardSummary = {
  totalVisits: 15,
  completedManagersCount: 8,
  pendingManagersCount: 4,
  visitedStoresCount: 12,
  abnormalIssuesCount: 2,
  improvementIssuesCount: 5,
  totalExpectedStayMinutes: 720,
  highlightCount: 3
};

const MOCK_ACTIVITIES: VisitRecord[] = [
  {
    recordId: 'uuid-1',
    areaManagerName: '王小明',
    jobTitle: '區主管',
    actionType: '指導',
    storeName: '台北站前店',
    region: '北一區',
    timeAgoMinutes: 10,
    expectedStayMinutes: 60,
    tags: ['排面陳列', '檔期輔銷物'],
    immediateImprovement: '協助門市將排面商品依先進先出原則重新整理，並填補大位區排面空洞。',
    highlightDescription: '指導新進同仁正確張貼本期海報於店外指定位置。',
    abnormalFlag: false
  },
  {
    recordId: 'uuid-2',
    areaManagerName: '林美玲',
    jobTitle: '區經理',
    actionType: '發現異常',
    storeName: '台中逢甲店',
    region: '中區',
    timeAgoMinutes: 45,
    expectedStayMinutes: 45,
    tags: ['店務檢視', '顧客服務'],
    immediateImprovement: '已請店長立即將走道堆放紙箱移除。',
    abnormalFlag: true
  }
];

const MOCK_MANAGERS: Manager[] = [
  {
    department: '營業一處',
    directorName: 'C0066 簡楷潔',
    region: '北桃區',
    areaManagerName: 'F0116 陳岳翔',
    deputyManagerName: '',
    storeName: '士林文林店',
    beautyLeader: '',
    todayVisitCount: 2,
    assignedStoreCount: 8,
    hasAbnormal: false,
    visitStatus: '巡店中'
  },
  {
    department: '營業一處',
    directorName: 'C0066 簡楷潔',
    region: '北桃區',
    areaManagerName: 'F0116 陳岳翔',
    deputyManagerName: '',
    storeName: '北投中和店',
    beautyLeader: '',
    todayVisitCount: 0,
    assignedStoreCount: 8,
    hasAbnormal: false,
    visitStatus: '尚未回填'
  },
  {
    department: '營業一處',
    directorName: 'C0066 簡楷潔',
    region: '新北區',
    areaManagerName: 'F0010 曾志偉',
    deputyManagerName: '',
    storeName: '新莊中正店',
    beautyLeader: '無',
    todayVisitCount: 1,
    assignedStoreCount: 6,
    hasAbnormal: true,
    visitStatus: '已完成'
  }
];

// ==========================================
// RESTful 呼叫核心 Helper
// ==========================================
const fetchJSON = async (endpoint: string, options?: RequestInit) => {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`Fetch failed for ${endpoint}:`, error);
    return null;
  }
};

// ==========================================
// 匯出 API 函數
// ==========================================
export const getDashboardSummary = async (date: string): Promise<DashboardSummary> => {
  const data = await fetchJSON(`/summary?date=${date}`);
  if (data) return data;
  
  // Fallback
  return new Promise((resolve) => setTimeout(() => resolve(MOCK_SUMMARY), 500));
};

export const getActivityWall = async (date: string, region: string): Promise<VisitRecord[]> => {
  const data = await fetchJSON(`/activities?date=${date}&region=${region}`);
  // 如果成功打通 API，但 MongoDB 剛建置沒有資料，會收到空陣列。
  // 為了方便看畫面排版，這裡暫時將空陣列也 fallback 回 mock data。
  if (data && data.length > 0) return data;

  // Fallback
  return new Promise((resolve) => {
    setTimeout(() => {
      if (region === 'all') resolve(MOCK_ACTIVITIES);
      else resolve(MOCK_ACTIVITIES.filter(a => a.region === region));
    }, 500);
  });
};

export const getManagers = async (): Promise<Manager[]> => {
  const data = await fetchJSON(`/managers`);
  if (data && data.length > 0) return data;

  // Fallback
  return new Promise((resolve) => setTimeout(() => resolve(MOCK_MANAGERS), 500));
};

export const createVisitRecord = async (payload: any): Promise<{ recordId: string }> => {
  const data = await fetchJSON(`/visit-records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (data && data.success) return data.data;

  // Fallback
  return new Promise((resolve) => setTimeout(() => resolve({ recordId: 'new-uuid-' + Date.now() }), 800));
};
