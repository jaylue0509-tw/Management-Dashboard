import type { Manager } from '../types';

// ==========================================
// API 網址設定：Vercel 生產環境自動使用同網域的 /api，本機開發指向遠端 API
// ==========================================
export const API_BASE_URL = import.meta.env.PROD
  ? '/api'
  : 'https://management-dashboard-rust.vercel.app/api';

/**
 * 產生包含 Bearer Token 的認證 Header
 */
export const getAuthHeaders = (extra?: Record<string, string>): Record<string, string> => {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = { ...(extra || {}) };
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

const fetchJSON = async (endpoint: string, options?: RequestInit) => {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: getAuthHeaders((options?.headers as Record<string, string>) || {}),
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`Fetch failed for ${endpoint}:`, error);
    return null;
  }
};

/**
 * 匯入組織架構與門市名單（限管理員權限）
 */
export const importManagers = async (managers: Manager[]): Promise<boolean> => {
  const data = await fetchJSON(`/managers/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(managers),
  });
  return Boolean(data && data.success);
};

/**
 * 取得儀表板完整資料（動態牆、組織主檔、待辦事項、統計摘要）
 */
export const getDashboardData = async (timeRange: string = 'day', region: string = 'all'): Promise<any> => {
  return await fetchJSON(`/dashboard-data?time_range=${timeRange}&region=${region}`);
};
