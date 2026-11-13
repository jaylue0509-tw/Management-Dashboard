import React, { useState, useEffect, useMemo } from 'react';
import type { VisitRecord } from '../types';
import { MapPin, Clock, AlertCircle, Star, Camera, ArrowRight, X, Calendar, CheckCircle2, ChevronDown, ChevronUp, Tag, ClipboardCheck, Search, Compass } from 'lucide-react';
import { formatTaipeiReportTime, formatTimeAgo, getMinutesAgo } from '../utils/time-utils';

export type ActivityCategoryFilter = 'all' | 'store' | 'abnormal' | 'normal' | 'photo' | 'schedule';

export interface Props {
  activities: VisitRecord[];
  actionItems?: any[];
  focusedRecord?: { id: string; ts: number } | null;
  externalFilter?: { category: ActivityCategoryFilter; ts: number } | null;
  onEditActivity?: (activity: VisitRecord) => void;
  canEditActivity?: (activity: VisitRecord) => boolean;
}

const ITEM_NAMES: Record<string, string> = {
  'core-1': '環境異味與清潔', 'core-2': '櫃檯焦點陳列', 'core-3': '人員狀態與迎賓',
  '1-1': '檔期 POP 與宣傳物', '1-2': '主題陳列與佈置', '1-3': '檔期主打商品備貨', '1-4': '結帳區加價購專區',
  '2-1': '排面平整與拉面', '2-2': '效期與先進先出', '2-3': '臨期品與損耗處置', '2-4': '高單價與高損品防竊', '2-5': 'PB 與高毛利商品陳列',
  '3-1': '美容房環境與衛生', '3-2': '美容操作 SOP 與安全', '3-3': '活體照護與環境', '3-4': '保健/醫療專區維護',
  '4-1': '儀容儀態與招呼', '4-2': '專業導購與衛教', '4-3': '櫃檯結帳與附加銷售',
  '5-1': '門面與整體環境清潔', '5-2': '賣場氣氛與燈光空調', '5-3': '後勤倉庫與公安動線', '5-4': '系統與設備安全運作',
  '6-1': '業績與 KPI 指標跟進', '6-2': '人員 1-on-1 面談紀錄', '6-3': '團隊士氣與排班合理性'
};

const resolvePhotoUrl = (url?: string): string => {
  if (!url) return '';
  if (url.startsWith('/api/')) {
    return import.meta.env.PROD ? url : `https://management-dashboard-rust.vercel.app${url}`;
  }
  return url;
};

/**
 * 判斷單筆巡店紀錄是否含有異常或缺失
 */
const checkActivityAbnormal = (activity: VisitRecord): boolean => {
  const isSpecialSchedule = ['總部行程', '會議行程', '特殊行程'].includes(activity.actionType || '');
  if (isSpecialSchedule) return false;

  const coreAbnormals = (activity as any).coreChecks
    ? Object.entries((activity as any).coreChecks).filter(([_, val]) => val === '缺失')
    : [];
  const categoryAbnormals = (activity as any).categoryChecks
    ? Object.entries((activity as any).categoryChecks).filter(([_, val]) => val === '缺失' || val === '待改善')
    : [];
  if (coreAbnormals.length > 0 || categoryAbnormals.length > 0) return true;

  if (activity.immediateImprovement) {
    const lines = activity.immediateImprovement.split('\n').filter(line => line.trim() && !line.includes('紀錄缺失項目'));
    for (const line of lines) {
      const sepIdx = line.indexOf('：') !== -1 ? line.indexOf('：') : line.indexOf(':');
      const hasSep = sepIdx !== -1;
      const title = hasSep ? line.substring(0, sepIdx).trim() : line;
      const content = hasSep ? line.substring(sepIdx + 1).trim() : '';
      const isNeutral = title.includes('姓名') || title.includes('簽名') || title.includes('反饋') || title.includes('店名');
      const isOk = hasSep
        ? (!content || content === '無' || content === '無缺失' || content === '正常')
        : (title === '無' || title === '無缺失' || title === '正常');
      if (!isNeutral && !isOk) return true;
    }
  }
  return false;
};

