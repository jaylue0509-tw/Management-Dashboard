import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

interface Props {
  selectedDepartment: string;
  onDepartmentChange: (dept: string) => void;
}

export const HeaderBar: React.FC<Props> = ({ selectedDepartment, onDepartmentChange }) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="card flex justify-between items-center" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4) var(--space-6)' }}>
      <h1 className="text-xl font-bold text-gray-900">東寵門市營運改善與輔導戰情牆</h1>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 text-gray-500 font-medium text-sm">
          <Clock size={16} />
          {time.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <select 
          className="card" 
          style={{ padding: 'var(--space-2) var(--space-4)', border: '1px solid var(--border-color)', outline: 'none' }}
          value={selectedDepartment}
          onChange={(e) => onDepartmentChange(e.target.value)}
        >
          <option value="all">全區檢視</option>
          <option value="營業一處">營業一處</option>
          <option value="營業二處">營業二處</option>
        </select>
        <button className="btn btn-primary">
          ＋ 填寫巡店紀錄
        </button>
      </div>
    </header>
  );
};
