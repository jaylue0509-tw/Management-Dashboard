import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import {
  ArrowLeft,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  History,
  Mic,
  MicOff,
  Plus,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
  Sparkles,
  Store,
  Trash2,
  UserCheck,
  Users,
  AlertTriangle,
  Link2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL, getAuthHeaders } from '../api/api';
import { storeRegions } from '../data/storeRegions';
import {
  BEAUTY_AUDIT_MODES,
  BEAUTY_COACHING_TARGET_OPTIONS,
  BEAUTY_CORE_SAFETY_ITEMS,
  BEAUTY_TOPIC_GROUPS,
  type BeautyAuditMode,
  type BeautyCheckStatus,
  type BeautyOverallRating,
} from '../data/beautyAuditConfig';
import { getTaipeiTodayStr } from '../utils/time-utils';
import { normalizeStoreName } from '../utils/store-region';
import type { Manager } from '../types';

const DRAFT_STORAGE_KEY = 'beauty_director_audit_draft_v1';
const MAX_PHOTOS = 3;
const MAX_BACKFILL_DAYS = 5;

interface LastBeautyAuditData {
  hasHistory: boolean;
  recordId?: string;
  storeName?: string;
  taipeiDate?: string;
  areaManagerName?: string;
  auditMode?: string;
  selectedTopics?: number[];
  overallRating?: string;
  coachingNotes?: string;
  coachingTargets?: string[];
  beautyLeaderName?: string;
  storeManagerName?: string;
  defects?: { key: string; label: string; status: string; remark?: string; topicIndex?: number; isCore: boolean }[];
  suggestedTopicIndices?: number[];
}

interface PendingActionItem {
  id: string;
  storeName: string;
  auditDepartment?: string;
  category?: string;
  desc?: string;
  issueDescription?: string;
  assignee?: string;
  dueDate?: string;
  status?: string;
}

interface CustomCheckRow {
  id: string;
  label: string;
  status: BeautyCheckStatus;
  remark: string;
}

interface NewActionRow {
  id: string;
  desc: string;
  assignee: string;
  dueDate: string;
  crossDepartment: boolean;
}

interface UploadedBeautyPhoto {
  id: string;
  url: string;
  kind: '亮點照片' | '缺失存證';
}

const getTaipeiNowTimeStr = (): string =>
  new Date().toLocaleTimeString('zh-TW', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Taipei',
  });

