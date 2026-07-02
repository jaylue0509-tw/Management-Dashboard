import React from 'react';
import type { VisitRecord } from '../types';
import { MapPin, Clock, AlertCircle, Star } from 'lucide-react';

interface Props {
  activities: VisitRecord[];
}

export const ActivityWall: React.FC<Props> = ({ activities }) => {
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
              <div className="flex items-center gap-1">
                預計停留 {activity.expectedStayMinutes} 分鐘
              </div>
            </div>

            <div className="flex gap-2" style={{ marginBottom: 'var(--space-4)' }}>
              {activity.tags.map(tag => (
                <span key={tag} className="badge badge-info">{tag}</span>
              ))}
              {activity.abnormalFlag && (
                <span className="badge badge-error flex items-center gap-1">
                  <AlertCircle size={12} /> 異常發現
                </span>
              )}
            </div>

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
              </div>
            )}
          </div>
        ))}
        {activities.length === 0 && (
          <div className="text-center text-gray-500 py-8">目前無動態</div>
        )}
      </div>
    </div>
  );
};
