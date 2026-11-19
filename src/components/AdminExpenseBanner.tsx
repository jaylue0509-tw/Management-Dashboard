import React from 'react';
import type { ExpenseDashboardReport } from '../utils/mileage-calculator';

interface AdminExpenseBannerProps {
  report: ExpenseDashboardReport;
  onOpenExpenseTab: () => void;
}

/**
 * 最高管理權限專屬：當日與當月預估巡店車資總覽橫幅
 * （獨立模組化以便僅在管理員登入時透過 React.lazy 動態載入）
 */
export const AdminExpenseBanner: React.FC<AdminExpenseBannerProps> = ({
  report,
  onOpenExpenseTab,
}) => {
  return (
    <div className="mb-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-4 sm:p-5 text-white shadow-md border border-indigo-500/30">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-white/10">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-400 text-slate-950">
            🔒 最高管理權限專屬
          </span>
          <h3 className="text-sm sm:text-base font-extrabold text-white">
            🚗 巡店車程里程與預估車資補助（依汽車每公里 {report.ratePerKm} 元推算）
          </h3>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="bg-blue-500/20 border border-blue-400/40 rounded-xl px-3 py-1.5 text-xs">
            <span className="text-blue-200 font-semibold">
              📅 當天推算 ({report.targetDateStr.slice(5).replace('-', '/')})：
            </span>
            <strong className="text-white font-black text-sm ml-1">
              NT$ {report.dayTotalSubsidy.toLocaleString()}
            </strong>
            <span className="text-blue-200 ml-1">
              ({report.dayTotalKm.toFixed(1)} km)
            </span>
          </div>

          <div className="bg-emerald-500/20 border border-emerald-400/40 rounded-xl px-3 py-1.5 text-xs">
            <span className="text-emerald-200 font-semibold">
              🗓️ {report.targetMonthKey.slice(5)}月累計加總：
            </span>
            <strong className="text-amber-300 font-black text-sm ml-1">
              NT$ {report.monthTotalSubsidy.toLocaleString()}
            </strong>
            <span className="text-emerald-200 ml-1">
              ({report.monthTotalKm.toFixed(1)} km)
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenExpenseTab}
            className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs cursor-pointer transition-all shadow-xs"
          >
            查看完整路線與報表 ➔
          </button>
        </div>
      </div>

      {/* 每一位區主管當天推算費用 & 當月車程費用加總一覽 */}
      <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
        {report.managersReport.map(m => (
          <button
            key={m.managerName}
            type="button"
            onClick={onOpenExpenseTab}
            className="text-left bg-white/10 hover:bg-white/15 border border-white/15 rounded-xl px-3 py-2 transition-all cursor-pointer flex flex-col gap-1"
            title={`點擊查看 ${m.managerName} 每日行車路線與分段車資明細`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-extrabold text-white truncate">
                {m.managerName}
                {m.roleLabel === '副區主管' ? ' (副)' : ''}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/40 text-indigo-100 shrink-0">
                {m.region}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-indigo-200">
              <span>當天 ({report.targetDateStr.slice(5).replace('-', '/')})：</span>
              <strong className={m.daySubsidy > 0 ? 'text-sky-300 font-extrabold' : 'text-gray-400'}>
                ${m.daySubsidy.toLocaleString()} ({m.dayKm.toFixed(1)}km)
              </strong>
            </div>
            <div className="flex items-center justify-between text-[11px] text-indigo-200">
              <span>{report.targetMonthKey.slice(5)}月加總：</span>
              <strong className="text-amber-300 font-extrabold">
                ${m.monthSubsidy.toLocaleString()} ({m.monthKm.toFixed(1)}km)
              </strong>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