const shiftTaipeiDate = (daysOffset: number): string => {
  const now = new Date();
  const target = new Date(now.getTime() + daysOffset * 86400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(target);
  const y = parts.find(p => p.type === 'year')?.value || '2026';
  const m = parts.find(p => p.type === 'month')?.value || '01';
  const d = parts.find(p => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
};

/**
 * 壓縮現場上傳照片至適合行動網路與資料庫儲存之尺寸（最長邊 1200px，JPEG 0.78）
 */
const compressImageFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1200;
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          if (width >= height) {
            height = Math.round((height * maxSide) / width);
            width = maxSide;
          } else {
            width = Math.round((width * maxSide) / height);
            height = maxSide;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = () => reject(new Error('圖片載入失敗'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('檔案讀取失敗'));
    reader.readAsDataURL(file);
  });

/**
 * 美容總監巡店表（第 0 層歷程回溯 ＋ 第 1～4 層完整行動端／桌面端專業巡檢系統）
 */
export const BeautyAuditApp: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const sigCanvasRef = useRef<SignatureCanvas | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const todayStr = getTaipeiTodayStr();
  const minDateStr = useMemo(() => shiftTaipeiDate(-MAX_BACKFILL_DAYS), []);
  const defaultDueDateStr = useMemo(() => shiftTaipeiDate(7), []);

  // 門市主檔（用於自動帶出區域與美容組長）
  const [managersCatalog, setManagersCatalog] = useState<Manager[]>([]);
  const [storeKeyword, setStoreKeyword] = useState('');

  // 第 1 層：基本資訊與模式選擇
  const [visitDate, setVisitDate] = useState<string>(todayStr);
  const [visitTime, setVisitTime] = useState<string>(getTaipeiNowTimeStr);
  const [storeName, setStoreName] = useState<string>('');
  const [storeRegion, setStoreRegion] = useState<string>('');
  const [storeManagerName, setStoreManagerName] = useState<string>('');
  const [beautyLeaderName, setBeautyLeaderName] = useState<string>('');
  const [directorName, setDirectorName] = useState<string>(() => user?.name || '');
  const [auditMode, setAuditMode] = useState<BeautyAuditMode>('B');
  const [selectedTopics, setSelectedTopics] = useState<number[]>([1, 4]);

  // 第 0 區塊：進店前歷程回溯與交辦追蹤
  const [lastAuditLoading, setLastAuditLoading] = useState(false);
  const [lastAuditData, setLastAuditData] = useState<LastBeautyAuditData | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingActionItem[]>([]);
  const [pdcaResults, setPdcaResults] = useState<Record<string, '已改善' | '未改善'>>({});

  // 第 2 層：必看安全與衛生底線
  const [coreChecks, setCoreChecks] = useState<Record<string, string>>({});
  const [coreRemarks, setCoreRemarks] = useState<Record<string, string>>({});

  // 第 3 層：六大核心大項庫 + 自訂擴充 + 6-3 / 6-4 技術輔導與職涯紀錄
  const [categoryChecks, setCategoryChecks] = useState<Record<string, BeautyCheckStatus>>({});
  const [categoryRemarks, setCategoryRemarks] = useState<Record<string, string>>({});
  const [customItemsByTopic, setCustomItemsByTopic] = useState<Record<number, CustomCheckRow[]>>({});
  const [coachingConducted, setCoachingConducted] = useState<boolean>(false);
  const [coachingTargets, setCoachingTargets] = useState<string[]>([]);
  const [coachingNotes, setCoachingNotes] = useState<string>('');

  // 第 4 層：表尾管理閉環
  const [photos, setPhotos] = useState<UploadedBeautyPhoto[]>([]);
  const [newActionItems, setNewActionItems] = useState<NewActionRow[]>([
    { id: 'act-1', desc: '', assignee: '美容組長', dueDate: defaultDueDateStr, crossDepartment: false },
    { id: 'act-2', desc: '', assignee: '店長', dueDate: defaultDueDateStr, crossDepartment: false },
  ]);
  const [overallRating, setOverallRating] = useState<BeautyOverallRating | ''>('');
  const [signerRole, setSignerRole] = useState<'美容組長' | '店長'>('美容組長');

  // 語音輸入狀態與送出狀態
  const [listeningField, setListeningField] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftSavedHint, setDraftSavedHint] = useState('');
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);

  // 載入門市主檔以自動對應美容組長與分區
  useEffect(() => {
    let active = true;
    fetch(`${API_BASE_URL}/managers`, { headers: getAuthHeaders() })
      .then(res => (res.ok ? res.json() : []))
      .then((list: Manager[]) => {
        if (active && Array.isArray(list)) {
          setManagersCatalog(list);
        }
      })
      .catch(() => {
        // 離線時退回內建 storeRegions 門市名單
      });
    return () => {
      active = false;
    };
  }, []);

  // 恢復草稿與 URL ?store= 預帶門市
  useEffect(() => {
    if (user?.name && !directorName) {
      setDirectorName(user.name);
    }
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.visitDate) setVisitDate(d.visitDate);
        if (d.visitTime) setVisitTime(d.visitTime);
        if (d.storeName) setStoreName(d.storeName);
        if (d.storeRegion) setStoreRegion(d.storeRegion);
        if (d.storeManagerName) setStoreManagerName(d.storeManagerName);
        if (d.beautyLeaderName) setBeautyLeaderName(d.beautyLeaderName);
        if (d.directorName) setDirectorName(d.directorName);
        if (d.auditMode) setAuditMode(d.auditMode);
        if (Array.isArray(d.selectedTopics)) setSelectedTopics(d.selectedTopics);
        if (d.coreChecks) setCoreChecks(d.coreChecks);
        if (d.coreRemarks) setCoreRemarks(d.coreRemarks);
        if (d.categoryChecks) setCategoryChecks(d.categoryChecks);
        if (d.categoryRemarks) setCategoryRemarks(d.categoryRemarks);
        if (d.customItemsByTopic) setCustomItemsByTopic(d.customItemsByTopic);
        if (typeof d.coachingConducted === 'boolean') setCoachingConducted(d.coachingConducted);
        if (Array.isArray(d.coachingTargets)) setCoachingTargets(d.coachingTargets);
        if (typeof d.coachingNotes === 'string') setCoachingNotes(d.coachingNotes);
        if (Array.isArray(d.newActionItems) && d.newActionItems.length > 0) {
          setNewActionItems(d.newActionItems);
        }
        if (d.overallRating) setOverallRating(d.overallRating);
        if (d.signerRole) setSignerRole(d.signerRole);
      }
    } catch {
      // 忽略損壞的草稿
    }

    const qStore = new URLSearchParams(window.location.search).get('store')?.trim();
    if (qStore) setStoreName(qStore);
    setIsDraftHydrated(true);
  }, [user?.name, directorName]);

  // 自動暫存文字草稿至本機（照片與簽名留在記憶體，避免超出 localStorage 容量）
  useEffect(() => {
    if (!isDraftHydrated) return;
    try {
      const payload = {
        visitDate,
        visitTime,
        storeName,
        storeRegion,
        storeManagerName,
        beautyLeaderName,
        directorName,
        auditMode,
        selectedTopics,
        coreChecks,
        coreRemarks,
        categoryChecks,
        categoryRemarks,
        customItemsByTopic,
        coachingConducted,
        coachingTargets,
        coachingNotes,
        newActionItems,
        overallRating,
        signerRole,
      };
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
      setDraftSavedHint('草稿已自動暫存');
    } catch {
      // 忽略儲存空間不足
    }
  }, [
    isDraftHydrated,
    visitDate,
    visitTime,
    storeName,
    storeRegion,
    storeManagerName,
    beautyLeaderName,
    directorName,
    auditMode,
    selectedTopics,
    coreChecks,
    coreRemarks,
    categoryChecks,
    categoryRemarks,
    customItemsByTopic,
    coachingConducted,
    coachingTargets,
    coachingNotes,
    newActionItems,
    overallRating,
    signerRole,
  ]);

  // 門市下拉選項清單（美容總監嚴格僅顯示自己所屬處別門市；管理員顯示全區門市）
  const isBeautyDirector = user?.role === 'beauty_director';
  const storeOptions = useMemo(() => {
    const map = new Map<string, { storeName: string; region: string; beautyLeader: string }>();
    const assignedSet = new Set(
      (user?.assigned_stores || []).map(s => normalizeStoreName(s))
    );

    if (!isBeautyDirector) {
      for (const [reg, stores] of Object.entries(storeRegions)) {
        for (const sName of stores) {
          map.set(normalizeStoreName(sName), { storeName: sName, region: reg, beautyLeader: '' });
        }
      }
    } else if (managersCatalog.length === 0 && assignedSet.size > 0) {
      // 離線備援：僅放入自己所屬處別之 assigned_stores
      for (const [reg, stores] of Object.entries(storeRegions)) {
        for (const sName of stores) {
          if (assignedSet.has(normalizeStoreName(sName))) {
            map.set(normalizeStoreName(sName), { storeName: sName, region: reg, beautyLeader: '' });
          }
        }
      }
    }

    for (const m of managersCatalog) {
      if (!m.storeName || m.storeName.includes('測試')) continue;
      if (isBeautyDirector) {
        const matchDept = user?.department && m.department === user.department;
        const matchSup = user?.supervisor && m.directorName === user.supervisor;
        const matchAssigned = assignedSet.has(normalizeStoreName(m.storeName));
        if (!matchDept && !matchSup && !matchAssigned) continue;
      }
      const key = normalizeStoreName(m.storeName);
      map.set(key, {
        storeName: m.storeName,
        region: m.region || map.get(key)?.region || '',
        beautyLeader: m.beautyLeader || '',
      });
    }
    const list = Array.from(map.values()).sort((a, b) =>
      `${a.region}-${a.storeName}`.localeCompare(`${b.region}-${b.storeName}`, 'zh-TW')
    );
    const q = storeKeyword.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      item =>
        item.storeName.toLowerCase().includes(q) ||
        item.region.toLowerCase().includes(q) ||
        item.beautyLeader.toLowerCase().includes(q)
    );
  }, [managersCatalog, storeKeyword, isBeautyDirector, user?.assigned_stores, user?.department, user?.supervisor]);

  // 選擇門市後，自動帶出該店上一次美容巡店摘要、未結案事項與上次輔導筆記（第 0 區塊連動）
  const fetchStoreHistory = useCallback(async (targetStore: string) => {
    if (!targetStore) {
      setLastAuditData(null);
      setPendingItems([]);
      setPdcaResults({});
      return;
    }
    setLastAuditLoading(true);
    try {
      const [lastRes, itemsRes] = await Promise.all([
        fetch(
          `${API_BASE_URL}/visit-records/last-audit?store=${encodeURIComponent(targetStore)}&audit_type=beauty`,
          { headers: getAuthHeaders() }
        ),
        fetch(`${API_BASE_URL}/action-items?store=${encodeURIComponent(targetStore)}`, {
          headers: getAuthHeaders(),
        }),
      ]);

      if (lastRes.ok) {
        const lastJson: LastBeautyAuditData = await lastRes.json();
        setLastAuditData(lastJson);
        // 若前次美容巡店有未填寫過之美容組長或店長，貼心回填
        if (lastJson.hasHistory) {
          if (lastJson.beautyLeaderName) setBeautyLeaderName(prev => prev || lastJson.beautyLeaderName || '');
          if (lastJson.storeManagerName) setStoreManagerName(prev => prev || lastJson.storeManagerName || '');
        }
      } else {
        setLastAuditData(null);
      }

      if (itemsRes.ok) {
        const allItems: PendingActionItem[] = await itemsRes.json();
        const openItems = (Array.isArray(allItems) ? allItems : []).filter(
          i => (i.status || 'Open') === 'Open'
        );
        // 美容部門待辦優先排在最上面，其次是營運跨部門待辦
        openItems.sort((a, b) => {
          const aScore = a.auditDepartment === '美容' ? 0 : 1;
          const bScore = b.auditDepartment === '美容' ? 0 : 1;
          return aScore - bScore;
        });
        setPendingItems(openItems);
      } else {
        setPendingItems([]);
      }
      setPdcaResults({});
    } catch {
      setLastAuditData(null);
      setPendingItems([]);
    } finally {
      setLastAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!storeName) return;
    const matched = storeOptions.find(
      s => normalizeStoreName(s.storeName) === normalizeStoreName(storeName)
    );
    if (matched) {
      setStoreRegion(matched.region);
      if (matched.beautyLeader) {
        setBeautyLeaderName(matched.beautyLeader);
      }
    }
    fetchStoreHistory(storeName);
  }, [storeName, storeOptions, fetchStoreHistory]);

  // 偵測第二層必看底線是否有任何零容忍紅線違規
  const hasCoreRedlineViolation = useMemo(
    () =>
      BEAUTY_CORE_SAFETY_ITEMS.some(item => {
        const val = coreChecks[item.id];
        return val === item.failLabel || val === '缺失' || val === '違規' || val === '待改善';
      }),
    [coreChecks]
  );

  // 任一必看安全底線觸發紅線時，自動將綜合評價聯動為「高風險（立即重點輔導）」
  useEffect(() => {
    if (hasCoreRedlineViolation && overallRating !== '高風險（立即重點輔導）') {
      setOverallRating('高風險（立即重點輔導）');
    }
  }, [hasCoreRedlineViolation, overallRating]);

  // 依據巡店模式計算第三層實際顯示的大項
  const visibleTopics = useMemo(() => {
    if (auditMode === 'A') return [];
    if (auditMode === 'C') return BEAUTY_TOPIC_GROUPS;
    return BEAUTY_TOPIC_GROUPS.filter(g => selectedTopics.includes(g.id));
  }, [auditMode, selectedTopics]);

  // 瀏覽器 Web Speech 語音輸入輔助（支援繁體中文）
  const triggerVoiceInput = (fieldId: string, onAppendText: (spoken: string) => void) => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert('目前瀏覽器不支援語音輸入，請改用手機鍵盤麥克風或直接輸入文字。');
      return;
    }

    const recognition = new SpeechRec() as {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onstart: () => void;
      onend: () => void;
      onerror: () => void;
      onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      start: () => void;
    };
    recognition.lang = 'zh-TW';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListeningField(fieldId);
    recognition.onend = () => setListeningField(null);
    recognition.onerror = () => setListeningField(null);
    recognition.onresult = event => {
      const spoken = event.results?.[0]?.[0]?.transcript?.trim();
      if (spoken) onAppendText(spoken);
    };
    recognition.start();
  };

  // 模式 B 切換主題（限制 1～3 個大項）
  const handleToggleTopicB = (topicId: number) => {
    setSelectedTopics(prev => {
      if (prev.includes(topicId)) {
        return prev.length > 1 ? prev.filter(id => id !== topicId) : prev;
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), topicId];
      }
      return [...prev, topicId].sort((a, b) => a - b);
    });
  };

  // 大項 3 一鍵全設 N/A（無住宿業務門市）
  const handleSetTopicAllNA = (topicId: number) => {
    const group = BEAUTY_TOPIC_GROUPS.find(g => g.id === topicId);
    if (!group) return;
    setCategoryChecks(prev => {
      const next = { ...prev };
      for (const item of group.items) {
        next[item.id] = 'N/A';
      }
      return next;
    });
  };

  // 自訂新增大項細目
  const handleAddCustomCheck = (topicId: number) => {
    setCustomItemsByTopic(prev => ({
      ...prev,
      [topicId]: [
        ...(prev[topicId] || []),
        {
          id: `b-${topicId}-custom-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          label: '',
          status: '合格',
          remark: '',
        },
      ],
    }));
  };

  const handleUpdateCustomCheck = (
    topicId: number,
    rowId: string,
    patch: Partial<CustomCheckRow>
  ) => {
    setCustomItemsByTopic(prev => ({
      ...prev,
      [topicId]: (prev[topicId] || []).map(row => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  };

  const handleRemoveCustomCheck = (topicId: number, rowId: string) => {
    setCustomItemsByTopic(prev => ({
      ...prev,
      [topicId]: (prev[topicId] || []).filter(row => row.id !== rowId),
    }));
  };

  // 上傳現場照片（1～3 張）
  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      alert(`最多可上傳 ${MAX_PHOTOS} 張現場照片`);
      return;
    }
    const picked = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remaining);
    const added: UploadedBeautyPhoto[] = [];
    for (const file of picked) {
      try {
        const compressed = await compressImageFile(file);
        added.push({
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          url: compressed,
          kind: hasCoreRedlineViolation ? '缺失存證' : '亮點照片',
        });
      } catch {
        // 略過損壞圖檔
      }
    }
    if (added.length > 0) {
      setPhotos(prev => [...prev, ...added]);
    }
  };

  const handleClearDraft = () => {
    if (!window.confirm('確定要清空目前填寫的美容總監巡店表草稿嗎？')) return;
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    setStoreName('');
    setStoreRegion('');
    setStoreManagerName('');
    setBeautyLeaderName('');
    setAuditMode('B');
    setSelectedTopics([1, 4]);
    setCoreChecks({});
    setCoreRemarks({});
    setCategoryChecks({});
    setCategoryRemarks({});
    setCustomItemsByTopic({});
    setCoachingConducted(false);
    setCoachingTargets([]);
    setCoachingNotes('');
    setPhotos([]);
    setNewActionItems([
      { id: 'act-1', desc: '', assignee: '美容組長', dueDate: defaultDueDateStr, crossDepartment: false },
      { id: 'act-2', desc: '', assignee: '店長', dueDate: defaultDueDateStr, crossDepartment: false },
    ]);
    setOverallRating('');
    setPdcaResults({});
    setLastAuditData(null);
    setPendingItems([]);
    sigCanvasRef.current?.clear();
  };

  // 送出美容總監巡店表
  const handleSubmit = async () => {
    if (submitting) return;
    if (!storeName.trim()) {
      alert('請先選擇巡店門市');
      return;
    }
    if (!directorName.trim()) {
      alert('請填寫美容總監姓名');
      return;
    }

    const uncheckedCore = BEAUTY_CORE_SAFETY_ITEMS.filter(item => !coreChecks[item.id]);
    if (uncheckedCore.length > 0) {
      alert(`請完成「第二層必看安全與衛生底線」所有檢核項目（尚未勾選：${uncheckedCore.map(c => c.title).join('、')}）`);
      return;
    }

    if (!overallRating) {
      alert('請選擇「美容/住宿綜合評價」');
      return;
    }

    // 整理第三層檢核結果與自訂項目
    const finalCategoryChecks: Record<string, string> = {};
    const finalCategoryRemarks: Record<string, string> = { ...coreRemarks };
    for (const topic of visibleTopics) {
      for (const item of topic.items) {
        if (categoryChecks[item.id]) {
          finalCategoryChecks[item.id] = categoryChecks[item.id];
        }
        if (categoryRemarks[item.id]?.trim()) {
          finalCategoryRemarks[item.id] = categoryRemarks[item.id].trim();
        }
      }
      for (const custom of customItemsByTopic[topic.id] || []) {
        const title = custom.label.trim();
        if (!title) continue;
        const customKey = `[大項${topic.id}自訂] ${title}`;
        finalCategoryChecks[customKey] = custom.status;
        if (custom.remark.trim()) {
          finalCategoryRemarks[customKey] = custom.remark.trim();
        }
      }
    }

    const modeMeta = BEAUTY_AUDIT_MODES.find(m => m.id === auditMode);
    const createdAtIso = new Date(`${visitDate}T${visitTime || '12:00'}:00+08:00`).toISOString();

    // 整理照片（以現有 photoPairs 結構相容寫入後端 photos 表）
    const photoPairs = photos.map(p =>
      p.kind === '缺失存證'
        ? { beforeUrl: p.url, afterUrl: '' }
        : { beforeUrl: '', afterUrl: p.url }
    );

    const signatureDataUrl =
      sigCanvasRef.current && !sigCanvasRef.current.isEmpty()
        ? sigCanvasRef.current.getTrimmedCanvas().toDataURL('image/png')
        : null;

    const highlightParts: string[] = [];
    if (modeMeta) {
      highlightParts.push(`模式：${modeMeta.badge} ${modeMeta.title}`);
    }
    if (beautyLeaderName.trim()) {
      highlightParts.push(`美容組長：${beautyLeaderName.trim()}`);
    }
    if (storeManagerName.trim()) {
      highlightParts.push(`店長：${storeManagerName.trim()}`);
    }
    if (coachingConducted) {
      highlightParts.push(
        `1-on-1 指導：${coachingTargets.length > 0 ? coachingTargets.join('、') : '已進行'}`
      );
    }
    if (coachingNotes.trim()) {
      highlightParts.push(`輔導筆記：${coachingNotes.trim()}`);
    }

    const validNewActions = newActionItems
      .filter(a => a.desc.trim())
      .map(a => ({
        desc: a.desc.trim(),
        assignee: a.assignee.trim() || '美容組長',
        dueDate: a.dueDate || defaultDueDateStr,
        auditDepartment: a.crossDepartment ? '營運' : '美容',
        crossDepartment: a.crossDepartment,
      }));

    const payload = {
      auditType: 'beauty',
      auditDepartment: '美容',
      areaManagerName: directorName.trim(),
      jobTitle: '美容總監',
      actionType: '美容總監巡店',
      storeName: storeName.trim(),
      region: storeRegion || '',
      storeManagerName: storeManagerName.trim(),
      beautyLeaderName: beautyLeaderName.trim(),
      auditMode,
      selectedTopics: auditMode === 'A' ? [] : auditMode === 'C' ? [1, 2, 3, 4, 5, 6] : selectedTopics,
      expectedStayMinutes: modeMeta?.durationMin || 30,
      coreChecks,
      categoryChecks: finalCategoryChecks,
      categoryRemarks: finalCategoryRemarks,
      pdcaResults,
      newActionItems: validNewActions,
      coachingConducted,
      coachingTargets: coachingConducted ? coachingTargets : [],
      coachingNotes: coachingNotes.trim(),
      overallRating,
      coreRedlineViolated: hasCoreRedlineViolation,
      highlightDescription: highlightParts.join(' ｜ '),
      photoPairs,
      signerRole,
      signature: signatureDataUrl,
      tags: [
        '美容總監巡店',
        modeMeta ? `${modeMeta.badge}·${modeMeta.title.split('（')[0]}` : '美容巡店',
        ...(hasCoreRedlineViolation ? ['安全紅線違規'] : []),
      ],
      createdAt: createdAtIso,
    };

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/visit-records`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `送出失敗（HTTP ${res.status}）`);
      }
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      alert(
        hasCoreRedlineViolation || overallRating === '高風險（立即重點輔導）'
          ? `✅ 已送出「${storeName}」美容總監巡店表！因偵測到安全紅線或高風險評價，系統已自動啟動高風險預警通報。`
          : `✅ 已成功送出「${storeName}」美容總監巡店表，待改善事項與高層戰情看板已即時連動更新！`
      );
      navigate('/dashboard?view=beauty');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '網路連線異常，請稍後再試';
      alert(`送出失敗：${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50/60 via-slate-50 to-slate-100 pb-24">
      {/* 頂部導覽列 */}
      <header className="sticky top-0 z-40 bg-gradient-to-r from-rose-700 via-fuchsia-700 to-purple-800 text-white shadow-md">
        <div className="max-w-4xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="p-2 rounded-xl bg-white/15 hover:bg-white/25 transition-colors cursor-pointer shrink-0"
              title="返回戰情牆"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-300 text-slate-950">
                  美容住宿專項
                </span>
                <h1 className="text-sm sm:text-lg font-extrabold truncate">
                  美容總監巡店表
                </h1>
              </div>
              <p className="text-[11px] text-rose-100 hidden sm:block">
                進店歷程回溯 · 零容忍安全紅線 · 六大核心題庫 · 跨部門 PDCA 閉環
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {draftSavedHint && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] bg-white/15 px-2.5 py-1 rounded-full text-rose-100 font-semibold">
                <Save size={11} />
                {draftSavedHint}
              </span>
            )}
            <button
              type="button"
              onClick={handleClearDraft}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-bold cursor-pointer transition-colors"
              title="清空目前草稿"
            >
              <RotateCcw size={13} />
              <span className="hidden sm:inline">重設</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-3 sm:px-6 pt-4 sm:pt-6 space-y-5">
        {/* ==================== 1. 第一層：基本資訊與【美容巡店模式選擇】 ==================== */}
        <section className="bg-white rounded-2xl border border-rose-200/80 shadow-xs overflow-hidden">
          <div className="bg-gradient-to-r from-rose-50 to-fuchsia-50 px-4 sm:px-5 py-3 border-b border-rose-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-rose-600 text-white text-xs font-black flex items-center justify-center">
                1
              </span>
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
                第一層：基本資訊與【美容巡店模式選擇】
              </h2>
            </div>
            {storeRegion && (
              <span className="px-2.5 py-0.5 rounded-full bg-rose-600 text-white text-xs font-extrabold">
                📍 {storeRegion}
              </span>
            )}
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {/* 門市選擇（含關鍵字快速搜尋） */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  <Store size={13} className="inline mr-1 text-rose-600" />
                  巡店門市（必選，選完自動帶出歷程與交辦）
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={storeKeyword}
                    onChange={e => setStoreKeyword(e.target.value)}
                    placeholder="輸入店名快篩..."
                    className="w-28 sm:w-32 px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-rose-500"
                  />
                  <select
                    value={storeName}
                    onChange={e => setStoreName(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm font-bold bg-white border border-slate-300 rounded-xl outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-200 cursor-pointer"
                  >
                    <option value="">-- 請選擇巡店門市 --</option>
                    {storeOptions.map(opt => (
                      <option key={opt.storeName} value={opt.storeName}>
                        [{opt.region || '其他'}] {opt.storeName}
                        {opt.beautyLeader ? `（美容組長：${opt.beautyLeader}）` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 巡店日期 / 時間 */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    <Calendar size={13} className="inline mr-1 text-rose-600" />
                    巡店日期
                  </label>
                  <input
                    type="date"
                    value={visitDate}
                    min={user?.role === 'manager' || user?.role === 'beauty_director' ? minDateStr : undefined}
                    max={todayStr}
                    onChange={e => e.target.value && setVisitDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-bold bg-white border border-slate-300 rounded-xl outline-none focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    <Clock size={13} className="inline mr-1 text-rose-600" />
                    巡店時間
                  </label>
                  <input
                    type="time"
                    value={visitTime}
                    onChange={e => setVisitTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-bold bg-white border border-slate-300 rounded-xl outline-none focus:border-rose-500"
                  />
                </div>
              </div>
            </div>

            {/* 美容總監 / 店長 / 美容組長 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  <UserCheck size={13} className="inline mr-1 text-rose-600" />
                  美容總監（巡店者）
                  {isBeautyDirector && user?.nickname ? ` · ${user.nickname}` : ''}
                </label>
                <input
                  type="text"
                  value={isBeautyDirector ? user.name : directorName}
                  readOnly={isBeautyDirector}
                  onChange={e => !isBeautyDirector && setDirectorName(e.target.value)}
                  placeholder="請輸入總監姓名"
                  className={`w-full px-3 py-2 text-sm font-bold border rounded-xl outline-none ${
                    isBeautyDirector
                      ? 'bg-rose-50 border-rose-200 text-rose-900 cursor-not-allowed'
                      : 'bg-white border-slate-300 focus:border-rose-500'
                  }`}
                />
                {isBeautyDirector && (user?.department || user?.supervisor) && (
                  <div className="text-[11px] font-semibold text-rose-700 mt-1">
                    {user.department}
                    {user.supervisor ? ` · 直屬長官：${user.supervisor}` : ''}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  門市店長
                </label>
                <input
                  type="text"
                  value={storeManagerName}
                  onChange={e => setStoreManagerName(e.target.value)}
                  placeholder="輸入店長姓名"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:border-rose-500"
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  美容組長（主責美容師）
                </label>
                <input
                  type="text"
                  value={beautyLeaderName}
                  onChange={e => setBeautyLeaderName(e.target.value)}
                  placeholder="選店後自動帶入或手填"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl outline-none focus:border-rose-500"
                />
              </div>
            </div>

            {/* 本次巡店模式選擇（單選，動態決定第三層展開範圍） */}
            <div>
              <div className="text-xs font-extrabold text-slate-700 mb-2">
                本次巡店模式選擇（單選，動態決定第三層展開範圍）：
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {BEAUTY_AUDIT_MODES.map(m => {
                  const selected = auditMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setAuditMode(m.id)}
                      className={`text-left p-3.5 rounded-2xl border-2 transition-all cursor-pointer ${
                        selected
                          ? 'bg-rose-50 border-rose-600 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-rose-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-black ${
                            selected ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {m.badge}
                        </span>
                        <span className="text-[11px] font-bold text-slate-500">{m.durationMin} 分鐘</span>
                      </div>
                      <div className="text-sm font-extrabold text-slate-900">{m.title}</div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{m.summary}</p>
                      <div className="text-[11px] font-semibold text-rose-700 mt-1.5">{m.useCase}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 模式 B 主題選擇器（1～3 個大項） */}
            {auditMode === 'B' && (
              <div className="bg-fuchsia-50/70 border border-fuchsia-200 rounded-xl p-3.5">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <span className="text-xs font-extrabold text-fuchsia-900">
                    請勾選本次深度輔導大項（1～3 項，目前選中 {selectedTopics.length} 項）：
                  </span>
                  {lastAuditData?.suggestedTopicIndices && lastAuditData.suggestedTopicIndices.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedTopics(lastAuditData.suggestedTopicIndices!.slice(0, 3))
                      }
                      className="text-[11px] font-extrabold px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 hover:bg-amber-300 cursor-pointer"
                    >
                      ✨ 套用前次缺失建議大項
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {BEAUTY_TOPIC_GROUPS.map(g => {
                    const active = selectedTopics.includes(g.id);
                    const suggested = lastAuditData?.suggestedTopicIndices?.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => handleToggleTopicB(g.id)}
                        className={`text-left px-3 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                          active
                            ? 'bg-fuchsia-600 text-white border-fuchsia-600 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-fuchsia-300'
                        }`}
                      >
                        <span className="truncate">{g.title}</span>
                        {suggested && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-black ${
                              active ? 'bg-amber-300 text-slate-950' : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            前次缺失
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ==================== 0. 進店前：歷程回溯與交辦追蹤（前次紀錄連動） ==================== */}
        {storeName && (
          <section className="bg-white rounded-2xl border-2 border-indigo-200 shadow-xs overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 px-4 sm:px-5 py-3 border-b border-indigo-100 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white text-xs font-black flex items-center justify-center">
                  0
                </span>
                <h2 className="text-sm sm:text-base font-extrabold text-indigo-950 flex items-center gap-1.5">
                  <History size={16} className="text-indigo-600" />
                  進店前：歷程回溯與交辦追蹤（{storeName}）
                </h2>
              </div>
              <span className="text-[11px] font-bold text-indigo-700">
                已結案事項自動隱藏 · 支援跨部門協同督導
              </span>
            </div>

            <div className="p-4 sm:p-5 space-y-3.5">
              {lastAuditLoading ? (
                <div className="text-xs text-slate-500 py-4 text-center font-semibold">
                  正在從資料庫調閱「{storeName}」上次美容巡店紀錄與未結案交辦事項...
                </div>
              ) : (
                <>
                  {/* 上次美容巡店紀錄摘要 */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
                    <div className="font-extrabold text-slate-800 mb-1">
                      📋 上次美容巡店紀錄摘要：
                    </div>
                    {lastAuditData?.hasHistory ? (
                      <div className="flex flex-wrap items-center gap-2 text-slate-700">
                        <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 font-bold">
                          {lastAuditData.taipeiDate}
                        </span>
                        <span className="font-bold">
                          模式 {lastAuditData.auditMode || 'B'}
                          {lastAuditData.areaManagerName ? ` · ${lastAuditData.areaManagerName}` : ''}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full font-extrabold ${
                            String(lastAuditData.overallRating || '').includes('高風險')
                              ? 'bg-rose-100 text-rose-700'
                              : String(lastAuditData.overallRating || '').includes('追蹤')
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          上次評價：{lastAuditData.overallRating || '正常'}
                        </span>
                      </div>
                    ) : (
                      <div className="text-slate-500">
                        本門市尚無歷史美容總監巡店紀錄，本次將建立首筆美容巡店基線資料。
                      </div>
                    )}
                  </div>

                  {/* 未結案待改善事項 (Pending Action Items) */}
                  <div>
                    <div className="text-xs font-extrabold text-slate-800 mb-2 flex items-center justify-between">
                      <span>
                        未結案待改善事項（Pending Action Items：{pendingItems.length} 筆）
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">
                        點選「已改善」送出後將自動結案
                      </span>
                    </div>

                    {pendingItems.length === 0 ? (
                      <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2.5 font-bold flex items-center gap-2">
                        <CheckCircle2 size={15} />
                        太棒了！本門市目前無未結案待改善事項。
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {pendingItems.map((item, idx) => {
                          const currentVal = pdcaResults[item.id];
                          const isBeautyItem = item.auditDepartment === '美容';
                          return (
                            <div
                              key={item.id}
                              className="p-3 rounded-xl border border-rose-200 bg-rose-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                  <span
                                    className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                      isBeautyItem
                                        ? 'bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200'
                                        : 'bg-blue-100 text-blue-800 border border-blue-200'
                                    }`}
                                  >
                                    {isBeautyItem ? '🌸 美容交辦' : '🏢 營運跨部門'}
                                  </span>
                                  {item.assignee && (
                                    <span className="text-[11px] font-bold text-slate-600">
                                      責任人：{item.assignee}
                                    </span>
                                  )}
                                  {item.dueDate && (
                                    <span className="text-[11px] text-slate-500">
                                      期限：{item.dueDate}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs sm:text-sm font-bold text-slate-900">
                                  ❌ {idx + 1}. {item.desc || item.issueDescription}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPdcaResults(prev => ({ ...prev, [item.id]: '已改善' }))
                                  }
                                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border cursor-pointer transition-all ${
                                    currentVal === '已改善'
                                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                      : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                                  }`}
                                >
                                  ✅ 已改善
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPdcaResults(prev => ({ ...prev, [item.id]: '未改善' }))
                                  }
                                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border cursor-pointer transition-all ${
                                    currentVal === '未改善'
                                      ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                      : 'bg-white text-rose-700 border-rose-300 hover:bg-rose-50'
                                  }`}
                                >
                                  ❌ 未改善
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 上次面談 / 交辦筆記備忘 */}
                  {lastAuditData?.coachingNotes && (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs">
                      <div className="font-extrabold text-amber-900 mb-1">
                        📝 上次面談／交辦筆記備忘：
                      </div>
                      <p className="text-amber-950 whitespace-pre-wrap leading-relaxed">
                        {lastAuditData.coachingNotes}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* ==================== 2. 第二層：每次進店【必看安全與衛生底線】 ==================== */}
        <section
          className={`bg-white rounded-2xl border-2 shadow-xs overflow-hidden ${
            hasCoreRedlineViolation ? 'border-rose-500 ring-2 ring-rose-200' : 'border-rose-200'
          }`}
        >
          <div className="bg-gradient-to-r from-rose-600 to-red-600 text-white px-4 sm:px-5 py-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-white text-rose-700 text-xs font-black flex items-center justify-center">
                2
              </span>
              <h2 className="text-sm sm:text-base font-extrabold flex items-center gap-1.5">
                <ShieldAlert size={17} />
                第二層：每次進店【必看安全與衛生底線】（零容忍紅線）
              </h2>
            </div>
            <span className="text-[11px] font-bold bg-white/20 px-2.5 py-0.5 rounded-full">
              任一項 🔴 直接觸發高風險預警
            </span>
          </div>

          {hasCoreRedlineViolation && (
            <div className="bg-rose-50 border-b border-rose-200 px-4 py-2.5 flex items-center gap-2 text-xs font-extrabold text-rose-800">
              <AlertTriangle size={16} className="text-rose-600 shrink-0" />
              <span>
                已觸發零容忍安全紅線違規！表尾綜合評價已自動聯動為「🔴 高風險（立即重點輔導）」，送出後將即時推播警示予營運主管與高層。
              </span>
            </div>
          )}

          <div className="p-4 sm:p-5 space-y-3">
            {BEAUTY_CORE_SAFETY_ITEMS.map(item => {
              const val = coreChecks[item.id] || '';
              const isPass = val === item.passLabel;
              const isFail = val === item.failLabel;
              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-3.5 sm:p-4 transition-all ${
                    isFail
                      ? 'bg-rose-50/80 border-rose-400'
                      : isPass
                      ? 'bg-emerald-50/40 border-emerald-300'
                      : 'bg-slate-50/70 border-slate-200'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-extrabold text-slate-900">{item.title}</div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{item.standard}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setCoreChecks(prev => ({ ...prev, [item.id]: item.passLabel }))}
                        className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-extrabold border cursor-pointer transition-all ${
                          isPass
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                        }`}
                      >
                        🟢 {item.passLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCoreChecks(prev => ({ ...prev, [item.id]: item.failLabel }))}
                        className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-extrabold border cursor-pointer transition-all ${
                          isFail
                            ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                            : 'bg-white text-rose-700 border-rose-300 hover:bg-rose-50'
                        }`}
                      >
                        🔴 {item.failLabel}
                      </button>
                    </div>
                  </div>

                  {/* 現場狀況備註（支援語音輸入） */}
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <input
                      type="text"
                      value={coreRemarks[item.id] || ''}
                      onChange={e =>
                        setCoreRemarks(prev => ({ ...prev, [item.id]: e.target.value }))
                      }
                      placeholder={
                        isFail ? '請填寫違規／異常現場細節（必填建議）...' : '備註／現場狀況（選填）...'
                      }
                      className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:border-rose-500"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        triggerVoiceInput(`core-${item.id}`, spoken =>
                          setCoreRemarks(prev => ({
                            ...prev,
                            [item.id]: prev[item.id] ? `${prev[item.id]} ${spoken}` : spoken,
                          }))
                        )
                      }
                      className={`p-2 rounded-xl border cursor-pointer transition-colors ${
                        listeningField === `core-${item.id}`
                          ? 'bg-rose-600 text-white border-rose-600 animate-pulse'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-rose-50 hover:text-rose-600'
                      }`}
                      title="語音輸入備註"
                    >
                      {listeningField === `core-${item.id}` ? <MicOff size={14} /> : <Mic size={14} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ==================== 3. 第三層：【美容與住宿六大核心大項庫 + 自訂擴充】 ==================== */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="bg-gradient-to-r from-fuchsia-50 to-purple-50 px-4 sm:px-5 py-3 border-b border-fuchsia-100 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-fuchsia-600 text-white text-xs font-black flex items-center justify-center">
                3
              </span>
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
                第三層：【美容與住宿六大核心大項庫 ＋ 自訂擴充】
              </h2>
            </div>
            <span className="text-[11px] font-bold text-fuchsia-700">
              {auditMode === 'A'
                ? '目前為模式 A 快閃抽查（自動跳過第三層）'
                : `已展開 ${visibleTopics.length} / 6 大項 · 支援語音自訂`}
            </span>
          </div>

          {auditMode === 'A' ? (
            <div className="p-6 text-center space-y-2">
              <div className="text-sm font-extrabold text-slate-700">
                ⚡ 模式 A（快閃抽查 15 分鐘）已精簡跳過第三層六大核心細項
              </div>
              <p className="text-xs text-slate-500">
                僅需確認上方「第 0 區歷程追蹤」與「第二層必看安全底線」，即可直接前往表尾填寫評價與簽認！若現場發現需深度稽核，可點上方切換為模式 B 或模式 C。
              </p>
            </div>
          ) : (
            <div className="p-4 sm:p-5 space-y-5">
              {visibleTopics.map(group => {
                const customRows = customItemsByTopic[group.id] || [];
                return (
                  <div
                    key={group.id}
                    className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-50/40"
                  >
                    <div className="bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <h3 className="text-xs sm:text-sm font-extrabold">{group.title}</h3>
                        {group.subtitle && (
                          <div className="text-[11px] text-slate-300">{group.subtitle}</div>
                        )}
                      </div>
                      {group.allowBatchNA && (
                        <button
                          type="button"
                          onClick={() => handleSetTopicAllNA(group.id)}
                          className="text-[11px] font-extrabold px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white border border-white/20 cursor-pointer"
                        >
                          ⚪ 該店無住宿業務（全項設 N/A）
                        </button>
                      )}
                    </div>

                    <div className="p-3.5 sm:p-4 space-y-3">
                      {group.items.map(item => {
                        const status = categoryChecks[item.id];
                        const needsRemark = status === '待改善' || status === '缺失' || Boolean(categoryRemarks[item.id]);
                        return (
                          <div
                            key={item.id}
                            className={`rounded-xl border p-3 bg-white transition-all ${
                              status === '缺失'
                                ? 'border-rose-300 bg-rose-50/30'
                                : status === '待改善'
                                ? 'border-amber-300 bg-amber-50/30'
                                : 'border-slate-200'
                            }`}
                          >
                            <div className="flex flex-col gap-2">
                              <div>
                                <div className="text-xs sm:text-sm font-extrabold text-slate-900">
                                  {item.code}. {item.title}
                                </div>
                                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                                  {item.description}
                                </p>
                              </div>

                              {/* 四選一評估按鈕列 */}
                              <div className="grid grid-cols-4 gap-1.5">
                                {(['N/A', '合格', '待改善', '缺失'] as BeautyCheckStatus[]).map(opt => {
                                  const active = status === opt;
                                  const styleMap: Record<BeautyCheckStatus, string> = {
                                    'N/A': active
                                      ? 'bg-slate-600 text-white border-slate-600'
                                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100',
                                    合格: active
                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                      : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50',
                                    待改善: active
                                      ? 'bg-amber-500 text-white border-amber-500'
                                      : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50',
                                    缺失: active
                                      ? 'bg-rose-600 text-white border-rose-600'
                                      : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50',
                                  };
                                  const iconMap: Record<BeautyCheckStatus, string> = {
                                    'N/A': '⚪',
                                    合格: '🟢',
                                    待改善: '🟡',
                                    缺失: '🔴',
                                  };
                                  return (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() =>
                                        setCategoryChecks(prev => ({ ...prev, [item.id]: opt }))
                                      }
                                      className={`py-1.5 px-2 rounded-lg border text-[11px] sm:text-xs font-extrabold cursor-pointer transition-all ${styleMap[opt]}`}
                                    >
                                      {iconMap[opt]} {opt}
                                    </button>
                                  );
                                })}
                              </div>

                              {needsRemark && (
                                <div className="flex items-center gap-1.5 pt-1">
                                  <input
                                    type="text"
                                    value={categoryRemarks[item.id] || ''}
                                    onChange={e =>
                                      setCategoryRemarks(prev => ({ ...prev, [item.id]: e.target.value }))
                                    }
                                    placeholder="補充現場缺失／改善說明（將自動帶入待改善清單）..."
                                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg outline-none focus:border-rose-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      triggerVoiceInput(`item-${item.id}`, spoken =>
                                        setCategoryRemarks(prev => ({
                                          ...prev,
                                          [item.id]: prev[item.id] ? `${prev[item.id]} ${spoken}` : spoken,
                                        }))
                                      )
                                    }
                                    className={`p-1.5 rounded-lg border cursor-pointer ${
                                      listeningField === `item-${item.id}`
                                        ? 'bg-rose-600 text-white border-rose-600 animate-pulse'
                                        : 'bg-white text-slate-600 border-slate-200 hover:text-rose-600'
                                    }`}
                                    title="語音輸入"
                                  >
                                    {listeningField === `item-${item.id}` ? <MicOff size={13} /> : <Mic size={13} />}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* 大項 6 專屬：6-3 美容師 1-on-1 技術指導與面談紀錄 ＋ 6-4 技術輔導重點與職涯/考核紀錄 */}
                      {group.hasCoachingSection && (
                        <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/50 p-3.5 space-y-3">
                          <div>
                            <div className="text-xs sm:text-sm font-extrabold text-fuchsia-950 flex items-center gap-1.5 mb-2">
                              <Users size={15} className="text-fuchsia-600" />
                              6-3. 美容師 1-on-1 技術指導與面談紀錄
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setCoachingConducted(false);
                                  setCoachingTargets([]);
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border cursor-pointer ${
                                  !coachingConducted
                                    ? 'bg-slate-800 text-white border-slate-800'
                                    : 'bg-white text-slate-600 border-slate-300'
                                }`}
                              >
                                今日無進行
                              </button>
                              <button
                                type="button"
                                onClick={() => setCoachingConducted(true)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border cursor-pointer ${
                                  coachingConducted
                                    ? 'bg-fuchsia-600 text-white border-fuchsia-600'
                                    : 'bg-white text-fuchsia-700 border-fuchsia-300'
                                }`}
                              >
                                ✅ 今日有進行
                              </button>
                            </div>

                            {coachingConducted && (
                              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-slate-700">指導對象（可複選）：</span>
                                {BEAUTY_COACHING_TARGET_OPTIONS.map(target => {
                                  const checked = coachingTargets.includes(target);
                                  return (
                                    <button
                                      key={target}
                                      type="button"
                                      onClick={() =>
                                        setCoachingTargets(prev =>
                                          prev.includes(target)
                                            ? prev.filter(t => t !== target)
                                            : [...prev, target]
                                        )
                                      }
                                      className={`px-3 py-1 rounded-full text-xs font-bold border cursor-pointer transition-all ${
                                        checked
                                          ? 'bg-fuchsia-600 text-white border-fuchsia-600'
                                          : 'bg-white text-slate-700 border-slate-300 hover:border-fuchsia-400'
                                      }`}
                                    >
                                      {checked ? '☑ ' : '☐ '}
                                      {target}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <label className="text-xs sm:text-sm font-extrabold text-fuchsia-950">
                                6-4. 技術輔導重點與職涯／考核紀錄（下次巡店將自動帶入第 0 區備忘）
                              </label>
                              <button
                                type="button"
                                onClick={() =>
                                  triggerVoiceInput('coaching-notes', spoken =>
                                    setCoachingNotes(prev => (prev ? `${prev}\n${spoken}` : spoken))
                                  )
                                }
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                                  listeningField === 'coaching-notes'
                                    ? 'bg-rose-600 text-white border-rose-600 animate-pulse'
                                    : 'bg-white text-fuchsia-700 border-fuchsia-300 hover:bg-fuchsia-100'
                                }`}
                              >
                                {listeningField === 'coaching-notes' ? <MicOff size={12} /> : <Mic size={12} />}
                                <span>語音輸入</span>
                              </button>
                            </div>
                            <textarea
                              rows={3}
                              value={coachingNotes}
                              onChange={e => setCoachingNotes(e.target.value)}
                              placeholder="例：資深美容師預計下月調店，需追蹤實習生升遷考核與犬貓剪工輔導進度..."
                              className="w-full px-3 py-2 text-xs sm:text-sm bg-white border border-fuchsia-200 rounded-xl outline-none focus:border-fuchsia-500"
                            />
                          </div>
                        </div>
                      )}

                      {/* 大項底部：自訂新增項目（支援文字／語音輸入） */}
                      <div className="pt-1 space-y-2">
                        {customRows.map((row, cIdx) => (
                          <div
                            key={row.id}
                            className="p-3 rounded-xl bg-white border border-dashed border-fuchsia-300 space-y-2"
                          >
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={row.label}
                                onChange={e =>
                                  handleUpdateCustomCheck(group.id, row.id, { label: e.target.value })
                                }
                                placeholder={`自訂項目 ${cIdx + 1} 名稱（例：烘箱定時器校正）...`}
                                className="flex-1 px-2.5 py-1.5 text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-fuchsia-500"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  triggerVoiceInput(`custom-${row.id}`, spoken =>
                                    handleUpdateCustomCheck(group.id, row.id, {
                                      label: row.label ? `${row.label} ${spoken}` : spoken,
                                    })
                                  )
                                }
                                className={`p-1.5 rounded-lg border cursor-pointer ${
                                  listeningField === `custom-${row.id}`
                                    ? 'bg-rose-600 text-white border-rose-600 animate-pulse'
                                    : 'bg-white text-slate-600 border-slate-200 hover:text-fuchsia-600'
                                }`}
                                title="語音輸入自訂項目"
                              >
                                <Mic size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveCustomCheck(group.id, row.id)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 cursor-pointer"
                                title="移除此自訂項目"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                            <div className="grid grid-cols-4 gap-1.5">
                              {(['N/A', '合格', '待改善', '缺失'] as BeautyCheckStatus[]).map(opt => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() =>
                                    handleUpdateCustomCheck(group.id, row.id, { status: opt })
                                  }
                                  className={`py-1 rounded-lg border text-[11px] font-bold cursor-pointer ${
                                    row.status === opt
                                      ? opt === '缺失'
                                        ? 'bg-rose-600 text-white border-rose-600'
                                        : opt === '待改善'
                                        ? 'bg-amber-500 text-white border-amber-500'
                                        : opt === '合格'
                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                        : 'bg-slate-600 text-white border-slate-600'
                                      : 'bg-white text-slate-600 border-slate-200'
                                  }`}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                            {(row.status === '待改善' || row.status === '缺失') && (
                              <input
                                type="text"
                                value={row.remark}
                                onChange={e =>
                                  handleUpdateCustomCheck(group.id, row.id, { remark: e.target.value })
                                }
                                placeholder="補充說明（選填）..."
                                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-rose-500"
                              />
                            )}
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => handleAddCustomCheck(group.id)}
                          className="w-full py-2 rounded-xl border border-dashed border-fuchsia-300 bg-white hover:bg-fuchsia-50 text-fuchsia-700 text-xs font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Plus size={14} />
                          <span>➕ 自訂新增大項 {group.id} 檢核項目（支援語音輸入）</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ==================== 4. 表尾：【管理閉環】與高層數據連動 ==================== */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white px-4 sm:px-5 py-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-amber-400 text-slate-950 text-xs font-black flex items-center justify-center">
                4
              </span>
              <h2 className="text-sm sm:text-base font-extrabold">
                表尾：【管理閉環】照片存證、交辦追蹤、評價與數位簽認
              </h2>
            </div>
          </div>

          <div className="p-4 sm:p-5 space-y-5">
            {/* 4-1 現場照片上傳（1~3 張） */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="text-xs sm:text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                  <Camera size={15} className="text-rose-600" />
                  現場照片上傳（最多 {MAX_PHOTOS} 張：優秀造型/整潔亮點 或 安全衛生缺失存證）
                </label>
                <span className="text-xs font-bold text-slate-500">
                  {photos.length} / {MAX_PHOTOS}
                </span>
              </div>

              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => {
                  handlePhotoUpload(e.target.files);
                  e.target.value = '';
                }}
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {photos.map(photo => (
                  <div
                    key={photo.id}
                    className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex flex-col"
                  >
                    <div className="relative h-36 bg-slate-100">
                      <img
                        src={photo.url}
                        alt={photo.kind}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setPhotos(prev => prev.filter(p => p.id !== photo.id))}
                        className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-slate-900/75 text-white hover:bg-rose-600 cursor-pointer"
                        title="移除照片"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="p-2 flex gap-1">
                      {(['亮點照片', '缺失存證'] as const).map(kind => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() =>
                            setPhotos(prev =>
                              prev.map(p => (p.id === photo.id ? { ...p, kind } : p))
                            )
                          }
                          className={`flex-1 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                            photo.kind === kind
                              ? kind === '缺失存證'
                                ? 'bg-rose-600 text-white border-rose-600'
                                : 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-slate-600 border-slate-200'
                          }`}
                        >
                          {kind === '缺失存證' ? '⚠️ 缺失存證' : '✨ 造型亮點'}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {photos.length < MAX_PHOTOS && (
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="h-44 rounded-xl border-2 border-dashed border-rose-300 bg-rose-50/40 hover:bg-rose-50 flex flex-col items-center justify-center gap-1.5 text-rose-700 cursor-pointer transition-colors"
                  >
                    <Camera size={24} />
                    <span className="text-xs font-extrabold">點擊拍照／上傳照片</span>
                    <span className="text-[11px] text-rose-500">自動壓縮上傳至雲端</span>
                  </button>
                )}
              </div>
            </div>

            {/* 4-2 新增限期改善事項 (Action Items) */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div>
                  <div className="text-xs sm:text-sm font-extrabold text-slate-900">
                    新增限期改善事項（自動連動至下次美容／區經理巡店「第 0 區塊」）
                  </div>
                  <div className="text-[11px] text-slate-500">
                    勾選「跨部門硬體修繕」將標記為營運跨部門事項，讓區經理下次巡店也能協同督導店長修繕
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setNewActionItems(prev => [
                      ...prev,
                      {
                        id: `act-${Date.now()}`,
                        desc: '',
                        assignee: '美容組長',
                        dueDate: defaultDueDateStr,
                        crossDepartment: false,
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-extrabold cursor-pointer"
                >
                  <Plus size={13} />
                  <span>新增改善事項</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {newActionItems.map((row, idx) => (
                  <div
                    key={row.id}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black text-slate-500 shrink-0">
                        改善事項 {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={row.desc}
                        onChange={e =>
                          setNewActionItems(prev =>
                            prev.map(r => (r.id === row.id ? { ...r, desc: e.target.value } : r))
                          )
                        }
                        placeholder="例：紫消燈管已逾時數需更換 / 熱水器水溫不穩報修..."
                        className="flex-1 px-3 py-1.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg outline-none focus:border-rose-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          triggerVoiceInput(`act-${row.id}`, spoken =>
                            setNewActionItems(prev =>
                              prev.map(r =>
                                r.id === row.id
                                  ? { ...r, desc: r.desc ? `${r.desc} ${spoken}` : spoken }
                                  : r
                              )
                            )
                          )
                        }
                        className={`p-1.5 rounded-lg border cursor-pointer ${
                          listeningField === `act-${row.id}`
                            ? 'bg-rose-600 text-white border-rose-600 animate-pulse'
                            : 'bg-white text-slate-600 border-slate-200'
                        }`}
                        title="語音輸入"
                      >
                        <Mic size={13} />
                      </button>
                      {newActionItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setNewActionItems(prev => prev.filter(r => r.id !== row.id))
                          }
                          className="p-1.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                          title="刪除列"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-slate-600">負責人：</span>
                        <input
                          type="text"
                          value={row.assignee}
                          onChange={e =>
                            setNewActionItems(prev =>
                              prev.map(r =>
                                r.id === row.id ? { ...r, assignee: e.target.value } : r
                              )
                            )
                          }
                          className="w-24 px-2 py-1 bg-white border border-slate-300 rounded-lg font-bold outline-none focus:border-rose-500"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-bold text-slate-600">時限：</span>
                        <input
                          type="date"
                          value={row.dueDate}
                          onChange={e =>
                            setNewActionItems(prev =>
                              prev.map(r =>
                                r.id === row.id ? { ...r, dueDate: e.target.value } : r
                              )
                            )
                          }
                          className="px-2 py-1 bg-white border border-slate-300 rounded-lg font-bold outline-none focus:border-rose-500"
                        />
                      </div>
                      <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 font-bold cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={row.crossDepartment}
                          onChange={e =>
                            setNewActionItems(prev =>
                              prev.map(r =>
                                r.id === row.id
                                  ? {
                                      ...r,
                                      crossDepartment: e.target.checked,
                                      assignee: e.target.checked ? '店長' : r.assignee,
                                    }
                                  : r
                              )
                            )
                          }
                          className="rounded text-blue-600"
                        />
                        <Link2 size={12} />
                        <span>跨部門硬體修繕（同步區經理協同）</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 4-3 美容/住宿綜合評價 */}
            <div className="pt-2 border-t border-slate-100">
              <div className="text-xs sm:text-sm font-extrabold text-slate-900 mb-2">
                美容／住宿綜合評價（必選）：
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {(
                  [
                    {
                      val: '優良標竿' as BeautyOverallRating,
                      label: '🟢 優良標竿',
                      sub: '安全衛生與技術品質表現優異',
                      activeCls: 'bg-emerald-600 text-white border-emerald-600 shadow-sm',
                      idleCls: 'bg-white text-emerald-800 border-emerald-200 hover:bg-emerald-50',
                    },
                    {
                      val: '需追蹤改善' as BeautyOverallRating,
                      label: '🟡 需追蹤改善',
                      sub: '有部分細項待優化，排入下輪複查',
                      activeCls: 'bg-amber-500 text-white border-amber-500 shadow-sm',
                      idleCls: 'bg-white text-amber-800 border-amber-200 hover:bg-amber-50',
                    },
                    {
                      val: '高風險（立即重點輔導）' as BeautyOverallRating,
                      label: '🔴 高風險（立即重點輔導）',
                      sub: '自動推播警示予營運主管與高層',
                      activeCls: 'bg-rose-600 text-white border-rose-600 shadow-sm',
                      idleCls: 'bg-white text-rose-800 border-rose-200 hover:bg-rose-50',
                    },
                  ] as const
                ).map(opt => {
                  const selected = overallRating === opt.val;
                  return (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => setOverallRating(opt.val)}
                      className={`p-3.5 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                        selected ? opt.activeCls : opt.idleCls
                      }`}
                    >
                      <div className="text-sm font-black">{opt.label}</div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          selected ? 'text-white/90' : 'text-slate-500'
                        }`}
                      >
                        {opt.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4-4 門市主責人員線上簽認 */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs sm:text-sm font-extrabold text-slate-900">
                    門市主責人員線上簽認：
                  </span>
                  <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                    {(['美容組長', '店長'] as const).map(role => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => setSignerRole(role)}
                        className={`px-2.5 py-1 rounded-md text-xs font-bold cursor-pointer ${
                          signerRole === role ? 'bg-rose-600 text-white' : 'text-slate-600'
                        }`}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => sigCanvasRef.current?.clear()}
                  className="text-xs font-bold text-slate-500 hover:text-rose-600 cursor-pointer"
                >
                  清除重簽
                </button>
              </div>
              <div className="border-2 border-dashed border-slate-300 rounded-2xl bg-slate-50 overflow-hidden">
                <SignatureCanvas
                  ref={sigCanvasRef}
                  penColor="#0f172a"
                  canvasProps={{
                    className: 'w-full h-36 cursor-crosshair touch-none',
                  }}
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                請由「{signerRole}」以手指或觸控筆於上方簽名框內完成巡店確認簽認
              </p>
            </div>
          </div>
        </section>

        {/* 底部固定送出列 */}
        <div className="sticky bottom-3 z-30">
          <div className="bg-slate-900/95 backdrop-blur-xs text-white rounded-2xl p-3 sm:p-4 shadow-xl border border-white/15 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs">
              <div className="font-extrabold flex items-center gap-1.5">
                <Sparkles size={14} className="text-amber-300" />
                <span>{storeName ? `目前巡檢：${storeName}` : '請先於上方選擇巡店門市'}</span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                {hasCoreRedlineViolation
                  ? '⚠️ 已偵測安全紅線違規，送出將即時推播高風險警示'
                  : '送出後自動同步至戰情牆「美容住宿專項視角」與跨部門待辦追蹤'}
              </div>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-fuchsia-600 hover:from-rose-400 hover:to-fuchsia-500 disabled:opacity-60 text-white text-sm font-black shadow-md cursor-pointer transition-all"
            >
              <Send size={15} />
              <span>{submitting ? '安全上傳中...' : '送出美容總監巡店表'}</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};
