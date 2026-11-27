import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../api/api';
import { Sparkles, ArrowRight, Building2, UserCircle, ShieldCheck, Eye, EyeOff } from 'lucide-react';

const LOGIN_TIMEOUT_MS = 20_000;
const COLD_START_HINT_DELAY_MS = 3_000;

/**
 * 帶逾時控制與單次冷啟動自動重試的登入請求。
 * 對應 Neon 休眠喚醒或 Serverless 冷啟動瞬間可能發生的 502/503/504 或連線中斷。
 */
const postLoginWithRetry = async (
  username: string,
  password: string
): Promise<Response> => {
  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
    try {
      return await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timer);
    }
  };

  try {
    const res = await attempt();
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      return await attempt();
    }
    return res;
  } catch (err) {
    // 若非使用者取消而是短暫網路抖動 / 首次冷啟動逾時，自動補重試一次
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    return await attempt().catch(() => {
      throw err;
    });
  }
};

export const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHint, setLoadingHint] = useState('安全驗證中...');
  const [selectedRole, setSelectedRole] = useState<'admin' | 'manager' | 'beauty_director'>('manager');
  const { login, user, token } = useAuth();
  const navigate = useNavigate();
  const preloadedDashboardRef = useRef(false);

  // 若已具備有效登入憑證，直接導向主儀表板，避免重整或返回時停留在登入頁
  useEffect(() => {
    if (token && user) {
      navigate(user.role === 'beauty_director' ? '/dashboard?view=beauty' : '/dashboard', { replace: true });
    }
  }, [token, user, navigate]);

  // 進入登入頁後於背景預載 DashboardPage 分包，登入成功切換路由時可秒開、避免載入空窗閃白
  useEffect(() => {
    if (preloadedDashboardRef.current) return;
    preloadedDashboardRef.current = true;
    const timer = window.setTimeout(() => {
      void import('./DashboardPage').catch(() => {
        // 預載失敗不影響登入，實際切頁時由 lazyWithRetry 接手處理
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      setError('請輸入帳號與密碼');
      return;
    }

    setError('');
    setLoading(true);
    setLoadingHint('安全驗證中...');

    const coldStartTimer = window.setTimeout(() => {
      setLoadingHint('正在喚醒系統資料庫，請稍候...');
    }, COLD_START_HINT_DELAY_MS);

    try {
      const res = await postLoginWithRetry(trimmedUsername, password);

      if (!res.ok) {
        if (res.status === 401) throw new Error('帳號或密碼錯誤，請重新檢查');
        if (res.status >= 500) throw new Error('登入服務暫時無法使用，請稍後再試');
        throw new Error('登入失敗，請重新整理頁面後再試');
      }

      const data = await res.json();
      if (!data?.token || !data?.user?.sub) {
        throw new Error('登入回應格式異常，請重新整理後再試');
      }

      login(data.token, data.user);
      navigate(data.user.role === 'beauty_director' ? '/dashboard?view=beauty' : '/dashboard', {
        replace: true,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('連線逾時，系統可能正在喚醒資料庫，請再點一次登入');
      } else if (err instanceof Error) {
        setError(err.message || '系統連線異常，請稍後再試');
      } else {
        setError('系統連線異常，請稍後再試');
      }
    } finally {
      window.clearTimeout(coldStartTimer);
      setLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[#FAFAFA] text-slate-900 selection:bg-indigo-500/20"
      style={{ fontFamily: "'Noto Sans TC', 'Inter', sans-serif" }}
    >
      {/* Soft Animated Background Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-br from-indigo-200/40 to-purple-200/40 blur-[100px] animate-[spin_60s_linear_infinite] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-gradient-to-tl from-sky-200/40 to-emerald-100/40 blur-[90px] animate-[spin_40s_linear_infinite_reverse] pointer-events-none" />

      {/* Main Glassmorphism Card */}
      <div className="w-full max-w-md relative z-10">
        <div className="bg-white/85 backdrop-blur-2xl rounded-[2.5rem] border border-white/60 p-8 sm:p-10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.06)]">
          
          {/* Header Section */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mb-6 shadow-[0_10px_25px_-5px_rgba(99,102,241,0.4)] relative overflow-hidden">
              <div className="absolute inset-0 bg-white/20 rounded-2xl mix-blend-overlay"></div>
              <Sparkles size={28} className="text-white relative z-10" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight mb-2 text-slate-900">東寵營運系統</h1>
            <p className="text-slate-500 text-sm font-medium">智能管理與巡查平台</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm font-medium mb-6 flex items-center gap-3 shadow-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            
            {/* Role Selection */}
            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">
                選擇登入身分
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button 
                  type="button"
                  onClick={() => setSelectedRole('admin')}
                  className={`relative overflow-hidden py-3 px-2 rounded-2xl border-2 flex flex-col items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer
                    ${selectedRole === 'admin' 
                      ? 'border-indigo-500 bg-indigo-50/50 text-indigo-700 shadow-sm' 
                      : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200 hover:bg-slate-50'}`}
                >
                  <Building2 size={18} className={selectedRole === 'admin' ? 'text-indigo-600' : 'text-slate-400'} />
                  <span className="text-xs font-bold">總部管理員</span>
                </button>
                
                <button 
                  type="button"
                  onClick={() => setSelectedRole('manager')}
                  className={`relative overflow-hidden py-3 px-2 rounded-2xl border-2 flex flex-col items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer
                    ${selectedRole === 'manager' 
                      ? 'border-purple-500 bg-purple-50/50 text-purple-700 shadow-sm' 
                      : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200 hover:bg-slate-50'}`}
                >
                  <UserCircle size={18} className={selectedRole === 'manager' ? 'text-purple-600' : 'text-slate-400'} />
                  <span className="text-xs font-bold">區主管</span>
                </button>

                <button 
                  type="button"
                  onClick={() => setSelectedRole('beauty_director')}
                  className={`relative overflow-hidden py-3 px-2 rounded-2xl border-2 flex flex-col items-center justify-center gap-1.5 transition-all duration-300 cursor-pointer
                    ${selectedRole === 'beauty_director' 
                      ? 'border-rose-500 bg-rose-50/70 text-rose-700 shadow-sm' 
                      : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200 hover:bg-slate-50'}`}
                >
                  <Sparkles size={18} className={selectedRole === 'beauty_director' ? 'text-rose-600' : 'text-slate-400'} />
                  <span className="text-xs font-bold">美容總監</span>
                </button>
              </div>
            </div>

            {/* Inputs */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="login-username" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">
                  使用者帳號
                </label>
                <div className="relative group">
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-5 py-3.5 bg-slate-50/80 border border-slate-200 rounded-2xl outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-slate-900 placeholder-slate-400 font-medium transition-all text-[15px] shadow-sm"
                    placeholder={selectedRole === 'admin' ? "請輸入總部帳號" : "請輸入真實姓名"}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <label htmlFor="login-password" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">
                  密碼
                </label>
                <div className="relative group">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-5 pr-12 py-3.5 bg-slate-50/80 border border-slate-200 rounded-2xl outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-slate-900 placeholder-slate-400 font-medium transition-all text-[15px] shadow-sm"
                    placeholder="請輸入密碼"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className={`w-full py-4 rounded-2xl font-bold text-[15px] tracking-wide transition-all duration-300 flex items-center justify-center gap-2 overflow-hidden relative group
                  ${loading 
                    ? 'bg-slate-200 text-slate-600 cursor-not-allowed' 
                    : 'bg-slate-900 text-white hover:bg-slate-800 hover:scale-[0.98] shadow-[0_10px_20px_-10px_rgba(15,23,42,0.5)] cursor-pointer'}`}
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-slate-400/30 border-t-slate-600 rounded-full animate-spin" />
                    <span>{loadingHint}</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={18} className="text-white/80" />
                    <span>安全登入</span>
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform opacity-90" />
                  </>
                )}
              </button>
            </div>
          </form>

        </div>
        
        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-slate-400 text-xs font-medium">
            © {new Date().getFullYear()} 東寵智能營運團隊. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
};
