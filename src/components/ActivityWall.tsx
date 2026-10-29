import React, { useState, useMemo } from 'react';
import type { VisitRecord } from '../types';
import {
  MapPin,
  Clock,
  AlertCircle,
  Star,
  Camera,
  ArrowRight,
  X,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Tag,
  ClipboardCheck,
  Search,
  Filter,
  PenTool
} from 'lucide-react';

interface Props {
  activities: VisitRecord[];
  actionItems?: any[];
  externalExpandedId?: string | null;
  onActionItemStatusChange?: (itemId: string, newStatus: 'Open' | 'Closed') => void;
  onActivityPhotosChange?: (recordId: string, newPairs: { beforeUrl: string; afterUrl: string }[]) => void;
}

const CORE_ITEM_NAMES: Record<string, string> = {
  'core-1': '環境異味與清潔',
  'core-2': '櫃檯焦點陳列',
  'core-3': '人員狀態與迎賓'
};

const ITEM_NAMES: Record<string, string> = {
  '1-1': '檔期 POP 與宣傳物', '1-2': '主題陳列與佈置', '1-3': '檔期主打商品備貨', '1-4': '結帳區加價購專區',
  '2-1': '排面平整與拉面', '2-2': '效期與先進先出', '2-3': '臨期品與損耗處置', '2-4': '高單價與高損品防竊', '2-5': 'PB 與高毛利商品陳列',
  '3-1': '美容房環境與衛生', '3-2': '美容操作 SOP 與安全', '3-3': '活體照護與環境', '3-4': '保健/醫療專區維護',
  '4-1': '儀容儀態與招呼', '4-2': '專業導購與衛教', '4-3': '櫃檯結帳與附加銷售',
  '5-1': '門面與整體環境清潔', '5-2': '賣場氣氛與燈光空調', '5-3': '後勤倉庫與公安動線', '5-4': '系統與設備安全運作',
  '6-1': '業績與 KPI 指標跟進', '6-2': '人員 1-on-1 面談紀錄', '6-3': '團隊士氣與排班合理性'
};

const AUDIT_MODE_LABELS: Record<string, string> = {
  A: '模式 A · 快閃巡店',
  B: '模式 B · 主題巡店',
  C: '模式 C · 全店完整輔導'
};

/**
 * 根據建立時間動態計算相對時間文字，避免資料庫靜態 timeAgoMinutes 永遠顯示 0 分前
 * @param createdAt ISO 時間字串
 * @param fallbackMinutes 備用分鐘數
 * @returns 相對時間描述
 */
