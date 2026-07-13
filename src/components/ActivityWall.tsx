import React, { useState } from 'react';
import type { VisitRecord } from '../types';
import { MapPin, Clock, AlertCircle, Star, Camera, ArrowRight, X, Calendar, CheckCircle2 } from 'lucide-react';

interface Props {
  activities: VisitRecord[];
}

export const ActivityWall: React.FC<Props> = ({ activities }) => {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  return (
    <div>
      <h2 className="text-lg font-bold text-gray-900" style={{ marginBottom: 'var(--space-4)' }}>即時巡店動態</h2>
      <div className="flex flex-col gap-4">
        {activities.map((activity) => (
          <div key={activity.recordId} className="card" style={{ borderLeft: `4px solid ${activity.abnormalFlag ? 'var(--color-error)' : 'var(--color-primary-500)'}` }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="font-bold text-gray-900">
                {activity.areaManagerName || "未知主管"} ({activity.jobTitle || "區主管"}) - {activity.actionType || "實地巡店"}
              </div>
              <div className="text-sm text-gray-500 flex flex-col items-end gap-1">
                <div className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                  <Clock size={14} /> {activity.timeAgoMinutes} 分鐘前
                </div>
                {activity.createdAt && (
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <Calendar size={12} />
                    {new Date(activity.createdAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-gray-700" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="flex items-center gap-1">
                <MapPin size={14} className="text-primary" /> {activity.storeName || "未知門市"}{activity.region ? ` (${activity.region})` : ""}
              </div>
              {activity.expectedStayMinutes > 0 && (
                <div className="badge badge-success flex items-center gap-1" style={{ fontSize: '0.85rem' }}>
                  <Clock size={12} /> 預計停留 {activity.expectedStayMinutes} 分鐘
                </div>
              )}
            </div>

            {(activity.tags?.length > 0 || activity.abnormalFlag) && (
              <div className="flex gap-2" style={{ marginBottom: 'var(--space-4)' }}>
                {activity.tags?.map(tag => (
                  <span key={tag} className="badge badge-info">{tag}</span>
                ))}
                {activity.abnormalFlag && (
                  <span className="badge badge-error flex items-center gap-1">
                    <AlertCircle size={12} /> 異常發現
                  </span>
                )}
              </div>
            )}

            {(activity.immediateImprovement || activity.highlightDescription) && (
              <div style={{ backgroundColor: 'var(--bg-app)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-secondary-200)' }}>
                
                {activity.immediateImprovement && (
                  <div>
                    <strong className="text-gray-900 text-sm flex items-center gap-1 mb-1">
                      📝 改善事項紀錄
                    </strong>
                    <div className="overflow-hidden rounded-md border border-gray-200 mt-2">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500 whitespace-nowrap border-r border-gray-200">檢查項目</th>
                            <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500 w-full">紀錄結果</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                          {activity.immediateImprovement
                            .split('\n')
                            .filter(line => line.trim() && !line.includes('紀錄缺失項目'))
                            .map((line, idx) => {
                              let title = line;
                              let content = '';
                              const separatorIdx = line.indexOf('：') !== -1 ? line.indexOf('：') : line.indexOf(':');
                              const hasSeparator = separatorIdx !== -1;
                              
                              if (hasSeparator) {
                                title = line.substring(0, separatorIdx).trim();
                                content = line.substring(separatorIdx + 1).trim();
                              }

                              // 判斷是否為無缺失
                              let isNone = false;
                              if (hasSeparator) {
                                isNone = content === '無' || content === '無缺失' || content === '';
                              } else {
                                isNone = title === '無' || title === '無缺失' || title === '正常' || title === '皆正常';
                              }
                              
                              if (!hasSeparator) {
                                return (
                                  <tr key={idx} className={isNone ? 'bg-gray-50/50' : 'bg-red-50/40'}>
                                    <td colSpan={2} className="px-4 py-2.5 text-gray-900 align-top">
                                      <div className="flex items-start gap-1.5">
                                        {isNone ? (
                                          <CheckCircle2 size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
                                        ) : (
                                          <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                                        )}
                                        <span className={isNone ? 'text-gray-500' : 'text-red-700 font-medium whitespace-pre-wrap'}>
                                          {title}
                                        </span>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              }

                              return (
                                <tr key={idx} className={isNone ? 'bg-gray-50/50' : 'bg-red-50/40'}>
                                  <td className="px-4 py-2.5 font-medium text-gray-700 border-r border-gray-200 align-top whitespace-nowrap min-w-[120px]">
                                    {title}
                                  </td>
                                  <td className="px-4 py-2.5 text-gray-900 align-top">
                                    <div className="flex items-start gap-1.5">
                                      {isNone ? (
                                        <CheckCircle2 size={16} className="text-gray-400 mt-0.5 flex-shrink-0" />
                                      ) : (
                                        <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                                      )}
                                      <span className={isNone ? 'text-gray-500' : 'text-red-700 font-medium whitespace-pre-wrap break-words'}>
                                        {content || '無'}
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {activity.highlightDescription && (
                  <div className="text-sm" style={{ marginTop: activity.immediateImprovement ? 'var(--space-2)' : 0 }}>
                    <strong className="text-gray-900" style={{ color: 'var(--color-warning)' }}><Star size={14} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> 優良分享：</strong>
                    <span className="text-gray-700">{activity.highlightDescription}</span>
                  </div>
                )}
                
                {activity.photoPairs && activity.photoPairs.length > 0 && (
                  <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-secondary-200)' }}>
                    <strong className="text-gray-900 text-sm flex items-center gap-1 mb-2">
                      <Camera size={14} className="text-primary" /> 現場對比 (點擊放大)：
                    </strong>
                    <div className="flex flex-col gap-2">
                      {activity.photoPairs.map((pair, pIdx) => (
                        <div key={pIdx} className="flex items-center gap-2">
                          <img 
                            src={pair.beforeUrl} 
                            alt="改善前" 
                            className="object-cover cursor-pointer"
                            style={{ width: '60px', height: '60px', borderRadius: '4px', border: '1px solid var(--color-secondary-200)' }}
                            onClick={() => setLightboxImage(pair.beforeUrl)}
                          />
                          <ArrowRight size={16} className="text-gray-500" />
                          <img 
                            src={pair.afterUrl} 
                            alt="改善後" 
                            className="object-cover cursor-pointer"
                            style={{ width: '60px', height: '60px', borderRadius: '4px', border: '1px solid var(--color-secondary-200)' }}
                            onClick={() => setLightboxImage(pair.afterUrl)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {activities.length === 0 && (
          <div className="text-center text-gray-500 py-8">目前無動態</div>
        )}
      </div>

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div 
          style={{ 
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
            backgroundColor: 'rgba(0, 0, 0, 0.85)' 
          }}
          onClick={() => setLightboxImage(null)}
        >
          <div style={{ position: 'relative', width: '100%', maxWidth: '800px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <button 
              style={{
                position: 'absolute', top: '-40px', right: '0', 
                color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', 
                border: 'none', borderRadius: '50%', padding: '8px', cursor: 'pointer'
              }}
              onClick={() => setLightboxImage(null)}
            >
              <X size={24} />
            </button>
            <img 
              src={lightboxImage} 
              alt="放大圖片" 
              style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', borderRadius: '8px' }}
              onClick={(e) => e.stopPropagation()} 
            />
          </div>
        </div>
      )}
    </div>
  );
};
