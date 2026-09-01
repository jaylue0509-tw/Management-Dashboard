import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Sparkles, ArrowRight, Building2, UserCircle } from 'lucide-react';

export const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'admin' | 'manager'>('manager');
  const { login } = useAuth();
  const navigate = useNavigate();

  // Add a premium font to the document if not present
  useEffect(() => {
    if (!document.getElementById('premium-font')) {
      const link = document.createElement('link');
      link.id = 'premium-font';
      link.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('https://management-dashboard-rust.vercel.app/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        throw new Error('帳號或密碼錯誤，請重新檢查');
      }

      const data = await res.json();
      login(data.token, data.user);
      
      if (data.user.role === 'admin') {
        navigate('/dashboard');
      } else {
        navigate('/audit');
      }
    } catch (err: any) {
      setError(err.message || '系統連線異常，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[#F4F7FE]"
      style={{ fontFamily: "'Noto Sans TC', sans-serif" }}
    >
      {/* Premium Background Orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] rounded-full bg-gradient-to-br from-indigo-300/30 to-purple-300/30 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-gradient-to-tl from-blue-300/30 to-teal-200/30 blur-[100px] pointer-events-none" />

      {/* Main Card */}
      <div className="bg-white/80 backdrop-blur-2xl rounded-[40px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] border border-white w-full max-w-[500px] p-10 sm:p-12 relative z-10 transition-all duration-500 hover:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)]">
        
        {/* Logo & Title Section */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-20 h-20 bg-gradient-to-br from-[#6366F1] via-[#8B5CF6] to-[#D946EF] rounded-3xl flex items-center justify-center mb-6 shadow-[0_10px_25px_-5px_rgba(139,92,246,0.5)] transform transition-transform hover:scale-105 duration-300">
            <Sparkles size={36} className="text-white drop-shadow-md" fill="currentColor" />
          </div>
          <h1 className="text-[32px] font-black text-[#1E293B] tracking-tight mb-2">東寵營運系統</h1>
          <p className="text-[#64748B] font-medium text-[15px]">請選擇您的身分並登入系統</p>
        </div>

        {error && (
          <div className="bg-red-50/80 backdrop-blur-sm text-red-600 px-5 py-3.5 rounded-2xl text-[15px] font-bold mb-8 text-center border border-red-100 flex items-center justify-center gap-2 animate-in fade-in slide-in-from-top-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-7">
          
          {/* Role Selection Cards */}
          <div>
            <p className="text-[14px] font-bold text-[#334155] mb-3 ml-1">登入身分</p>
            <div className="grid grid-cols-2 gap-4">
              <button 
                type="button"
                onClick={() => setSelectedRole('admin')}
                className={`py-5 px-4 rounded-[24px] border-2 flex flex-col items-center gap-3 transition-all duration-300 group
                  ${selectedRole === 'admin' 
                    ? 'border-[#6366F1] bg-[#EEF2FF] shadow-[0_8px_20px_-6px_rgba(99,102,241,0.2)]' 
                    : 'border-[#F1F5F9] bg-white hover:border-[#E2E8F0] hover:bg-[#F8FAFC]'}`}
              >
                <div className={`p-3 rounded-2xl transition-colors ${selectedRole === 'admin' ? 'bg-[#6366F1] text-white shadow-md' : 'bg-[#F1F5F9] text-[#64748B] group-hover:bg-[#E2E8F0]'}`}>
                  <Building2 size={24} />
                </div>
                <span className={`text-[15px] font-bold ${selectedRole === 'admin' ? 'text-[#4338CA]' : 'text-[#64748B]'}`}>總部管理員</span>
              </button>
              
              <button 
                type="button"
                onClick={() => setSelectedRole('manager')}
                className={`py-5 px-4 rounded-[24px] border-2 flex flex-col items-center gap-3 transition-all duration-300 group
                  ${selectedRole === 'manager' 
                    ? 'border-[#6366F1] bg-[#EEF2FF] shadow-[0_8px_20px_-6px_rgba(99,102,241,0.2)]' 
                    : 'border-[#F1F5F9] bg-white hover:border-[#E2E8F0] hover:bg-[#F8FAFC]'}`}
              >
                <div className={`p-3 rounded-2xl transition-colors ${selectedRole === 'manager' ? 'bg-[#6366F1] text-white shadow-md' : 'bg-[#F1F5F9] text-[#64748B] group-hover:bg-[#E2E8F0]'}`}>
                  <UserCircle size={24} />
                </div>
                <span className={`text-[15px] font-bold ${selectedRole === 'manager' ? 'text-[#4338CA]' : 'text-[#64748B]'}`}>區主管</span>
              </button>
            </div>
          </div>

          {/* Inputs */}
          <div className="space-y-5">
            <div>
              <label className="block text-[14px] font-bold text-[#334155] mb-2.5 ml-1">
                使用者帳號
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-5 py-4 bg-[#F8FAFC] border-2 border-transparent rounded-[20px] outline-none focus:bg-white focus:border-[#8B5CF6] focus:ring-4 focus:ring-[#8B5CF6]/10 text-[#0F172A] placeholder-[#94A3B8] font-medium transition-all text-[16px] shadow-sm"
                placeholder={selectedRole === 'admin' ? "請輸入總部帳號 (例如 admin)" : "請輸入您的真實姓名"}
              />
            </div>
            
            <div>
              <label className="block text-[14px] font-bold text-[#334155] mb-2.5 ml-1">
                密碼
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-5 py-4 bg-[#F8FAFC] border-2 border-transparent rounded-[20px] outline-none focus:bg-white focus:border-[#8B5CF6] focus:ring-4 focus:ring-[#8B5CF6]/10 text-[#0F172A] placeholder-[#94A3B8] font-medium transition-all text-[16px] shadow-sm"
                placeholder="請輸入密碼"
              />
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className={`w-full py-4 px-4 rounded-[20px] text-white font-bold text-[17px] tracking-wide transition-all duration-300 flex items-center justify-center gap-2 group
                ${loading 
                  ? 'bg-[#CBD5E1] cursor-not-allowed' 
                  : 'bg-[#0F172A] hover:bg-[#1E293B] shadow-[0_10px_20px_-10px_rgba(15,23,42,0.5)] hover:shadow-[0_15px_25px_-10px_rgba(15,23,42,0.6)] active:scale-[0.98]'}`}
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>登入中...</span>
                </div>
              ) : (
                <>
                  <span>安全登入</span>
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
