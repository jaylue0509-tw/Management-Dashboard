import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL, getAuthHeaders } from '../api/api';
import { storeRegions } from '../data/storeRegions';
import {
  BEAUTY_DIRECTORS_CONFIG,
  isRegionInBeautyDirectorScope,
} from '../data/beautyAuditConfig';
import { getTaipeiDateStr, getTaipeiTodayStr } from '../utils/time-utils';
import { normalizeStoreName, getBusinessDepartment } from '../utils/store-region';
import type { Manager, VisitRecord } from '../types';

export interface RosterPerson {
  name: string;
  role: 'manager' | 'beauty_director';
  title: string;
  department: string;
  supervisor: string;
  region: string;
  nickname: string;
  stores: string[];
}

export interface PlannedScheduleItem {
  id: string;
  personName: string;
  personRole: 'manager' | 'beauty_director';
  department: string;
  region: string;
  scheduleDate: string;
  timeSlot: '全天' | '上午' | '下午';
  scheduleType: string;
  storeName: string;
  note: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  managers: Manager[];
  allActivities: VisitRecord[];
}

const WEEKDAY_LABELS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const TIME_SLOTS: Array<'上午' | '下午' | '全天'> = ['上午', '下午', '全天'];

const MANAGER_SCHEDULE_TYPES = [
  { id: '門市巡店', icon: '🏪', badgeCls: 'bg-blue-50 text-blue-800 border-blue-200' },
  { id: '總部會議', icon: '🏢', badgeCls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  { id: '教育訓練', icon: '📚', badgeCls: 'bg-purple-50 text-purple-800 border-purple-200' },
  { id: '跨區支援', icon: '🤝', badgeCls: 'bg-amber-50 text-amber-800 border-amber-200' },
  { id: '排休/休假', icon: '🌴', badgeCls: 'bg-slate-100 text-slate-700 border-slate-300' },
  { id: '其他公務', icon: '📌', badgeCls: 'bg-teal-50 text-teal-800 border-teal-200' },
] as const;

const BEAUTY_SCHEDULE_TYPES = [
  { id: '美容巡店', icon: '🌸', badgeCls: 'bg-rose-50 text-rose-800 border-rose-200' },
  { id: '技術考核/輔導', icon: '✂️', badgeCls: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200' },
  { id: '總部會議', icon: '🏢', badgeCls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  { id: '教育訓練', icon: '📚', badgeCls: 'bg-purple-50 text-purple-800 border-purple-200' },
  { id: '排休/休假', icon: '🌴', badgeCls: 'bg-slate-100 text-slate-700 border-slate-300' },
  { id: '其他公務', icon: '📌', badgeCls: 'bg-teal-50 text-teal-800 border-teal-200' },
] as const;

/**
 * 依據基準日期字串 (YYYY-MM-DD) 計算該週週一至週日的 7 天日期陣列
 */
const buildWeekDates = (anchorDateStr: string, weekOffset = 0): string[] => {
  const [y, m, d] = anchorDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + weekOffset * 7));
  const dow = dt.getUTCDay(); // 0=Sun..6=Sat
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + diffToMon));
  return Array.from({ length: 7 }, (_, idx) => {
    const dayDt = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + idx));
    return dayDt.toISOString().slice(0, 10);
  });
};

const getScheduleBadgeMeta = (scheduleType: string, role: string) => {
  const allTypes = [...MANAGER_SCHEDULE_TYPES, ...BEAUTY_SCHEDULE_TYPES];
  const found = allTypes.find(t => t.id === scheduleType);
  if (found) return found;
  return role === 'beauty_director'
    ? { id: scheduleType, icon: '🌸', badgeCls: 'bg-rose-50 text-rose-800 border-rose-200' }
    : { id: scheduleType, icon: '🏪', badgeCls: 'bg-blue-50 text-blue-800 border-blue-200' };
};

/**
 * 獨立預排行程管理中心（涵蓋「每一位區經理預排行程」與「美容總監預排行程」）
 * 支援週曆矩陣檢視、手機卡片操作、單次多店勾選快排、實績自動對帳與一鍵帶入填寫巡店表
 */
