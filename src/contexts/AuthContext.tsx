import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { API_BASE_URL } from '../api/api';
import { clearCustomHubPointsCache } from '../utils/address-geocoder';

/** 切換帳號或登出時必須一併清除的帳號專屬本機快取鍵，避免共用裝置資料殘留 */
const ACCOUNT_SCOPED_STORAGE_KEYS = [
  'petty_cash_google_evidence_v2',
  'petty_cash_custom_rows_v1',
];

const clearAccountScopedCaches = (): void => {
  clearCustomHubPointsCache();
  try {
    for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // 忽略私密瀏覽等儲存異常
  }
};

export interface User {
  sub: string; // username
  role: 'admin' | 'manager';
  name: string;
  assigned_stores: string[];
  must_change_password?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (updated: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // 嘗試從 localStorage 恢復登入狀態，並向後端同步最新負責門市與權限設定
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    
    if (storedToken && storedUser) {
      setToken(storedToken);
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        console.error('Failed to parse stored user', e);
      }

      const syncLatestUser = async () => {
        try {
          const res = await fetch(`${API_BASE_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${storedToken}` }
          });
          if (res.status === 401) {
            // Token 已失效或過期時，清除登入狀態與本機快取
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            clearAccountScopedCaches();
            setToken(null);
            setUser(null);
            return;
          }
          if (res.ok) {
            const latestUser = await res.json();
            if (latestUser && latestUser.sub) {
              setUser(latestUser);
              localStorage.setItem('user', JSON.stringify(latestUser));
            }
          }
        } catch {
          // 網路離線時保留本機快取使用者狀態
        }
      };

      syncLatestUser();
    }
  }, []);

  const login = (newToken: string, newUser: User) => {
    clearAccountScopedCaches();
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    clearAccountScopedCaches();
    setToken(null);
    setUser(null);
  };

  const updateUser = (updated: Partial<User>) => {
    setUser(prev => {
      if (!prev) return null;
      const next = { ...prev, ...updated };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
