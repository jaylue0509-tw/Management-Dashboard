import React, { useState } from 'react';
import { KeyRound, X, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const API_URL = import.meta.env.PROD
  ? '/api/auth/change-password'
  : 'https://management-dashboard-rust.vercel.app/api/auth/change-password';
const MIN_PASSWORD_LENGTH = 6;

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
  forceMode?: boolean; // 是否為登入後強制修改模式 (不可略過)
}

/**
 * 區主管修改密碼的彈出視窗 (支援自選修改與強制修改模式)
 * @param open 是否顯示
 * @param onClose 關閉回呼
 * @param forceMode 是否強制修改 (無法略過)
 */
export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ open, onClose, forceMode = false }) => {
  const { token, logout, updateUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const resetAndClose = () => {
    if (forceMode) return; // 強制模式下不允許關閉
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // 前端先做基本檢查以提升體驗，最終仍以後端驗證為準
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`新密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('兩次輸入的新密碼不一致');
      return;
    }
    if (newPassword === currentPassword) {
      setError('新密碼不可與目前密碼相同');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = typeof data.detail === 'string' ? data.detail : '修改失敗，請確認目前密碼是否正確';
        throw new Error(detail);
      }

      // 同步更新本地 Context 中的 must_change_password 旗標
      updateUser({ must_change_password: false });
      
      alert(forceMode 
        ? '密碼修改完成！歡迎進入系統使用。' 
        : '密碼已更新成功！');
      
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '系統連線異常，請稍後再試');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-slate-900 text-[15px] transition-all';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-200"
      onClick={resetAndClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 animate-in zoom-in-95 duration-200 border border-slate-100"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-md ${
              forceMode 
                ? 'bg-gradient-to-br from-amber-500 to-rose-600 text-white' 
                : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
            }`}>
              <KeyRound size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {forceMode ? '首次登入安全設定' : '修改密碼'}
              </h2>
              {forceMode && (
                <p className="text-xs text-amber-600 font-medium">請先變更密碼以繼續使用</p>
              )}
            </div>
          </div>
          {!forceMode && (
            <button id="change-password-close" type="button" onClick={resetAndClose} className="text-slate-400 hover:text-slate-600 p-1">
              <X size={20} />
            </button>
          )}
        </div>

        {forceMode && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3.5 py-2.5 rounded-xl mb-4 leading-relaxed font-medium">
            依資安規範，初次登入或密碼重設後必須立即更改密碼，設定完成後即可正常使用系統所有功能。
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-2.5 rounded-xl text-sm font-medium mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">目前密碼</label>
            <input
              id="change-password-current"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="請輸入原密碼"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">新密碼（至少 {MIN_PASSWORD_LENGTH} 碼）</label>
            <input
              id="change-password-new"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder={`輸入新密碼 (至少 ${MIN_PASSWORD_LENGTH} 碼)`}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">確認新密碼</label>
            <input
              id="change-password-confirm"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="再次輸入新密碼"
              className={inputClass}
            />
          </div>

          <button
            id="change-password-toggle-visibility"
            type="button"
            onClick={() => setShowPassword(v => !v)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 cursor-pointer"
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            {showPassword ? '隱藏密碼' : '顯示密碼'}
          </button>

          <button
            id="change-password-submit"
            type="submit"
            disabled={submitting}
            className={`w-full py-3.5 rounded-xl font-bold text-[15px] transition-all shadow-md ${
              submitting 
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed' 
                : forceMode
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
            }`}
          >
            {submitting ? '更新驗證中...' : (forceMode ? '確認修改並啟用帳號' : '確認修改')}
          </button>

          {forceMode && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('確定要暫時登出嗎？修改密碼前將無法使用系統功能。')) {
                    logout();
                  }
                }}
                className="text-xs text-slate-400 hover:text-rose-600 font-medium transition-colors"
              >
                暫不修改，安全登出
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
