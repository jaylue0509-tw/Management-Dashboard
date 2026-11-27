import { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { API_BASE_URL } from '../api/api';
import { clearCustomHubPointsCache } from '../utils/address-geocoder';

/** 切換帳號或登出時必須一併清除的帳號專屬本機快取鍵，避免共用裝置資料殘留 */
const ACCOUNT_SCOPED_STORAGE_KEYS = [
  'petty_cash_google_evidence_v2',
  'petty_cash_custom_rows_v1',
  'audit_app_draft',
  'audit_app_multidrafts_v1',
  'beauty_director_audit_draft_v1',
];

const VALID_ROLES = new Set(['admin', 'manager', 'beauty_director']);

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
  role: 'admin' | 'manager' | 'beauty_director';
  name: string;
  nickname?: string;
  department?: string;
  supervisor?: string;
  assigned_stores: string[];
  must_change_password?: boolean;
}

const isValidStoredUser = (value: unknown): value is User => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sub === 'string' &&
    candidate.sub.trim().length > 0 &&
    typeof candidate.name === 'string' &&
    typeof candidate.role === 'string' &&
    VALID_ROLES.has(candidate.role)
  );
};

/**
 * 同步讀取 localStorage 內的登入憑證，避免首屏 render 時 token/user 短暫為 null
 * 而被 ProtectedRoute 誤踢回 /login 或造成畫面閃白。
 */
const readInitialAuthState = (): { token: string | null; user: User | null } => {
  try {
    const storedToken = localStorage.getItem('token');
    const storedUserRaw = localStorage.getItem('user');
    if (!storedToken || !storedUserRaw) {
      return { token: null, user: null };
    }
    const parsed = JSON.parse(storedUserRaw);
    if (!isValidStoredUser(parsed)) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      return { token: null, user: null };
    }
    return {
      token: storedToken,
      user: {
        ...parsed,
        assigned_stores: Array.isArray(parsed.assigned_stores) ? parsed.assigned_stores : [],
      },
    };
  } catch {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch {
      // 忽略私密瀏覽限制
    }
    return { token: null, user: null };
  }
};

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (updated: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const initialAuthRef = useRef<{ token: string | null; user: User | null } | null>(null);
  if (initialAuthRef.current === null) {
    initialAuthRef.current = readInitialAuthState();
  }

  const [user, setUser] = useState<User | null>(initialAuthRef.current.user);
  const [token, setToken] = useState<string | null>(initialAuthRef.current.token);

  useEffect(() => {
    // 僅在從既有 localStorage 恢復登入時向後端同步最新權限設定，剛手動登入則不重複打 /auth/me
    const storedToken = initialAuthRef.current?.token;
    if (!storedToken) return;

    const controller = new AbortController();
    const syncLatestUser = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
          signal: controller.signal,
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
          if (isValidStoredUser(latestUser)) {
            const normalizedUser: User = {
              ...latestUser,
              assigned_stores: Array.isArray(latestUser.assigned_stores) ? latestUser.assigned_stores : [],
            };
            setUser(normalizedUser);
            localStorage.setItem('user', JSON.stringify(normalizedUser));
          }
        }
      } catch {
        // 網路離線或元件卸載中止時保留本機快取使用者狀態
      }
    };

    syncLatestUser();
    return () => controller.abort();
  }, []);

  const login = (newToken: string, newUser: User) => {
    const normalizedUser: User = {
      ...newUser,
      assigned_stores: Array.isArray(newUser.assigned_stores) ? newUser.assigned_stores : [],
    };
    clearAccountScopedCaches();
    try {
      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(normalizedUser));
    } catch {
      // 忽略私密瀏覽儲存異常，仍維持記憶體內登入態
    }
    setToken(newToken);
    setUser(normalizedUser);
  };

  const logout = () => {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch {
      // 忽略私密瀏覽儲存異常
    }
    clearAccountScopedCaches();
    setToken(null);
    setUser(null);
  };

  const updateUser = (updated: Partial<User>) => {
    setUser(prev => {
      if (!prev) return null;
      const next = { ...prev, ...updated };
      try {
        localStorage.setItem('user', JSON.stringify(next));
      } catch {
        // 忽略私密瀏覽儲存異常
      }
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
