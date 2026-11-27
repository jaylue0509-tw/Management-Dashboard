import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Login } from './pages/Login';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { lazyWithRetry } from './utils/lazy-with-retry';

const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const AuditApp = lazyWithRetry(() => import('./pages/AuditApp').then(m => ({ default: m.AuditApp })));
const BeautyAuditApp = lazyWithRetry(() => import('./pages/BeautyAuditApp').then(m => ({ default: m.BeautyAuditApp })));
const AdminSettings = lazyWithRetry(() => import('./pages/AdminSettings').then(m => ({ default: m.AdminSettings })));

const PageLoadingFallback = () => (
  <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-[#f4f6f9] text-slate-600 px-4">
    <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-indigo-200 border-t-indigo-600" />
    <div className="text-center">
      <p className="text-sm font-bold text-slate-800">正在進入東寵營運系統...</p>
      <p className="mt-1 text-xs text-slate-400">首次載入頁面模組中，請稍候</p>
    </div>
  </div>
);

const ProtectedRoute = ({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: ('admin' | 'manager' | 'beauty_director')[];
}) => {
  const { user, token } = useAuth();
  
  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }
  
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'beauty_director' ? '/dashboard?view=beauty' : '/'} replace />;
  }

  // 登入後若標記為必須修改密碼，先顯示獨立安全設定背景，避免未改密碼前就預先拉取整包儀表板資料
  if ((user.role === 'manager' || user.role === 'beauty_director') && user.must_change_password) {
    return (
      <div className="min-h-screen w-full bg-[#f4f6f9]">
        <ChangePasswordModal open={true} forceMode={true} onClose={() => {}} />
      </div>
    );
  }
  
  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<PageLoadingFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              
              <Route path="/dashboard" element={
                <ProtectedRoute allowedRoles={['admin', 'manager', 'beauty_director']}>
                  <DashboardPage />
                </ProtectedRoute>
              } />
              
              <Route path="/admin/settings" element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <AdminSettings />
                </ProtectedRoute>
              } />
              
              <Route path="/audit" element={
                <ProtectedRoute allowedRoles={['manager', 'admin']}>
                  <AuditApp />
                </ProtectedRoute>
              } />

              <Route path="/beauty-audit" element={
                <ProtectedRoute allowedRoles={['beauty_director', 'manager', 'admin']}>
                  <BeautyAuditApp />
                </ProtectedRoute>
              } />
              
              {/* 預設首頁根據角色導向 */}
              <Route path="/" element={
                <ProtectedRoute>
                  <IndexRedirect />
                </ProtectedRoute>
              } />
              
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
};

const IndexRedirect = () => {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'beauty_director' ? '/dashboard?view=beauty' : '/dashboard'} replace />;
};

export default App;

