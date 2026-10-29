import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Login } from './pages/Login';
import { ChangePasswordModal } from './components/ChangePasswordModal';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const AuditApp = lazy(() => import('./pages/AuditApp').then(m => ({ default: m.AuditApp })));
const AdminSettings = lazy(() => import('./pages/AdminSettings').then(m => ({ default: m.AdminSettings })));

const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: ('admin' | 'manager')[] }) => {
  const { user, token } = useAuth();
  
  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }
  
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  // 登入後若標記為必須修改密碼，強制攔截並彈出修改密碼視窗，無法略過
  if (user.role === 'manager' && user.must_change_password) {
    return (
      <div className="relative">
        <div className="pointer-events-none select-none blur-xs">
          {children}
        </div>
        <ChangePasswordModal open={true} forceMode={true} onClose={() => {}} />
      </div>
    );
  }
  
  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center bg-slate-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div></div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            <Route path="/dashboard" element={
              <ProtectedRoute allowedRoles={['admin', 'manager']}>
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
  );
};

const IndexRedirect = () => {
  return <Navigate to="/dashboard" replace />;
};

export default App;

