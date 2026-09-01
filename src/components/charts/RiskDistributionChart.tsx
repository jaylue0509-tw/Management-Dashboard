import React, { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface Props {
  data: { name: string; value: number; color: string; stores?: { name: string; score: number; reportTime?: string; reasons?: string[] }[] }[];
}

export const RiskDistributionChart: React.FC<Props> = ({ data }) => {
  const [activeSlice, setActiveSlice] = useState<{ name: string; color: string; stores: { name: string; score: number; reportTime?: string; reasons?: string[] }[] } | null>(null);

  if (!data || data.length === 0) return null;

  return (
    <>
    <div style={{
      background: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      padding: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      display: 'flex',
      flexDirection: 'column',
      height: '320px'
    }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#374151', marginBottom: '4px' }}>
        門市風險評級分佈圖
      </h3>
      <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '16px' }}>
        全區門市最新一次巡店之綜合評價
      </p>
      
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey="value"
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
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              itemStyle={{ color: '#374151', fontWeight: 600 }}
            />
            <Legend verticalAlign="bottom" height={36} iconType="circle" />
          </PieChart>
        </ResponsiveContainer>
        
        {/* 中心統計 */}
        <div style={{
          position: 'absolute',
          top: '45%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          pointerEvents: 'none',
          marginTop: '-18px'
        }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1f2937', lineHeight: 1 }}>
            {data.reduce((a, b) => a + b.value, 0)}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#6b7280', fontWeight: 500 }}>總店數</div>
        </div>
      </div>
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
              {activeSlice.name.replace(/[🔴🟡🟢] /g, '')} 門市名單
            </h3>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
            {activeSlice.stores.map((s, i) => (
               <div key={i} style={{
                 padding: '12px',
                 borderBottom: '1px solid #f3f4f6',
                 display: 'flex',
                 justifyContent: 'space-between',
                 alignItems: 'center'
               }}>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                   <span style={{ fontSize: '0.95rem', color: '#374151', fontWeight: 500 }}>{s.name}</span>
                   {s.reportTime && (
                     <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>回報時間：{s.reportTime}</span>
                   )}
                   {s.reasons && s.reasons.length > 0 && (
                     <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                       {s.reasons.map((r, rIdx) => (
                         <span key={rIdx} style={{ fontSize: '0.75rem', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}>
                           <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ef4444' }} />
                           {r}
                         </span>
                       ))}
                     </div>
                   )}
                 </div>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '8px', alignSelf: 'flex-start', marginTop: '2px' }}>
                   <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>風險分數</span>
                   <span style={{ 
                     fontSize: '1rem', 
                     fontWeight: 700, 
                     color: s.score >= 80 ? '#10B981' : s.score >= 60 ? '#F59E0B' : '#EF4444' 
                   }}>
                     {s.score}
                   </span>
                 </div>
               </div>
            ))}
          </div>
        </div>
      </div>
    )}
    </>
  );
};
