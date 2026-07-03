import type { DashboardSummary, Manager, VisitRecord } from '../types';

// ==========================================
// API 網址設定：Vercel 生產環境自動使用同網域的 /api，本機開發使用 localhost:8000
// ==========================================
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:8000/api');

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

// (MOCK_MANAGERS removed for production)

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
  if (data) return data;
  return [];
};

export const getManagers = async (): Promise<Manager[]> => {
  const data = await fetchJSON(`/managers`);
  if (data && data.length > 0) return data;
  return [];
};

export const importManagers = async (managers: Manager[]): Promise<boolean> => {
  const data = await fetchJSON(`/managers/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(managers)
  });
  return !!(data && data.success);
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
