import React from 'react';
import type { DashboardSummary } from '../types';
import { TrendingUp, CheckCircle, AlertTriangle, ClipboardList, Zap } from 'lucide-react';

interface Props {
  summary: DashboardSummary | null;
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  valueColor: string;
  iconBg: string;
  borderTop: string;
  trend?: string;
  trendColor?: string;
  description?: string;
  storeList?: string[];
  unvisitedList?: string[];
  openPdcaList?: string[];
  redLightStoresList?: { store: string; reasons: string[]; reportTime?: string }[];
  abnormalStoresList?: { store: string; reasons: string[]; reportTime?: string }[];
  subText?: React.ReactNode;
  onClick?: () => void;
}

const StoreTag: React.FC<{ store: string; type?: 'default' | 'danger' | 'warning' | 'gray' }> = ({ store, type = 'default' }) => {
  let bg = '#f3f4f6';
  let color = '#4b5563';
  let border = '#d1d5db';
  if (type === 'danger') { bg = '#fef2f2'; color = '#b91c1c'; border = '#fca5a5'; }
  if (type === 'warning') { bg = '#fffbeb'; color = '#b45309'; border = '#fcd34d'; }
  if (type === 'gray') { bg = '#f9fafb'; color = '#9ca3af'; border = '#e5e7eb'; }

  return (
    <span style={{
      fontSize: '0.75rem',
      fontWeight: 500,
      color, background: bg, border: `1px solid ${border}`,
      padding: '2px 8px', borderRadius: '6px',
      display: 'inline-block'
    }}>
      {store}
    </span>
  );
};

