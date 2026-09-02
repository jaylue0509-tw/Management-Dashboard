import React, { useEffect, useState } from 'react';
import { Clock, ClipboardSignature, LayoutDashboard, ChevronDown, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  selectedDepartment: string;
  onDepartmentChange: (dept: string) => void;
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
}

export const HeaderBar: React.FC<Props> = ({ selectedDepartment, onDepartmentChange, timeRange, onTimeRangeChange }) => {
  const [time, setTime] = useState(new Date());
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeOptions = [
    { value: 'all', label: '所有紀錄' },
    { value: 'day', label: '今日動態' },
    { value: 'week', label: '本週動態' },
    { value: 'last_week', label: '上週動態' },
    { value: 'month', label: '本月動態' },
  ];

  const deptOptions = [
    { value: 'all', label: '全區檢視' },
    { value: '營業一處', label: '營業一處' },
    { value: '營業二處', label: '營業二處' },
  ];

  return (
    <header style={{
      background: '#ffffff',
      borderBottom: '1px solid #e5e7eb',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      {/* Top accent line */}
      <div style={{
        height: '3px',
        background: 'linear-gradient(90deg, #3b82f6 0%, #6366f1 50%, #14b8a6 100%)',
      }} />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '60px',
        maxWidth: '1440px',
        margin: '0 auto',
        padding: '0 24px',
      }}>
        {/* Left: Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '34px', height: '34px',
            background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
            borderRadius: '9px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
            flexShrink: 0,
          }}>
            <LayoutDashboard size={18} color="white" />
          </div>
          <div>
            <h1 style={{
              fontSize: '0.95rem',
              fontWeight: 700,
              color: '#111827',
              letterSpacing: '0.01em',
              lineHeight: 1.2,
            }}>
              東寵門市營運改善與輔導戰情牆
            </h1>
            <p style={{ fontSize: '0.68rem', color: '#9ca3af', letterSpacing: '0.04em', marginTop: '1px' }}>
              Operations Management Dashboard
            </p>
          </div>
        </div>

        {/* Right: Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Time Range Select */}
          <div style={{ position: 'relative' }}>
            <select
              value={timeRange}
              onChange={(e) => onTimeRangeChange(e.target.value)}
              style={{
                appearance: 'none',
                padding: '7px 30px 7px 12px',
                fontSize: '0.82rem',
                fontWeight: 500,
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                color: '#374151',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {timeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={13} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
          </div>

          {/* Dept Select */}
          <div style={{ position: 'relative' }}>
            <select
              value={selectedDepartment}
              onChange={(e) => onDepartmentChange(e.target.value)}
              style={{
                appearance: 'none',
                padding: '7px 30px 7px 12px',
                fontSize: '0.82rem',
                fontWeight: 500,
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                color: '#374151',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {deptOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={13} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
          </div>

          {/* Divider */}
          <div style={{ width: '1px', height: '24px', background: '#e5e7eb' }} />

          {/* Clock */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            color: '#6b7280',
            fontSize: '0.8rem',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.04em',
            fontWeight: 500,
          }}>
            <Clock size={13} color="#9ca3af" />
            {time.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>

          {/* Settings Button (Admin Only) */}
          {user?.role === 'admin' && (
            <button
              onClick={() => navigate('/admin/settings')}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                background: '#f3f4f6',
                color: '#4b5563',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb';
                (e.currentTarget as HTMLButtonElement).style.color = '#1f2937';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6';
                (e.currentTarget as HTMLButtonElement).style.color = '#4b5563';
              }}
            >
              <Settings size={14} />
              系統設定
            </button>
          )}

          {/* CTA Button */}
          <button
            onClick={() => navigate('/audit')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(37,99,235,0.3)',
              transition: 'all 0.15s',
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 14px rgba(37,99,235,0.45)';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(37,99,235,0.3)';
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            }}
          >
            <ClipboardSignature size={14} />
            現場巡店作業
          </button>
        </div>
      </div>
    </header>
  );
};
