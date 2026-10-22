import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, History, Save, Plus, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { storeRegions } from '../data/storeRegions';

interface User {
  username: string;
  name: string;
  role: string;
  assigned_stores: string[];
}

interface AuditLog {
  id: string;
  action: string;
  target_user: string;
  changed_by: string;
  before_data: any;
  after_data: any;
  created_at: string;
}

export const AdminSettings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editPassword, setEditPassword] = useState('');
  
  const { token, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user?.role !== 'admin') {
      navigate('/dashboard');
      return;
    }
    fetchData();
  }, [user, navigate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, logsRes] = await Promise.all([
        fetch('https://management-dashboard-rust.vercel.app/api/admin/users', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('https://management-dashboard-rust.vercel.app/api/admin/audit-logs', { headers: { Authorization: `Bearer ${token}` } })
      ]);
      
      if (usersRes.ok) setUsers(await usersRes.json());
      if (logsRes.ok) setAuditLogs(await logsRes.json());
    } catch (err) {
      console.error("Failed to fetch admin data", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    
    // NOTE: 區主管帳號統一為姓名；新增時以姓名作為帳號，既有帳號維持原值避免主鍵變動
    const isExisting = users.some(u => u.username === editingUser.username);
    const trimmedName = editingUser.name.trim();
    const username = isExisting ? editingUser.username : trimmedName;

    try {
      const res = await fetch('https://management-dashboard-rust.vercel.app/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          username,
          name: trimmedName,
          password: editPassword || null,
          assigned_stores: editingUser.assigned_stores
        })
      });
      
      if (res.ok) {
        setEditingUser(null);
        setEditPassword('');
        fetchData();
        alert('設定儲存成功！');
      } else {
        const error = await res.json();
        alert('儲存失敗: ' + (error.detail || '未知錯誤'));
      }
    } catch (err) {
      alert('系統連線異常');
    }
  };

  const toggleStore = (store: string) => {
    if (!editingUser) return;
    setEditingUser(prev => {
      if (!prev) return prev;
      const stores = new Set(prev.assigned_stores);
      if (stores.has(store)) stores.delete(store);
      else stores.add(store);
      return { ...prev, assigned_stores: Array.from(stores) };
    });
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">載入中...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-30 shadow-sm px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
          <ShieldCheck size={18} className="text-indigo-600" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900 leading-tight">系統設定後台</h1>
          <p className="text-xs text-gray-500">Admin Control Panel</p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 pt-6">
        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('users')}
            className={`pb-3 px-2 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'users' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users size={16} /> 區主管帳號管理
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-3 px-2 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'audit' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <History size={16} /> 異動紀錄追蹤
          </button>
        </div>

        {activeTab === 'users' && !editingUser && (
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-800">所有區主管</h2>
              <button 
                onClick={() => setEditingUser({ username: '', name: '', role: 'manager', assigned_stores: [] })}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm transition-colors"
              >
                <Plus size={16} /> 新增區主管
              </button>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2">
              {users.map(u => (
                <div key={u.username} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-bold text-gray-900 mb-2">{u.name}</h3>
                      <div className="space-y-1">
                        <p className="text-xs text-gray-600 font-medium">登入帳號：<span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{u.username}</span></p>
                        <p className="text-xs text-gray-600 font-medium">登入密碼：<span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">admin1234</span> <span className="text-gray-400 font-normal scale-90 inline-block">(預設密碼，如修改過請以新密碼為準)</span></p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setEditingUser({ ...u })}
                      className="text-indigo-600 hover:text-indigo-800 text-sm font-medium px-3 py-1 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors"
                    >
                      編輯設定
                    </button>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 mb-2">負責門市 ({u.assigned_stores?.length || 0} 間)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {u.assigned_stores?.slice(0, 5).map(s => (
                        <span key={s} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md">{s}</span>
                      ))}
                      {(u.assigned_stores?.length || 0) > 5 && (
                        <span className="px-2 py-1 bg-gray-50 text-gray-400 text-xs rounded-md">+{u.assigned_stores.length - 5}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'users' && editingUser && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-800">
                {users.find(u => u.username === editingUser.username) ? '編輯區主管設定' : '新增區主管'}
              </h2>
              <button onClick={() => setEditingUser(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSaveUser} className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">登入帳號 (Username)</label>
                  <input 
                    type="text" 
                    readOnly
                    value={users.find(u => u.username === editingUser.username) ? editingUser.username : editingUser.name.trim()}
                    className="w-full border border-gray-200 rounded-lg px-4 py-2 outline-none bg-gray-100 text-gray-500 cursor-not-allowed"
                    placeholder="將自動使用主管姓名"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    {users.find(u => u.username === editingUser.username) ? '帳號建立後無法修改' : '帳號統一為主管姓名，自動帶入'}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">主管姓名 (Name)</label>
                  <input 
                    type="text" 
                    required 
                    value={editingUser.name}
                    onChange={e => setEditingUser({...editingUser, name: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="例如: 王小明"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    密碼 (Password) 
                    <span className="text-gray-400 font-normal ml-2">※ 若不修改請保持空白</span>
                  </label>
                  <input 
                    type="password" 
                    value={editPassword}
                    onChange={e => setEditPassword(e.target.value)}
                    required={!users.find(u => u.username === editingUser.username)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder={users.find(u => u.username === editingUser.username) ? "輸入新密碼 (不改請留白)" : "請輸入密碼"}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-end mb-4">
                  <label className="block text-sm font-semibold text-gray-700">負責門市勾選 ({editingUser.assigned_stores.length} 間)</label>
                </div>
                
                <div className="space-y-6">
                  {Object.entries(storeRegions).map(([region, stores]) => (
                    <div key={region} className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                      <h4 className="font-bold text-gray-800 mb-3 text-sm">{region}</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {stores.map(store => (
                          <label key={store} className="flex items-center gap-2 cursor-pointer group">
                            <input 
                              type="checkbox"
                              checked={editingUser.assigned_stores.includes(store)}
                              onChange={() => toggleStore(store)}
                              className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                            />
                            <span className="text-sm text-gray-700 group-hover:text-indigo-700 transition-colors">{store}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-gray-200 flex justify-end gap-3">
                <button type="button" onClick={() => setEditingUser(null)} className="px-5 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors">
                  取消
                </button>
                <button type="submit" className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors shadow-sm">
                  <Save size={18} /> 儲存設定
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 font-semibold">時間</th>
                    <th className="px-6 py-3 font-semibold">操作人</th>
                    <th className="px-6 py-3 font-semibold">對象 (帳號)</th>
                    <th className="px-6 py-3 font-semibold">異動內容</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 text-gray-500 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-6 py-4 font-medium text-gray-900">{log.changed_by}</td>
                      <td className="px-6 py-4 text-gray-600">{log.target_user}</td>
                      <td className="px-6 py-4">
                        {log.action === 'CREATE_USER' && <span className="inline-flex px-2 py-1 bg-green-50 text-green-700 text-xs font-bold rounded-md mb-2">新增帳號</span>}
                        {log.action === 'UPDATE_USER' && <span className="inline-flex px-2 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-md mb-2">更新設定</span>}
                        
                        {log.after_data?.password_changed && (
                          <div className="text-xs text-amber-600 mb-1 font-medium">⚠️ 重設了密碼</div>
                        )}
                        
                        {log.before_data?.name !== log.after_data?.name && log.before_data && (
                          <div className="text-xs text-gray-600 mb-1">
                            姓名: <span className="line-through text-gray-400">{log.before_data.name}</span> ➡️ <span className="font-semibold text-gray-900">{log.after_data?.name}</span>
                          </div>
                        )}
                        
                        {/* 比較門市差異 */}
                        {(() => {
                          const beforeStores = log.before_data?.assigned_stores || [];
                          const afterStores = log.after_data?.assigned_stores || [];
                          const added = afterStores.filter((s: string) => !beforeStores.includes(s));
                          const removed = beforeStores.filter((s: string) => !afterStores.includes(s));
                          
                          if (added.length === 0 && removed.length === 0 && !(!log.before_data)) return null;
                          
                          return (
                            <div className="mt-2 space-y-1">
                              {added.length > 0 && (
                                <div className="text-xs">
                                  <span className="text-green-600 font-semibold">+ 新增門市:</span> <span className="text-gray-600">{added.join(', ')}</span>
                                </div>
                              )}
                              {removed.length > 0 && (
                                <div className="text-xs">
                                  <span className="text-red-500 font-semibold">- 移除門市:</span> <span className="text-gray-600">{removed.join(', ')}</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-gray-500">尚無異動紀錄</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
