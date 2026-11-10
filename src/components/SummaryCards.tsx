import React, { useState } from 'react';
import type { DashboardSummary, Manager } from '../types';
import { TrendingUp, CheckCircle, AlertTriangle, ClipboardList, Zap } from 'lucide-react';
import { useStoreRegionLookup } from '../hooks/use-store-region-lookup';
import { DetailModal } from './DetailModal';
import { RegionGroupedStoreCards, RegionGroupedStoreTags } from './RegionGroupedStores';

interface Props {
  summary: DashboardSummary | null;
  managers?: Manager[];
  regionLabel?: string;
  periodLabel?: string;
  onStoreSelect?: (storeName: string, recordId?: string) => void;
}

type CardKind = 'coverage' | 'pdca' | 'redLight' | 'visits' | 'abnormal';

interface MetricCardConfig {
  kind: CardKind;
  icon: React.ReactElement;
  label: string;
  value: string | number;
  unit?: string;
  valueColor: string;
  iconBg: string;
  borderTop: string;
  description: string;
  subText?: React.ReactNode;
  storeList?: string[];
  unvisitedList?: string[];
  openPdcaList?: string[];
  redLightStoresList?: { store: string; reasons: string[]; reportTime?: string; recordId?: string }[];
  abnormalStoresList?: { store: string; reasons: string[]; reportTime?: string; recordId?: string }[];
}

const MetricCard: React.FC<MetricCardConfig & { className?: string; onClick: () => void }> = ({
  icon,
  label,
  value,
  unit,
  valueColor,
  iconBg,
  borderTop,
  subText,
  onClick,
  className = '',
}) => (
  <div
    onClick={onClick}
    className={`p-3.5 sm:p-5 bg-white rounded-xl border border-gray-200 shadow-2xs hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer ${className}`}
    style={{ borderTop: `3px solid ${borderTop}` }}
  >
    <div className="flex items-start justify-between mb-2.5 sm:mb-3.5">
      <div
        className="w-8 h-8 sm:w-[38px] sm:h-[38px] rounded-[10px] flex items-center justify-center"
        style={{ background: iconBg }}
      >
        {icon}
      </div>
    </div>

    <div className="text-gray-500 text-xs sm:text-[0.78rem] font-medium tracking-wide mb-1 sm:mb-1.5">
      {label}
    </div>

    <div className="flex items-baseline gap-1">
      <span
        className="text-3xl sm:text-[2.4rem] font-extrabold leading-none tracking-tight tabular-nums"
        style={{ color: valueColor }}
      >
        {value}
      </span>
      {unit && <span className="text-xs sm:text-[0.95rem] font-medium text-gray-400">{unit}</span>}
    </div>

    {subText && (
      <div className="mt-1.5 text-xs sm:text-[0.82rem] text-gray-500 font-semibold leading-snug">
        {subText}
      </div>
    )}
  </div>
);

/**
 * 頂部五大核心營運指標卡片與分區明細彈窗
 */
