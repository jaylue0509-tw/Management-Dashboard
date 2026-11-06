import React, { useEffect, useState } from 'react';
import { Clock, ClipboardSignature, LayoutDashboard, ChevronDown, Settings, KeyRound, LogOut, UserCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ChangePasswordModal } from './ChangePasswordModal';

interface Props {
  selectedDepartment: string;
  onDepartmentChange: (dept: string) => void;
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
}

export const HeaderBar: React.FC<Props> = ({ selectedDepartment, onDepartmentChange, timeRange, onTimeRangeChange }) => {
  const [time, setTime] = useState(new Date());
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeOptions = [
    { value: 'day', label: '今日動態' },
    { value: 'week', label: '本週動態' },
    { value: 'last_week', label: '上週動態' },
    { value: 'month', label: '本月動態' },
    { value: 'custom', label: '📅 自選日期' },
    { value: 'all', label: '所有紀錄' },
  ];

  const deptOptions = [
    { value: 'all', label: '全區檢視' },
    { value: '營業一處', label: '營業一處' },
    { value: '營業二處', label: '營業二處' },
  ];

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-2xs">
      {/* Top accent line */}
      <div
        style={{
          height: '3px',
          background: 'linear-gradient(90deg, #3b82f6 0%, #6366f1 50%, #14b8a6 100%)',
        }}
      />

      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-2 sm:py-2.5 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        {/* 第一列：品牌標題 + 主要操作按鈕 (手機與電腦皆保持單行俐落不擠壓) */}
        <div className="flex items-center justify-between gap-2 w-full lg:w-auto">
          {/* Left: Brand */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
              }}
            >
              <LayoutDashboard size={17} color="white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-[0.95rem] font-bold text-gray-900 leading-tight truncate">
                東寵門市營運改善與輔導戰情牆
              </h1>
              <p className="hidden sm:block text-[0.68rem] text-gray-400 tracking-wider mt-0.5 truncate">
                Operations Management Dashboard
              </p>
            </div>
          </div>

          {/* Mobile Quick CTA & Auth Buttons (僅在 < lg 顯示於第一列右側) */}
          <div className="flex lg:hidden items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/audit')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white shadow-xs cursor-pointer whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
            >
              <ClipboardSignature size={13} />
              <span>巡店作業</span>
            </button>

            {user?.role === 'admin' && (
              <button
                type="button"
                onClick={() => navigate('/admin/settings')}
                className="p-1.5 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 cursor-pointer"
                title="系統設定"
              >
                <Settings size={14} />
              </button>
            )}

            {user?.role === 'manager' && (
              <button
                type="button"
                onClick={() => setIsChangePasswordOpen(true)}
                className="p-1.5 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 cursor-pointer"
                title="修改密碼"
              >
                <KeyRound size={14} />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (window.confirm('確定要安全登出系統嗎？')) {
                  logout();
                  navigate('/login');
                }
              }}
              className="p-1.5 rounded-lg bg-white text-gray-500 border border-gray-200 hover:text-red-600 hover:border-red-200 cursor-pointer"
              title="登出"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>

        {/* 第二列 (手機) / 右側控制列 (電腦)：篩選器、主管身分徽章與桌面版按鈕 */}
        <div className="flex items-center justify-between lg:justify-end flex-wrap gap-2 w-full lg:w-auto">
          <div className="flex items-center gap-2 flex-1 sm:flex-initial min-w-0">
            {/* Time Range Select */}
            <div className="relative shrink-0">
              <select
                value={timeRange}
                onChange={(e) => onTimeRangeChange(e.target.value)}
                className="appearance-none py-1.5 pl-2.5 pr-7 text-xs sm:text-[0.82rem] font-semibold bg-gray-50 border border-gray-200 rounded-lg text-gray-700 cursor-pointer outline-none"
              >
                {timeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>

            {/* Dept Select or Manager Identity Badge */}
            {user?.role === 'manager' ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-xs font-bold min-w-0 truncate">
                <UserCheck size={13} className="text-blue-600 shrink-0" />
                <span className="truncate">區主管：{user.name}</span>
                <span className="text-blue-300 font-normal shrink-0">|</span>
                <span className="text-[11px] text-blue-600 font-semibold shrink-0">
                  轄屬 {user.assigned_stores?.length || 0} 店
                </span>
              </div>
            ) : (
              <div className="relative shrink-0">
                <select
                  value={selectedDepartment}
                  onChange={(e) => onDepartmentChange(e.target.value)}
                  className="appearance-none py-1.5 pl-2.5 pr-7 text-xs sm:text-[0.82rem] font-semibold bg-gray-50 border border-gray-200 rounded-lg text-gray-700 cursor-pointer outline-none"
                >
                  {deptOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Desktop Controls (僅在 lg 以上顯示完整文字按鈕與時鐘) */}
          <div className="hidden lg:flex items-center gap-2">
            <div className="w-px h-6 bg-gray-200 mx-0.5" />

            {/* Clock */}
            <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium tabular-nums tracking-wider">
              <Clock size={13} className="text-gray-400" />
              {time.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>

            {user?.role === 'admin' && (
              <button
                type="button"
                onClick={() => navigate('/admin/settings')}
                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors"
              >
                <Settings size={14} />
                系統設定
              </button>
            )}

            {user?.role === 'manager' && (
              <button
                id="header-change-password"
                type="button"
                onClick={() => setIsChangePasswordOpen(true)}
                className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap"
              >
                <KeyRound size={14} />
                修改密碼
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (window.confirm('確定要安全登出系統嗎？')) {
                  logout();
                  navigate('/login');
                }
              }}
              className="flex items-center gap-1.5 bg-white hover:bg-red-50 text-gray-600 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap"
            >
              <LogOut size={13} />
              登出
            </button>

            <button
              type="button"
              onClick={() => navigate('/audit')}
              className="flex items-center gap-1.5 text-white rounded-lg px-4 py-2 text-xs font-bold cursor-pointer transition-all shadow-sm hover:-translate-y-0.5 whitespace-nowrap"
              style={{
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                boxShadow: '0 2px 8px rgba(37,99,235,0.3)',
              }}
            >
              <ClipboardSignature size={14} />
              現場巡店作業
            </button>
          </div>
        </div>
      </div>
      <ChangePasswordModal open={isChangePasswordOpen} onClose={() => setIsChangePasswordOpen(false)} />
    </header>
  );
};