export const PlannedSchedulePanel: React.FC<Props> = ({ managers, allActivities }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const todayStr = getTaipeiTodayStr();

  const [anchorDate, setAnchorDate] = useState<string>(todayStr);
  const [roleTab, setRoleTab] = useState<'all' | 'manager' | 'beauty_director'>(() => {
    if (user?.role === 'beauty_director') return 'beauty_director';
    if (user?.role === 'manager') return 'manager';
    return 'all';
  });
  const [deptSubFilter, setDeptSubFilter] = useState<'all' | '營業一處' | '營業二處'>('all');
  const [onlyShowUnplanned, setOnlyShowUnplanned] = useState<boolean>(false);
  const [compactExecutiveTable, setCompactExecutiveTable] = useState<boolean>(
    () => user?.role === 'admin'
  );
  const [personKeyword, setPersonKeyword] = useState<string>('');

  const [schedules, setSchedules] = useState<PlannedScheduleItem[]>([]);
  const [serverAreaManagers, setServerAreaManagers] = useState<RosterPerson[]>([]);
  const [serverBeautyDirectors, setServerBeautyDirectors] = useState<RosterPerson[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  // 新增／編輯彈窗狀態
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<PlannedScheduleItem | null>(null);
  const [formPersonName, setFormPersonName] = useState<string>('');
  const [formPersonRole, setFormPersonRole] = useState<'manager' | 'beauty_director'>('manager');
  const [formDate, setFormDate] = useState<string>(todayStr);
  const [formTimeSlot, setFormTimeSlot] = useState<'上午' | '下午' | '全天'>('全天');
  const [formScheduleType, setFormScheduleType] = useState<string>('門市巡店');
  const [formSelectedStores, setFormSelectedStores] = useState<string[]>([]);
  const [formSingleStore, setFormSingleStore] = useState<string>('');
  const [formNote, setFormNote] = useState<string>('');
  const [storeFilterKeyword, setStoreFilterKeyword] = useState<string>('');

  const weekDates = useMemo(() => buildWeekDates(anchorDate, 0), [anchorDate]);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  // 本地保底名冊（若伺服器尚未回傳或離線時，從既有 managers 與 BEAUTY_DIRECTORS 合成完整名冊）
  const fallbackRoster = useMemo(() => {
    const mgrMap = new Map<string, RosterPerson>();
    for (const m of managers) {
      if (!m.storeName || m.storeName.includes('測試')) continue;
      for (const [name, title] of [
        [m.areaManagerName, '區經理'],
        [m.deputyManagerName, '副區主管'],
      ] as const) {
        const trimmed = (name || '').trim();
        if (!trimmed || trimmed === '無' || trimmed === '陳育廷') continue;
        if (!mgrMap.has(trimmed)) {
          mgrMap.set(trimmed, {
            name: trimmed,
            role: 'manager',
            title,
            department: getBusinessDepartment(m.region) || m.department || '',
            supervisor: m.directorName || '',
            region: m.region || '',
            nickname: '',
            stores: [],
          });
        }
        const entry = mgrMap.get(trimmed)!;
        if (title === '區經理') entry.title = '區經理';
        if (!entry.stores.includes(m.storeName)) {
          entry.stores.push(m.storeName);
        }
      }
    }

    const allStoresFlat: Array<{ region: string; store: string }> = [];
    for (const [reg, stList] of Object.entries(storeRegions)) {
      for (const st of stList) {
        allStoresFlat.push({ region: reg, store: st });
      }
    }

    const bds: RosterPerson[] = BEAUTY_DIRECTORS_CONFIG.map(bd => ({
      name: bd.name,
      role: 'beauty_director',
      title: '美容總監',
      department: bd.department,
      supervisor: bd.supervisor,
      region: bd.department === '美容一處' ? '新北/北桃/竹苗/宜花/嘉南' : '中投/彰雲/高雄/高屏',
      nickname: bd.nickname,
      stores: allStoresFlat
        .filter(x => isRegionInBeautyDirectorScope(x.region, bd.department))
        .map(x => x.store),
    }));

    return {
      areaManagers: Array.from(mgrMap.values()),
      beautyDirectors: bds,
    };
  }, [managers]);

  const fetchWeekSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        start_date: weekStart,
        end_date: weekEnd,
      });
      const res = await fetch(`${API_BASE_URL}/planned-schedules?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        setSchedules(Array.isArray(json.schedules) ? json.schedules : []);
        if (Array.isArray(json.areaManagers) && json.areaManagers.length > 0) {
          setServerAreaManagers(json.areaManagers);
        }
        if (Array.isArray(json.beautyDirectors) && json.beautyDirectors.length > 0) {
          setServerBeautyDirectors(json.beautyDirectors);
        }
      }
    } catch {
      // 保留目前畫面資料
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    fetchWeekSchedules();
  }, [fetchWeekSchedules]);

  // 依登入者權限決定可見之「區經理名冊」與「美容總監名冊」
  const areaManagersRoster = useMemo(() => {
    if (user?.role === 'beauty_director') return [];
    const base =
      serverAreaManagers.length > 0 ? serverAreaManagers : fallbackRoster.areaManagers;
    const activeManagers = base
      .filter(p => p.name !== '陳育廷')
      .map(p => ({ ...p, department: getBusinessDepartment(p.region) || p.department }));
    const scoped =
      user?.role === 'manager'
        ? activeManagers.filter(p => p.name === user.name || p.stores.some(s => user.assigned_stores?.includes(s)))
        : activeManagers;
    const q = personKeyword.trim().toLowerCase();
    return scoped.filter(p => {
      if (deptSubFilter !== 'all' && p.department !== deptSubFilter) return false;
      if (onlyShowUnplanned && schedules.some(s => s.personName === p.name)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.region.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q)
      );
    });
  }, [user, serverAreaManagers, fallbackRoster.areaManagers, personKeyword, deptSubFilter, onlyShowUnplanned, schedules]);

  const beautyDirectorsRoster = useMemo(() => {
    if (user?.role === 'manager') return [];
    const base =
      serverBeautyDirectors.length > 0 ? serverBeautyDirectors : fallbackRoster.beautyDirectors;
    const scoped =
      user?.role === 'beauty_director' ? base.filter(p => p.name === user.name) : base;
    const q = personKeyword.trim().toLowerCase();
    return scoped.filter(p => {
      if (onlyShowUnplanned && schedules.some(s => s.personName === p.name)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.nickname.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q)
      );
    });
  }, [user, serverBeautyDirectors, fallbackRoster.beautyDirectors, personKeyword, onlyShowUnplanned, schedules]);

  // 建立「實際已執行巡店／公務紀錄」快速查詢索引，自動判斷預排是否已完成
  const completedActivityLookup = useMemo(() => {
    const storeVisitSet = new Set<string>();
    const scheduleSet = new Set<string>();
    for (const act of allActivities) {
      const dStr = getTaipeiDateStr(act.createdAt);
      const mgr = (act.areaManagerName || '').trim();
      if (!dStr || !mgr) continue;
      if (['總部行程', '會議行程', '特殊行程'].includes(act.actionType || '')) {
        scheduleSet.add(`${mgr}|${dStr}`);
      } else if (act.storeName) {
        storeVisitSet.add(`${mgr}|${dStr}|${normalizeStoreName(act.storeName)}`);
        // 同區域正副主管若當天已巡該店也視為該店當日已巡
        storeVisitSet.add(`*|${dStr}|${normalizeStoreName(act.storeName)}|${act.auditType === 'beauty' ? 'beauty' : 'ops'}`);
      }
    }
    return { storeVisitSet, scheduleSet };
  }, [allActivities]);

  const isScheduleCompleted = useCallback(
    (item: PlannedScheduleItem): boolean => {
      if (item.storeName) {
        const normSt = normalizeStoreName(item.storeName);
        if (completedActivityLookup.storeVisitSet.has(`${item.personName}|${item.scheduleDate}|${normSt}`)) {
          return true;
        }
        if (
          item.personRole === 'manager' &&
          completedActivityLookup.storeVisitSet.has(`*|${item.scheduleDate}|${normSt}|ops`)
        ) {
          return true;
        }
      } else if (['總部會議', '教育訓練', '其他公務'].includes(item.scheduleType)) {
        return completedActivityLookup.scheduleSet.has(`${item.personName}|${item.scheduleDate}`);
      }
      return false;
    },
    [completedActivityLookup]
  );

  // 將本週預排行程依 `personName|date` 分組
  const schedulesByPersonAndDate = useMemo(() => {
    const map = new Map<string, PlannedScheduleItem[]>();
    for (const s of schedules) {
      const key = `${s.personName}|${s.scheduleDate}`;
      const arr = map.get(key) || [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  }, [schedules]);

  // 本週統計指標
  const weekStats = useMemo(() => {
    const totalCount = schedules.length;
    const mgrNamesWithPlan = new Set(
      schedules.filter(s => s.personRole === 'manager').map(s => s.personName)
    ).size;
    const bdNamesWithPlan = new Set(
      schedules.filter(s => s.personRole === 'beauty_director').map(s => s.personName)
    ).size;
    const trackable = schedules.filter(s => s.scheduleType !== '排休/休假');
    const completed = trackable.filter(s => isScheduleCompleted(s)).length;
    const completionRate =
      trackable.length > 0 ? Math.round((completed / trackable.length) * 100) : 0;

    return {
      totalCount,
      mgrNamesWithPlan,
      bdNamesWithPlan,
      completed,
      trackableTotal: trackable.length,
      completionRate,
    };
  }, [schedules, isScheduleCompleted]);

  // 所有可選人員（供彈窗下拉選擇）
  const allSelectablePeople = useMemo(
    () => [...areaManagersRoster, ...beautyDirectorsRoster],
    [areaManagersRoster, beautyDirectorsRoster]
  );

  const selectedPersonInfo = useMemo(
    () => allSelectablePeople.find(p => p.name === formPersonName) || null,
    [allSelectablePeople, formPersonName]
  );

  // 彈窗內該人員可勾選的門市清單
  const availableStoresForForm = useMemo(() => {
    let baseStores: string[] = [];
    if (selectedPersonInfo && selectedPersonInfo.stores.length > 0) {
      baseStores = selectedPersonInfo.stores;
    } else if (formPersonRole === 'beauty_director') {
      const dept = selectedPersonInfo?.department || user?.department || '美容一處';
      for (const [reg, list] of Object.entries(storeRegions)) {
        if (isRegionInBeautyDirectorScope(reg, dept)) {
          baseStores.push(...list);
        }
      }
    } else {
      for (const list of Object.values(storeRegions)) {
        baseStores.push(...list);
      }
    }
    const unique = Array.from(new Set(baseStores));
    const q = storeFilterKeyword.trim().toLowerCase();
    if (!q) return unique;
    return unique.filter(s => s.toLowerCase().includes(q));
  }, [selectedPersonInfo, formPersonRole, user?.department, storeFilterKeyword]);

  // 開啟「新增預排行程」彈窗
  const openCreateModal = (person: RosterPerson, dateStr?: string) => {
    setEditingItem(null);
    setFormPersonName(person.name);
    setFormPersonRole(person.role);
    setFormDate(dateStr || (anchorDate >= weekStart && anchorDate <= weekEnd ? anchorDate : weekStart));
    setFormTimeSlot('全天');
    setFormScheduleType(person.role === 'beauty_director' ? '美容巡店' : '門市巡店');
    setFormSelectedStores([]);
    setFormSingleStore('');
    setFormNote('');
    setStoreFilterKeyword('');
    setModalOpen(true);
  };

  // 開啟「編輯預排行程」彈窗
  const openEditModal = (item: PlannedScheduleItem) => {
    setEditingItem(item);
    setFormPersonName(item.personName);
    setFormPersonRole(item.personRole);
    setFormDate(item.scheduleDate);
    setFormTimeSlot((item.timeSlot as '上午' | '下午' | '全天') || '全天');
    setFormScheduleType(item.scheduleType);
    setFormSingleStore(item.storeName || '');
    setFormSelectedStores(item.storeName ? [item.storeName] : []);
    setFormNote(item.note || '');
    setStoreFilterKeyword('');
    setModalOpen(true);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const isStoreVisitType =
      formScheduleType === '門市巡店' ||
      formScheduleType === '美容巡店' ||
      formScheduleType === '技術考核/輔導';

    if (!editingItem && isStoreVisitType && formScheduleType !== '技術考核/輔導' && formSelectedStores.length === 0) {
      alert('請至少勾選 1 間預計巡視的門市');
      return;
    }

    setSaving(true);
    try {
      if (editingItem) {
        const res = await fetch(`${API_BASE_URL}/planned-schedules/${encodeURIComponent(editingItem.id)}`, {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            scheduleDate: formDate,
            timeSlot: formTimeSlot,
            scheduleType: formScheduleType,
            storeName: isStoreVisitType ? formSingleStore : '',
            note: formNote.trim(),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || '更新預排行程失敗');
        }
      } else {
        const res = await fetch(`${API_BASE_URL}/planned-schedules`, {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            personName: formPersonName,
            personRole: formPersonRole,
            department: selectedPersonInfo?.department || '',
            region: selectedPersonInfo?.region || '',
            scheduleDate: formDate,
            timeSlot: formTimeSlot,
            scheduleType: formScheduleType,
            storeNames: isStoreVisitType ? formSelectedStores : [],
            note: formNote.trim(),
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || '新增預排行程失敗');
        }
      }

      setModalOpen(false);
      await fetchWeekSchedules();
    } catch (err) {
      alert(err instanceof Error ? err.message : '網路連線異常，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSchedule = async (item: PlannedScheduleItem) => {
    if (saving) return;
    const label = item.storeName ? `${item.scheduleDate} ${item.storeName}` : `${item.scheduleDate} ${item.scheduleType}`;
    if (!window.confirm(`確定要刪除「${item.personName} — ${label}」這筆預排行程嗎？`)) return;

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/planned-schedules/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '刪除失敗');
      }
      setModalOpen(false);
      await fetchWeekSchedules();
    } catch (err) {
      alert(err instanceof Error ? err.message : '網路連線異常，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  // 匯出當前週次預排行程 CSV
  const handleExportCsv = () => {
    const header = ['日期', '星期', '角色', '處別', '區域', '姓名', '時段', '行程類型', '預計門市', '重點備註', '執行狀態'];
    const lines = [header.join(',')];

    const sorted = [...schedules].sort((a, b) =>
      `${a.personRole}-${a.personName}-${a.scheduleDate}`.localeCompare(
        `${b.personRole}-${b.personName}-${b.scheduleDate}`,
        'zh-TW'
      )
    );
    for (const s of sorted) {
      const dIdx = weekDates.indexOf(s.scheduleDate);
      const wd = dIdx >= 0 ? WEEKDAY_LABELS[dIdx] : '';
      const roleLabel = s.personRole === 'beauty_director' ? '美容總監' : '區經理';
      const statusLabel =
        s.scheduleType === '排休/休假'
          ? '排休'
          : isScheduleCompleted(s)
          ? '已完成'
          : '預排中';
      const cols = [
        s.scheduleDate,
        wd,
        roleLabel,
        s.department,
        s.region,
        s.personName,
        s.timeSlot,
        s.scheduleType,
        s.storeName,
        (s.note || '').replace(/"/g, '""'),
        statusLabel,
      ].map(v => `"${v}"`);
      lines.push(cols.join(','));
    }

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `預排行程表_${weekStart}_至_${weekEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * 渲染單一人員列（桌面端 7 日週曆格子 ＋ 手機端清晰按日卡片）
   */
  const renderPersonScheduleRow = (person: RosterPerson) => {
    const isBeauty = person.role === 'beauty_director';
    const personWeekItems = schedules.filter(s => s.personName === person.name);
    const canManage =
      user?.role === 'admin' ||
      user?.name === person.name ||
      (user?.role === 'manager' && person.role === 'manager');

    return (
      <div
        key={`${person.role}-${person.name}`}
        className={`bg-white rounded-2xl border shadow-2xs overflow-hidden ${
          isBeauty ? 'border-rose-200' : 'border-slate-200'
        }`}
      >
        {/* 人員標頭列 */}
        <div
          className={`px-3.5 sm:px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 ${
            isBeauty
              ? 'bg-gradient-to-r from-rose-50 via-fuchsia-50 to-purple-50 border-rose-100'
              : 'bg-slate-50/90 border-slate-200/80'
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span
              className={`px-2 py-0.5 rounded-md text-[11px] font-black ${
                isBeauty ? 'bg-rose-600 text-white' : 'bg-blue-600 text-white'
              }`}
            >
              {isBeauty ? '🌸 美容總監' : `👔 ${person.title}`}
            </span>
            <span className="text-sm sm:text-base font-extrabold text-slate-900">
              {person.name}
              {person.nickname ? ` (${person.nickname})` : ''}
            </span>
            {person.department && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700">
                {person.department}
              </span>
            )}
            {person.region && (
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-0.5">
                <MapPin size={12} className={isBeauty ? 'text-rose-500' : 'text-blue-500'} />
                {person.region}
              </span>
            )}
            {person.supervisor && isBeauty && (
              <span className="text-[11px] font-semibold text-rose-700">
                直屬長官：{person.supervisor}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600">
              本週已排 <strong className={isBeauty ? 'text-rose-600' : 'text-blue-600'}>{personWeekItems.length}</strong> 筆
            </span>
            {canManage && (
              <button
                type="button"
                onClick={() => openCreateModal(person)}
                className={`min-h-[34px] inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-extrabold text-white shadow-2xs active:scale-95 cursor-pointer transition-all ${
                  isBeauty
                    ? 'bg-gradient-to-r from-rose-600 to-fuchsia-600 hover:from-rose-500 hover:to-fuchsia-500'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <Plus size={13} />
                <span>新增預排</span>
              </button>
            )}
          </div>
        </div>

        {/* 桌面端（>= lg）：週一 ～ 週日 7 欄行事曆矩陣 */}
        <div className="hidden lg:grid lg:grid-cols-7 divide-x divide-slate-100">
          {weekDates.map((dStr, idx) => {
            const dayItems = schedulesByPersonAndDate.get(`${person.name}|${dStr}`) || [];
            const isToday = dStr === todayStr;
            return (
              <div
                key={dStr}
                className={`p-2.5 min-h-[124px] flex flex-col justify-between gap-1.5 transition-colors ${
                  isToday ? 'bg-blue-50/40' : 'bg-white hover:bg-slate-50/50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span
                      className={`text-[11px] font-extrabold px-1.5 py-0.5 rounded-md ${
                        isToday
                          ? 'bg-blue-600 text-white'
                          : idx >= 5
                          ? 'text-rose-600 bg-rose-50'
                          : 'text-slate-600 bg-slate-100'
                      }`}
                    >
                      {WEEKDAY_LABELS[idx]} {dStr.slice(5).replace('-', '/')}
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => openCreateModal(person, dStr)}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer transition-colors"
                        title={`新增 ${person.name} 於 ${dStr} 之預排行程`}
                      >
                        <Plus size={13} />
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {dayItems.map(item => {
                      const badge = getScheduleBadgeMeta(item.scheduleType, item.personRole);
                      const done = isScheduleCompleted(item);
                      const canGoAudit =
                        !done &&
                        Boolean(item.storeName) &&
                        dStr <= todayStr &&
                        (user?.name === item.personName || user?.role === 'admin');

                      return (
                        <div
                          key={item.id}
                          onClick={() => canManage && openEditModal(item)}
                          className={`group rounded-lg border p-1.5 text-xs transition-all ${
                            done
                              ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
                              : badge.badgeCls
                          } ${canManage ? 'cursor-pointer hover:shadow-xs' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-extrabold truncate">
                              {badge.icon} {item.storeName || item.scheduleType}
                            </span>
                            {item.timeSlot !== '全天' && (
                              <span className="text-[10px] font-bold px-1 rounded bg-white/80 shrink-0">
                                {item.timeSlot}
                              </span>
                            )}
                          </div>
                          {item.note && (
                            <div className="text-[10px] opacity-80 truncate mt-0.5" title={item.note}>
                              {item.note}
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-1 mt-1">
                            {done ? (
                              <span className="text-[10px] font-black text-emerald-700 flex items-center gap-0.5">
                                ✓ 已完成
                              </span>
                            ) : (
                              <span className="text-[10px] opacity-65">預排中</span>
                            )}
                            {canGoAudit && (
                              <button
                                type="button"
                                onClick={ev => {
                                  ev.stopPropagation();
                                  navigate(
                                    item.personRole === 'beauty_director'
                                      ? `/beauty-audit?store=${encodeURIComponent(item.storeName)}`
                                      : `/audit?store=${encodeURIComponent(item.storeName)}`
                                  );
                                }}
                                className="text-[10px] font-black text-blue-700 hover:underline inline-flex items-center gap-0.5"
                                title="直接帶入此門市填寫巡店表"
                              >
                                去填表 <ExternalLink size={9} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 手機與平板端（< lg）：直覺單手操作清單 ＋ 快速點日新增 */}
        <div className="lg:hidden p-3 space-y-2.5">
          {/* 7 日快速點選新增橫滑條 */}
          {canManage && (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {weekDates.map((dStr, idx) => {
                const count = (schedulesByPersonAndDate.get(`${person.name}|${dStr}`) || []).length;
                const isToday = dStr === todayStr;
                return (
                  <button
                    key={dStr}
                    type="button"
                    onClick={() => openCreateModal(person, dStr)}
                    className={`shrink-0 min-h-[40px] px-2.5 py-1 rounded-xl border text-left flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-all ${
                      isToday
                        ? 'bg-blue-600 text-white border-blue-600'
                        : count > 0
                        ? 'bg-indigo-50/70 text-indigo-900 border-indigo-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}
                  >
                    <span className="text-[10px] font-bold">
                      {WEEKDAY_LABELS[idx]} {dStr.slice(8)}日
                    </span>
                    <span className="text-[10px] font-black">
                      {count > 0 ? `已排 ${count}` : '+ 排程'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {personWeekItems.length === 0 ? (
            <div className="text-xs text-slate-400 py-3 text-center bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
              本週尚無預排行程，點選上方日期或右上角「＋ 新增預排」即可排定。
            </div>
          ) : (
            <div className="space-y-2">
              {personWeekItems.map(item => {
                const dIdx = weekDates.indexOf(item.scheduleDate);
                const wdLabel = dIdx >= 0 ? WEEKDAY_LABELS[dIdx] : '';
                const badge = getScheduleBadgeMeta(item.scheduleType, item.personRole);
                const done = isScheduleCompleted(item);
                const canGoAudit =
                  !done &&
                  Boolean(item.storeName) &&
                  item.scheduleDate <= todayStr &&
                  (user?.name === item.personName || user?.role === 'admin');

                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 ${
                      done ? 'bg-emerald-50/60 border-emerald-300' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-black px-2 py-0.5 rounded-md bg-slate-100 text-slate-800">
                          {item.scheduleDate.slice(5).replace('-', '/')} ({wdLabel})
                        </span>
                        {item.timeSlot !== '全天' && (
                          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                            {item.timeSlot}
                          </span>
                        )}
                        <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full border ${badge.badgeCls}`}>
                          {badge.icon} {item.storeName || item.scheduleType}
                        </span>
                        {done && (
                          <span className="text-[11px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                            ✓ 已完成巡店
                          </span>
                        )}
                      </div>
                      {item.note && (
                        <div className="text-xs text-slate-600 mt-1 leading-snug">{item.note}</div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {canGoAudit && (
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              item.personRole === 'beauty_director'
                                ? `/beauty-audit?store=${encodeURIComponent(item.storeName)}`
                                : `/audit?store=${encodeURIComponent(item.storeName)}`
                            )
                          }
                          className="min-h-[34px] px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-extrabold cursor-pointer"
                        >
                          去填表
                        </button>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
                          title="編輯或刪除此預排"
                        >
                          <Edit3 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* 頂部橫幅與週次控制列 */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-md space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-indigo-500/25 border border-indigo-400/30 flex items-center justify-center shrink-0">
              <Calendar size={21} className="text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-300 text-slate-950">
                  獨立排程中心
                </span>
                <h2 className="text-base sm:text-xl font-extrabold">
                  {user?.role === 'beauty_director'
                    ? '美容總監個人預排行程管理'
                    : user?.role === 'manager'
                    ? '區經理預排行程管理'
                    : '區經理 ＆ 美容總監 預排行程總覽'}
                </h2>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                支援預排本週／下週／未來巡店門市與公務會議，並與實際巡店回報紀錄自動比對達成狀態
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={schedules.length === 0}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white text-xs font-bold border border-white/15 cursor-pointer transition-colors"
          >
            <Download size={14} />
            <span>匯出本週預排 CSV</span>
          </button>
        </div>

        {/* 週次切換與角色篩選列 */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-white/10">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setAnchorDate(buildWeekDates(anchorDate, -1)[0])}
              className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <ChevronLeft size={14} />
              <span>上一週</span>
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate(todayStr)}
              className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-extrabold cursor-pointer ${
                weekStart <= todayStr && todayStr <= weekEnd
                  ? 'bg-amber-300 text-slate-950'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              本週
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate(buildWeekDates(todayStr, 1)[0])}
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold cursor-pointer"
            >
              下一週
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate(buildWeekDates(anchorDate, 1)[0])}
              className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
            >
              <span>後一週</span>
              <ChevronRight size={14} />
            </button>

            <div className="flex items-center gap-1.5 bg-white/10 border border-white/15 rounded-xl px-2.5 py-1">
              <span className="text-[11px] text-slate-300 font-semibold">跳至週次：</span>
              <input
                type="date"
                value={anchorDate}
                onChange={e => e.target.value && setAnchorDate(e.target.value)}
                className="text-xs font-bold text-white bg-transparent outline-none cursor-pointer"
              />
            </div>

            <span className="text-xs font-extrabold text-amber-200 ml-1">
              📅 {weekStart.replace(/-/g, '/')} ～ {weekEnd.replace(/-/g, '/')}
            </span>
          </div>

          {/* 管理員專屬：快速切換檢視「長官一頁總表 / 詳細卡片」、「處別 / 角色 / 未排程過濾」與搜尋 */}
          {user?.role === 'admin' && (
            <div className="flex items-center gap-2 flex-wrap w-full">
              <button
                type="button"
                onClick={() => setCompactExecutiveTable(prev => !prev)}
                className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-extrabold border cursor-pointer transition-colors ${
                  compactExecutiveTable
                    ? 'bg-emerald-400 text-slate-950 border-emerald-300'
                    : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                }`}
              >
                {compactExecutiveTable ? '👑 長官一頁總表模式（開啟中）' : '切換為長官一頁總表'}
              </button>

              <div className="inline-flex rounded-xl bg-white/10 p-0.5 border border-white/15">
                {(
                  [
                    { id: 'all', label: '全部角色' },
                    { id: 'manager', label: '👔 區經理' },
                    { id: 'beauty_director', label: '🌸 美容總監' },
                  ] as const
                ).map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setRoleTab(t.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      roleTab === t.id ? 'bg-white text-slate-900' : 'text-slate-200 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {roleTab !== 'beauty_director' && (
                <div className="inline-flex rounded-xl bg-white/10 p-0.5 border border-white/15">
                  {(['all', '營業一處', '營業二處'] as const).map(dOpt => (
                    <button
                      key={dOpt}
                      type="button"
                      onClick={() => setDeptSubFilter(dOpt)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                        deptSubFilter === dOpt ? 'bg-amber-300 text-slate-950' : 'text-slate-200 hover:text-white'
                      }`}
                    >
                      {dOpt === 'all' ? '全部處別' : dOpt}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => setOnlyShowUnplanned(prev => !prev)}
                className={`min-h-[34px] px-2.5 py-1 rounded-xl text-xs font-bold border cursor-pointer transition-colors ${
                  onlyShowUnplanned
                    ? 'bg-rose-500 text-white border-rose-400'
                    : 'bg-white/10 text-amber-200 border-white/15 hover:bg-white/20'
                }`}
              >
                {onlyShowUnplanned ? '✓ 僅顯示本週未排程' : '⚠️ 篩選本週未排程'}
              </button>

              <div className="relative flex-1 min-w-[150px] sm:max-w-[200px] ml-auto">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={personKeyword}
                  onChange={e => setPersonKeyword(e.target.value)}
                  placeholder="搜尋主管或區域..."
                  className="w-full pl-7 pr-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-xs text-white placeholder-slate-400 outline-none focus:border-amber-300"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 本週預排 KPI 卡片（手機 2×2 緊湊排布） */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
        <div className="bg-white rounded-2xl border border-slate-200 border-t-4 border-t-indigo-600 p-3 sm:p-4 shadow-2xs">
          <div className="text-[11px] sm:text-xs font-extrabold text-indigo-700 flex items-center gap-1">
            <Calendar size={14} />
            <span>本週預排總筆數</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-1 tabular-nums">
            {weekStats.totalCount} <span className="text-xs font-bold text-slate-500">筆</span>
          </div>
          <div className="text-[11px] text-slate-500 font-semibold mt-1">
            {weekStart.slice(5)} ～ {weekEnd.slice(5)}
          </div>
        </div>

        {user?.role !== 'beauty_director' && (
          <div className="bg-white rounded-2xl border border-slate-200 border-t-4 border-t-blue-600 p-3 sm:p-4 shadow-2xs">
            <div className="text-[11px] sm:text-xs font-extrabold text-blue-700 flex items-center gap-1">
              <Users size={14} />
              <span>區經理已排人數</span>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-blue-600 mt-1 tabular-nums">
              {weekStats.mgrNamesWithPlan}{' '}
              <span className="text-xs font-bold text-slate-500">/ {areaManagersRoster.length} 位</span>
            </div>
            <div className="text-[11px] text-slate-500 font-semibold mt-1">
              涵蓋各區正／副區主管
            </div>
          </div>
        )}

        {user?.role !== 'manager' && (
          <div className="bg-white rounded-2xl border border-slate-200 border-t-4 border-t-rose-600 p-3 sm:p-4 shadow-2xs">
            <div className="text-[11px] sm:text-xs font-extrabold text-rose-700 flex items-center gap-1">
              <Sparkles size={14} />
              <span>美容總監已排人數</span>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-rose-600 mt-1 tabular-nums">
              {weekStats.bdNamesWithPlan}{' '}
              <span className="text-xs font-bold text-slate-500">/ {beautyDirectorsRoster.length} 位</span>
            </div>
            <div className="text-[11px] text-slate-500 font-semibold mt-1">
              美容一處 ＆ 美容二處
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 border-t-4 border-t-emerald-600 p-3 sm:p-4 shadow-2xs">
          <div className="text-[11px] sm:text-xs font-extrabold text-emerald-700 flex items-center gap-1">
            <CheckCircle2 size={14} />
            <span>預排實地達成率</span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-600 mt-1 tabular-nums">
            {weekStats.completionRate}%
          </div>
          <div className="text-[11px] text-slate-500 font-semibold mt-1">
            已完成 <strong className="text-emerald-700">{weekStats.completed}</strong> / {weekStats.trackableTotal} 筆
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 flex flex-col items-center justify-center gap-2 text-slate-500">
          <Loader2 size={26} className="animate-spin text-indigo-600" />
          <span className="text-xs font-bold">正在同步雲端預排行程表...</span>
        </div>
      ) : compactExecutiveTable && user?.role === 'admin' ? (
        /* ==================== 長官一頁式緊湊戰情總表（同屏一眼看穿全體區經理＆美容總監整週規劃） ==================== */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs sm:text-sm font-extrabold text-slate-900">
              👑 全體主管一頁式週預排總表（點擊任一格子可立即新增或修改）
            </div>
            <div className="flex items-center gap-3 text-[11px] font-bold text-slate-600">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> 已實際完成
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" /> 預排待執行
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400" /> 本週尚未排程
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs min-w-[920px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-100 px-3 py-2.5 text-left font-extrabold text-slate-700 border-b border-r border-slate-200 w-48">
                    主管姓名 ／ 處別區域
                  </th>
                  {weekDates.map((dStr, idx) => {
                    const isToday = dStr === todayStr;
                    return (
                      <th
                        key={dStr}
                        className={`px-2 py-2.5 text-center font-extrabold border-b border-r border-slate-200 ${
                          isToday ? '!bg-blue-50 !text-blue-800' : ''
                        }`}
                      >
                        <div>{WEEKDAY_LABELS[idx]}</div>
                        <div className="text-[11px] font-semibold opacity-80">
                          {dStr.slice(5).replace('-', '/')}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {[
                  ...(roleTab === 'beauty_director' ? [] : areaManagersRoster),
                  ...(roleTab === 'manager' ? [] : beautyDirectorsRoster),
                ].map(person => {
                  const isBeauty = person.role === 'beauty_director';
                  const totalForPerson = schedules.filter(s => s.personName === person.name).length;
                  return (
                    <tr key={`${person.role}-${person.name}`} className="border-b border-slate-100">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2.5 border-r border-slate-200 align-top">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-extrabold text-slate-900">
                            {isBeauty ? '🌸 ' : '👔 '}
                            {person.name}
                            {person.nickname ? ` (${person.nickname})` : ''}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                              totalForPerson === 0
                                ? 'bg-amber-100 text-amber-800'
                                : isBeauty
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {totalForPerson === 0 ? '未排' : `${totalForPerson}筆`}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {person.department}
                          {person.region ? ` · ${person.region}` : ''}
                        </div>
                      </td>

                      {weekDates.map(dStr => {
                        const cellItems = schedulesByPersonAndDate.get(`${person.name}|${dStr}`) || [];
                        const isToday = dStr === todayStr;
                        return (
                          <td
                            key={dStr}
                            onClick={() => {
                              if (cellItems.length === 0) openCreateModal(person, dStr);
                            }}
                            className={`px-1.5 py-2 border-r border-slate-100 align-top min-w-[108px] cursor-pointer hover:bg-slate-50 ${
                              isToday ? 'bg-blue-50/30' : ''
                            }`}
                          >
                            <div className="space-y-1">
                              {cellItems.map(item => {
                                const done = isScheduleCompleted(item);
                                return (
                                  <div
                                    key={item.id}
                                    onClick={ev => {
                                      ev.stopPropagation();
                                      openEditModal(item);
                                    }}
                                    className={`px-1.5 py-1 rounded border text-[11px] font-bold leading-tight hover:shadow-2xs ${
                                      done
                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                        : isBeauty
                                        ? 'bg-rose-50 text-rose-900 border-rose-200'
                                        : 'bg-blue-50 text-blue-900 border-blue-200'
                                    }`}
                                    title={item.note ? `${item.storeName || item.scheduleType}｜${item.note}` : undefined}
                                  >
                                    <div className="truncate">
                                      {item.timeSlot !== '全天' ? `[${item.timeSlot}] ` : ''}
                                      {item.storeName || item.scheduleType}
                                    </div>
                                  </div>
                                );
                              })}
                              <button
                                type="button"
                                onClick={ev => {
                                  ev.stopPropagation();
                                  openCreateModal(person, dStr);
                                }}
                                className="w-full py-0.5 rounded text-[10px] font-bold text-slate-400 hover:text-blue-600 hover:bg-blue-50/80 transition-colors cursor-pointer"
                              >
                                + 排程
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ==================== 專區一：每一位區經理預排行程 ==================== */}
          {(roleTab === 'all' || roleTab === 'manager') && user?.role !== 'beauty_director' && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2 px-1">
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <span className="w-2.5 h-5 rounded-full bg-blue-600 inline-block" />
                  <span>👔 區經理預排行程（共 {areaManagersRoster.length} 位）</span>
                </h3>
                <span className="text-xs text-slate-500 font-semibold hidden sm:inline">
                  點擊任一日期「＋」可快速排定單間或多間順路門市
                </span>
              </div>

              <div className="space-y-3.5">
                {areaManagersRoster.map(person => renderPersonScheduleRow(person))}
              </div>
            </section>
          )}

          {/* ==================== 專區二：美容總監預排行程 ==================== */}
          {(roleTab === 'all' || roleTab === 'beauty_director') && user?.role !== 'manager' && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2 px-1">
                <h3 className="text-sm sm:text-base font-extrabold text-rose-950 flex items-center gap-2">
                  <span className="w-2.5 h-5 rounded-full bg-rose-600 inline-block" />
                  <span>🌸 美容總監預排行程（共 {beautyDirectorsRoster.length} 位）</span>
                </h3>
                <span className="text-xs text-rose-700 font-semibold hidden sm:inline">
                  美容一處與美容二處獨立管理，自動對應轄屬區域門市
                </span>
              </div>

              <div className="space-y-3.5">
                {beautyDirectorsRoster.map(person => renderPersonScheduleRow(person))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ==================== 新增／編輯預排行程彈窗 ==================== */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
          onClick={() => !saving && setModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 p-4 sm:p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  {editingItem ? '✏️ 編輯預排行程' : '➕ 新增預排行程'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  排定後將即時儲存於雲端資料庫並同步至預排週曆
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveSchedule} className="space-y-4">
              {/* 人員選擇（管理員新增時可自由切換；編輯或個人登入時唯讀鎖定） */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    排程人員
                  </label>
                  {user?.role === 'admin' && !editingItem ? (
                    <select
                      value={formPersonName}
                      onChange={e => {
                        const nextName = e.target.value;
                        setFormPersonName(nextName);
                        const found = allSelectablePeople.find(p => p.name === nextName);
                        if (found) {
                          setFormPersonRole(found.role);
                          setFormScheduleType(found.role === 'beauty_director' ? '美容巡店' : '門市巡店');
                          setFormSelectedStores([]);
                        }
                      }}
                      className="w-full min-h-[42px] px-3 py-2 text-sm font-bold border border-slate-300 rounded-xl outline-none"
                    >
                      {allSelectablePeople.map(p => (
                        <option key={`${p.role}-${p.name}`} value={p.name}>
                          [{p.role === 'beauty_director' ? '美容總監' : p.title}] {p.name}
                          {p.region ? `（${p.region}）` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                      <span>{formPersonRole === 'beauty_director' ? '🌸' : '👔'}</span>
                      <span>{formPersonName}</span>
                    </div>
                  )}
                </div>

                {/* 日期與時段 */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">
                      預排日期
                    </label>
                    <input
                      type="date"
                      required
                      value={formDate}
                      onChange={e => e.target.value && setFormDate(e.target.value)}
                      className="w-full min-h-[42px] px-2.5 py-2 text-sm font-bold bg-white border border-slate-300 rounded-xl outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-extrabold text-slate-700 mb-1">
                      <Clock size={12} className="inline mr-1" />
                      時段
                    </label>
                    <div className="grid grid-cols-3 gap-1">
                      {TIME_SLOTS.map(slot => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setFormTimeSlot(slot)}
                          className={`min-h-[42px] rounded-xl text-xs font-extrabold border cursor-pointer transition-colors ${
                            formTimeSlot === slot
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* 行程類型選擇 */}
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                  行程類型
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(formPersonRole === 'beauty_director'
                    ? BEAUTY_SCHEDULE_TYPES
                    : MANAGER_SCHEDULE_TYPES
                  ).map(t => {
                    const active = formScheduleType === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setFormScheduleType(t.id)}
                        className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition-all ${
                          active
                            ? formPersonRole === 'beauty_director'
                              ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                              : 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span>{t.icon}</span>
                        <span>{t.id}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 門市選擇（新增時支援多間勾選一次排入；編輯單筆時為單選下拉） */}
              {(formScheduleType === '門市巡店' ||
                formScheduleType === '美容巡店' ||
                formScheduleType === '技術考核/輔導') && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
                  {editingItem ? (
                    <div>
                      <label className="block text-xs font-extrabold text-slate-700 mb-1">
                        預計巡視門市
                      </label>
                      <select
                        value={formSingleStore}
                        onChange={e => setFormSingleStore(e.target.value)}
                        className="w-full min-h-[42px] px-3 py-2 text-sm font-bold bg-white border border-slate-300 rounded-xl"
                      >
                        <option value="">-- 不指定特定門市 --</option>
                        {availableStoresForForm.map(st => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-extrabold text-slate-800">
                          勾選當日預計巡視門市（可複選多間順路門市，已選{' '}
                          <strong className="text-blue-600">{formSelectedStores.length}</strong> 間）：
                        </span>
                        {formSelectedStores.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setFormSelectedStores([])}
                            className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                          >
                            清空已選
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={storeFilterKeyword}
                        onChange={e => setStoreFilterKeyword(e.target.value)}
                        placeholder="輸入門市關鍵字快速篩選..."
                        className="w-full min-h-[38px] px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500"
                      />
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1">
                        {availableStoresForForm.map(st => {
                          const checked = formSelectedStores.includes(st);
                          return (
                            <button
                              key={st}
                              type="button"
                              onClick={() =>
                                setFormSelectedStores(prev =>
                                  prev.includes(st) ? prev.filter(x => x !== st) : [...prev, st]
                                )
                              }
                              className={`min-h-[38px] px-2.5 py-1.5 rounded-lg border text-xs font-bold text-left truncate cursor-pointer transition-all ${
                                checked
                                  ? formPersonRole === 'beauty_director'
                                    ? 'bg-rose-600 text-white border-rose-600'
                                    : 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
                              }`}
                            >
                              {checked ? '✓ ' : ''}
                              {st}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* 重點備註 */}
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  預計輔導重點／任務備註（選填）
                </label>
                <input
                  type="text"
                  value={formNote}
                  onChange={e => setFormNote(e.target.value)}
                  placeholder="例：追蹤上週缺失改善、美容師剪工考核、參加營運月會..."
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:border-blue-500"
                />
              </div>

              {/* 底部操作按鈕 */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                {editingItem ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleDeleteSchedule(editingItem)}
                    className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-extrabold cursor-pointer"
                  >
                    <Trash2 size={14} />
                    <span>刪除此預排</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className={`min-h-[42px] px-5 py-2 rounded-xl text-white text-xs sm:text-sm font-extrabold shadow-sm cursor-pointer disabled:opacity-60 ${
                      formPersonRole === 'beauty_director'
                        ? 'bg-gradient-to-r from-rose-600 to-fuchsia-600 hover:from-rose-500 hover:to-fuchsia-500'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {saving
                      ? '儲存中...'
                      : editingItem
                      ? '儲存變更'
                      : formSelectedStores.length > 1
                      ? `一次新增 ${formSelectedStores.length} 筆預排`
                      : '確認新增預排'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
