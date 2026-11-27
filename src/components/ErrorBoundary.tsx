import React from 'react';
import { AlertTriangle, RefreshCw, LogIn } from 'lucide-react';
import { isChunkLoadError, triggerSafeChunkReload } from '../utils/lazy-with-retry';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  isChunkError: boolean;
}

/**
 * 全域渲染錯誤邊界：攔截未預期的前端執行期錯誤或分包載入失敗，
 * 避免整個應用程式崩潰變成全白畫面，並提供一鍵復原按鈕。
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      isChunkError: false,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const chunkErr = isChunkLoadError(error);
    return {
      hasError: true,
      errorMessage: error?.message || '頁面載入發生異常',
      isChunkError: chunkErr,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught render error:', error, errorInfo);
    // 若屬於新版部署造成的分包失效，優先自動重整一次取得最新資源
    if (isChunkLoadError(error)) {
      triggerSafeChunkReload();
    }
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleBackToLogin = (): void => {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch {
      // 忽略私密瀏覽限制
    }
    window.location.href = '/login';
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#f4f6f9] p-4 text-slate-900">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-lg p-7 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <AlertTriangle size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            {this.state.isChunkError ? '系統已更新至最新版本' : '頁面暫時無法顯示'}
          </h1>
          <p className="text-sm text-slate-500 leading-relaxed mb-6">
            {this.state.isChunkError
              ? '偵測到網站有新版本或網路短暫中斷，請點擊下方按鈕重新載入即可恢復正常。'
              : '畫面載入時發生預期外的錯誤，請重新整理頁面或返回登入頁重新操作。'}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold transition-colors cursor-pointer"
            >
              <RefreshCw size={16} />
              重新載入頁面
            </button>
            <button
              type="button"
              onClick={this.handleBackToLogin}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold transition-colors cursor-pointer"
            >
              <LogIn size={16} />
              返回登入頁
            </button>
          </div>
        </div>
      </div>
    );
  }
}
