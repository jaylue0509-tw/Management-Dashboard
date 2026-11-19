import React from 'react';
import type { ExpenseDashboardReport } from '../utils/mileage-calculator';

interface AdminExpenseBannerProps {
  report: ExpenseDashboardReport;
  isManager?: boolean;
  onOpenExpenseTab: () => void;
}

/**
 * 巡店車資與零用金報銷總覽橫幅
 * - 最高管理員 (admin)：顯示全體區主管當日與當月車資總覽
 * - 區主管 (manager)：僅顯示區主管本人之當日與當月車資，嚴格隔離他人資料
 */
export const AdminExpenseBanner: React.FC<AdminExpenseBannerProps> = ({
  report,
  isManager = false,
  onOpenExpenseTab,
}) => {
  return (
    <div className="mb-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-4 sm:p-5 text-white shadow-md border border-indigo-500/30">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-white/10">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-400 text-slate-950">
            {isManager ? '👤 區主管個人專屬' : '🔒 最高管理權限'}
          </span>
          <h3 className="text-sm sm:text-base font-extrabold text-white">
            🚗 {isManager ? '個人巡店車程里程與零用金報銷速覽' : '全區巡店車程里程與預估車資補助'}（每公里 {report.ratePerKm} 元）
          </h3>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap w-full sm:w-auto">
          <div className="flex-1 sm:flex-initial bg-blue-500/20 border border-blue-400/40 rounded-xl px-3 py-1.5 text-xs">
            <span className="text-blue-200 font-semibold">
              📅 當天 ({report.targetDateStr.slice(5).replace('-', '/')})：
            </span>
            <strong className="text-white font-black text-sm ml-1">
              NT$ {report.dayTotalSubsidy.toLocaleString()}
            </strong>
            <span className="text-blue-200 ml-1">
              ({report.dayTotalKm.toFixed(1)} km)
            </span>
          </div>

          <div className="flex-1 sm:flex-initial bg-emerald-500/20 border border-emerald-400/40 rounded-xl px-3 py-1.5 text-xs">
            <span className="text-emerald-200 font-semibold">
              🗓️ {report.targetMonthKey.slice(5)}月累計：
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
            className="w-full sm:w-auto px-3.5 py-2 sm:py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs cursor-pointer transition-all shadow-xs text-center"
          >
            {isManager ? '開啟個人車資與零用金黏存單 ➔' : '查看全區路線與零用金黏存單 ➔'}
          </button>
        </div>
      </div>

      {/* 主管卡片網格（區主管登入時僅有本人 1 張卡片） */}
      <div
        className={`pt-3 grid gap-2 ${
          isManager
            ? 'grid-cols-1'
            : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
        }`}
      >
        {report.managersReport.map(m => (
          <button
            key={m.managerName}
            type="button"
            onClick={onOpenExpenseTab}
            className="text-left bg-white/10 hover:bg-white/15 border border-white/15 rounded-xl px-3 py-2.5 transition-all cursor-pointer flex flex-col gap-1"
            title={`點擊查看 ${m.managerName} 每日行車路線與零用金單據黏存單`}
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