const formatRelativeTime = (createdAt?: string, fallbackMinutes?: number): string => {
  if (!createdAt) {
    return fallbackMinutes && fallbackMinutes > 0 ? `${fallbackMinutes} 分前` : '剛剛';
  }
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return '剛剛';

  const diffMins = Math.max(0, Math.floor((Date.now() - createdMs) / 60000));
  if (diffMins < 1) return '剛剛';
  if (diffMins < 60) return `${diffMins} 分鐘前`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} 小時前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} 天前`;
  return new Date(createdAt).toLocaleDateString('zh-TW');
};

export const ActivityWall: React.FC<Props> = ({ activities, actionItems = [], externalExpandedId, onActionItemStatusChange, onActivityPhotosChange }) => {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxPair, setLightboxPair] = useState<{ beforeUrl: string; afterUrl: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'abnormal' | 'red' | 'photos'>('all');
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [uploadingPhotoKey, setUploadingPhotoKey] = useState<string | null>(null);
  const [localPhotoOverrides, setLocalPhotoOverrides] = useState<Record<string, { beforeUrl: string; afterUrl: string }[]>>({});

  React.useEffect(() => {
    if (externalExpandedId) {
      setExpandedId(externalExpandedId);
    }
  }, [externalExpandedId]);

  /**
   * 壓縮圖片為 Base64 JPEG，供動態牆直接補傳改善前/改善後照片
   */
  const compressImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1280;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  /**
   * 補傳或更新單筆巡店紀錄的「改善前 (Before) / 改善後 (After)」照片
   */
  const handleUpdateRecordPhoto = async (
    activity: VisitRecord,
    pairIdx: number,
    side: 'beforeUrl' | 'afterUrl',
    file: File
  ) => {
    const uploadKey = `${activity.recordId}-${pairIdx}-${side}`;
    setUploadingPhotoKey(uploadKey);
    try {
      const base64Url = await compressImageToBase64(file);
      const currentPairs = localPhotoOverrides[activity.recordId] || activity.photoPairs || [];
      const nextPairs = [...currentPairs];
      while (nextPairs.length <= pairIdx) {
        nextPairs.push({ beforeUrl: '', afterUrl: '' });
      }
      nextPairs[pairIdx] = {
        ...nextPairs[pairIdx],
        [side]: base64Url
      };

      // 先行更新前端顯示，提供零延遲體驗
      setLocalPhotoOverrides(prev => ({ ...prev, [activity.recordId]: nextPairs }));
      if (onActivityPhotosChange) {
        onActivityPhotosChange(activity.recordId, nextPairs);
      }

      const apiBase = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${apiBase}/visit-records/${activity.recordId}/photos`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ photoPairs: nextPairs })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.photoPairs) {
          setLocalPhotoOverrides(prev => ({ ...prev, [activity.recordId]: data.photoPairs }));
        }
      }
    } catch (err) {
      console.error('補傳改善前後照片失敗', err);
      alert('照片上傳失敗，請稍後再試');
    } finally {
      setUploadingPhotoKey(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  /**
   * 判斷單筆巡店紀錄是否包含異常或缺失
   */
  const checkActivityAbnormal = (activity: VisitRecord): boolean => {
    const coreDefects = activity.coreChecks
      ? Object.values(activity.coreChecks).some(val => val === '缺失' || val === '待改善')
      : false;
    const catDefects = activity.categoryChecks
      ? Object.values(activity.categoryChecks).some(val => val === '缺失' || val === '待改善')
      : false;

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
    return coreDefects || catDefects || hasRealDefectInNotes || activity.overallRating === '需重點輔導';
  };

  const filteredActivities = useMemo(() => {
    return activities.filter(activity => {
      // 狀態過濾
      if (statusFilter === 'abnormal' && !checkActivityAbnormal(activity)) return false;
      if (statusFilter === 'red' && activity.overallRating !== '需重點輔導') return false;
      if (statusFilter === 'photos') {
        const hasPhotos = activity.photoPairs?.some(p => p.beforeUrl || p.afterUrl);
        if (!hasPhotos) return false;
      }

      // 關鍵字搜尋
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchStore = (activity.storeName || '').toLowerCase().includes(q);
        const matchMgr = (activity.areaManagerName || '').toLowerCase().includes(q);
        const matchRegion = (activity.region || '').toLowerCase().includes(q);
        const matchNotes = (activity.immediateImprovement || '').toLowerCase().includes(q);
        const matchHighlight = (activity.highlightDescription || '').toLowerCase().includes(q);
        const matchRemarks = activity.categoryRemarks
          ? Object.values(activity.categoryRemarks).some(r => (r || '').toLowerCase().includes(q))
          : false;
        return matchStore || matchMgr || matchRegion || matchNotes || matchHighlight || matchRemarks;
      }
      return true;
    });
  }, [activities, searchQuery, statusFilter]);

  /**
   * 切換 PDCA 待辦事項的結案狀態
   */
  const handleTogglePdcaStatus = async (item: any) => {
    if (updatingItemId) return;
    const nextStatus: 'Open' | 'Closed' = item.status === 'Open' ? 'Closed' : 'Open';
    setUpdatingItemId(item.id);
    try {
      const apiBase = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${apiBase}/action-items/${item.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok && onActionItemStatusChange) {
        onActionItemStatusChange(item.id, nextStatus);
      }
    } catch (err) {
      console.error('Failed to update PDCA status', err);
    } finally {
      setUpdatingItemId(null);
    }
  };

  return (
    <div>
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ClipboardCheck size={18} color="#2563eb" />
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#111827' }}>
            即時巡店動態
          </h2>
          <span style={{
            fontSize: '0.72rem', fontWeight: 600,
            color: '#6b7280',
            background: '#f3f4f6',
            border: '1px solid #e5e7eb',
            borderRadius: '99px',
            padding: '2px 10px',
          }}>
            顯示 {filteredActivities.length} / {activities.length} 筆
          </span>
        </div>

        {/* Search Input */}
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋門市、主管、缺失說明..."
            className="w-full pl-8 pr-8 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Quick Filter Pills */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
        <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0 mr-1">
          <Filter size={12} /> 篩選：
        </span>
        {[
          { id: 'all', label: '全部動態', count: activities.length },
          { id: 'abnormal', label: '🚨 發現異常/缺失', count: activities.filter(checkActivityAbnormal).length },
          { id: 'red', label: '🔴 需重點輔導', count: activities.filter(a => a.overallRating === '需重點輔導').length },
          { id: 'photos', label: '📷 含現場照片', count: activities.filter(a => a.photoPairs?.some(p => p.beforeUrl || p.afterUrl)).length },
        ].map(tab => {
          const active = statusFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 flex items-center gap-1.5 border ${active
                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
            >
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${active ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Activity Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filteredActivities.map((activity) => {
          const isExpanded = expandedId === activity.recordId;
          // 同時相容 visitRecordId 與 sourceRecordId
          const relatedItems = actionItems.filter(
            ai => ai.visitRecordId === activity.recordId || ai.sourceRecordId === activity.recordId
          );

          const abnormalCoreChecks = activity.coreChecks
            ? Object.entries(activity.coreChecks).filter(([_, val]) => val === '缺失' || val === '待改善')
            : [];

          const abnormalChecks = activity.categoryChecks
            ? Object.entries(activity.categoryChecks).filter(([_, val]) => val === '缺失' || val === '待改善')
            : [];

          // 統計模組檢核合格率
          const totalCheckedItems = activity.categoryChecks
            ? Object.values(activity.categoryChecks).filter(v => v !== 'N/A').length
            : 0;
          const passedCheckedItems = activity.categoryChecks
            ? Object.values(activity.categoryChecks).filter(v => v === '合格').length
            : 0;
          const passRate = totalCheckedItems > 0 ? Math.round((passedCheckedItems / totalCheckedItems) * 100) : null;

          const isAbnormal = checkActivityAbnormal(activity);
          const effectivePhotoPairs = localPhotoOverrides[activity.recordId] || activity.photoPairs || [];
          const validPhotos = effectivePhotoPairs.filter(p => p.beforeUrl || p.afterUrl);
          const displayPhotoPairs = effectivePhotoPairs.length > 0 ? effectivePhotoPairs : [{ beforeUrl: '', afterUrl: '' }];

          // 任何卡片皆可展開檢視完整檢核摘要
          const hasDetail = true;
          const accentColor = activity.overallRating === '需重點輔導'
            ? '#e11d48'
            : isAbnormal
              ? '#f59e0b'
              : '#3b82f6';

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
                style={{ padding: '14px 16px', cursor: 'pointer' }}
                onClick={() => toggleExpand(activity.recordId)}
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
                          {AUDIT_MODE_LABELS[activity.auditMode] || `模式 ${activity.auditMode}`}
                        </span>
                      )}
                      {passRate !== null && (
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 600,
                          color: passRate >= 85 ? '#059669' : passRate >= 70 ? '#d97706' : '#e11d48',
                          background: passRate >= 85 ? '#ecfdf5' : passRate >= 70 ? '#fffbeb' : '#fff1f2',
                          border: `1px solid ${passRate >= 85 ? '#a7f3d0' : passRate >= 70 ? '#fde68a' : '#fecdd3'}`,
                          borderRadius: '5px', padding: '1px 6px',
                        }}>
                          檢核合格率 {passRate}%
                        </span>
                      )}
                    </div>

                    {/* Location & Duration Row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#374151', fontSize: '0.84rem' }}>
                        <MapPin size={13} color="#3b82f6" />
                        <span style={{ fontWeight: 700, color: '#1e293b' }}>{activity.storeName || '未知門市'}</span>
                        {activity.region && (
                          <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>（{activity.region}）</span>
                        )}
                      </div>

                      {activity.expectedStayMinutes > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#16a34a', fontSize: '0.78rem', fontWeight: 500 }}>
                          <Clock size={11} />
                          停留 {activity.expectedStayMinutes} 分鐘
                        </div>
                      )}

                      {activity.overallRating && (
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 700,
                          padding: '2px 8px', borderRadius: '99px',
                          ...(activity.overallRating === '需重點輔導'
                            ? { color: '#e11d48', background: '#fff1f2', border: '1px solid #fecdd3' }
                            : activity.overallRating === '需追蹤' || activity.overallRating === '待追蹤'
                              ? { color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a' }
                              : { color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0' }
                          )
                        }}>
                          {activity.overallRating === '需重點輔導' ? '🔴 ' : activity.overallRating === '需追蹤' ? '🟡 ' : '🟢 '}
                          {activity.overallRating}
                        </span>
                      )}
                    </div>

                    {/* Tags & Quick Summary Badges */}
                    {(activity.tags?.length > 0 || isAbnormal || validPhotos.length > 0 || relatedItems.length > 0) && (
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
                            <AlertCircle size={9} />
                            發現異常 ({abnormalCoreChecks.length + abnormalChecks.length || 1} 項)
                          </span>
                        )}
                        {validPhotos.length > 0 && (
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 600,
                            color: '#7c3aed',
                            background: '#f5f3ff',
                            border: '1px solid #ddd6fe',
                            borderRadius: '99px', padding: '1px 8px',
                            display: 'flex', alignItems: 'center', gap: '3px',
                          }}>
                            <Camera size={9} />
                            附照片 ({validPhotos.length} 組)
                          </span>
                        )}
                        {relatedItems.length > 0 && (
                          <span style={{
                            fontSize: '0.68rem', fontWeight: 600,
                            color: '#d97706',
                            background: '#fffbeb',
                            border: '1px solid #fde68a',
                            borderRadius: '99px', padding: '1px 8px',
                          }}>
                            PDCA 追蹤 ({relatedItems.filter(i => i.status === 'Closed').length}/{relatedItems.length} 結案)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: Time & Expand */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 600, color: '#6b7280', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={11} />
                      {formatRelativeTime(activity.createdAt, activity.timeAgoMinutes)}
                    </div>
                    {activity.createdAt && (
                      <div style={{ fontSize: '0.68rem', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <Calendar size={9} />
                        {new Date(activity.createdAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                    {hasDetail && (
                      <div style={{
                        color: isExpanded ? '#2563eb' : '#9ca3af',
                        marginTop: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                        fontSize: '0.68rem',
                        fontWeight: 600
                      }}>
                        <span>{isExpanded ? '收起詳情' : '展開詳情'}</span>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Expandable Detail Section */}
              {isExpanded && (
                <div style={{
                  borderTop: '1px solid #f3f4f6',
                  padding: '18px 16px',
                  background: '#fafafa',
                  display: 'flex', flexDirection: 'column', gap: '18px',
                }}>
                  {/* Core Checks Summary (必看核心底線) */}
                  {activity.coreChecks && Object.keys(activity.coreChecks).length > 0 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                        <div style={{ width: '3px', height: '14px', background: '#2563eb', borderRadius: '99px' }} />
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#111827' }}>必看核心底線檢核</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {Object.entries(activity.coreChecks).map(([key, val]) => {
                          const isOk = val === '正常' || val === '合格';
                          const remark = activity.categoryRemarks?.[key];
                          return (
                            <div
                              key={key}
                              className={`p-3 rounded-lg border ${isOk ? 'bg-white border-gray-200' : 'bg-rose-50 border-rose-200'
                                }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-gray-800">
                                  {CORE_ITEM_NAMES[key] || key}
                                </span>
                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${isOk ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-100 text-rose-700'
                                  }`}>
                                  {isOk ? '✅ 正常' : `❌ ${val}`}
                                </span>
                              </div>
                              {remark && (
                                <p className="text-xs text-rose-700 mt-1.5 pt-1.5 border-t border-rose-200/60 font-medium">
                                  說明：{remark}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Abnormal Checks from categoryChecks */}
                  {abnormalChecks.length > 0 ? (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                        <AlertCircle size={14} color="#e11d48" />
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#111827' }}>
                          六大模組異常與待改善細項 ({abnormalChecks.length} 項)
                        </span>
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
                              reasonText = `自訂檢核：${key}`;
                            }
                          }
                          const remark = activity.categoryRemarks?.[key];
                          return (
                            <div key={key} style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', padding: '10px 12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#e11d48' }} />
                                <span style={{ fontSize: '0.82rem', color: '#be123c', fontWeight: 700 }}>{reasonText}</span>
                                <span style={{ fontSize: '0.7rem', color: '#e11d48', background: '#ffe4e6', padding: '1px 7px', borderRadius: '4px', fontWeight: 600 }}>
                                  {status as string}
                                </span>
                              </div>
                              {remark && (
                                <div style={{ marginTop: '6px', paddingLeft: '14px', fontSize: '0.78rem', color: '#881337', lineHeight: 1.5 }}>
                                  📝 現場說明：{remark}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    totalCheckedItems > 0 && (
                      <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-3 flex items-center gap-2 text-xs text-emerald-800 font-semibold">
                        <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                        <span>本次共檢核 {totalCheckedItems} 項模組細項，全數符合標準無缺失！</span>
                      </div>
                    )
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
                              <th style={{ padding: '9px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap', width: '130px', fontSize: '0.75rem', letterSpacing: '0.03em' }}>
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
                                        <td style={{ padding: '9px 12px', color: '#374151', borderRight: '1px solid #f3f4f6', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
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
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400e', marginBottom: '3px', letterSpacing: '0.03em' }}>優良表現與門市亮點</div>
                        <div style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.6 }}>{activity.highlightDescription}</div>
                      </div>
                    </div>
                  )}

                  {/* Photo Pairs: 永遠顯示改善前 (Before) ➡️ 改善後 (After) 現場對比，並支援直接補拍上傳 */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '7px', marginBottom: '10px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <Camera size={14} color="#7c3aed" />
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#111827' }}>
                          現場對比照片：改善前 (Before) ➡️ 改善後 (After)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setLocalPhotoOverrides(prev => ({
                            ...prev,
                            [activity.recordId]: [...displayPhotoPairs, { beforeUrl: '', afterUrl: '' }]
                          }));
                        }}
                        className="text-xs font-bold text-purple-600 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2.5 py-1 rounded-lg transition-colors"
                      >
                        + 新增一組對比照片
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                      {displayPhotoPairs.map((pair, pIdx) => {
                        const isUploadingBefore = uploadingPhotoKey === `${activity.recordId}-${pIdx}-beforeUrl`;
                        const isUploadingAfter = uploadingPhotoKey === `${activity.recordId}-${pIdx}-afterUrl`;
                        return (
                          <div key={pIdx} className="bg-white p-3 rounded-xl border border-gray-200 flex items-center gap-3 shadow-xs">
                            {/* 改善前 (Before) */}
                            <div className="flex flex-col items-center gap-1.5">
                              <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-100">
                                改善前 (Before)
                              </span>
                              {pair.beforeUrl ? (
                                <div className="relative group">
                                  <img
                                    src={pair.beforeUrl}
                                    alt="改善前"
                                    style={{ width: '92px', height: '92px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #fecdd3', cursor: 'pointer' }}
                                    onClick={() => {
                                      if (pair.beforeUrl && pair.afterUrl) {
                                        setLightboxPair({ beforeUrl: pair.beforeUrl, afterUrl: pair.afterUrl });
                                      } else {
                                        setLightboxImage(pair.beforeUrl);
                                      }
                                    }}
                                  />
                                  <label
                                    title="更換改善前照片"
                                    className="absolute bottom-1 right-1 bg-black/65 hover:bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded cursor-pointer"
                                  >
                                    重拍
                                    <input
                                      type="file"
                                      accept="image/*"
                                      capture="environment"
                                      className="hidden"
                                      onChange={(e) => {
                                        if (e.target.files?.[0]) {
                                          handleUpdateRecordPhoto(activity, pIdx, 'beforeUrl', e.target.files[0]);
                                        }
                                      }}
                                    />
                                  </label>
                                </div>
                              ) : (
                                <label
                                  style={{ width: '92px', height: '92px' }}
                                  className="border-2 border-dashed border-rose-200 hover:border-rose-400 bg-rose-50/30 rounded-lg flex flex-col items-center justify-center text-rose-400 cursor-pointer transition-colors"
                                >
                                  <Camera size={18} className="mb-1" />
                                  <span className="text-[10px] font-bold text-center px-1">
                                    {isUploadingBefore ? '上傳中...' : '拍攝/上傳\n改善前'}
                                  </span>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    disabled={isUploadingBefore}
                                    onChange={(e) => {
                                      if (e.target.files?.[0]) {
                                        handleUpdateRecordPhoto(activity, pIdx, 'beforeUrl', e.target.files[0]);
                                      }
                                    }}
                                  />
                                </label>
                              )}
                            </div>

                            <ArrowRight size={16} color="#9ca3af" />

                            {/* 改善後 (After) */}
                            <div className="flex flex-col items-center gap-1.5">
                              <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                                改善後 (After)
                              </span>
                              {pair.afterUrl ? (
                                <div className="relative group">
                                  <img
                                    src={pair.afterUrl}
                                    alt="改善後"
                                    style={{ width: '92px', height: '92px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #bbf7d0', cursor: 'pointer' }}
                                    onClick={() => {
                                      if (pair.beforeUrl && pair.afterUrl) {
                                        setLightboxPair({ beforeUrl: pair.beforeUrl, afterUrl: pair.afterUrl });
                                      } else {
                                        setLightboxImage(pair.afterUrl);
                                      }
                                    }}
                                  />
                                  <label
                                    title="更換改善後照片"
                                    className="absolute bottom-1 right-1 bg-black/65 hover:bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded cursor-pointer"
                                  >
                                    重拍
                                    <input
                                      type="file"
                                      accept="image/*"
                                      capture="environment"
                                      className="hidden"
                                      onChange={(e) => {
                                        if (e.target.files?.[0]) {
                                          handleUpdateRecordPhoto(activity, pIdx, 'afterUrl', e.target.files[0]);
                                        }
                                      }}
                                    />
                                  </label>
                                </div>
                              ) : (
                                <label
                                  style={{ width: '92px', height: '92px' }}
                                  className="border-2 border-dashed border-emerald-200 hover:border-emerald-400 bg-emerald-50/30 rounded-lg flex flex-col items-center justify-center text-emerald-500 cursor-pointer transition-colors"
                                >
                                  <Camera size={18} className="mb-1" />
                                  <span className="text-[10px] font-bold text-center px-1">
                                    {isUploadingAfter ? '上傳中...' : '拍攝/上傳\n改善後'}
                                  </span>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    disabled={isUploadingAfter}
                                    onChange={(e) => {
                                      if (e.target.files?.[0]) {
                                        handleUpdateRecordPhoto(activity, pIdx, 'afterUrl', e.target.files[0]);
                                      }
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* PDCA Action Items */}
                  {relatedItems.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                        <div style={{ width: '3px', height: '14px', background: 'linear-gradient(180deg,#f59e0b,#e11d48)', borderRadius: '99px' }} />
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#111827' }}>追蹤改善項目（PDCA）</span>
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 700,
                          color: '#d97706', background: '#fffbeb',
                          border: '1px solid #fde68a',
                          borderRadius: '99px', padding: '1px 7px',
                        }}>{relatedItems.length} 項</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                        {relatedItems.map(ai => {
                          const titleText = ai.issueDescription || ai.desc || '未命名改善項目';
                          const categoryLabel = ai.category ? `${ai.category} — ` : '';
                          const isClosed = ai.status === 'Closed';
                          return (
                            <div key={ai.id} style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              background: '#ffffff',
                              border: `1px solid ${isClosed ? '#bbf7d0' : '#e5e7eb'}`,
                              borderRadius: '8px',
                              padding: '11px 13px',
                              gap: '12px',
                            }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: '0.84rem',
                                  fontWeight: 600,
                                  color: isClosed ? '#6b7280' : '#111827',
                                  textDecoration: isClosed ? 'line-through' : 'none',
                                  marginBottom: '3px'
                                }}>
                                  {categoryLabel}{titleText}
                                </div>
                                <div style={{ fontSize: '0.74rem', color: '#9ca3af' }}>
                                  負責人：{ai.assignee || '店長'}　|　改善期限：{ai.dueDate ? new Date(ai.dueDate).toLocaleDateString('zh-TW') : '未指定'}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={updatingItemId === ai.id}
                                onClick={() => handleTogglePdcaStatus(ai)}
                                title="點擊切換結案狀態"
                                style={{
                                  fontSize: '0.72rem', fontWeight: 700,
                                  padding: '4px 10px', borderRadius: '99px', whiteSpace: 'nowrap', flexShrink: 0,
                                  cursor: updatingItemId === ai.id ? 'wait' : 'pointer',
                                  transition: 'all 0.15s',
                                  ...(!isClosed
                                    ? { color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a' }
                                    : { color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0' }
                                  )
                                }}
                              >
                                {updatingItemId === ai.id
                                  ? '更新中...'
                                  : !isClosed
                                    ? '⏳ 待改善 (點擊結案)'
                                    : '✅ 已結案'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Signature Preview */}
                  {activity.signature && (
                    <div className="flex items-center justify-between bg-white px-4 py-2.5 rounded-lg border border-gray-200">
                      <span className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                        <PenTool size={13} className="text-blue-500" /> 現場巡店簽名確認
                      </span>
                      <img
                        src={activity.signature}
                        alt="主管簽名"
                        className="h-10 object-contain bg-gray-50 px-2 rounded border border-gray-100 cursor-pointer"
                        onClick={() => setLightboxImage(activity.signature || null)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filteredActivities.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            color: '#9ca3af',
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px dashed #d1d5db',
          }}>
            <div style={{ fontSize: '2.2rem', marginBottom: '12px', opacity: 0.5 }}>📋</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#6b7280' }}>
              {searchQuery || statusFilter !== 'all' ? '找不到符合篩選條件的巡店紀錄' : '目前尚無巡店動態'}
            </div>
            <div style={{ fontSize: '0.78rem', marginTop: '6px', color: '#9ca3af' }}>
              {searchQuery || statusFilter !== 'all' ? (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
                  className="mt-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors"
                >
                  清除搜尋與篩選條件
                </button>
              ) : '請調整時間範圍或區域篩選'}
            </div>
          </div>
        )}
      </div>

      {/* Lightbox Modal (單張放大) */}
      {lightboxImage && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.75)',
            padding: '20px',
          }}
          onClick={() => setLightboxImage(null)}
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
            onClick={() => setLightboxImage(null)}
          >
            <X size={18} />
          </button>
          <img
            src={lightboxImage}
            alt="放大圖片"
            style={{ maxWidth: '90%', maxHeight: '85vh', objectFit: 'contain', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', background: '#fff' }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {/* Lightbox Pair Modal (改善前 Before ➡️ 改善後 After 雙圖並排放大對比) */}
      {lightboxPair && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.82)',
            padding: '20px',
          }}
          onClick={() => setLightboxPair(null)}
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
            onClick={() => setLightboxPair(null)}
          >
            <X size={18} />
          </button>
          <div
            className="bg-white rounded-2xl p-4 sm:p-6 max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Camera size={18} className="text-purple-600" />
                <h4 className="text-base font-bold text-gray-900">
                  現場改善前後對比檢視（改善前 Before ➡️ 改善後 After）
                </h4>
              </div>
              <span className="text-xs text-gray-400">點擊背景或右上角 ✕ 關閉</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="flex flex-col items-center bg-rose-50/40 p-3 rounded-xl border border-rose-200">
                <span className="text-xs font-bold text-rose-700 bg-rose-100 px-3 py-1 rounded-full mb-2.5">
                  📸 改善前 (Before)
                </span>
                <img
                  src={lightboxPair.beforeUrl}
                  alt="改善前放大"
                  className="max-h-[65vh] w-full object-contain rounded-lg bg-white"
                />
              </div>
              <div className="flex flex-col items-center bg-emerald-50/40 p-3 rounded-xl border border-emerald-200">
                <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full mb-2.5">
                  ✨ 改善後 (After)
                </span>
                <img
                  src={lightboxPair.afterUrl}
                  alt="改善後放大"
                  className="max-h-[65vh] w-full object-contain rounded-lg bg-white"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
