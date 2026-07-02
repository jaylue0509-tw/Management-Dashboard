import React, { useState } from 'react';

export const VisitRecordForm: React.FC = () => {
  const [manager, setManager] = useState('');
  
  return (
    <div className="card" style={{ padding: 'var(--space-6)' }}>
      <h2 className="text-xl font-bold" style={{ marginBottom: 'var(--space-4)' }}>新增巡店紀錄</h2>
      <form className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium text-gray-700">區主管姓名</label>
          <select 
            className="w-full" 
            style={{ padding: 'var(--space-2)', marginTop: 'var(--space-1)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', outline: 'none' }}
            value={manager}
            onChange={e => setManager(e.target.value)}
          >
            <option value="">請選擇</option>
            <option value="王小明">王小明</option>
            <option value="林美玲">林美玲</option>
            <option value="陳大山">陳大山</option>
          </select>
        </div>
        
        <div>
          <label className="text-sm font-medium text-gray-700">預計停留時間 (分鐘)</label>
          <input 
            type="number" 
            className="w-full" 
            style={{ padding: 'var(--space-2)', marginTop: 'var(--space-1)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', outline: 'none' }}
            placeholder="例如: 60"
          />
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <h3 className="font-bold text-gray-900" style={{ marginBottom: 'var(--space-2)' }}>巡店項目 (排面陳列)</h3>
          <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-2)' }}>
            <input type="checkbox" id="displayIssue" />
            <label htmlFor="displayIssue" className="text-sm text-gray-700">排面是否有缺失</label>
          </div>
          <textarea 
            className="w-full" 
            style={{ padding: 'var(--space-2)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', outline: 'none', minHeight: '80px' }}
            placeholder="請填寫缺失紀錄與改善說明"
          />
        </div>
        
        <div className="flex justify-between" style={{ marginTop: 'var(--space-6)' }}>
          <button type="button" className="btn btn-outline">取消</button>
          <button type="button" className="btn btn-primary" onClick={(e) => { e.preventDefault(); alert('紀錄已送出 (Mock)'); }}>送出紀錄</button>
        </div>
      </form>
    </div>
  );
};
