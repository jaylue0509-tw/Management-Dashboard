import React, { useState } from 'react';
import type { VisitRecord } from '../types';
import { MapPin, Clock, AlertCircle, Star, Camera, ArrowRight, X } from 'lucide-react';

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
                {activity.areaManagerName} ({activity.jobTitle}) - {activity.actionType}
              </div>
              <div className="text-sm text-gray-500 flex items-center gap-1">
                <Clock size={14} /> {activity.timeAgoMinutes} 分鐘前
              </div>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-gray-700" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="flex items-center gap-1">
                <MapPin size={14} className="text-primary" /> {activity.storeName} ({activity.region})
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
              <div style={{ backgroundColor: 'var(--bg-app)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                {activity.immediateImprovement && (
                  <div className="text-sm">
                    <strong className="text-gray-900">改善事項：</strong>
                    <span className="text-gray-700">{activity.immediateImprovement}</span>
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
