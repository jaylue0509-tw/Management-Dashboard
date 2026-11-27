import React, { useState } from 'react';
import {
  Home,
  CalendarDays,
  Plus,
  Car,
  LayoutGrid,
  ClipboardSignature,
  Sparkles,
  MapPin,
  Network,
  RefreshCw,
  X,
  CalendarPlus,
  ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export type DashboardTabId = 'dashboard' | 'beauty' | 'planned' | 'route_map' | 'expense' | 'org_map' | 'map';

interface MobileBottomNavProps {
  activeTab: DashboardTabId;
  userRole?: 'admin' | 'manager' | 'beauty_director';
  isRefreshing: boolean;
  onSelectTab: (tab: DashboardTabId) => void;
  onGoHome: () => void;
  onRefresh: () => void;
  onCreateSchedule: () => void;
}

/**
 * 手機端專屬底部快捷導覽列（僅在 < md 螢幕顯示）：
 * 將高頻操作集中於單手大拇指可及範圍，並提供白話說明的快速作業選單，讓新使用者快速上手。
 */
export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  userRole,
  isRefreshing,
  onSelectTab,
  onGoHome,
  onRefresh,
  onCreateSchedule,
}) => {
  const navigate = useNavigate();
  const [quickActionOpen, setQuickActionOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const isBeautyDirector = userRole === 'beauty_director';
  const isMoreTabActive =
    !isBeautyDirector &&
    (activeTab === 'beauty' || activeTab === 'route_map' || activeTab === 'map' || activeTab === 'org_map');

  const handleTabSwitch = (tab: DashboardTabId) => {
    setMoreMenuOpen(false);
    setQuickActionOpen(false);
    onSelectTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {/* 底部導覽列（僅手機顯示，支援 iOS / Android 底部安全區） */}
      <nav
        aria-label="手機快捷導覽"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-4px_20px_rgba(15,23,42,0.08)] safe-bottom"
      >
        <div className="grid grid-cols-5 items-end px-1.5 pt-1.5">
          {/* 1. 首頁 / 看板 */}
          <button
            type="button"
            onClick={() => {
              setMoreMenuOpen(false);
              setQuickActionOpen(false);
              onGoHome();
            }}
            className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl transition-colors cursor-pointer ${
              (isBeautyDirector ? activeTab === 'beauty' : activeTab === 'dashboard')
                ? 'text-blue-600'
                : 'text-slate-500 active:bg-slate-100'
            }`}
          >
            <Home size={20} strokeWidth={(isBeautyDirector ? activeTab === 'beauty' : activeTab === 'dashboard') ? 2.4 : 2} />
            <span className="text-[11px] font-bold leading-none mt-0.5">
              {isBeautyDirector ? '看板' : '首頁'}
            </span>
          </button>

          {/* 2. 預排行程 */}
          <button
            type="button"
            onClick={() => handleTabSwitch('planned')}
            className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl transition-colors cursor-pointer ${
              activeTab === 'planned' ? 'text-blue-600' : 'text-slate-500 active:bg-slate-100'
            }`}
          >
            <CalendarDays size={20} strokeWidth={activeTab === 'planned' ? 2.4 : 2} />
            <span className="text-[11px] font-bold leading-none mt-0.5">預排</span>
          </button>

          {/* 3. 中央核心主動作按鈕：一鍵巡店／快速作業 */}
          <div className="flex flex-col items-center justify-center -mt-4 pb-1">
            {isBeautyDirector ? (
              <button
                type="button"
                onClick={() => navigate('/beauty-audit')}
                aria-label="開始美容巡店"
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform cursor-pointer"
                style={{
                  background: 'linear-gradient(135deg, #e11d48, #a21caf)',
                  boxShadow: '0 6px 16px rgba(190, 24, 93, 0.35)',
                }}
              >
                <Sparkles size={22} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  setQuickActionOpen(true);
                }}
                aria-label="開啟快速巡店與作業選單"
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg active:scale-95 transition-transform cursor-pointer"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  boxShadow: '0 6px 16px rgba(37, 99, 235, 0.35)',
                }}
              >
                <Plus size={24} strokeWidth={2.6} />
              </button>
            )}
            <span className={`text-[11px] font-extrabold leading-none mt-1 ${isBeautyDirector ? 'text-rose-600' : 'text-blue-600'}`}>
              {isBeautyDirector ? '美容巡店' : '快速作業'}
            </span>
          </div>

          {/* 4. 車資黏存單 */}
          <button
            type="button"
            onClick={() => handleTabSwitch('expense')}
            className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl transition-colors cursor-pointer ${
              activeTab === 'expense' ? 'text-blue-600' : 'text-slate-500 active:bg-slate-100'
            }`}
          >
            <Car size={20} strokeWidth={activeTab === 'expense' ? 2.4 : 2} />
            <span className="text-[11px] font-bold leading-none mt-0.5">車資</span>
          </button>

          {/* 5. 美容總監直達組織架構；管理員／區主管開啟「更多功能」抽屜 */}
          {isBeautyDirector ? (
            <button
              type="button"
              onClick={() => handleTabSwitch('org_map')}
              className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl transition-colors cursor-pointer ${
                activeTab === 'org_map' ? 'text-blue-600' : 'text-slate-500 active:bg-slate-100'
              }`}
            >
              <Network size={20} strokeWidth={activeTab === 'org_map' ? 2.4 : 2} />
              <span className="text-[11px] font-bold leading-none mt-0.5">組織</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setQuickActionOpen(false);
                setMoreMenuOpen(true);
              }}
              className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl transition-colors cursor-pointer ${
                isMoreTabActive || moreMenuOpen ? 'text-blue-600' : 'text-slate-500 active:bg-slate-100'
              }`}
            >
              <LayoutGrid size={20} strokeWidth={isMoreTabActive || moreMenuOpen ? 2.4 : 2} />
              <span className="text-[11px] font-bold leading-none mt-0.5">更多</span>
            </button>
          )}
        </div>
      </nav>

      {/* 快速作業抽屜（Bottom Action Sheet） */}
      {quickActionOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-end"
          onClick={() => setQuickActionOpen(false)}
        >
          <div
            className="w-full bg-white rounded-t-3xl p-5 pb-6 safe-bottom shadow-2xl border-t border-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">要執行哪項作業？</h3>
                <p className="text-xs text-slate-500 mt-0.5">選擇常用功能立即開始</p>
              </div>
              <button
                type="button"
                onClick={() => setQuickActionOpen(false)}
                className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
                aria-label="關閉選單"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => {
                  setQuickActionOpen(false);
                  navigate('/audit');
                }}
                className="w-full min-h-[60px] flex items-center gap-3.5 p-3.5 rounded-2xl bg-blue-50/80 border border-blue-200 text-left active:scale-[0.99] transition-transform cursor-pointer"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm"
                  style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                >
                  <ClipboardSignature size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-extrabold text-slate-900">現場巡店作業</div>
                  <div className="text-xs text-slate-500 mt-0.5">填寫門市營運巡檢表、拍照與 PDCA 追蹤</div>
                </div>
                <ChevronRight size={18} className="text-blue-400 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setQuickActionOpen(false);
                  navigate('/beauty-audit');
                }}
                className="w-full min-h-[60px] flex items-center gap-3.5 p-3.5 rounded-2xl bg-rose-50/80 border border-rose-200 text-left active:scale-[0.99] transition-transform cursor-pointer"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm"
                  style={{ background: 'linear-gradient(135deg, #e11d48, #a21caf)' }}
                >
                  <Sparkles size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-extrabold text-slate-900">美容總監巡店表</div>
                  <div className="text-xs text-slate-500 mt-0.5">美容房與住宿環境專項檢核回報</div>
                </div>
                <ChevronRight size={18} className="text-rose-400 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setQuickActionOpen(false);
                  onCreateSchedule();
                }}
                className="w-full min-h-[60px] flex items-center gap-3.5 p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-left active:scale-[0.99] transition-transform cursor-pointer"
              >
                <div className="w-11 h-11 rounded-xl bg-emerald-600 flex items-center justify-center text-white shrink-0 shadow-sm">
                  <CalendarPlus size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-extrabold text-slate-900">登記總部／外勤行程</div>
                  <div className="text-xs text-slate-500 mt-0.5">快速回報總部開會、教育訓練或休假狀態</div>
                </div>
                <ChevronRight size={18} className="text-slate-400 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 更多功能抽屜（Bottom Sheet） */}
      {moreMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-end"
          onClick={() => setMoreMenuOpen(false)}
        >
          <div
            className="w-full bg-white rounded-t-3xl p-5 pb-6 safe-bottom shadow-2xl border-t border-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">更多戰情功能</h3>
                <p className="text-xs text-slate-500 mt-0.5">一鍵切換所有管理看板</p>
              </div>
              <button
                type="button"
                onClick={() => setMoreMenuOpen(false)}
                className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer"
                aria-label="關閉更多功能"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mb-3">
              <button
                type="button"
                onClick={() => handleTabSwitch('beauty')}
                className={`p-3.5 rounded-2xl border text-left transition-all active:scale-[0.98] cursor-pointer ${
                  activeTab === 'beauty'
                    ? 'bg-rose-50 border-rose-300 text-rose-800'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <Sparkles size={19} className="text-rose-500 mb-2" />
                <div className="text-sm font-bold">美容住宿專項</div>
                <div className="text-[11px] text-slate-500 mt-0.5">美容巡店與異常追蹤</div>
              </button>

              <button
                type="button"
                onClick={() => handleTabSwitch('route_map')}
                className={`p-3.5 rounded-2xl border text-left transition-all active:scale-[0.98] cursor-pointer ${
                  activeTab === 'route_map' || activeTab === 'map'
                    ? 'bg-blue-50 border-blue-300 text-blue-800'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <MapPin size={19} className="text-blue-600 mb-2" />
                <div className="text-sm font-bold">巡店路徑地圖</div>
                <div className="text-[11px] text-slate-500 mt-0.5">路線視覺化與最佳化</div>
              </button>

              <button
                type="button"
                onClick={() => handleTabSwitch('org_map')}
                className={`p-3.5 rounded-2xl border text-left transition-all active:scale-[0.98] cursor-pointer ${
                  activeTab === 'org_map'
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <Network size={19} className="text-indigo-600 mb-2" />
                <div className="text-sm font-bold">組織架構配置</div>
                <div className="text-[11px] text-slate-500 mt-0.5">各處區主管與轄屬店</div>
              </button>

              <button
                type="button"
                disabled={isRefreshing}
                onClick={() => {
                  setMoreMenuOpen(false);
                  onRefresh();
                }}
                className="p-3.5 rounded-2xl border bg-slate-50 border-slate-200 text-slate-800 text-left transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  size={19}
                  className={`text-emerald-600 mb-2 ${isRefreshing ? 'animate-spin' : ''}`}
                />
                <div className="text-sm font-bold">{isRefreshing ? '資料更新中...' : '立即更新資料'}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">手動同步最新巡店紀錄</div>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
