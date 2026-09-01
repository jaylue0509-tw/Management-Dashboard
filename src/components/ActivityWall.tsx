import React from 'react';
import type { VisitRecord } from '../types';
import { MapPin, Clock, AlertCircle, Star, Camera, ArrowRight, X, Calendar, CheckCircle2, ChevronDown, ChevronUp, Tag, ClipboardCheck } from 'lucide-react';
import { useState } from 'react';

interface Props {
  activities: VisitRecord[];
  actionItems?: any[];
}

const ITEM_NAMES: Record<string, string> = {
  '1-1': '檔期 POP 與宣傳物', '1-2': '主題陳列與佈置', '1-3': '檔期主打商品備貨', '1-4': '結帳區加價購專區',
  '2-1': '排面平整與拉面', '2-2': '效期與先進先出', '2-3': '臨期品與損耗處置', '2-4': '高單價與高損品防竊', '2-5': 'PB 與高毛利商品陳列',
  '3-1': '美容房環境與衛生', '3-2': '美容操作 SOP 與安全', '3-3': '活體照護與環境', '3-4': '保健/醫療專區維護',
  '4-1': '儀容儀態與招呼', '4-2': '專業導購與衛教', '4-3': '櫃檯結帳與附加銷售',
  '5-1': '門面與整體環境清潔', '5-2': '賣場氣氛與燈光空調', '5-3': '後勤倉庫與公安動線', '5-4': '系統與設備安全運作',
  '6-1': '業績與 KPI 指標跟進', '6-2': '人員 1-on-1 面談紀錄', '6-3': '團隊士氣與排班合理性'
};

export const ActivityWall: React.FC<Props> = ({ activities, actionItems = [] }) => {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  return (
    <div>
      {/* Section Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <ClipboardCheck size={18} color="#2563eb" />
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#111827' }}>
          即時巡店動態
        </h2>
        <span style={{
          marginLeft: 'auto',
          fontSize: '0.72rem', fontWeight: 600,
          color: '#6b7280',
          background: '#f3f4f6',
          border: '1px solid #e5e7eb',
          borderRadius: '99px',
          padding: '2px 10px',
        }}>
          {activities.length} 筆紀錄
        </span>
      </div>

      {/* Activity Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {activities.map((activity) => {
          const isExpanded = expandedId === activity.recordId;
          const relatedItems = actionItems.filter(ai => ai.visitRecordId === activity.recordId);
          
          const abnormalChecks = (activity as any).categoryChecks 
            ? Object.entries((activity as any).categoryChecks).filter(([_, val]) => val === '缺失' || val === '待改善')
            : [];
            
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
          
          const isAbnormal = abnormalChecks.length > 0 || hasRealDefectInNotes;
            
          const hasDetail = !!(activity.immediateImprovement || activity.highlightDescription || relatedItems.length > 0 || abnormalChecks.length > 0);
          const accentColor = isAbnormal ? '#e11d48' : '#3b82f6';

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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#16a34a', fontSize: '0.78rem', fontWeight: 500 }}>
                          <Clock size={11} />
                          {activity.expectedStayMinutes} 分鐘
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

                    {/* Tags */}
                    {(activity.tags?.length > 0 || isAbnormal) && (
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
                      </div>
                    )}
                  </div>

                  {/* Right: Time & Expand */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.72rem', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={10} />
                      {activity.timeAgoMinutes} 分前
                    </div>
                    {activity.createdAt && (
                      <div style={{ fontSize: '0.68rem', color: '#d1d5db', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <Calendar size={9} />
                        {new Date(activity.createdAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
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
                          return (
                            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '6px', padding: '8px 12px' }}>
                              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#e11d48' }} />
                              <span style={{ fontSize: '0.8rem', color: '#be123c', fontWeight: 600 }}>{reasonText}</span>
                              <span style={{ fontSize: '0.7rem', color: '#e11d48', background: '#ffe4e6', padding: '1px 6px', borderRadius: '4px' }}>{status as string}</span>
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
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400e', marginBottom: '3px', letterSpacing: '0.03em' }}>優良表現分享</div>
                        <div style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.6 }}>{activity.highlightDescription}</div>
                      </div>
                    </div>
                  )}

                  {/* Photo Pairs */}
                  {activity.photoPairs && activity.photoPairs.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                        <Camera size={14} color="#6b7280" />
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#111827' }}>現場對比（點擊放大）</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {activity.photoPairs.map((pair, pIdx) => (
                          <div key={pIdx} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <img
                              src={pair.beforeUrl}
                              alt="改善前"
                              style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '7px', border: '1px solid #e5e7eb', cursor: 'pointer' }}
                              onClick={() => setLightboxImage(pair.beforeUrl)}
                            />
                            <ArrowRight size={14} color="#d1d5db" />
                            <img
                              src={pair.afterUrl}
                              alt="改善後"
                              style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '7px', border: '1px solid #bbf7d0', cursor: 'pointer' }}
                              onClick={() => setLightboxImage(pair.afterUrl)}
                            />
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
                                {ai.category} — {ai.issueDescription}
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

      {/* Lightbox Modal */}
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
            style={{ maxWidth: '90%', maxHeight: '85vh', objectFit: 'contain', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
