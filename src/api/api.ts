import type { Manager, VisitRecord } from '../types';

// ==========================================
// API 網址設定：Vercel 生產環境自動使用同網域的 /api，本機開發使用 localhost:8000
// ==========================================
const API_BASE_URL = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';

// (MOCK_SUMMARY removed)
// (MOCK_ACTIVITIES removed)
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


export const getActivityWall = async (timeRange: string = 'day', region: string): Promise<VisitRecord[]> => {
  const data = await fetchJSON(`/activities?time_range=${timeRange}&region=${region}`);
  if (data) {
    return data;
  }
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


