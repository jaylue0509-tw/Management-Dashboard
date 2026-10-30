import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

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
          const apiBase = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';
          const res = await fetch(`${apiBase}/auth/me`, {
            headers: { Authorization: `Bearer ${storedToken}` }
          });
          if (res.ok) {
            const latestUser = await res.json();
            if (latestUser && latestUser.sub) {
              setUser(latestUser);
              localStorage.setItem('user', JSON.stringify(latestUser));
            }
          }
        } catch (err) {
          // 網路離線時保留本機快取使用者狀態
        }
      };

      syncLatestUser();
    }
  }, []);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
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
