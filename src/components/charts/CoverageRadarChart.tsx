import React from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface Props {
  data: { subject: string; A: number; fullMark: number }[];
}

export const CoverageRadarChart: React.FC<Props> = ({ data }) => {
  const hasData = data && data.some(d => d.A > 0);

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      padding: '20px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    }}>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6' }} />
          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#111827' }}>六大模組健康度</span>
        </div>
        <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginLeft: '16px', letterSpacing: '0.04em' }}>
          Six-Module Coverage Radar
        </div>
      </div>

      {!hasData ? (
        <div style={{
          height: '220px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          color: '#d1d5db', gap: '8px',
        }}>
          <div style={{ fontSize: '2rem' }}>📡</div>
          <div style={{ fontSize: '0.82rem', color: '#9ca3af' }}>尚無巡店資料可分析</div>
        </div>
      ) : (
        <div style={{ height: '220px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} margin={{ top: 5, right: 30, bottom: 5, left: 30 }}>
              <PolarGrid stroke="#f3f4f6" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: '#9ca3af', fontSize: 11, fontFamily: 'Inter, sans-serif' }}
              />
              <Radar
                name="健康度"
                dataKey="A"
                stroke="#3b82f6"
                fill="#3b82f6"
                fillOpacity={0.12}
                strokeWidth={2}
                dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }}
              />
              <Tooltip
                contentStyle={{
                  background: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  color: '#111827',
                  fontSize: '0.82rem',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  fontFamily: 'Inter, sans-serif',
                }}
                formatter={(val: any) => [`${val ?? 0}%`, '合格率'] as [string, string]}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
