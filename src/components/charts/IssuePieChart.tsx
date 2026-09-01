import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface Props {
  data: { name: string; value: number; color: string; stores?: { name: string; reasons: string[]; reportTime?: string }[] }[];
}

const COLORS = ['#3b82f6', '#16a34a', '#d97706', '#e11d48', '#7c3aed', '#0d9488'];

export const IssuePieChart: React.FC<Props> = ({ data }) => {
  const [activeSlice, setActiveSlice] = useState<{ name: string; color: string; stores: { name: string; reasons: string[]; reportTime?: string }[] } | null>(null);
  const hasData = data && data.length > 0;

  return (
    <>
    <div style={{
      background: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      padding: '20px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    }}>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#7c3aed' }} />
          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#111827' }}>缺失風險分佈</span>
        </div>
        <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginLeft: '16px', letterSpacing: '0.04em' }}>
          Issue Risk Distribution
        </div>
      </div>

      {!hasData ? (
        <div style={{
          height: '220px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          color: '#d1d5db', gap: '8px',
        }}>
          <div style={{ fontSize: '2rem' }}>🔍</div>
          <div style={{ fontSize: '0.82rem', color: '#9ca3af' }}>暫無缺失分佈資料</div>
        </div>
      ) : (
        <div style={{ height: '220px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
                strokeWidth={0}
                onClick={(entry: any) => {
                   const stores = entry.payload?.stores || entry.stores;
                   if (stores && stores.length > 0) {
                       setActiveSlice({ 
                         name: entry.name || entry.payload?.name || '', 
                         color: entry.fill || entry.payload?.color || '', 
                         stores 
                       });
                   }
                }}
                style={{ cursor: 'pointer' }}
              >
                {data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                }}
                itemStyle={{ color: '#374151', fontSize: '0.85rem' }}
              />
              <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '0.8rem' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
    
    {activeSlice && (
      <div style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        animation: 'fadeIn 0.2s ease-out'
      }} onClick={() => setActiveSlice(null)}>
        <div style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '450px',
          width: '90%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          position: 'relative',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column'
        }} onClick={e => e.stopPropagation()}>
          <button 
            onClick={() => setActiveSlice(null)}
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
              width: '16px', height: '16px',
              background: activeSlice.color,
              borderRadius: '50%'
            }} />
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1f2937', margin: 0 }}>
              {activeSlice.name} 異常門市名單
            </h3>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
            {activeSlice.stores.map((s, i) => (
               <div key={i} style={{
                 padding: '12px',
                 borderBottom: '1px solid #f3f4f6',
                 display: 'flex',
                 flexDirection: 'column',
                 gap: '6px'
               }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   <span style={{ fontSize: '1rem', color: '#374151', fontWeight: 700 }}>{s.name}</span>
                   {s.reportTime && (
                     <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                       回報時間：{s.reportTime}
                     </span>
                   )}
                 </div>
                 {s.reasons && s.reasons.length > 0 && (
                   <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                     {s.reasons.map((r, rIdx) => (
                       <span key={rIdx} style={{
                         fontSize: '0.75rem',
                         color: '#b91c1c',
                         background: '#fee2e2',
                         padding: '2px 8px',
                         borderRadius: '4px',
                         fontWeight: 500
                       }}>
                         {r}
                       </span>
                     ))}
                   </div>
                 )}
               </div>
            ))}
          </div>
        </div>
      </div>
    )}
    </>
  );
};
