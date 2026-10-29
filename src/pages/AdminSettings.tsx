import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, History, Save, Plus, ShieldCheck, X, Search, CheckCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { storeRegions } from '../data/storeRegions';

interface User {
  username: string;
  name: string;
  role: string;
  assigned_stores: string[];
  must_change_password?: boolean;
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

const API_BASE = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';

export const AdminSettings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'login' | 'visit' | 'user'>('all');
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [storeSearch, setStoreSearch] = useState('');

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
        fetch(`${API_BASE}/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/admin/audit-logs`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      if (usersRes.ok) setUsers(await usersRes.json());
      if (logsRes.ok) setAuditLogs(await logsRes.json());
    } catch (err) {
      console.error('Failed to fetch admin data', err);
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
      const res = await fetch(`${API_BASE}/admin/users`, {
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
        setStoreSearch('');
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

  const toggleRegionAll = (storesInRegion: string[]) => {
    if (!editingUser) return;
    setEditingUser(prev => {
      if (!prev) return prev;
      const current = new Set(prev.assigned_stores);
      const allSelected = storesInRegion.every(s => current.has(s));
      if (allSelected) {
        storesInRegion.forEach(s => current.delete(s));
      } else {
        storesInRegion.forEach(s => current.add(s));
      }
      return { ...prev, assigned_stores: Array.from(current) };
    });
  };

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return users;
    const q = userSearch.trim().toLowerCase();
    return users.filter(u =>
      u.name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.assigned_stores || []).some(s => s.toLowerCase().includes(q))
    );
  }, [users, userSearch]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">載入中...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-30 shadow-xs px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center shrink-0">
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
            <Users size={16} /> 區主管帳號與門市分配 ({users.length})
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-3 px-2 font-medium text-sm flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'audit' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <History size={16} /> 異動紀錄追蹤 ({auditLogs.length})
          </button>
        </div>

        {activeTab === 'users' && !editingUser && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-800">所有區主管</h2>
                <p className="text-xs text-gray-500">管理各區主管帳號權限與門市管轄範圍</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-56">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    placeholder="搜尋主管姓名或門市..."
                    className="w-full pl-8 pr-7 py-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:border-indigo-500"
                  />
                  {userSearch && (
                    <button onClick={() => setUserSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X size={13} />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setEditingUser({ username: '', name: '', role: 'manager', assigned_stores: [] })}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-xs transition-colors shrink-0"
                >
                  <Plus size={16} /> 新增區主管
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {filteredUsers.map(u => (
                <div key={u.username} className="bg-white p-5 rounded-xl border border-gray-200 shadow-xs hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <h3 className="font-bold text-gray-900 text-base">{u.name}</h3>
                        {u.must_change_password && (
                          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
                            待初次變更密碼
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 font-medium flex items-center gap-1.5">
                        <span>登入帳號：</span>
                        <span className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded font-mono font-semibold">{u.username}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setStoreSearch('');
                        setEditingUser({ ...u });
                      }}
                      className="text-indigo-600 hover:text-indigo-800 text-sm font-medium px-3 py-1 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors"
                    >
                      編輯設定
                    </button>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 mb-2">負責門市 ({u.assigned_stores?.length || 0} 間)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {u.assigned_stores?.slice(0, 6).map(s => (
                        <span key={s} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-md">{s}</span>
                      ))}
                      {(u.assigned_stores?.length || 0) > 6 && (
                        <span className="px-2 py-1 bg-gray-50 text-gray-400 text-xs rounded-md">+{u.assigned_stores.length - 6}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'users' && editingUser && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-800">
                {users.find(u => u.username === editingUser.username) ? `編輯區主管設定 — ${editingUser.name}` : '新增區主管'}
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
                    onChange={e => setEditingUser({ ...editingUser, name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="例如: 王小明"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    密碼 (Password)
                    <span className="text-gray-400 font-normal ml-2">※ 若不修改請保持空白（重設後該主管下次登入須強制改密碼）</span>
                  </label>
                  <input
                    type="password"
                    value={editPassword}
                    onChange={e => setEditPassword(e.target.value)}
                    required={!users.find(u => u.username === editingUser.username)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder={users.find(u => u.username === editingUser.username) ? '輸入新密碼 (不改請留白)' : '請輸入初始密碼'}
                  />
                </div>
              </div>

              <div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
                  <label className="block text-sm font-semibold text-gray-700">
                    負責門市勾選 (已選 <span className="text-indigo-600 font-bold">{editingUser.assigned_stores.length}</span> 間)
                  </label>
                  <div className="relative sm:w-64">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={storeSearch}
                      onChange={e => setStoreSearch(e.target.value)}
                      placeholder="快速篩選門市名稱..."
                      className="w-full pl-8 pr-7 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none focus:bg-white focus:border-indigo-500"
                    />
                    {storeSearch && (
                      <button type="button" onClick={() => setStoreSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-5">
                  {Object.entries(storeRegions).map(([region, stores]) => {
                    const visibleStores = storeSearch.trim()
                      ? stores.filter(s => s.toLowerCase().includes(storeSearch.trim().toLowerCase()))
                      : stores;
                    if (visibleStores.length === 0) return null;

                    const selectedInRegionCount = visibleStores.filter(s => editingUser.assigned_stores.includes(s)).length;
                    const allRegionSelected = selectedInRegionCount === visibleStores.length && visibleStores.length > 0;

                    return (
                      <div key={region} className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200/70">
                          <h4 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                            <span>{region}</span>
                            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                              {selectedInRegionCount} / {visibleStores.length}
                            </span>
                          </h4>
                          <button
                            type="button"
                            onClick={() => toggleRegionAll(visibleStores)}
                            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-white px-2.5 py-1 rounded-md border border-indigo-100 shadow-2xs"
                          >
                            <CheckCheck size={12} />
                            {allRegionSelected ? '取消本區' : '全選本區'}
                          </button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                          {visibleStores.map(store => {
                            const checked = editingUser.assigned_stores.includes(store);
                            return (
                              <label
                                key={store}
                                className={`flex items-center gap-2 cursor-pointer p-2 rounded-lg border transition-all ${
                                  checked
                                    ? 'bg-indigo-50/70 border-indigo-200 text-indigo-900 font-semibold'
                                    : 'bg-white border-gray-100 text-gray-700 hover:border-indigo-200'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleStore(store)}
                                  className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                />
                                <span className="text-xs sm:text-sm truncate">{store}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-gray-200 flex justify-end gap-3">
                <button type="button" onClick={() => setEditingUser(null)} className="px-5 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded-lg transition-colors">
                  取消
                </button>
                <button type="submit" className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg flex items-center gap-2 transition-colors shadow-xs">
                  <Save size={18} /> 儲存設定
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="space-y-4">
            {/* 日誌類型過濾標籤 */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setLogFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  logFilter === 'all' ? 'bg-blue-600 text-white shadow-xs' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                全部紀錄 ({auditLogs.length})
              </button>
              <button
                onClick={() => setLogFilter('login')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  logFilter === 'login' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                🔑 登入歷史 ({auditLogs.filter(l => l.action === 'USER_LOGIN').length})
              </button>
              <button
                onClick={() => setLogFilter('visit')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  logFilter === 'visit' ? 'bg-purple-600 text-white shadow-xs' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                📝 巡店送出 ({auditLogs.filter(l => l.action === 'CREATE_VISIT_RECORD').length})
              </button>
              <button
                onClick={() => setLogFilter('user')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  logFilter === 'user' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                ⚙️ 帳號/密碼設定 ({auditLogs.filter(l => l.action === 'CREATE_USER' || l.action === 'UPDATE_USER').length})
              </button>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-gray-500 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 font-semibold">時間</th>
                      <th className="px-6 py-3 font-semibold">操作主管 / 人員</th>
                      <th className="px-6 py-3 font-semibold">對象 / 門市</th>
                      <th className="px-6 py-3 font-semibold">操作與異動內容</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {auditLogs
                      .filter(log => {
                        if (logFilter === 'login') return log.action === 'USER_LOGIN';
                        if (logFilter === 'visit') return log.action === 'CREATE_VISIT_RECORD';
                        if (logFilter === 'user') return log.action === 'CREATE_USER' || log.action === 'UPDATE_USER';
                        return true;
                      })
                      .map(log => (
                        <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4 text-gray-500 whitespace-nowrap text-xs">
                            {new Date(log.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td className="px-6 py-4 font-semibold text-gray-900 whitespace-nowrap">
                            {log.changed_by}
                          </td>
                          <td className="px-6 py-4 text-gray-700 font-medium whitespace-nowrap">
                            {log.target_user}
                          </td>
                          <td className="px-6 py-4">
                            {/* 登入紀錄 */}
                            {log.action === 'USER_LOGIN' && (
                              <div className="space-y-1">
                                <span className="inline-flex px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-md">
                                  🔑 登入系統
                                </span>
                                <div className="text-xs text-gray-500">
                                  角色：{log.after_data?.role === 'admin' ? '總部管理員' : '區主管'}
                                  {log.after_data?.assigned_stores_count !== undefined && ` · 負責門市數：${log.after_data.assigned_stores_count} 間`}
                                </div>
                              </div>
                            )}

                            {/* 巡店送出紀錄 */}
                            {log.action === 'CREATE_VISIT_RECORD' && (
                              <div className="space-y-1">
                                <span className="inline-flex px-2 py-0.5 bg-purple-50 text-purple-700 text-xs font-bold rounded-md">
                                  📝 巡店紀錄提交
                                </span>
                                <div className="text-xs text-gray-800 font-medium">
                                  門市：<span className="text-purple-900 font-bold">{log.after_data?.storeName || log.target_user}</span>
                                  {log.after_data?.region && ` (${log.after_data.region})`}
                                </div>
                                <div className="text-xs text-gray-500">
                                  綜合評價：<span className={`font-bold ${log.after_data?.overallRating === '良好' ? 'text-green-600' : log.after_data?.overallRating === '需追蹤' ? 'text-amber-600' : 'text-red-600'}`}>{log.after_data?.overallRating || '良好'}</span>
                                  {log.after_data?.actionItemsCreated > 0 && ` · 建立 ${log.after_data.actionItemsCreated} 項 PDCA 改善`}
                                </div>
                              </div>
                            )}

                            {/* 帳號建立 */}
                            {log.action === 'CREATE_USER' && (
                              <span className="inline-flex px-2 py-0.5 bg-green-50 text-green-700 text-xs font-bold rounded-md">
                                ➕ 新增帳號
                              </span>
                            )}

                            {/* 帳號與密碼異動 */}
                            {log.action === 'UPDATE_USER' && (
                              <div className="space-y-1">
                                <span className="inline-flex px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-md">
                                  ⚙️ 更新設定
                                </span>
                                {log.after_data?.password_changed && (
                                  <div className="text-xs text-amber-600 font-medium">
                                    🔒 {log.after_data?.self_service ? '區主管自行修改了登入密碼' : '管理員重設了密碼'}
                                  </div>
                                )}
                                {log.before_data?.name !== log.after_data?.name && log.before_data && (
                                  <div className="text-xs text-gray-600">
                                    姓名: <span className="line-through text-gray-400">{log.before_data.name}</span> ➡️ <span className="font-semibold text-gray-900">{log.after_data?.name}</span>
                                  </div>
                                )}
                                {(() => {
                                  const beforeStores = log.before_data?.assigned_stores || [];
                                  const afterStores = log.after_data?.assigned_stores || [];
                                  const added = afterStores.filter((s: string) => !beforeStores.includes(s));
                                  const removed = beforeStores.filter((s: string) => !afterStores.includes(s));
                                  if (added.length === 0 && removed.length === 0) return null;
                                  return (
                                    <div className="text-xs space-y-0.5">
                                      {added.length > 0 && (
                                        <div><span className="text-green-600 font-semibold">+ 新增門市:</span> <span className="text-gray-600">{added.join(', ')}</span></div>
                                      )}
                                      {removed.length > 0 && (
                                        <div><span className="text-red-500 font-semibold">- 移除門市:</span> <span className="text-gray-600">{removed.join(', ')}</span></div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
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
          </div>
        )}
      </div>
    </div>
  );
};
