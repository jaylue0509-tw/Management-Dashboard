import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Sparkles, ArrowRight, Building2, UserCircle, ShieldCheck, Eye, EyeOff } from 'lucide-react';

const LAST_USERNAME_KEY = 'last_login_username';

export const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'admin' | 'manager'>('manager');
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const savedUsername = localStorage.getItem(LAST_USERNAME_KEY);
    if (savedUsername) {
      setUsername(savedUsername);
      if (savedUsername === 'admin') {
        setSelectedRole('admin');
      }
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const apiBase = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';
      const trimmedUsername = username.trim();
      const res = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmedUsername, password })
      });

      if (!res.ok) {
        throw new Error('帳號或密碼錯誤，請重新檢查');
      }

      const data = await res.json();
      localStorage.setItem(LAST_USERNAME_KEY, trimmedUsername);
      login(data.token, data.user);

      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || '系統連線異常，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[#FAFAFA] text-slate-900 selection:bg-indigo-500/20"
      style={{ fontFamily: "'Noto Sans TC', 'Inter', sans-serif" }}
    >
      {/* Soft Animated Background Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-br from-indigo-200/40 to-purple-200/40 blur-[100px] animate-[spin_60s_linear_infinite]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] rounded-full bg-gradient-to-tl from-sky-200/40 to-emerald-100/40 blur-[90px] animate-[spin_40s_linear_infinite_reverse]" />

      {/* Main Glassmorphism Card */}
      <div className="w-full max-w-md relative z-10 animate-in fade-in zoom-in-95 duration-700">
        <div className="bg-white/80 backdrop-blur-3xl rounded-[2.5rem] border border-white/60 p-8 sm:p-10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.06)]">

          {/* Header Section */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mb-5 shadow-[0_10px_25px_-5px_rgba(99,102,241,0.4)] relative overflow-hidden">
              <div className="absolute inset-0 bg-white/20 rounded-2xl mix-blend-overlay"></div>
              <Sparkles size={28} className="text-white relative z-10" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight mb-1.5 text-slate-900">東寵營運系統</h1>
            <p className="text-slate-500 text-sm font-medium">智能管理與巡查平台</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm font-medium mb-6 flex items-center gap-3 animate-in slide-in-from-top-2 shadow-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">

            {/* Role Selection */}
            <div className="space-y-2.5">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">
                選擇登入身分
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRole('admin');
                    if (!username || username !== 'admin') setUsername('admin');
                  }}
                  className={`relative overflow-hidden py-3 px-4 rounded-2xl border-2 flex items-center justify-center gap-3 transition-all duration-300
                    ${selectedRole === 'admin'
                      ? 'border-indigo-500 bg-indigo-50/50 text-indigo-700 shadow-xs'
                      : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200 hover:bg-slate-50'}`}
                >
                  <Building2 size={18} className={selectedRole === 'admin' ? 'text-indigo-600' : 'text-slate-400'} />
                  <span className="text-sm font-bold">總部管理員</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedRole('manager');
                    if (username === 'admin') setUsername('');
                  }}
                  className={`relative overflow-hidden py-3 px-4 rounded-2xl border-2 flex items-center justify-center gap-3 transition-all duration-300
                    ${selectedRole === 'manager'
                      ? 'border-purple-500 bg-purple-50/50 text-purple-700 shadow-xs'
                      : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200 hover:bg-slate-50'}`}
                >
                  <UserCircle size={18} className={selectedRole === 'manager' ? 'text-purple-600' : 'text-slate-400'} />
                  <span className="text-sm font-bold">區主管</span>
                </button>
              </div>
            </div>

            {/* Inputs */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">
                  使用者帳號
                </label>
                <div className="relative group">
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-5 py-3.5 bg-slate-50/50 border border-slate-200 rounded-2xl outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-slate-900 placeholder-slate-400 font-medium transition-all text-[15px] shadow-xs"
                    placeholder={selectedRole === 'admin' ? '請輸入總部帳號 (admin)' : '請輸入區主管真實姓名'}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider ml-1">
                  密碼
                </label>
                <div className="relative group">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-5 pr-12 py-3.5 bg-slate-50/50 border border-slate-200 rounded-2xl outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-slate-900 placeholder-slate-400 font-medium transition-all text-[15px] shadow-xs"
                    placeholder="請輸入密碼"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    title={showPassword ? '隱藏密碼' : '顯示密碼'}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className={`w-full py-4 rounded-2xl font-bold text-[15px] tracking-wide transition-all duration-300 flex items-center justify-center gap-2 overflow-hidden relative group
                  ${loading
                    ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-900 text-white hover:bg-slate-800 hover:scale-[0.99] shadow-[0_10px_20px_-10px_rgba(15,23,42,0.5)]'}`}
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-slate-400/30 border-t-slate-500 rounded-full animate-spin" />
                    <span>安全驗證中...</span>
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