const MetricCard: React.FC<MetricCardProps> = ({
  icon, label, value, unit, valueColor, iconBg, borderTop, trend, trendColor, subText, onClick
}) => (
  <div
    onClick={onClick}
    style={{
      background: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      borderTop: `3px solid ${borderTop}`,
      padding: '20px 22px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      transition: 'box-shadow 0.15s, transform 0.15s',
      cursor: 'pointer',
    }}
    onMouseEnter={e => {
      (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.09)';
      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={e => {
      (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.05)';
      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
    }}
  >
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
      <div style={{
        width: '38px', height: '38px',
        background: iconBg,
        borderRadius: '10px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      {trend && (
        <span style={{
          fontSize: '0.7rem', fontWeight: 600,
          color: trendColor || '#16a34a',
          background: trendColor === '#e11d48' ? '#fff1f2' : '#f0fdf4',
          border: `1px solid ${trendColor === '#e11d48' ? '#fecdd3' : '#bbf7d0'}`,
          borderRadius: '99px', padding: '2px 8px',
        }}>{trend}</span>
      )}
    </div>

    <div style={{ color: '#6b7280', fontSize: '0.78rem', fontWeight: 500, letterSpacing: '0.03em', marginBottom: '6px' }}>
      {label}
    </div>

    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
      <span style={{
        fontSize: '2.4rem',
        fontWeight: 800,
        color: valueColor,
        lineHeight: 1,
        letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
      {unit && (
        <span style={{ fontSize: '0.95rem', fontWeight: 500, color: '#9ca3af' }}>
          {unit}
        </span>
      )}
    </div>
    {subText && (
      <div style={{ marginTop: '6px', fontSize: '0.85rem', color: '#6b7280', fontWeight: 600 }}>
        {subText}
      </div>
    )}
  </div>
);

export const SummaryCards: React.FC<Props & { regionLabel?: string }> = ({ summary, regionLabel = '全區' }) => {
  const [activeCard, setActiveCard] = React.useState<MetricCardProps | null>(null);

  if (!summary) return null;
  
  const totalCoverageStores = (summary.coverageStoresInfo?.visited?.length || 0) + (summary.coverageStoresInfo?.unvisited?.length || 0);

  const cards: MetricCardProps[] = [
    {
      icon: <TrendingUp size={19} color="#2563eb" />,
      label: '巡店覆蓋率（區間）',
      value: summary.coverageRate ?? 0,
      unit: '%',
      valueColor: '#2563eb',
      iconBg: '#eff6ff',
      borderTop: '#3b82f6',
      subText: (
        <span style={{ color: '#3b82f6', background: '#eff6ff', padding: '2px 8px', borderRadius: '4px' }}>
          {regionLabel === 'all' ? '全區' : regionLabel}：已巡視 {summary.coverageStoresInfo?.visited?.length || 0} / {totalCoverageStores} 間
        </span>
      ),
      description: '目前所選時間區間內，已實際完成巡視的門市數量，佔該區主管名下總分派負責門市總數的百分比。此指標反映出主管是否有落實對旗下所有店點的走動式管理。',
      storeList: summary.coverageStoresInfo?.visited || [],
      unvisitedList: summary.coverageStoresInfo?.unvisited || [],
    },
    {
      icon: <CheckCircle size={19} color="#16a34a" />,
      label: 'PDCA 結案率',
      value: summary.pdcaRate === -1 ? '-' : (summary.pdcaRate ?? 0),
      unit: summary.pdcaRate === -1 ? '' : '%',
      valueColor: '#16a34a',
      iconBg: '#f0fdf4',
      borderTop: '#22c55e',
      description: '在巡店過程中被開立需要追蹤改善的項目 (PDCA) 裡，目前狀態已經被主管確認並標記為「Closed (已結案)」的項目比例。結案率越高，代表門市執行力與改善效率越好。',
      storeList: summary.pdcaStoresInfo?.closed || [],
      openPdcaList: summary.pdcaStoresInfo?.open || [],
    },
    {
      icon: <AlertTriangle size={19} color="#e11d48" />,
      label: '紅燈預警門市',
      value: summary.redLightStores ?? 0,
      unit: '店',
      valueColor: '#e11d48',
      iconBg: '#fff1f2',
      borderTop: '#f43f5e',
      description: '在最近一次的巡店紀錄中，整體綜合評核結果被標記為最危險等級（需重點輔導 / 紅燈）的門市家數。建議高階主管優先調派資源或特別關注這些門市的營運狀況。',
      redLightStoresList: summary.redLightStoresList || [],
    },
    {
      icon: <ClipboardList size={19} color="#7c3aed" />,
      label: '今日回報次數',
      value: summary.totalVisits,
      unit: '筆',
      valueColor: '#7c3aed',
      iconBg: '#f5f3ff',
      borderTop: '#8b5cf6',
      description: '在今日 (00:00~23:59) 系統成功接收到來自前線區主管所送出的「巡店紀錄表單」的總筆數。',
      storeList: summary.visitStoresList || [],
    },
    {
      icon: <Zap size={19} color="#d97706" />,
      label: '發現異常事項',
      value: summary.abnormalIssuesCount,
      unit: '項',
      valueColor: '#d97706',
      iconBg: '#fffbeb',
      borderTop: '#f59e0b',
      description: '在目前所選時間區間內，所有巡店紀錄表單中，針對細項查核被勾選為「待改善」或是「缺失」的總數累計。此數字越高，代表前線營運流程可能出現較大問題。',
      abnormalStoresList: summary.abnormalStoresList || [],
    },
  ];

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
        gap: '14px',
        marginBottom: '22px',
      }}>
        {cards.map((card, idx) => (
          <MetricCard key={idx} {...card} onClick={() => setActiveCard(card)} />
        ))}
      </div>

      {activeCard && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          animation: 'fadeIn 0.2s ease-out'
        }} onClick={() => setActiveCard(null)}>
          <div style={{
            background: '#fff',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '450px',
            width: '90%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            position: 'relative'
          }} onClick={e => e.stopPropagation()}>
            <button 
              onClick={() => setActiveCard(null)}
              style={{
                position: 'absolute', top: '16px', right: '16px',
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#9ca3af', fontSize: '1.2rem'
              }}
            >
              ✕
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{
                width: '48px', height: '48px',
                background: activeCard.iconBg,
                borderRadius: '12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {React.cloneElement(activeCard.icon as React.ReactElement, { size: 24 } as any)}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#111827', fontWeight: 700 }}>{activeCard.label}</h3>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginTop: '4px' }}>
                  <span style={{ fontSize: '1.5rem', fontWeight: 800, color: activeCard.valueColor }}>{activeCard.value}</span>
                  <span style={{ fontSize: '1rem', color: '#6b7280' }}>{activeCard.unit}</span>
                </div>
              </div>
            </div>
            <div style={{
              background: '#f9fafb',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              color: '#374151',
              fontSize: '0.95rem',
              lineHeight: 1.6,
              marginBottom: '16px'
            }}>
              {activeCard.description}
            </div>

            {/* Store List Section */}
            <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {/* Coverage special case: Visited vs Unvisited */}
              {activeCard.label === '巡店覆蓋率（區間）' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>已巡視門市 ({activeCard.storeList?.length || 0})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {activeCard.storeList?.map(s => <StoreTag key={s} store={s} type="default" />)}
                      {(!activeCard.storeList || activeCard.storeList.length === 0) && <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>無資料</span>}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>尚未巡視門市 ({activeCard.unvisitedList?.length || 0})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {activeCard.unvisitedList?.map(s => <StoreTag key={s} store={s} type="gray" />)}
                      {(!activeCard.unvisitedList || activeCard.unvisitedList.length === 0) && <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>無資料</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* PDCA special case: Closed vs Open */}
              {activeCard.label === 'PDCA 結案率' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>已結案門市 ({activeCard.storeList?.length || 0})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {activeCard.storeList?.map(s => <StoreTag key={s} store={s} type="default" />)}
                      {(!activeCard.storeList || activeCard.storeList.length === 0) && <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>無資料</span>}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>待改善/追蹤中門市 ({activeCard.openPdcaList?.length || 0})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {activeCard.openPdcaList?.map(s => <StoreTag key={s} store={s} type="warning" />)}
                      {(!activeCard.openPdcaList || activeCard.openPdcaList.length === 0) && <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>無資料</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* Red Light special case: Stores with Reasons */}
              {activeCard.label === '紅燈預警門市' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>紅燈門市與原因 ({activeCard.redLightStoresList?.length || 0})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {activeCard.redLightStoresList?.map(item => (
                      <div key={item.store} style={{ background: '#fef2f2', border: '1px solid #fca5a5', padding: '10px 14px', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <div style={{ fontWeight: 600, color: '#b91c1c', fontSize: '0.9rem' }}>{item.store}</div>
                          {item.reportTime && (
                            <div style={{ fontSize: '0.75rem', color: '#991b1b', background: '#fee2e2', padding: '2px 6px', borderRadius: '4px' }}>
                              回報時間: {item.reportTime}
                            </div>
                          )}
                        </div>
                        <ul style={{ margin: 0, paddingLeft: '18px', color: '#7f1d1d', fontSize: '0.8rem', lineHeight: '1.4' }}>
                          {item.reasons.map((r, i) => <li key={i} style={{ marginBottom: '2px' }}>{r}</li>)}
                        </ul>
                      </div>
                    ))}
                    {(!activeCard.redLightStoresList || activeCard.redLightStoresList.length === 0) && <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>目前無門市紀錄</span>}
                  </div>
                </div>
              )}

              {/* Abnormal Issues special case: Stores with Reasons */}
              {activeCard.label === '發現異常事項' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>相關異常門市清單 ({activeCard.abnormalStoresList?.length || 0})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {activeCard.abnormalStoresList?.map(item => (
                      <div key={item.store} style={{ background: '#fffbeb', border: '1px solid #fcd34d', padding: '10px 14px', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <div style={{ fontWeight: 600, color: '#b45309', fontSize: '0.9rem' }}>{item.store}</div>
                          {item.reportTime && (
                            <div style={{ fontSize: '0.75rem', color: '#92400e', background: '#fef3c7', padding: '2px 6px', borderRadius: '4px' }}>
                              回報時間: {item.reportTime}
                            </div>
                          )}
                        </div>
                        <ul style={{ margin: 0, paddingLeft: '18px', color: '#92400e', fontSize: '0.8rem', lineHeight: '1.4' }}>
                          {item.reasons.map((r, i) => <li key={i} style={{ marginBottom: '2px' }}>{r}</li>)}
                        </ul>
                      </div>
                    ))}
                    {(!activeCard.abnormalStoresList || activeCard.abnormalStoresList.length === 0) && <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>目前無門市紀錄</span>}
                  </div>
                </div>
              )}

              {/* Default List Rendering for others */}
              {activeCard.label !== '巡店覆蓋率（區間）' && activeCard.label !== 'PDCA 結案率' && activeCard.label !== '紅燈預警門市' && activeCard.label !== '發現異常事項' && (
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>相關門市清單 ({activeCard.storeList?.length || 0})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {activeCard.storeList?.map(s => <StoreTag key={s} store={s} type={activeCard.label === '紅燈預警門市' ? 'danger' : 'default'} />)}
                    {(!activeCard.storeList || activeCard.storeList.length === 0) && <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>目前無門市紀錄</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
