import React, { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import type { Manager, VisitRecord } from '../../types';
import { getTaipeiDateStr, getTaipeiTodayStr, shiftDateStr } from '../../utils/time-utils';

export type ActivityScheduleType = '總部行程' | '會議行程' | '特殊行程';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  onModeChange: (mode: 'create' | 'edit') => void;
  initialRecord?: VisitRecord | null;
  initialPresetType?: ActivityScheduleType;
  targetManagerName?: string;
  onManagerChange?: (mgrName: string) => void;
  managers: Manager[];
  allActivities: VisitRecord[];
  isAdmin: boolean;
  currentUserName?: string;
  onSuccess: () => Promise<void>;
  canEditRecord: (record: VisitRecord) => boolean;
}

/**
 * 區主管當日活動內容／公務行程新增與修改彈窗
 * 支援切換新增/修改模式、快速挑選已填寫活動紀錄、調整時數、備註與刪除
 */
export const ActivityScheduleModal: React.FC<Props> = ({
  isOpen,
  onClose,
  mode,
  onModeChange,
  initialRecord,
  initialPresetType = '總部行程',
  targetManagerName,
  onManagerChange,
  managers,
  allActivities,
  isAdmin,
  currentUserName,
  onSuccess,
  canEditRecord,
}) => {
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [scheduleType, setScheduleType] = useState<ActivityScheduleType>(initialPresetType);
  const [scheduleDate, setScheduleDate] = useState<string>(() => getTaipeiTodayStr());
  const [scheduleNote, setScheduleNote] = useState('');
  const [scheduleImprovement, setScheduleImprovement] = useState('');
  const [scheduleDuration, setScheduleDuration] = useState(240);
  const [editingActionType, setEditingActionType] = useState('總部行程');
  const [editingStoreName, setEditingStoreName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // 取得目標主管姓名
  const activeManagerName =
    targetManagerName ||
    (isAdmin ? managers[0]?.areaManagerName || '' : currentUserName || '區主管');

  // 計算該主管可編輯的近期活動紀錄清單
  const editableRecords = useMemo(() => {
    const coNames = new Set<string>([activeManagerName].filter(Boolean));
    managers.forEach(m => {
      if (m.areaManagerName === activeManagerName || m.deputyManagerName === activeManagerName) {
        if (m.areaManagerName) coNames.add(m.areaManagerName);
        if (m.deputyManagerName) coNames.add(m.deputyManagerName);
      }
    });
    return allActivities
      .filter(a => (coNames.size > 0 ? coNames.has(a.areaManagerName) : true) && canEditRecord(a))
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 30);
  }, [allActivities, managers, activeManagerName, canEditRecord]);

  const loadRecord = (record: VisitRecord) => {
    setSelectedRecordId(record.recordId);
    setEditingActionType(record.actionType || '總部行程');
    setEditingStoreName(record.storeName || record.actionType || '');
    if (['總部行程', '會議行程', '特殊行程'].includes(record.actionType)) {
      setScheduleType(record.actionType as ActivityScheduleType);
    }
    setScheduleDate(getTaipeiDateStr(record.createdAt) || getTaipeiTodayStr());
    setScheduleNote(record.highlightDescription || '');
    setScheduleImprovement(record.immediateImprovement || '');
    setScheduleDuration(record.expectedStayMinutes || 240);
  };

  // 初始載入或變更 initialRecord 時填入表單
  useEffect(() => {
    if (!isOpen) return;

    if (mode === 'edit') {
      if (initialRecord) {
        loadRecord(initialRecord);
      } else if (editableRecords.length > 0) {
        loadRecord(editableRecords[0]);
      } else {
        setSelectedRecordId(null);
        setScheduleDate(getTaipeiTodayStr());
        setScheduleNote('');
        setScheduleImprovement('');
      }
    } else {
      const defaultType = initialPresetType || '總部行程';
      setSelectedRecordId(null);
      setEditingActionType(defaultType);
      setEditingStoreName(defaultType);
      setScheduleType(defaultType);
      setScheduleDate(getTaipeiTodayStr());
      setScheduleNote('');
      setScheduleImprovement('');
      setScheduleDuration(240);
    }
  }, [isOpen, mode, initialRecord, initialPresetType]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (isSubmitting) return;
    const isSpecialType = ['總部行程', '會議行程', '特殊行程'].includes(
      mode === 'edit' ? editingActionType : scheduleType
    );
    const targetMgr = isAdmin ? activeManagerName : (currentUserName || '區主管');
    const noteText = scheduleNote.trim() || (isSpecialType ? `執行當日${scheduleType}` : '');

    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const apiBase = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';

      if (mode === 'edit' && selectedRecordId) {
        const existingRecord = allActivities.find(a => a.recordId === selectedRecordId);
        const existingDateStr = existingRecord ? getTaipeiDateStr(existingRecord.createdAt) : '';
        const nextCreatedAt =
          scheduleDate && scheduleDate !== existingDateStr
            ? (scheduleDate === getTaipeiTodayStr()
                ? new Date().toISOString()
                : new Date(`${scheduleDate}T09:00:00+08:00`).toISOString())
            : undefined;

        const res = await fetch(`${apiBase}/visit-records/${encodeURIComponent(selectedRecordId)}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            actionType: isSpecialType ? scheduleType : editingActionType,
            storeName: isSpecialType ? scheduleType : editingStoreName,
            highlightDescription: noteText,
            immediateImprovement: scheduleImprovement.trim(),
            expectedStayMinutes: scheduleDuration || 240,
            ...(nextCreatedAt ? { createdAt: nextCreatedAt } : {}),
          }),
        });

        if (res.ok) {
          onClose();
          await onSuccess();
        } else {
          const errData = await res.json().catch(() => ({}));
          alert(errData.detail || '活動內容修改失敗，請稍後再試');
        }
        return;
      }

      // 新增模式
      const mgrRecord = managers.find(m => m.areaManagerName === targetMgr);
      const res = await fetch(`${apiBase}/visit-records`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          storeName: scheduleType,
          region: mgrRecord?.region || '',
          department: mgrRecord?.department || '',
          areaManagerName: targetMgr,
          jobTitle: '區主管',
          actionType: scheduleType,
          expectedStayMinutes: scheduleDuration || 240,
          tags: [scheduleType, '當日行程'],
          immediateImprovement: scheduleImprovement.trim(),
          highlightDescription: noteText,
          abnormalFlag: false,
          photoPairs: [],
          createdAt:
            scheduleDate === getTaipeiTodayStr()
              ? new Date().toISOString()
              : new Date(`${scheduleDate}T09:00:00+08:00`).toISOString(),
        }),
      });

      if (res.ok) {
        onClose();
        await onSuccess();
      } else {
        alert('行程登記失敗，請稍後再試');
      }
    } catch (e) {
      console.error(e);
      alert('網路連線異常，請稍後再試');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (recordId: string) => {
    if (!recordId || isDeleting) return;
    if (!window.confirm('確定要刪除這筆已填寫的當日活動／行程紀錄嗎？')) return;
    setIsDeleting(true);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const apiBase = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';
      const res = await fetch(`${apiBase}/visit-records/${encodeURIComponent(recordId)}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        onClose();
        setSelectedRecordId(null);
        await onSuccess();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.detail || '刪除失敗，僅限刪除公務行程紀錄或確認權限');
      }
    } catch (e) {
      console.error(e);
      alert('網路連線異常，請稍後再試');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-gray-100 relative my-auto max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 cursor-pointer"
          aria-label="關閉視窗"
        >
          <X size={20} />
        </button>

        <h3 className="text-lg font-bold text-gray-900 mb-1">
          {mode === 'edit' ? '✏️ 修改當日活動內容' : '➕ 新增當日活動內容'}
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          {mode === 'edit'
            ? '可點選下方已填寫之當日活動進行內容修改、調整時數／日期，或刪除誤填之公務行程'
            : '登記後將即時同步顯示於戰情牆上方、左側區主管進度與即時巡店動態牆中'}
        </p>

        {/* 模式切換按鈕 */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl mb-4">
          <button
            type="button"
            onClick={() => onModeChange('create')}
            className={`py-2 px-3 rounded-lg text-xs font-extrabold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              mode === 'create'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>➕ 新增當日活動內容</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange('edit')}
            className={`py-2 px-3 rounded-lg text-xs font-extrabold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              mode === 'edit'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>✏️ 修改已填寫活動 ({editableRecords.length})</span>
          </button>
        </div>

        {/* 管理員專用：切換所屬主管 */}
        {isAdmin && (
          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-700 mb-1.5">選擇區主管</label>
            <select
              value={activeManagerName}
              onChange={e => {
                if (onManagerChange) onManagerChange(e.target.value);
              }}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {managers.map(m => (
                <option key={m.areaManagerName} value={m.areaManagerName}>
                  {m.areaManagerName}（{m.region}）
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 修改模式下：列出該區主管近期已填寫之活動紀錄供選擇 */}
        {mode === 'edit' && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-gray-700">
                選擇要修改的已填寫活動紀錄
              </label>
              <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                共 {editableRecords.length} 筆可修改
              </span>
            </div>

            {editableRecords.length === 0 ? (
              <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 text-center">
                <div className="text-xs font-bold text-gray-600 mb-2">
                  目前尚無已填寫之活動紀錄可供修改
                </div>
                <button
                  type="button"
                  onClick={() => onModeChange('create')}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                >
                  ➕ 立即新增當日活動內容
                </button>
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 border border-gray-200 rounded-xl p-2 bg-gray-50/70">
                {editableRecords.map(rec => {
                  const isSelected = selectedRecordId === rec.recordId;
                  const recDate = getTaipeiDateStr(rec.createdAt).slice(5).replace('-', '/');
                  const summaryText =
                    rec.highlightDescription ||
                    rec.immediateImprovement ||
                    rec.storeName ||
                    rec.actionType;
                  return (
                    <button
                      key={rec.recordId}
                      type="button"
                      onClick={() => loadRecord(rec)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all cursor-pointer flex items-center justify-between gap-2 border ${
                        isSelected
                          ? 'bg-amber-50 border-amber-400 text-amber-950 font-bold shadow-2xs'
                          : 'bg-white border-gray-200/80 text-gray-700 hover:bg-indigo-50/50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 font-extrabold text-[10px]">
                            {recDate}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-800 font-bold text-[10px]">
                            {rec.actionType}
                          </span>
                          {!['總部行程', '會議行程', '特殊行程'].includes(rec.actionType) && (
                            <span className="font-extrabold text-indigo-900">
                              {rec.storeName}
                            </span>
                          )}
                          <span className="text-[11px] text-gray-500">
                            ({rec.areaManagerName})
                          </span>
                        </div>
                        <div className="truncate text-gray-700 mt-0.5">
                          {summaryText}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                          isSelected
                            ? 'bg-amber-500 text-white'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {isSelected ? '編輯中' : '點選修改'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {(mode === 'create' || selectedRecordId) && (
          <>
            {/* 活動日期 */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-gray-700">活動／行程日期</label>
                <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                  可選擇今日或往前調整日期
                </span>
              </div>
              <div className="grid grid-cols-6 gap-1.5 mb-2">
                {[0, 1, 2, 3, 4, 5].map(daysAgo => {
                  const dStr = shiftDateStr(getTaipeiTodayStr(), -daysAgo);
                  const label = daysAgo === 0 ? '今日' : daysAgo === 1 ? '昨日' : `${daysAgo}天前`;
                  const active = scheduleDate === dStr;
                  return (
                    <button
                      key={dStr}
                      type="button"
                      onClick={() => setScheduleDate(dStr)}
                      className={`py-1.5 px-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        active
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-indigo-50'
                      }`}
                    >
                      <div>{label}</div>
                      <div className={`text-[10px] ${active ? 'text-white/90' : 'text-gray-400'}`}>
                        {dStr.slice(5).replace('-', '/')}
                      </div>
                    </button>
                  );
                })}
              </div>
              <input
                type="date"
                max={getTaipeiTodayStr()}
                value={scheduleDate}
                onChange={e => {
                  const today = getTaipeiTodayStr();
                  const val = e.target.value || today;
                  setScheduleDate(val > today ? today : val);
                }}
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2 text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* 行程類型選擇 */}
            {mode === 'create' ||
            ['總部行程', '會議行程', '特殊行程'].includes(editingActionType) ? (
              <div className="mb-4">
                <label className="block text-xs font-bold text-gray-700 mb-1.5">當日活動／行程類型</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['總部行程', '會議行程', '特殊行程'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setScheduleType(t);
                        if (mode === 'edit') {
                          setEditingActionType(t);
                          setEditingStoreName(t);
                        }
                      }}
                      className={`py-2.5 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        scheduleType === t
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-indigo-50'
                      }`}
                    >
                      {t === '總部行程' ? '🏢 ' : t === '會議行程' ? '📅 ' : '⭐ '}
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mb-4 p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-indigo-600">正在修改門市巡檢活動內容</div>
                  <div className="text-sm font-extrabold text-indigo-950 mt-0.5">
                    📍 {editingStoreName}（{editingActionType}）
                  </div>
                </div>
              </div>
            )}

            {/* 任務說明與快捷標籤 */}
            <div className="mb-4">
              <label className="block text-xs font-bold text-gray-700 mb-1.5">
                當日活動內容／亮點與任務說明（可點選下方快速標籤或自由輸入）
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {['總部營運會議', '教育訓練課程', '跨區專案支援', '盤點／展店籌備', '部門主管會議'].map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setScheduleNote(preset)}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-gray-100 hover:bg-indigo-100 text-gray-700 hover:text-indigo-700 font-semibold transition-colors cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <textarea
                rows={2}
                value={scheduleNote}
                onChange={e => setScheduleNote(e.target.value)}
                placeholder={`請輸入當日活動內容，例如：參加${scheduleType}、總部月會、跨店支援說明...`}
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
            </div>

            {/* 門市巡檢修改時的現場改善補充 */}
            {mode === 'edit' &&
              !['總部行程', '會議行程', '特殊行程'].includes(editingActionType) && (
                <div className="mb-4">
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">
                    現場改善／補充指導內容（選填）
                  </label>
                  <textarea
                    rows={2}
                    value={scheduleImprovement}
                    onChange={e => setScheduleImprovement(e.target.value)}
                    placeholder="補充填寫當日現場立即改善或指導事項..."
                    className="w-full border border-gray-200 rounded-xl px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                  />
                </div>
              )}

            {/* 預計活動時數 */}
            <div className="mb-5">
              <label className="block text-xs font-bold text-gray-700 mb-1.5">預計活動／停留時數</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { mins: 60, label: '1 小時' },
                  { mins: 120, label: '2 小時' },
                  { mins: 240, label: '半天 (4h)' },
                  { mins: 480, label: '全天 (8h)' },
                ].map(d => (
                  <button
                    key={d.mins}
                    type="button"
                    onClick={() => setScheduleDuration(d.mins)}
                    className={`py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                      scheduleDuration === d.mins
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 底部按鈕 */}
            <div className="flex flex-col sm:flex-row gap-2">
              {mode === 'edit' &&
                selectedRecordId &&
                ['總部行程', '會議行程', '特殊行程'].includes(editingActionType) && (
                  <button
                    type="button"
                    disabled={isDeleting || isSubmitting}
                    onClick={() => handleDelete(selectedRecordId)}
                    className="sm:w-1/3 py-3 bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    {isDeleting ? '刪除中...' : '🗑️ 刪除此筆行程'}
                  </button>
                )}
              <button
                type="button"
                disabled={isSubmitting || isDeleting}
                onClick={handleSubmit}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-bold rounded-xl text-sm shadow-md transition-colors cursor-pointer"
              >
                {isSubmitting
                  ? '正在儲存活動內容...'
                  : mode === 'edit'
                    ? '💾 儲存修改當日活動內容'
                    : `✅ 確認新增「${scheduleType}」`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