export const SummaryCards: React.FC<Props> = ({
  summary,
  managers = [],
  regionLabel = '全區',
  periodLabel = '今日',
  onStoreSelect,
}) => {
  const [activeCard, setActiveCard] = useState<MetricCardConfig | null>(null);
  const [coverageSubTab, setCoverageSubTab] = useState<'visited' | 'unvisited'>('visited');
  const [pdcaSubTab, setPdcaSubTab] = useState<'open' | 'closed'>('open');
  const getRegionInfo = useStoreRegionLookup(managers);

  if (!summary) return null;

  const totalCoverageStores =
    (summary.coverageStoresInfo?.visited?.length || 0) +
    (summary.coverageStoresInfo?.unvisited?.length || 0);

  const cards: MetricCardConfig[] = [
    {
      kind: 'coverage',
      icon: <TrendingUp size={19} color="#2563eb" />,
      label: '巡店覆蓋率（區間）',
      value: summary.coverageRate ?? 0,
      unit: '%',
      valueColor: '#2563eb',
      iconBg: '#eff6ff',
      borderTop: '#3b82f6',
      subText: (
        <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
          {regionLabel === 'all' ? '全區' : regionLabel}：已巡視 {summary.coverageStoresInfo?.visited?.length || 0} / {totalCoverageStores} 間
        </span>
      ),
      description:
        '目前所選時間區間內，已實際完成巡視的門市數量，佔該區主管名下總分派負責門市總數的百分比。此指標反映出主管是否有落實對旗下所有店點的走動式管理。',
      storeList: summary.coverageStoresInfo?.visited || [],
      unvisitedList: summary.coverageStoresInfo?.unvisited || [],
    },
    {
      kind: 'pdca',
      icon: <CheckCircle size={19} color="#16a34a" />,
      label: 'PDCA 結案率',
      value: summary.pdcaRate === -1 ? '-' : (summary.pdcaRate ?? 0),
      unit: summary.pdcaRate === -1 ? '' : '%',
      valueColor: '#16a34a',
      iconBg: '#f0fdf4',
      borderTop: '#22c55e',
      description:
        '在巡店過程中被開立需要追蹤改善的項目 (PDCA) 裡，目前狀態已經被主管確認並標記為「Closed (已結案)」的項目比例。結案率越高，代表門市執行力與改善效率越好。',
      storeList: summary.pdcaStoresInfo?.closed || [],
      openPdcaList: summary.pdcaStoresInfo?.open || [],
    },
    {
      kind: 'redLight',
      icon: <AlertTriangle size={19} color="#e11d48" />,
      label: '紅燈預警門市',
      value: summary.redLightStores ?? 0,
      unit: '店',
      valueColor: '#e11d48',
      iconBg: '#fff1f2',
      borderTop: '#f43f5e',
      description:
        '在最近一次的巡店紀錄中，整體綜合評核結果被標記為最危險等級（需重點輔導 / 紅燈）的門市家數。建議高階主管優先調派資源或特別關注這些門市的營運狀況。',
      redLightStoresList: summary.redLightStoresList || [],
    },
    {
      kind: 'visits',
      icon: <ClipboardList size={19} color="#7c3aed" />,
      label: `${periodLabel}回報次數`,
      value: summary.totalVisits,
      unit: '筆',
      valueColor: '#7c3aed',
      iconBg: '#f5f3ff',
      borderTop: '#8b5cf6',
      description: `在所選區間 (${periodLabel}) 系統成功接收到來自前線區主管所送出的「巡店紀錄表單」總筆數。可依下方區域快速篩選並點選門市直接定位觀看明細。`,
      storeList: summary.visitStoresList || [],
    },
    {
      kind: 'abnormal',
      icon: <Zap size={19} color="#d97706" />,
      label: '發現異常事項',
      value: summary.abnormalIssuesCount,
      unit: '項',
      valueColor: '#d97706',
      iconBg: '#fffbeb',
      borderTop: '#f59e0b',
      description:
        '在目前所選時間區間內，所有巡店紀錄表單中，針對細項查核被勾選為「待改善」或是「缺失」的總數累計。此數字越高，代表前線營運流程可能出現較大問題。',
      abnormalStoresList: summary.abnormalStoresList || [],
    },
  ];

  const handleSelectStore = (store: string, recordId?: string) => {
    setActiveCard(null);
    onStoreSelect?.(store, recordId);
  };

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3.5 mb-5">
        {cards.map((card, idx) => (
          <MetricCard
            key={card.kind}
            {...card}
            className={idx === 0 ? 'col-span-2 sm:col-span-1' : ''}
            onClick={() => {
              setCoverageSubTab('visited');
              setPdcaSubTab((card.openPdcaList?.length || 0) > 0 ? 'open' : 'closed');
              setActiveCard(card);
            }}
          />
        ))}
      </div>

      <DetailModal
        open={Boolean(activeCard)}
        onClose={() => setActiveCard(null)}
        maxWidth={620}
        header={
          activeCard && (
            <div className="flex items-center gap-3">
              <div
                className="w-[46px] h-[46px] rounded-xl flex items-center justify-center shrink-0"
                style={{ background: activeCard.iconBg }}
              >
                {React.cloneElement(activeCard.icon, { size: 23 } as Record<string, unknown>)}
              </div>
              <div>
                <h3 className="m-0 text-lg font-bold text-gray-900">{activeCard.label}</h3>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-2xl font-extrabold" style={{ color: activeCard.valueColor }}>
                    {activeCard.value}
                  </span>
                  <span className="text-sm text-gray-500">{activeCard.unit}</span>
                </div>
              </div>
            </div>
          )
        }
      >
        {activeCard && (
          <div className="flex flex-col gap-3.5">
            <div className="bg-gray-50 px-3.5 py-3 rounded-xl border border-gray-200 text-gray-700 text-xs sm:text-sm leading-relaxed">
              {activeCard.description}
            </div>

            {/* 1. 巡店覆蓋率（區間） */}
            {activeCard.kind === 'coverage' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCoverageSubTab('visited')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        coverageSubTab === 'visited'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-blue-50'
                      }`}
                    >
                      ✅ 已巡視門市 ({activeCard.storeList?.length || 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setCoverageSubTab('unvisited')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        coverageSubTab === 'unvisited'
                          ? 'bg-slate-700 text-white border-slate-700 shadow-2xs'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      ⏳ 尚未巡視門市 ({activeCard.unvisitedList?.length || 0})
                    </button>
                  </div>
                  {coverageSubTab === 'visited' && onStoreSelect && (activeCard.storeList?.length || 0) > 0 && (
                    <span className="text-xs text-blue-600 font-semibold">點擊門市自動移至下方細節</span>
                  )}
                </div>

                {coverageSubTab === 'visited' ? (
                  <RegionGroupedStoreTags
                    stores={activeCard.storeList || []}
                    tone="default"
                    emptyText="目前尚無已巡視門市"
                    getRegionInfo={getRegionInfo}
                    onStoreClick={onStoreSelect ? s => handleSelectStore(s) : undefined}
                  />
                ) : (
                  <RegionGroupedStoreTags
                    stores={activeCard.unvisitedList || []}
                    tone="gray"
                    emptyText="太棒了！全數門市皆已完成巡視"
                    getRegionInfo={getRegionInfo}
                  />
                )}
              </div>
            )}

            {/* 2. PDCA 結案率 */}
            {activeCard.kind === 'pdca' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPdcaSubTab('open')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        pdcaSubTab === 'open'
                          ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-amber-50'
                      }`}
                    >
                      ⏳ 待改善／追蹤中 ({activeCard.openPdcaList?.length || 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPdcaSubTab('closed')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        pdcaSubTab === 'closed'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-emerald-50'
                      }`}
                    >
                      ✅ 已結案門市 ({activeCard.storeList?.length || 0})
                    </button>
                  </div>
                  {onStoreSelect && (
                    <span className="text-xs text-blue-600 font-semibold">點擊門市自動移至下方細節</span>
                  )}
                </div>

                {pdcaSubTab === 'open' ? (
                  <RegionGroupedStoreTags
                    stores={activeCard.openPdcaList || []}
                    tone="warning"
                    emptyText="目前無待改善門市"
                    getRegionInfo={getRegionInfo}
                    onStoreClick={onStoreSelect ? s => handleSelectStore(s) : undefined}
                  />
                ) : (
                  <RegionGroupedStoreTags
                    stores={activeCard.storeList || []}
                    tone="default"
                    emptyText="目前無已結案門市"
                    getRegionInfo={getRegionInfo}
                    onStoreClick={onStoreSelect ? s => handleSelectStore(s) : undefined}
                  />
                )}
              </div>
            )}

            {/* 3. 紅燈預警門市 */}
            {activeCard.kind === 'redLight' && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-gray-700">
                  <span>紅燈門市與原因（共 {activeCard.redLightStoresList?.length || 0} 間）</span>
                  {onStoreSelect && (activeCard.redLightStoresList?.length || 0) > 0 && (
                    <span className="text-xs text-blue-600 font-semibold">點擊門市自動移至下方細節</span>
                  )}
                </div>
                <RegionGroupedStoreCards
                  items={(activeCard.redLightStoresList || []).map(item => ({
                    name: item.store,
                    reasons: item.reasons,
                    reportTime: item.reportTime,
                    recordId: item.recordId,
                  }))}
                  tone="danger"
                  getRegionInfo={getRegionInfo}
                  onItemClick={onStoreSelect ? item => handleSelectStore(item.name, item.recordId) : undefined}
                />
              </div>
            )}

            {/* 4. 發現異常事項 */}
            {activeCard.kind === 'abnormal' && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-gray-700">
                  <span>相關異常門市清單（共 {activeCard.abnormalStoresList?.length || 0} 間）</span>
                  {onStoreSelect && (activeCard.abnormalStoresList?.length || 0) > 0 && (
                    <span className="text-xs text-blue-600 font-semibold">點擊門市自動移至下方細節</span>
                  )}
                </div>
                <RegionGroupedStoreCards
                  items={(activeCard.abnormalStoresList || []).map(item => ({
                    name: item.store,
                    reasons: item.reasons,
                    reportTime: item.reportTime,
                    recordId: item.recordId,
                  }))}
                  tone="warning"
                  getRegionInfo={getRegionInfo}
                  onItemClick={onStoreSelect ? item => handleSelectStore(item.name, item.recordId) : undefined}
                />
              </div>
            )}

            {/* 5. 區間回報次數 */}
            {activeCard.kind === 'visits' && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between flex-wrap gap-1 text-xs sm:text-sm font-bold text-gray-700">
                  <span>已回報門市分區清單（共 {activeCard.storeList?.length || 0} 間門市）</span>
                  {onStoreSelect && (activeCard.storeList?.length || 0) > 0 && (
                    <span className="text-xs text-blue-600 font-semibold">點擊門市自動移至下方細節 ➔</span>
                  )}
                </div>
                <RegionGroupedStoreTags
                  stores={activeCard.storeList || []}
                  tone="default"
                  emptyText="目前無門市紀錄"
                  getRegionInfo={getRegionInfo}
                  onStoreClick={onStoreSelect ? s => handleSelectStore(s) : undefined}
                />
              </div>
            )}
          </div>
        )}
      </DetailModal>
    </>
  );
};
