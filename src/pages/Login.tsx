import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Sparkles } from 'lucide-react';

export const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

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
        throw new Error('帳號或密碼錯誤，請重新輸入');
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
    <div className="min-h-screen bg-[#F8F9FB] flex items-center justify-center p-4 font-sans">
      <div className="bg-white rounded-[40px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] w-full max-w-[480px] p-10 sm:p-12">
        
        {/* Logo Section */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 rounded-3xl flex items-center justify-center mb-6 shadow-lg shadow-indigo-200">
            <Sparkles size={36} className="text-white" fill="currentColor" />
          </div>
          <h1 className="text-[28px] font-bold text-slate-900 tracking-wide mb-3">東寵營運系統</h1>
          <p className="text-slate-500 font-medium">戰情分析與現場巡店管理</p>
          <p className="text-slate-400 text-sm mt-1">請輸入您的帳號密碼以登入</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-sm font-medium mb-6 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          
          {/* Username Input */}
          <div>
            <label className="block text-[15px] font-bold text-slate-800 mb-2.5">
              使用者帳號
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-5 py-4 bg-[#FAFAFA] border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-700 placeholder-slate-400 font-medium transition-all text-[15px]"
              placeholder="請輸入您的帳號"
            />
          </div>
          
          {/* Password Input */}
          <div>
            <label className="block text-[15px] font-bold text-slate-800 mb-2.5">
              密碼
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-5 py-4 bg-[#FAFAFA] border border-gray-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-700 placeholder-slate-400 font-medium transition-all text-[15px]"
              placeholder="請輸入密碼"
            />
          </div>

          {/* Submit Button */}
          <div className="pt-4">
            <button
              type="submit"
              disabled={loading}
              className={`w-full py-4 px-4 rounded-2xl text-white font-bold text-[17px] tracking-wide transition-all
                ${loading 
                  ? 'bg-slate-300 cursor-not-allowed' 
                  : 'bg-[#1A233A] hover:bg-[#2A344A] hover:shadow-xl hover:shadow-slate-900/20 active:scale-[0.98]'}`}
            >
              {loading ? '登入中...' : '登入系統'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