export const ActivityWall: React.FC<Props> = ({
  activities,
  actionItems = [],
  focusedRecord,
  externalFilter,
  onEditActivity,
  canEditActivity,
}) => {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxPair, setLightboxPair] = useState<{ beforeUrl: string; afterUrl: string; mode: 'before' | 'after' | 'compare' } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState<boolean>(false);
  const [categoryFilter, setCategoryFilter] = useState<ActivityCategoryFilter>('all');
  const [regionFilter, setRegionFilter] = useState<string>('全部');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (focusedRecord?.id) {
      // 當外部點選指定門市或行程時，自動解除可能隱藏該筆紀錄的篩選並展開細節
      setCategoryFilter('all');
      setRegionFilter('全部');
      setSearchQuery('');
      setExpandedId(focusedRecord.id);
    }
  }, [focusedRecord]);

  useEffect(() => {
    if (externalFilter) {
      setCategoryFilter(externalFilter.category);
      setRegionFilter('全部');
    }
  }, [externalFilter]);

  // 按下 Escape 鍵快速關閉照片放大燈箱
  useEffect(() => {
    if (!lightboxImage && !lightboxPair) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxImage(null);
        setLightboxPair(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImage, lightboxPair]);

  const toggleExpand = (id: string) => {
    setExpandAll(false);
    setExpandedId(prev => prev === id ? null : id);
  };

  // 各分類統計數字（連動按鈕）
  const categoryCounts = useMemo(() => {
    let store = 0;
    let abnormal = 0;
    let normal = 0;
    let photo = 0;
    let schedule = 0;
    for (const act of activities) {
      const isSch = ['總部行程', '會議行程', '特殊行程'].includes(act.actionType || '');
      const isAbn = checkActivityAbnormal(act);
      const hasPh = (act.photoPairs || []).some(p => p && (p.beforeUrl || p.afterUrl));
      if (isSch) {
        schedule++;
      } else {
        store++;
        if (isAbn) abnormal++;
        else normal++;
      }
      if (hasPh) photo++;
    }
    return {
      all: activities.length,
      store,
      abnormal,
      normal,
      photo,
      schedule,
    };
  }, [activities]);

  // 區域統計清單
  const regionStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const act of activities) {
      const reg = act.region?.trim();
      if (reg) {
        map.set(reg, (map.get(reg) || 0) + 1);
      }
    }
    return Array.from(map.entries()).map(([region, count]) => ({ region, count }));
  }, [activities]);

  // 過濾後的動態清單
  const displayedActivities = useMemo(() => {
    return activities.filter(act => {
      const isSch = ['總部行程', '會議行程', '特殊行程'].includes(act.actionType || '');
      const isAbn = checkActivityAbnormal(act);
      const hasPh = (act.photoPairs || []).some(p => p && (p.beforeUrl || p.afterUrl));

      if (categoryFilter === 'store' && isSch) return false;
      if (categoryFilter === 'schedule' && !isSch) return false;
      if (categoryFilter === 'abnormal' && (!(!isSch && isAbn))) return false;
      if (categoryFilter === 'normal' && (!(!isSch && !isAbn))) return false;
      if (categoryFilter === 'photo' && !hasPh) return false;

      if (regionFilter !== '全部' && act.region !== regionFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${act.storeName || ''} ${act.areaManagerName || ''} ${act.region || ''} ${act.actionType || ''} ${act.immediateImprovement || ''} ${act.highlightDescription || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activities, categoryFilter, regionFilter, searchQuery]);

  const jumpToActivityCard = (recordId: string) => {
    setExpandedId(recordId);
    setTimeout(() => {
      const el = document.getElementById(`activity-${recordId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.4), 0 8px 24px rgba(37, 99, 235, 0.18)';
        setTimeout(() => {
          el.style.boxShadow = '';
        }, 1800);
      }
    }, 60);
  };

  return (
    <div id="section-activity-wall">
      {/* Section Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <ClipboardCheck size={18} color="#2563eb" />
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#111827' }}>
          即時巡店動態
        </h2>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {displayedActivities.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setExpandAll(prev => !prev);
                setExpandedId(null);
              }}
              className="text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full px-3 py-1 cursor-pointer transition-colors"
            >
              {expandAll ? '▲ 全部收合' : '▼ 全部展開細節'}
            </button>
          )}
          <span style={{
            fontSize: '0.72rem', fontWeight: 600,
            color: '#6b7280',
            background: '#f3f4f6',
            border: '1px solid #e5e7eb',
            borderRadius: '99px',
            padding: '2px 10px',
          }}>
            顯示 {displayedActivities.length} / {activities.length} 筆
          </span>
        </div>
      </div>

      {/* 動態牆多維度快速索引與篩選面板 */}
      {activities.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-3 sm:p-3.5 mb-3.5 shadow-2xs space-y-2.5">
          {/* 第一列：狀態與類型數字連動索引 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {([
              { key: 'all', label: '全部紀錄', count: categoryCounts.all, activeClass: 'bg-gray-900 text-white border-gray-900' },
              { key: 'store', label: '🏪 門市巡檢', count: categoryCounts.store, activeClass: 'bg-blue-600 text-white border-blue-600' },
              { key: 'abnormal', label: '🔴 發現異常', count: categoryCounts.abnormal, activeClass: 'bg-rose-600 text-white border-rose-600' },
              { key: 'normal', label: '🟢 正常合格', count: categoryCounts.normal, activeClass: 'bg-emerald-600 text-white border-emerald-600' },
              { key: 'photo', label: '📸 含照片', count: categoryCounts.photo, activeClass: 'bg-purple-600 text-white border-purple-600' },
              { key: 'schedule', label: '🏢 公務行程', count: categoryCounts.schedule, activeClass: 'bg-indigo-600 text-white border-indigo-600' },
            ] as const).map(tab => {
              const active = categoryFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setCategoryFilter(active && tab.key !== 'all' ? 'all' : tab.key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                    active
                      ? `${tab.activeClass} shadow-xs`
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[11px] font-extrabold ${active ? 'bg-white/20 text-white' : 'bg-white text-gray-600'}`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}

            {/* 搜尋輸入框 */}
            <div className="relative flex-1 min-w-[160px] ml-auto">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜尋門市、主管或缺失內容..."
                className="w-full pl-7 pr-6 py-1 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* 第二列：區域快速索引（當有多個區域時顯示） */}
          {regionStats.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1.5 border-t border-gray-100">
              <span className="text-[11px] font-bold text-gray-400 mr-1">區域索引：</span>
              <button
                type="button"
                onClick={() => setRegionFilter('全部')}
                className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-colors cursor-pointer ${
                  regionFilter === '全部'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                全部區域 ({activities.length})
              </button>
              {regionStats.map(r => (
                <button
                  key={r.region}
                  type="button"
                  onClick={() => setRegionFilter(regionFilter === r.region ? '全部' : r.region)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-colors cursor-pointer ${
                    regionFilter === r.region
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50'
                  }`}
                >
                  {r.region} ({r.count})
                </button>
              ))}
            </div>
          )}

          {/* 第三列：已巡門市／公務行程一鍵跳轉索引 */}
          {displayedActivities.length > 1 && (
            <div className="pt-1.5 border-t border-gray-100">
              <div className="flex items-center gap-1 text-[11px] font-bold text-gray-500 mb-1.5">
                <Compass size={12} className="text-blue-600" />
                <span>門市／行程快速定位索引（點選直接跳至該筆明細並展開）：</span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                {displayedActivities.map(act => {
                  const isSch = ['總部行程', '會議行程', '特殊行程'].includes(act.actionType || '');
                  const isAbn = checkActivityAbnormal(act);
                  const isCurrExpanded = expandAll || expandedId === act.recordId;
                  return (
                    <button
                      key={act.recordId}
                      type="button"
                      onClick={() => jumpToActivityCard(act.recordId)}
                      className={`text-xs px-2.5 py-1 rounded-lg font-semibold border transition-all cursor-pointer flex items-center gap-1 ${
                        isCurrExpanded
                          ? 'ring-2 ring-blue-500 bg-blue-50 text-blue-800 border-blue-300'
                          : isSch
                          ? 'bg-indigo-50/70 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                          : isAbn
                          ? 'bg-rose-50/80 text-rose-700 border-rose-200 hover:bg-rose-100'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-blue-50 hover:text-blue-700'
                      }`}
                    >
                      <span>{isSch ? '🏢' : isAbn ? '🔴' : '🟢'}</span>
                      <span>
                        {isSch ? `${act.areaManagerName}·${act.actionType}` : act.storeName}
                      </span>
                      <span className="text-[10px] opacity-70">➔</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activity Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {displayedActivities.map((activity) => {
          const isExpanded = expandAll || expandedId === activity.recordId;
          const relatedItems = actionItems.filter(
            ai =>
              (ai.visitRecordId === activity.recordId || ai.sourceRecordId === activity.recordId) &&
              !ai.desc?.includes('測試') &&
              !ai.issueDescription?.includes('測試')
          );
          const validPhotoPairs = (activity.photoPairs || [])
            .filter(p => p && (p.beforeUrl || p.afterUrl))
            .map(p => ({
              beforeUrl: resolvePhotoUrl(p.beforeUrl),
              afterUrl: resolvePhotoUrl(p.afterUrl),
            }));
          
          const coreAbnormals = (activity as any).coreChecks
            ? Object.entries((activity as any).coreChecks).filter(([_, val]) => val === '缺失')
            : [];
          const categoryAbnormals = (activity as any).categoryChecks 
            ? Object.entries((activity as any).categoryChecks).filter(([_, val]) => val === '缺失' || val === '待改善')
            : [];
          const abnormalChecks = [...coreAbnormals, ...categoryAbnormals];
          const passedCoreChecks = (activity as any).coreChecks
            ? Object.entries((activity as any).coreChecks).filter(([_, val]) => val === '合格')
            : [];
          const passedCategoryChecks = (activity as any).categoryChecks
            ? Object.entries((activity as any).categoryChecks).filter(([_, val]) => val === '合格')
            : [];
          const passedChecks = [...passedCoreChecks, ...passedCategoryChecks];
            
          let hasRealDefectInNotes = false;
          if (activity.immediateImprovement) {
            const lines = activity.immediateImprovement.split('\n').filter(line => line.trim() && !line.includes('紀錄缺失項目'));
            for (const line of lines) {
              const sepIdx = line.indexOf('：') !== -1 ? line.indexOf('：') : line.indexOf(':');
              const hasSep = sepIdx !== -1;
              const title = hasSep ? line.substring(0, sepIdx).trim() : line;
              const content = hasSep ? line.substring(sepIdx + 1).trim() : '';
              
              const isNeutral = title.includes('姓名') || title.includes('簽名') || title.includes('反饋') || title.includes('店名');
              const isOk = hasSep
                ? (!content || content === '無' || content === '無缺失' || content === '正常')
                : (title === '無' || title === '無缺失' || title === '正常');
                
              if (!isNeutral && !isOk) {
                hasRealDefectInNotes = true;
                break;
              }
            }
          }
          const isSpecialSchedule = ['總部行程', '會議行程', '特殊行程'].includes(activity.actionType || '');
          const isAbnormal = !isSpecialSchedule && (abnormalChecks.length > 0 || hasRealDefectInNotes);
            
          const hasDetail = !isSpecialSchedule || !!(activity.immediateImprovement || activity.highlightDescription || relatedItems.length > 0 || abnormalChecks.length > 0 || validPhotoPairs.length > 0);
          const accentColor = isSpecialSchedule ? '#6366f1' : isAbnormal ? '#e11d48' : '#3b82f6';

          return (
            <div
              key={activity.recordId}
              id={`activity-${activity.recordId}`}
              style={{
                background: '#ffffff',
                borderRadius: '12px',
                border: `1px solid ${isExpanded ? '#bfdbfe' : '#e5e7eb'}`,
                borderLeft: `4px solid ${accentColor}`,
                boxShadow: isExpanded ? '0 4px 16px rgba(59,130,246,0.1)' : '0 1px 3px rgba(0,0,0,0.05)',
                overflow: 'hidden',
                transition: 'all 0.2s',
              }}
            >
              {/* Card Header */}
              <div
                style={{ padding: '14px 16px', cursor: hasDetail ? 'pointer' : 'default' }}
                onClick={() => hasDetail && toggleExpand(activity.recordId)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  {/* Left Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Manager Name & Action Type */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '7px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#111827' }}>
                        {activity.areaManagerName || '未知主管'}
                      </span>
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 500,
                        color: '#6b7280',
                        background: '#f3f4f6',
                        border: '1px solid #e5e7eb',
                        borderRadius: '5px', padding: '1px 6px',
                      }}>
                        {activity.jobTitle || '區主管'}
                      </span>
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 600,
                        color: '#2563eb',
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '5px', padding: '1px 6px',
                      }}>
                        {activity.actionType || '實地巡店'}
                      </span>
                      {activity.auditMode && (
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 600,
                          color: '#7c3aed',
                          background: '#f5f3ff',
                          border: '1px solid #ddd6fe',
                          borderRadius: '5px', padding: '1px 6px',
                        }}>
                          模式 {activity.auditMode}
                        </span>
                      )}
                    </div>

                    {/* Location & Duration Row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#374151', fontSize: '0.82rem' }}>
                        <MapPin size={12} color="#3b82f6" />
                        <span style={{ fontWeight: 500 }}>{activity.storeName || '未知門市'}</span>
                        {activity.region && (
                          <span style={{ color: '#9ca3af' }}>（{activity.region}）</span>
                        )}
                      </div>

                      {activity.expectedStayMinutes > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#0f766e', fontSize: '0.78rem', fontWeight: 600 }}>
                          <Clock size={11} />
                          預計時數：{activity.expectedStayMinutes >= 60 && activity.expectedStayMinutes % 60 === 0
                            ? `${activity.expectedStayMinutes / 60} 小時`
                            : activity.expectedStayMinutes > 60
                            ? `${Math.floor(activity.expectedStayMinutes / 60)} 小時 ${activity.expectedStayMinutes % 60} 分鐘`
                            : `${activity.expectedStayMinutes} 分鐘`}
                        </div>
                      )}

                      {activity.overallRating && (
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 600,
                          padding: '2px 8px', borderRadius: '99px',
                          ...(activity.overallRating === '需重點輔導'
                            ? { color: '#e11d48', background: '#fff1f2', border: '1px solid #fecdd3' }
                            : { color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0' }
                          )
                        }}>
                          {activity.overallRating}
                        </span>
                      )}
                    </div>

                    {isSpecialSchedule && activity.highlightDescription && (
                      <div style={{
                        marginTop: '8px',
                        padding: '7px 11px',
                        background: '#eef2ff',
                        border: '1px solid #c7d2fe',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: '#3730a3',
                      }}>
                        📋 任務說明：{activity.highlightDescription}
                      </div>
                    )}

                    {/* Tags */}
                    {(activity.tags?.length > 0 || isAbnormal || validPhotoPairs.length > 0) && (
                      <div style={{ display: 'flex', gap: '5px', marginTop: '8px', flexWrap: 'wrap' }}>
                        {activity.tags?.filter(t => t !== '發現異常' && t !== '異常發現').map(tag => (
                          <span key={tag} style={{
                            fontSize: '0.68rem', fontWeight: 500,
                            color: '#6b7280',
                            background: '#f9fafb',
                            border: '1px solid #e5e7eb',
                            borderRadius: '99px', padding: '1px 8px',
                            display: 'flex', alignItems: 'center', gap: '3px',
                          }}>
                            <Tag size={8} />
                            {tag}
                          </span>
                        ))}
                        {isAbnormal && (
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 600,
                            color: '#e11d48',
                            background: '#fff1f2',
                            border: '1px solid #fecdd3',
                            borderRadius: '99px', padding: '1px 8px',
                            display: 'flex', alignItems: 'center', gap: '3px',
                          }}>
                            <AlertCircle size={8} />
                            異常發現
                          </span>
                        )}
                        {validPhotoPairs.length > 0 && (
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 600,
                            color: '#7c3aed',
                            background: '#f5f3ff',
                            border: '1px solid #ddd6fe',
                            borderRadius: '99px', padding: '1px 8px',
                            display: 'flex', alignItems: 'center', gap: '3px',
                          }}>
                            <Camera size={9} />
                            改善前後照片 ({validPhotoPairs.length} 組)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: Time & Expand */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.72rem', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={10} />
                      {formatTimeAgo(activity.timeAgoMinutes ?? getMinutesAgo(activity.createdAt))}
                    </div>
                    {activity.createdAt && (
                      <div style={{ fontSize: '0.68rem', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Calendar size={9} />
                        <span>{formatTaipeiReportTime(activity.createdAt)}</span>
                        {(activity as any).isBackfilled && (
                          <span style={{
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            color: '#b45309',
                            background: '#fef3c7',
                            border: '1px solid #fde68a',
                            borderRadius: '4px',
                            padding: '0 4px',
                          }}>
                            補登
                          </span>
                        )}
                      </div>
                    )}
                    {onEditActivity && (!canEditActivity || canEditActivity(activity)) && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          onEditActivity(activity);
                        }}
                        className="mt-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white border border-indigo-200 transition-all cursor-pointer flex items-center gap-1"
                        title="修改此筆當日活動／行程內容"
                      >
                        <span>✏️ 修改活動內容</span>
                      </button>
                    )}
                    {hasDetail && (
                      <div style={{ color: '#9ca3af', marginTop: '2px' }}>
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Expandable Detail Section */}
              {isExpanded && hasDetail && (
                <div style={{
                  borderTop: '1px solid #f3f4f6',
                  padding: '18px 16px',
                  background: '#fafafa',
                  display: 'flex', flexDirection: 'column', gap: '18px',
                }}>

                  {/* Abnormal Checks from categoryChecks */}
                  {abnormalChecks.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                        <AlertCircle size={14} color="#e11d48" />
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#111827' }}>六大模組異常細項</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {abnormalChecks.map(([key, status]) => {
                          let reasonText = ITEM_NAMES[key];
                          if (!reasonText) {
                            if (/^\d-\d+$/.test(key)) {
                              const mod = parseInt(key.split('-')[0]);
                              const mapping = ['行銷檔期', '陳列損耗', '寵物專業', '人員服務', '環境設備', '經營數據'];
                              const catName = mapping[mod - 1] || '未知模組';
                              reasonText = `其他${catName}異常`;
                            } else {
                              reasonText = `自訂異常: ${key}`;
                            }
                          }
                          const remark = (activity as any).categoryRemarks?.[key];
                          return (
                            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '6px', padding: '8px 12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#e11d48', flexShrink: 0 }} />
                                <span style={{ fontSize: '0.8rem', color: '#be123c', fontWeight: 600 }}>{reasonText}</span>
                                <span style={{ fontSize: '0.7rem', color: '#e11d48', background: '#ffe4e6', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>{status as string}</span>
                              </div>
                              {remark && (
                                <div style={{ fontSize: '0.78rem', color: '#881337', paddingLeft: '14px', lineHeight: 1.5 }}>
                                  說明：{remark}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Improvement Notes Table */}
                  {activity.immediateImprovement && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                        <div style={{ width: '3px', height: '14px', background: 'linear-gradient(180deg,#3b82f6,#6366f1)', borderRadius: '99px' }} />
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#111827' }}>改善事項紀錄</span>
                      </div>
                      <div style={{ borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                          <thead>
                            <tr style={{ background: '#f9fafb' }}>
                              <th style={{ padding: '9px 10px', textAlign: 'left', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb', width: '105px', fontSize: '0.75rem', letterSpacing: '0.03em' }}>
                                檢查項目
                              </th>
                              <th style={{ padding: '9px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb', fontSize: '0.75rem', letterSpacing: '0.03em' }}>
                                紀錄結果
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {activity.immediateImprovement
                              .split('\n')
                              .filter(line => line.trim() && !line.includes('紀錄缺失項目'))
                              .map((line, idx) => {
                                const sepIdx = line.indexOf('：') !== -1 ? line.indexOf('：') : line.indexOf(':');
                                const hasSep = sepIdx !== -1;
                                const title = hasSep ? line.substring(0, sepIdx).trim() : line;
                                const content = hasSep ? line.substring(sepIdx + 1).trim() : '';
                                
                                const isNeutral = title.includes('姓名') || title.includes('簽名') || title.includes('反饋') || title.includes('店名');
                                const isOk = hasSep
                                  ? (!content || content === '無' || content === '無缺失' || content === '正常')
                                  : (title === '無' || title === '無缺失' || title === '正常');

                                return (
                                  <tr key={idx} style={{
                                    borderBottom: '1px solid #f3f4f6',
                                    background: isNeutral ? '#ffffff' : (isOk ? '#ffffff' : '#fff8f8'),
                                  }}>
                                    {hasSep ? (
                                      <>
                                        <td style={{ padding: '9px 10px', color: '#374151', borderRight: '1px solid #f3f4f6', verticalAlign: 'top', wordBreak: 'break-word', fontWeight: 600 }}>
                                          {title}
                                        </td>
                                        <td style={{ padding: '9px 12px', verticalAlign: 'top' }}>
                                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                                            {isNeutral ? (
                                              <span style={{ color: '#6b7280', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontWeight: 500 }}>
                                                {content || '無'}
                                              </span>
                                            ) : (
                                              <>
                                                {isOk
                                                  ? <CheckCircle2 size={14} color="#16a34a" style={{ marginTop: '1px', flexShrink: 0 }} />
                                                  : <AlertCircle size={14} color="#e11d48" style={{ marginTop: '1px', flexShrink: 0 }} />
                                                }
                                                <span style={{ color: isOk ? '#6b7280' : '#be123c', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontWeight: isOk ? 400 : 500 }}>
                                                  {content || '無'}
                                                </span>
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      </>
                                    ) : (
                                      <td colSpan={2} style={{ padding: '9px 12px', color: isNeutral ? '#6b7280' : (isOk ? '#6b7280' : '#be123c') }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                          {!isNeutral && (
                                            isOk
                                              ? <CheckCircle2 size={14} color="#16a34a" />
                                              : <AlertCircle size={14} color="#e11d48" />
                                          )}
                                          {title}
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Highlight */}
                  {activity.highlightDescription && (
                    <div style={{
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: '8px',
                      padding: '12px 14px',
                      display: 'flex', gap: '10px', alignItems: 'flex-start',
                    }}>
                      <Star size={15} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                      <div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400e', marginBottom: '3px', letterSpacing: '0.03em' }}>優良表現分享</div>
                        <div style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.6 }}>{activity.highlightDescription}</div>
                      </div>
                    </div>
                  )}

                  {/* Photo Pairs (改善前 Before & 改善後 After) */}
                  {validPhotoPairs.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                        <Camera size={14} color="#6b7280" />
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#111827' }}>現場對比（點擊放大／對比）</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {validPhotoPairs.map((pair, pIdx) => (
                          <div key={pIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: '12px', background: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e5e7eb', width: '100%', maxWidth: '300px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#be123c' }}>改善前 (Before)</span>
                              {pair.beforeUrl ? (
                                <img
                                  src={pair.beforeUrl}
                                  alt="改善前"
                                  style={{ width: '76px', height: '76px', objectFit: 'cover', borderRadius: '7px', border: '1px solid #fecdd3', cursor: 'pointer' }}
                                  onClick={() => {
                                    if (pair.beforeUrl && pair.afterUrl) {
                                      setLightboxPair({ beforeUrl: pair.beforeUrl, afterUrl: pair.afterUrl, mode: 'compare' });
                                    } else {
                                      setLightboxImage(pair.beforeUrl);
                                    }
                                  }}
                                />
                              ) : (
                                <div style={{ width: '76px', height: '76px', borderRadius: '7px', border: '1px dashed #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', color: '#9ca3af', background: '#f9fafb' }}>
                                  無照片
                                </div>
                              )}
                            </div>
                            <ArrowRight size={15} color="#9ca3af" style={{ marginTop: '16px' }} />
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#15803d' }}>改善後 (After)</span>
                              {pair.afterUrl ? (
                                <img
                                  src={pair.afterUrl}
                                  alt="改善後"
                                  style={{ width: '76px', height: '76px', objectFit: 'cover', borderRadius: '7px', border: '1px solid #bbf7d0', cursor: 'pointer' }}
                                  onClick={() => {
                                    if (pair.beforeUrl && pair.afterUrl) {
                                      setLightboxPair({ beforeUrl: pair.beforeUrl, afterUrl: pair.afterUrl, mode: 'compare' });
                                    } else {
                                      setLightboxImage(pair.afterUrl);
                                    }
                                  }}
                                />
                              ) : (
                                <div style={{ width: '76px', height: '76px', borderRadius: '7px', border: '1px dashed #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', color: '#9ca3af', background: '#f0fdf4' }}>
                                  待補拍
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PDCA Action Items */}
                  {relatedItems.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                        <div style={{ width: '3px', height: '14px', background: 'linear-gradient(180deg,#f59e0b,#e11d48)', borderRadius: '99px' }} />
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#111827' }}>追蹤項目（PDCA）</span>
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 700,
                          color: '#d97706', background: '#fffbeb',
                          border: '1px solid #fde68a',
                          borderRadius: '99px', padding: '1px 7px',
                        }}>{relatedItems.length} 項</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                        {relatedItems.map(ai => (
                          <div key={ai.id} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            background: '#ffffff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                            padding: '11px 13px',
                            gap: '12px',
                          }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#111827', marginBottom: '3px' }}>
                                {ai.category ? `${ai.category} — ` : ''}{ai.issueDescription || ai.desc}
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#9ca3af' }}>
                                負責人：{ai.assignee}　|　期限：{new Date(ai.dueDate).toLocaleDateString('zh-TW')}
                              </div>
                            </div>
                            <span style={{
                              fontSize: '0.7rem', fontWeight: 700,
                              padding: '3px 10px', borderRadius: '99px', whiteSpace: 'nowrap', flexShrink: 0,
                              ...(ai.status === 'Open'
                                ? { color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a' }
                                : { color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0' }
                              )
                            }}>
                              {ai.status === 'Open' ? '待改善' : '已結案'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Passed Checks / Store Visit Detail Summary */}
                  {passedChecks.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                        <CheckCircle2 size={14} color="#16a34a" />
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#111827' }}>現場查核合格細項 ({passedChecks.length} 項)</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {passedChecks.map(([key]) => (
                          <span key={key} style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: '#15803d',
                            background: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}>
                            ✓ {ITEM_NAMES[key] || key}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {!activity.immediateImprovement && !activity.highlightDescription && relatedItems.length === 0 && abnormalChecks.length === 0 && validPhotoPairs.length === 0 && passedChecks.length === 0 && (
                    <div style={{
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      borderRadius: '8px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      color: '#15803d',
                      fontSize: '0.83rem',
                      fontWeight: 600,
                    }}>
                      <CheckCircle2 size={16} color="#16a34a" />
                      <span>本次巡店各項營運指標均正常合格（綜合評級：{activity.overallRating || '良好'}）</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {activities.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            color: '#9ca3af',
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px dashed #d1d5db',
          }}>
            <div style={{ fontSize: '2.2rem', marginBottom: '12px', opacity: 0.5 }}>📋</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 500, color: '#6b7280' }}>目前尚無巡店動態</div>
            <div style={{ fontSize: '0.78rem', marginTop: '6px', color: '#d1d5db' }}>請調整時間範圍或區域篩選</div>
          </div>
        )}
      </div>

      {/* Lightbox Modal (改善前後對比 / 單張放大) */}
      {(lightboxImage || lightboxPair) && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.82)',
            padding: '20px',
            gap: '16px',
          }}
          onClick={() => {
            setLightboxImage(null);
            setLightboxPair(null);
          }}
        >
          <button
            style={{
              position: 'absolute', top: '20px', right: '20px',
              background: 'white',
              border: 'none', borderRadius: '50%',
              width: '38px', height: '38px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#374151',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            }}
            onClick={() => {
              setLightboxImage(null);
              setLightboxPair(null);
            }}
          >
            <X size={18} />
          </button>

          {lightboxPair ? (
            <>
              <div
                style={{
                  display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.12)',
                  padding: '4px', borderRadius: '99px', backdropFilter: 'blur(8px)',
                }}
                onClick={e => e.stopPropagation()}
              >
                <button
                  onClick={() => setLightboxPair({ ...lightboxPair, mode: 'compare' })}
                  style={{
                    padding: '6px 14px', borderRadius: '99px', border: 'none', cursor: 'pointer',
                    fontSize: '0.78rem', fontWeight: 700,
                    background: lightboxPair.mode === 'compare' ? '#ffffff' : 'transparent',
                    color: lightboxPair.mode === 'compare' ? '#111827' : '#e5e7eb',
                  }}
                >
                  並列對比 (Before & After)
                </button>
                <button
                  onClick={() => setLightboxPair({ ...lightboxPair, mode: 'before' })}
                  style={{
                    padding: '6px 14px', borderRadius: '99px', border: 'none', cursor: 'pointer',
                    fontSize: '0.78rem', fontWeight: 700,
                    background: lightboxPair.mode === 'before' ? '#e11d48' : 'transparent',
                    color: '#ffffff',
                  }}
                >
                  改善前 (Before)
                </button>
                <button
                  onClick={() => setLightboxPair({ ...lightboxPair, mode: 'after' })}
                  style={{
                    padding: '6px 14px', borderRadius: '99px', border: 'none', cursor: 'pointer',
                    fontSize: '0.78rem', fontWeight: 700,
                    background: lightboxPair.mode === 'after' ? '#16a34a' : 'transparent',
                    color: '#ffffff',
                  }}
                >
                  改善後 (After)
                </button>
              </div>

              {lightboxPair.mode === 'compare' ? (
                <div
                  style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: '16px', width: '100%', maxWidth: '1100px', alignItems: 'center',
                  }}
                  onClick={e => e.stopPropagation()}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <span style={{ background: '#e11d48', color: '#fff', fontSize: '0.78rem', fontWeight: 700, padding: '4px 12px', borderRadius: '99px' }}>
                      改善前 (Before)
                    </span>
                    <img
                      src={lightboxPair.beforeUrl}
                      alt="改善前"
                      style={{ width: '100%', maxHeight: '72vh', objectFit: 'contain', borderRadius: '12px', border: '2px solid #fecdd3', background: '#111827' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <span style={{ background: '#16a34a', color: '#fff', fontSize: '0.78rem', fontWeight: 700, padding: '4px 12px', borderRadius: '99px' }}>
                      改善後 (After)
                    </span>
                    <img
                      src={lightboxPair.afterUrl}
                      alt="改善後"
                      style={{ width: '100%', maxHeight: '72vh', objectFit: 'contain', borderRadius: '12px', border: '2px solid #bbf7d0', background: '#111827' }}
                    />
                  </div>
                </div>
              ) : (
                <img
                  src={lightboxPair.mode === 'before' ? lightboxPair.beforeUrl : lightboxPair.afterUrl}
                  alt={lightboxPair.mode === 'before' ? '改善前' : '改善後'}
                  style={{ maxWidth: '90%', maxHeight: '80vh', objectFit: 'contain', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
                  onClick={e => e.stopPropagation()}
                />
              )}
            </>
          ) : (
            <img
              src={lightboxImage!}
              alt="放大圖片"
              style={{ maxWidth: '90%', maxHeight: '85vh', objectFit: 'contain', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
              onClick={e => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
};
