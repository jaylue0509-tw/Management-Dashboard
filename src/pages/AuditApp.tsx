import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { Camera, Mic, Save, ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, Trash2, LogOut, KeyRound, Calendar, Clock, Wifi, WifiOff, History, Sparkles, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { storeRegions } from '../data/storeRegions';
import { ChangePasswordModal } from '../components/ChangePasswordModal';

const LOCAL_STORAGE_KEY = 'audit_app_draft';
const MULTI_DRAFTS_STORAGE_KEY = 'audit_app_multidrafts_v1';
const MAX_BACKFILL_DAYS = 5;
const AUDIT_TOPIC_NAMES = ['行銷檔期', '陳列損耗', '寵物專業', '人員服務', '環境設備', '經營數據'];

export interface LastAuditDefect {
  key: string;
  label: string;
  status: string;
  remark?: string;
  topicIndex?: number;
  isCore: boolean;
}

export interface LastAuditData {
  hasHistory: boolean;
  recordId?: string;
  storeName?: string;
  createdAt?: string;
  taipeiDate?: string;
  areaManagerName?: string;
  overallRating?: string;
  abnormalFlag?: boolean;
  immediateImprovement?: string;
  pdcaResolved?: boolean;
  defects?: LastAuditDefect[];
  suggestedTopicIndices?: number[];
}

/**
 * 取得台北時區距離今日 N 天前的日期字串 (YYYY-MM-DD)
 * @param daysAgo 往前天數 (0 為今日，最大 5 天)
 */
const getTaipeiDateOffsetStr = (daysAgo = 0): string => {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
};

/**
 * 取得台北時區當下時間字串 (HH:mm)
 */
const getTaipeiCurrentTimeStr = (): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hh = parts.find(p => p.type === 'hour')?.value || '09';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  return `${hh}:${mm}`;
};

/**
 * 產生可回填之日期選項清單（今日 + 往前最多 5 天）
 */
const getBackfillDateOptions = () => {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return Array.from({ length: MAX_BACKFILL_DAYS + 1 }, (_, idx) => {
    const dateStr = getTaipeiDateOffsetStr(idx);
    const dt = new Date(`${dateStr}T12:00:00+08:00`);
    const weekday = weekdays[dt.getUTCDay()];
    const shortDate = dateStr.slice(5).replace('-', '/');
    const label = idx === 0 ? '今日' : idx === 1 ? '昨日' : `${idx}天前`;
    return { daysAgo: idx, dateStr, shortDate, weekday, label };
  });
};

export const AuditApp = () => {
  const navigate = useNavigate();
  const sigCanvas = useRef<SignatureCanvas>(null);
  const { user, logout } = useAuth();
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  // Stepper State
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 5;

  // --- Form States ---
  const [storeName, setStoreName] = useState('');
  const [mgrName, setMgrName] = useState(user?.name || '未知主管');
  const [auditMode, setAuditMode] = useState<string>('C');
  const [selectedTopics, setSelectedTopics] = useState<number[]>([]);
  const [coreChecks, setCoreChecks] = useState<Record<string, string>>({});
  const [categoryChecks, setCategoryChecks] = useState<Record<string, string>>({});
  const [categoryRemarks, setCategoryRemarks] = useState<Record<string, string>>({});
  const [customItems, setCustomItems] = useState<Record<number, string[]>>({});
  const [customInputValues, setCustomInputValues] = useState<Record<number, string>>({});
  
  // PDCA States
  const [actionItemsLoading, setActionItemsLoading] = useState(false);
  const [pastActionItems, setPastActionItems] = useState<any[]>([]);
  const [pdcaResults, setPdcaResults] = useState<Record<string, string>>({});
  const [newActionItems, setNewActionItems] = useState([{ desc: '', assignee: '', dueDate: '' }]);
  const [photoPairs, setPhotoPairs] = useState<{beforeUrl: string, afterUrl: string}[]>([{beforeUrl: '', afterUrl: ''}]);
  const [defectPhotos, setDefectPhotos] = useState<Record<string, { beforeUrl: string; afterUrl: string }>>({});
  
  const [overallRating, setOverallRating] = useState('');
  const [taskType, setTaskType] = useState<'實地巡店' | '總部行程' | '會議行程' | '特殊行程'>('實地巡店');
  const [scheduleNote, setScheduleNote] = useState('');
  const [scheduleLocation, setScheduleLocation] = useState('');
  const [scheduleDuration, setScheduleDuration] = useState<number>(240);

  // 問卷／巡店回填日期與時間（支援當日及往前最多 5 天補登）
  const [visitDate, setVisitDate] = useState<string>(() => getTaipeiDateOffsetStr(0));
  const [visitTime, setVisitTime] = useState<string>(() => getTaipeiCurrentTimeStr());
  const [isCustomTime, setIsCustomTime] = useState<boolean>(false);
  const [storeSearchQuery, setStoreSearchQuery] = useState<string>('');
  const [selectedStoreRegionFilter, setSelectedStoreRegionFilter] = useState<string>('全部');

  // 門市前次巡店紀錄與歷史缺失 (PDCA 閉環)
  const [lastAuditData, setLastAuditData] = useState<LastAuditData | null>(null);
  const [lastAuditLoading, setLastAuditLoading] = useState<boolean>(false);

  // 網路即時連線監控 (離線填報安全防護)
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [onlineNotice, setOnlineNotice] = useState<boolean>(false);

  // --- Local Storage Auto Save & Multi-Store Drafts ---
  const [isDraftRestored, setIsDraftRestored] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string>('');
  const [draftWarning, setDraftWarning] = useState<string>('');
  const [hasRestoredBanner, setHasRestoredBanner] = useState<boolean>(false);
  const [saveToast, setSaveToast] = useState<boolean>(false);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [multiDrafts, setMultiDrafts] = useState<Record<string, any>>({});

  // 監聽 Escape 鍵快速關閉照片全螢幕預覽燈箱
  useEffect(() => {
    if (!previewPhotoUrl) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewPhotoUrl(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewPhotoUrl]);

  // 監聽離線與上線事件
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setOnlineNotice(true);
      setTimeout(() => setOnlineNotice(false), 3500);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setOnlineNotice(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 抓取前次巡檢紀錄
  const fetchLastAuditRecord = async (store: string) => {
    if (!store || taskType !== '實地巡店') {
      setLastAuditData(null);
      return;
    }
    setLastAuditLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const apiBase = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';
      const res = await fetch(`${apiBase}/visit-records/last-audit?store=${encodeURIComponent(store)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setLastAuditData(data);
      } else {
        setLastAuditData(null);
      }
    } catch (err) {
      console.warn('載入前次巡檢紀錄稍有延遲', err);
      setLastAuditData(null);
    } finally {
      setLastAuditLoading(false);
    }
  };

  // 計算當前表單完成度百分比 (0~100)
  const calculateFormProgress = () => {
    let score = 0;
    if (storeName) score += 20;
    if (auditMode) score += 10;
    const coreCount = Object.keys(coreChecks).length;
    score += Math.min(30, coreCount * 10);
    const catCount = Object.keys(categoryChecks).length;
    if (catCount > 0) score += Math.min(25, catCount * 5);
    if (overallRating) score += 15;
    return Math.min(100, score);
  };

  // 安全存入 LocalStorage，支援多門市草稿
  const saveDraftSafe = () => {
    const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    const safePairs = Array.isArray(photoPairs) && photoPairs.length > 0
      ? photoPairs
      : [{ beforeUrl: '', afterUrl: '' }];
    const progress = calculateFormProgress();

    const currentDraft = {
      storeName,
      mgrName: user?.name || mgrName,
      auditMode,
      selectedTopics,
      coreChecks,
      categoryChecks,
      categoryRemarks,
      customItems,
      pdcaResults,
      newActionItems,
      overallRating,
      photoPairs: safePairs,
      defectPhotos,
      currentStep,
      visitDate,
      visitTime,
      isCustomTime,
      savedAt: timeStr,
      progress
    };

    try {
      // 1. 存入單一主要草稿
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(currentDraft));

      // 2. 存入多門市草稿字典
      if (storeName) {
        const existingMulti = (() => {
          try {
            return JSON.parse(localStorage.getItem(MULTI_DRAFTS_STORAGE_KEY) || '{}');
          } catch {
            return {};
          }
        })();
        existingMulti[storeName] = currentDraft;
        localStorage.setItem(MULTI_DRAFTS_STORAGE_KEY, JSON.stringify(existingMulti));
        setMultiDrafts(existingMulti);
      }

      setDraftSavedAt(timeStr);
      setDraftWarning('');
    } catch (quotaErr) {
      console.warn('LocalStorage 空間不足，啟用降級保護', quotaErr);
      try {
        const slimDraft = {
          ...currentDraft,
          photoPairs: [{ beforeUrl: '', afterUrl: '' }],
          defectPhotos: {}
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(slimDraft));
        if (storeName) {
          const existingMulti = (() => {
            try {
              return JSON.parse(localStorage.getItem(MULTI_DRAFTS_STORAGE_KEY) || '{}');
            } catch {
              return {};
            }
          })();
          existingMulti[storeName] = slimDraft;
          localStorage.setItem(MULTI_DRAFTS_STORAGE_KEY, JSON.stringify(existingMulti));
          setMultiDrafts(existingMulti);
        }
        setDraftSavedAt(timeStr);
        setDraftWarning('文字資料已妥善暫存（照片暫不佔用本機容量）');
      } catch (innerErr) {
        console.error('嚴重 LocalStorage 儲存錯誤', innerErr);
      }
    }
  };

  // 還原指定門市的草稿
  const restoreDraft = (draft: any) => {
    if (!draft) return;
    setStoreName(draft.storeName || '');
    if (draft.storeName) {
      fetchActionItems(draft.storeName);
      fetchLastAuditRecord(draft.storeName);
    }
    setMgrName(user?.name || draft.mgrName || '區主管');
    setAuditMode(draft.auditMode || 'C');
    setSelectedTopics(draft.selectedTopics || []);
    setCoreChecks(draft.coreChecks || {});
    setCategoryChecks(draft.categoryChecks || {});
    setCategoryRemarks(draft.categoryRemarks || {});
    setCustomItems(draft.customItems || {});
    setPdcaResults(draft.pdcaResults || {});
    setNewActionItems(
      Array.isArray(draft.newActionItems) && draft.newActionItems.length > 0
        ? draft.newActionItems
        : [{ desc: '', assignee: '', dueDate: '' }]
    );
    setOverallRating(draft.overallRating || '');
    setPhotoPairs(
      Array.isArray(draft.photoPairs) && draft.photoPairs.length > 0
        ? draft.photoPairs
        : [{ beforeUrl: '', afterUrl: '' }]
    );
    setDefectPhotos(draft.defectPhotos || {});
    if (draft.visitDate) {
      const todayStr = getTaipeiDateOffsetStr(0);
      const minDateStr = getTaipeiDateOffsetStr(MAX_BACKFILL_DAYS);
      if (draft.visitDate >= minDateStr && draft.visitDate <= todayStr) {
        setVisitDate(draft.visitDate);
        if (draft.visitTime) setVisitTime(draft.visitTime);
        if (typeof draft.isCustomTime === 'boolean') setIsCustomTime(draft.isCustomTime);
      }
    }
    if (draft.currentStep) setCurrentStep(draft.currentStep);
    setDraftSavedAt(draft.savedAt || '稍早');
    setHasRestoredBanner(true);
  };

  // 放棄/清除指定門市之草稿
  const handleDiscardDraft = (targetStore: string) => {
    if (!window.confirm(`確定要放棄並清除「${targetStore}」的暫存草稿嗎？已填寫內容將無法復原。`)) return;
    try {
      const existingMulti = (() => {
        try {
          return JSON.parse(localStorage.getItem(MULTI_DRAFTS_STORAGE_KEY) || '{}');
        } catch {
          return {};
        }
      })();
      delete existingMulti[targetStore];
      localStorage.setItem(MULTI_DRAFTS_STORAGE_KEY, JSON.stringify(existingMulti));
      setMultiDrafts(existingMulti);

      if (storeName === targetStore) {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        setStoreName('');
        setSelectedTopics([]);
        setCoreChecks({});
        setCategoryChecks({});
        setCategoryRemarks({});
        setCustomItems({});
        setPdcaResults({});
        setPastActionItems([]);
        setLastAuditData(null);
        setOverallRating('');
        setPhotoPairs([{ beforeUrl: '', afterUrl: '' }]);
        setDefectPhotos({});
        setHasRestoredBanner(false);
        setCurrentStep(1);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 手動儲存按鈕
  const handleManualSave = () => {
    saveDraftSafe();
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2500);
  };

  // 進入頁面時無損自動還原草稿，避免主管手誤點擊取消而遺失心血
  useEffect(() => {
    // 載入多門市草稿字典
    try {
      const savedMulti = JSON.parse(localStorage.getItem(MULTI_DRAFTS_STORAGE_KEY) || '{}');
      setMultiDrafts(savedMulti);
    } catch (e) {
      console.warn('Failed to parse multi-drafts', e);
    }

    const draftStr = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (draftStr) {
      try {
        const draft = JSON.parse(draftStr);
        const hasContent = Boolean(
          draft.storeName ||
          (draft.selectedTopics && draft.selectedTopics.length > 0) ||
          (draft.coreChecks && Object.keys(draft.coreChecks).length > 0) ||
          (draft.categoryChecks && Object.keys(draft.categoryChecks).length > 0)
        );

        if (hasContent) {
          restoreDraft(draft);
        }
      } catch (e) {
        console.error('Failed to parse draft', e);
      }
    }
    const params = new URLSearchParams(window.location.search);
    const queryStore = params.get('store')?.trim();
    const querySchedule = params.get('schedule')?.trim();
    if (queryStore) {
      setTaskType('實地巡店');
      setStoreName(queryStore);
      setCurrentStep(1);
      fetchActionItems(queryStore);
      fetchLastAuditRecord(queryStore);
    } else if (querySchedule) {
      setTaskType('總部行程');
      setCurrentStep(1);
    }
    setIsDraftRestored(true);
  }, [user]);

  // 當使用者登入身分載入後，同步主管姓名
  useEffect(() => {
    if (user?.name) {
      setMgrName(user.name);
    }
  }, [user?.name]);

  // 確保 photoPairs 永遠至少有一組改善前/改善後框，不會因空陣列而消失
  useEffect(() => {
    if (!Array.isArray(photoPairs) || photoPairs.length === 0) {
      setPhotoPairs([{ beforeUrl: '', afterUrl: '' }]);
    }
  }, [photoPairs]);

  // 表單變更時自動儲存草稿
  useEffect(() => {
    if (!isDraftRestored) return;
    saveDraftSafe();
  }, [storeName, mgrName, auditMode, selectedTopics, coreChecks, categoryChecks, categoryRemarks, customItems, pdcaResults, newActionItems, overallRating, photoPairs, defectPhotos, currentStep, visitDate, visitTime, isCustomTime, isDraftRestored]);

  /**
   * 將使用者拍照/上傳的圖片進行客戶端等比縮放壓縮轉為 base64 (JPEG)
   * 限制最大寬高 1280px，品質 0.75，大幅降低網路傳輸耗時並確保後台有效儲存
   */
  const compressImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1280;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  /**
   * 缺失項目專屬之拍照前後 (改善前 Before & 改善後 After) 上傳元件
   */
  const renderDefectPhotoPair = (itemKey: string) => {
    const pair = defectPhotos[itemKey] || { beforeUrl: '', afterUrl: '' };
    const handleUpload = async (field: 'beforeUrl' | 'afterUrl', file?: File) => {
      if (!file) return;
      try {
        const base64Url = await compressImageToBase64(file);
        setDefectPhotos(prev => ({
          ...prev,
          [itemKey]: {
            beforeUrl: field === 'beforeUrl' ? base64Url : (prev[itemKey]?.beforeUrl || ''),
            afterUrl: field === 'afterUrl' ? base64Url : (prev[itemKey]?.afterUrl || '')
          }
        }));
      } catch (err) {
        console.error('照片讀取失敗', err);
        alert('照片讀取失敗，請重新拍攝');
      }
    };

    const handleClear = (field: 'beforeUrl' | 'afterUrl') => {
      setDefectPhotos(prev => ({
        ...prev,
        [itemKey]: {
          beforeUrl: field === 'beforeUrl' ? '' : (prev[itemKey]?.beforeUrl || ''),
          afterUrl: field === 'afterUrl' ? '' : (prev[itemKey]?.afterUrl || '')
        }
      }));
    };

    return (
      <div className="mt-3 pt-3 border-t border-red-200/70">
        <p className="text-xs font-bold text-gray-700 mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Camera size={14} className="text-purple-600" />
            現場拍照存證 (Before & After)
          </span>
          {(pair.beforeUrl || pair.afterUrl) && (
            <span className="text-[11px] font-medium text-purple-600">點擊照片可放大檢視</span>
          )}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {/* Before */}
          <div className="relative">
            <p className="text-xs font-bold text-rose-700 mb-1.5 text-center">改善前 (Before)</p>
            {pair.beforeUrl ? (
              <div className="relative w-full h-28 rounded-xl overflow-hidden border border-rose-200 bg-white group">
                <img
                  src={pair.beforeUrl}
                  alt="Before"
                  className="w-full h-full object-cover cursor-zoom-in"
                  onClick={() => setPreviewPhotoUrl(pair.beforeUrl)}
                />
                <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
                  <label
                    className="bg-white/95 text-gray-700 hover:text-blue-600 rounded-md px-2 py-0.5 text-[11px] font-bold shadow-xs cursor-pointer border border-gray-200"
                    title="重拍或更換照片"
                  >
                    重拍
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                      onChange={(e) => handleUpload('beforeUrl', e.target.files?.[0])}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleClear('beforeUrl')}
                    className="bg-white/95 text-gray-500 hover:text-red-600 rounded-md p-1 shadow-xs border border-gray-200"
                    title="移除照片"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <label className="w-full h-28 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-50 hover:border-blue-400 transition-colors overflow-hidden bg-white">
                <Camera size={20} className="mb-1 text-rose-500" />
                <span className="text-xs font-medium text-gray-600">拍照 / 上傳</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                  onChange={(e) => handleUpload('beforeUrl', e.target.files?.[0])}
                />
              </label>
            )}
          </div>
          {/* After */}
          <div className="relative">
            <p className="text-xs font-bold text-emerald-700 mb-1.5 text-center">改善後 (After)</p>
            {pair.afterUrl ? (
              <div className="relative w-full h-28 rounded-xl overflow-hidden border border-emerald-200 bg-white group">
                <img
                  src={pair.afterUrl}
                  alt="After"
                  className="w-full h-full object-cover cursor-zoom-in"
                  onClick={() => setPreviewPhotoUrl(pair.afterUrl)}
                />
                <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
                  <label
                    className="bg-white/95 text-gray-700 hover:text-blue-600 rounded-md px-2 py-0.5 text-[11px] font-bold shadow-xs cursor-pointer border border-gray-200"
                    title="重拍或更換照片"
                  >
                    重拍
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                      onChange={(e) => handleUpload('afterUrl', e.target.files?.[0])}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleClear('afterUrl')}
                    className="bg-white/95 text-gray-500 hover:text-red-600 rounded-md p-1 shadow-xs border border-gray-200"
                    title="移除照片"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <label className="w-full h-28 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-50 hover:border-blue-400 transition-colors overflow-hidden bg-white">
                <Camera size={20} className="mb-1 text-emerald-500" />
                <span className="text-xs font-medium text-gray-600">拍照 / 上傳</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                  onChange={(e) => handleUpload('afterUrl', e.target.files?.[0])}
                />
              </label>
            )}
          </div>
        </div>
      </div>
    );
  };

  const handleAddCustomItem = (index: number) => {
    const val = customInputValues[index]?.trim();
    if (val) {
      setCustomItems(prev => ({
        ...prev,
        [index]: [...(prev[index] || []), val]
      }));
      setCustomInputValues(prev => ({ ...prev, [index]: '' }));
    }
  };

  // --- Fetch Action Items ---
  const fetchActionItems = async (store: string) => {
    if (!store) return;
    setActionItemsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const apiBase = import.meta.env.PROD ? '/api' : 'https://management-dashboard-rust.vercel.app/api';
      const res = await fetch(`${apiBase}/action-items?store=${encodeURIComponent(store)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setPastActionItems(data.filter((item: any) => item.status === 'Open' && !item.desc?.includes('測試') && !item.issueDescription?.includes('測試')));
      }
    } catch (e) {
      console.error(e);
    }
    setActionItemsLoading(false);
  };

  // --- Submit with Retry & Data Persistence Guarantee ---
  const [submitting, setSubmitting] = useState(false);
  const [submitStatusText, setSubmitStatusText] = useState('');

  /**
   * 根據區經理所選之「問卷回填日期與時間」轉換為 UTC ISO 字串
   * 嚴格限制於「今日 ~ 往前最多 5 天」範圍內，且不超過當下時間
   */
  const buildBackfillCreatedAtIso = (): string => {
    const todayStr = getTaipeiDateOffsetStr(0);
    const minDateStr = getTaipeiDateOffsetStr(MAX_BACKFILL_DAYS);
    let safeDate = visitDate || todayStr;
    if (safeDate < minDateStr) safeDate = minDateStr;
    if (safeDate > todayStr) safeDate = todayStr;

    // 若為今日且未手動指定回填時間，直接使用送出當下的即時時間
    if (safeDate === todayStr && !isCustomTime) {
      return new Date().toISOString();
    }

    const safeTime = /^\d{2}:\d{2}$/.test(visitTime) ? visitTime : getTaipeiCurrentTimeStr();
    const parsed = new Date(`${safeDate}T${safeTime}:00+08:00`);
    const now = new Date();
    if (isNaN(parsed.getTime()) || parsed.getTime() > now.getTime()) {
      return now.toISOString();
    }
    return parsed.toISOString();
  };

  const submitScheduleForm = async () => {
    if (submitting) return;
    if (!scheduleNote.trim()) {
      return alert('請填寫當日行程／任務內容說明（將顯示於戰情牆）');
    }
    const todayStr = getTaipeiDateOffsetStr(0);
    const minDateStr = getTaipeiDateOffsetStr(MAX_BACKFILL_DAYS);
    if (visitDate < minDateStr || visitDate > todayStr) {
      return alert(`回填日期僅限今日至往前最多 ${MAX_BACKFILL_DAYS} 天（${minDateStr} ~ ${todayStr}）`);
    }

    setSubmitting(true);
    setSubmitStatusText(`正在回報${visitDate === todayStr ? '當日' : `${visitDate} `}${taskType}...`);

    let detectedRegion = '';
    const refStore = (user?.assigned_stores && user.assigned_stores[0]) || '';
    if (refStore) {
      for (const [r, stores] of Object.entries(storeRegions)) {
        if (stores.includes(refStore)) {
          detectedRegion = r;
          break;
        }
      }
    }

    const payload = {
      storeName: scheduleLocation.trim() || taskType,
      region: detectedRegion,
      areaManagerName: user?.name || mgrName,
      jobTitle: '區主管',
      actionType: taskType,
      expectedStayMinutes: scheduleDuration || 240,
      tags: [taskType, '當日行程'],
      immediateImprovement: '',
      highlightDescription: scheduleNote.trim(),
      abnormalFlag: false,
      photoPairs: [],
      createdAt: buildBackfillCreatedAtIso()
    };

    try {
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const targetUrl = import.meta.env.PROD
        ? '/api/visit-records'
        : 'https://management-dashboard-rust.vercel.app/api/visit-records';
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `伺服器回應 ${res.status}`);
      }
      setScheduleNote('');
      setScheduleLocation('');
      const dateHint = visitDate === todayStr ? '當日' : `【${visitDate} 補登】`;
      alert(`✅ 已成功回報${dateHint}「${taskType}」！戰情牆已即時更新您的行程狀態。`);
      navigate(visitDate === todayStr ? '/dashboard' : `/dashboard?date=${visitDate}`);
    } catch (e: any) {
      alert(`⚠️ 行程回報失敗（${e?.message || '網路異常'}），請稍後再試。`);
    } finally {
      setSubmitting(false);
      setSubmitStatusText('');
    }
  };

  const submitForm = async () => {
    if (submitting) return;
    if (!storeName) return alert('請選擇門市名稱');
    if (!auditMode) return alert('請選擇巡店模式');
    const todayStr = getTaipeiDateOffsetStr(0);
    const minDateStr = getTaipeiDateOffsetStr(MAX_BACKFILL_DAYS);
    if (visitDate < minDateStr || visitDate > todayStr) {
      return alert(`問卷回填日期僅限今日至往前最多 ${MAX_BACKFILL_DAYS} 天（${minDateStr} ~ ${todayStr}）`);
    }
    
    // 檢查是否有缺失未填寫備註
    for (const [k, v] of Object.entries(coreChecks)) {
      if (v === '缺失' && !categoryRemarks[k]?.trim()) return alert(`核心底線有缺失未填寫說明，請返回步驟2補齊`);
    }
    for (const [k, v] of Object.entries(categoryChecks)) {
      if (v === '缺失' && !categoryRemarks[k]?.trim()) return alert(`模組細項有缺失未填寫說明，請返回步驟3補齊`);
    }

    if (Object.keys(coreChecks).length < 3) return alert('請完成第二層：必看核心底線');
    if (!overallRating) return alert('請選擇巡店綜合評價');
    
    const signature = sigCanvas.current?.isEmpty() ? null : sigCanvas.current?.toDataURL();

    // 查找所選門市所屬區域
    let detectedRegion = '';
    for (const [r, stores] of Object.entries(storeRegions)) {
      if (stores.includes(storeName)) {
        detectedRegion = r;
        break;
      }
    }

    // 合併步驟 2/3 缺失拍照與步驟 4 現場拍照存證
    const mergedPhotos = [
      ...Object.values(defectPhotos).filter(p => p && (p.beforeUrl || p.afterUrl)),
      ...photoPairs.filter(p => p && (p.beforeUrl || p.afterUrl))
    ];

    const payload = {
      storeName,
      region: detectedRegion,
      areaManagerName: user?.name || mgrName,
      auditMode,
      selectedTopics,
      coreChecks,
      categoryChecks,
      categoryRemarks,
      pdcaResults,
      newActionItems: newActionItems.filter(i => i.desc?.trim()),
      overallRating,
      signature,
      photoPairs: mergedPhotos,
      createdAt: buildBackfillCreatedAtIso()
    };

    setSubmitting(true);
    setSubmitStatusText('正在安全傳輸巡店紀錄與照片...');

    // 弱網與高負載環境重試機制 (最多重試 2 次)
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const endpoints = [
      '/api/visit-records',
      'https://management-dashboard-rust.vercel.app/api/visit-records'
    ];

    let isSuccess = false;
    let lastErrorMsg = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (attempt > 1) {
          setSubmitStatusText('連線稍有延遲，正在自動為您重試 (第 2 次)...');
          await new Promise(r => setTimeout(r, 1500));
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 秒保護防呆

        // 生產環境優先使用同源相對路徑
        const targetUrl = import.meta.env.PROD ? endpoints[0] : endpoints[1];
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `伺服器回應狀態碼 ${res.status}`);
        }

        const resData = await res.json();
        if (resData && (resData.success || resData.data)) {
          isSuccess = true;
          break;
        } else {
          throw new Error('伺服器未回傳確認信號');
        }
      } catch (err: any) {
        lastErrorMsg = err?.message || '連線逾時或網路不穩';
        console.warn(`巡檢資料送出第 ${attempt} 次失敗:`, err);
      }
    }

    if (isSuccess) {
      const submittedDate = visitDate;
      const submittedStore = storeName;
      // 伺服器確認持久化存檔後，才安全清除本機草稿並重置表單狀態
      setIsDraftRestored(false);
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      try {
        const existingMulti = JSON.parse(localStorage.getItem(MULTI_DRAFTS_STORAGE_KEY) || '{}');
        delete existingMulti[submittedStore];
        localStorage.setItem(MULTI_DRAFTS_STORAGE_KEY, JSON.stringify(existingMulti));
        setMultiDrafts(existingMulti);
      } catch (e) {
        console.warn(e);
      }
      setStoreName('');
      setSelectedTopics([]);
      setCoreChecks({});
      setCategoryChecks({});
      setCategoryRemarks({});
      setCustomItems({});
      setPdcaResults({});
      setPastActionItems([]);
      setLastAuditData(null);
      setNewActionItems([{ desc: '', assignee: '', dueDate: '' }]);
      setPhotoPairs([{ beforeUrl: '', afterUrl: '' }]);
      setDefectPhotos({});
      setOverallRating('');
      setVisitDate(getTaipeiDateOffsetStr(0));
      setVisitTime(getTaipeiCurrentTimeStr());
      setIsCustomTime(false);
      setCurrentStep(1);
      setHasRestoredBanner(false);
      setDraftSavedAt('');
      sigCanvas.current?.clear();
      setTimeout(() => setIsDraftRestored(true), 100);
      if (submittedDate !== todayStr) {
        alert(`🎉 巡店紀錄（回填時間：${submittedDate} ${visitTime}）已成功儲存至雲端系統！`);
      } else {
        alert('🎉 巡店紀錄已成功儲存至雲端系統！');
      }
      navigate(user?.role === 'admin' ? (submittedDate === todayStr ? '/dashboard' : `/dashboard?date=${submittedDate}`) : '/audit');
    } else {
      // 失敗時嚴格保留草稿與表單內容，確保主管心血不流失
      alert(`⚠️ 儲存失敗（${lastErrorMsg}）。\n\n【請放心】您填寫的所有內容已妥善暫存於手機本機草稿！請確認網路訊號後，直接再次點擊【送出巡店紀錄】即可重試。`);
    }

    setSubmitting(false);
    setSubmitStatusText('');
  };
  // --- Stepper Navigation ---
  const handleNext = () => {
    if (currentStep === 1) {
      if (!storeName) return alert('請先選擇門市名稱');
      if (auditMode === 'B' && selectedTopics.length === 0) return alert('請至少選擇一個查核主題');
    }
    if (currentStep === 2) {
      if (Object.keys(coreChecks).length < 3) return alert('請完成所有必看核心底線');
    }
    
    // 如果是模式A，Step 2 結束直接跳到 Step 4
    if (currentStep === 2 && auditMode === 'A') {
      setCurrentStep(4);
    } else {
      setCurrentStep(prev => Math.min(prev + 1, totalSteps));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrev = () => {
    if (currentStep === 4 && auditMode === 'A') {
      setCurrentStep(2);
    } else {
      setCurrentStep(prev => Math.max(prev - 1, 1));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // --- Render Sections ---
  /**
   * 問卷／巡店回填時間選擇器（支援今日及往前最多 5 天補登）
   */
  const renderBackfillTimeSelector = () => {
    const todayStr = getTaipeiDateOffsetStr(0);
    const minDateStr = getTaipeiDateOffsetStr(MAX_BACKFILL_DAYS);
    const dateOptions = getBackfillDateOptions();
    const isBackfilling = visitDate !== todayStr;

    return (
      <div
        className={`rounded-xl p-4 border transition-all ${
          isBackfilling
            ? 'bg-amber-50/70 border-amber-300 shadow-xs'
            : 'bg-blue-50/40 border-blue-100'
        }`}
      >
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <label className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
            <Calendar size={16} className={isBackfilling ? 'text-amber-600' : 'text-blue-600'} />
            <span>問卷／巡店回填時間</span>
            <span className="text-red-500">*</span>
          </label>
          <span
            className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
              isBackfilling
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : 'bg-white text-blue-700 border-blue-200'
            }`}
          >
            {isBackfilling
              ? `🕒 補登回填：${visitDate} ${visitTime}`
              : `可往前補登最多 ${MAX_BACKFILL_DAYS} 天`}
          </span>
        </div>

        {/* 快速日期選擇按鈕（今日 + 往前 5 天） */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
          {dateOptions.map(opt => {
            const active = visitDate === opt.dateStr;
            return (
              <button
                key={opt.dateStr}
                type="button"
                onClick={() => {
                  setVisitDate(opt.dateStr);
                  if (opt.daysAgo === 0 && !isCustomTime) {
                    setVisitTime(getTaipeiCurrentTimeStr());
                  }
                }}
                className={`py-2 px-1.5 rounded-lg border text-center transition-all cursor-pointer ${
                  active
                    ? opt.daysAgo === 0
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-bold'
                      : 'bg-amber-500 text-white border-amber-500 shadow-xs font-bold'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:bg-blue-50/40'
                }`}
              >
                <div className="text-xs font-bold leading-tight">{opt.label}</div>
                <div className={`text-[11px] mt-0.5 ${active ? 'text-white/90' : 'text-gray-500'}`}>
                  {opt.shortDate}({opt.weekday})
                </div>
              </button>
            );
          })}
        </div>

        {/* 日期與時間精細選擇器 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
            <Calendar size={15} className="text-gray-400 shrink-0" />
            <span className="text-xs font-semibold text-gray-500 shrink-0">日期：</span>
            <input
              type="date"
              min={minDateStr}
              max={todayStr}
              value={visitDate}
              onChange={e => {
                const val = e.target.value;
                if (!val) {
                  setVisitDate(todayStr);
                  return;
                }
                if (val < minDateStr) {
                  alert(`問卷回填日期最多僅能往前 ${MAX_BACKFILL_DAYS} 天（最早可選 ${minDateStr}）`);
                  setVisitDate(minDateStr);
                } else if (val > todayStr) {
                  alert('問卷回填日期不可選擇未來日期');
                  setVisitDate(todayStr);
                } else {
                  setVisitDate(val);
                }
              }}
              className="flex-1 text-sm font-semibold text-gray-800 outline-none bg-transparent"
            />
          </div>

          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
            <Clock size={15} className="text-gray-400 shrink-0" />
            <span className="text-xs font-semibold text-gray-500 shrink-0">時間：</span>
            <input
              type="time"
              value={visitTime}
              onChange={e => {
                setVisitTime(e.target.value || getTaipeiCurrentTimeStr());
                setIsCustomTime(true);
              }}
              className="flex-1 text-sm font-semibold text-gray-800 outline-none bg-transparent"
            />
            {(isBackfilling || isCustomTime) && (
              <button
                type="button"
                onClick={() => {
                  setVisitDate(todayStr);
                  setVisitTime(getTaipeiCurrentTimeStr());
                  setIsCustomTime(false);
                }}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-md shrink-0 transition-colors cursor-pointer"
              >
                設為現在
              </button>
            )}
          </div>
        </div>

        {(isBackfilling || isCustomTime) && (
          <p className="text-xs text-amber-800 font-medium mt-2.5 flex items-center gap-1.5">
            <span>📌</span>
            <span>
              本筆問卷將以 <strong>{visitDate} {visitTime}</strong> 回填送出，並自動計入該日期與當週之區主管巡店進度。
            </span>
          </p>
        )}
      </div>
    );
  };

  /**
   * 門市前次巡檢歷史紀錄與缺失提醒卡片 (PDCA 閉環)
   */
  const renderHistoricalDefectCard = () => {
    if (!storeName || taskType !== '實地巡店') return null;

    if (lastAuditLoading) {
      return (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex items-center gap-2.5 animate-pulse">
          <History size={16} className="text-blue-500 animate-spin" />
          <span className="text-xs text-gray-500 font-medium">正在比對「{storeName}」前次巡檢紀錄與歷史缺失...</span>
        </div>
      );
    }

    if (!lastAuditData || !lastAuditData.hasHistory) {
      return (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center gap-2 text-xs text-gray-500">
          <History size={15} className="text-gray-400 shrink-0" />
          <span>門市「{storeName}」尚無前次實地巡檢紀錄（新進門市或首次巡檢）。</span>
        </div>
      );
    }

    const {
      taipeiDate,
      areaManagerName,
      overallRating: prevRating,
      defects = [],
      suggestedTopicIndices = [],
      immediateImprovement,
      abnormalFlag,
    } = lastAuditData;

    const hasDefects = defects.length > 0;

    // 一鍵將歷史缺失對應之主題加入本次重點複查 (PDCA)
    const handleApplySuggestedTopics = () => {
      if (suggestedTopicIndices.length === 0) return;
      const merged = Array.from(new Set([...selectedTopics, ...suggestedTopicIndices])).sort((a, b) => a - b);
      setSelectedTopics(merged);
      setAuditMode('B'); // 自動切換為模式 B (主題巡店)
      const topicNames = suggestedTopicIndices.map(idx => AUDIT_TOPIC_NAMES[idx - 1]).filter(Boolean).join('、');
      alert(`⚡ 已自動為您切換至【模式 B 主題巡店】，並自動勾選前次缺失對應主題：\n${topicNames}\n\n您可直接前往步驟 2 與步驟 3 進行重點複查！`);
    };

    return (
      <div className={`rounded-xl border p-4 transition-all ${
        hasDefects ? 'bg-amber-50/70 border-amber-300 shadow-xs' : 'bg-emerald-50/60 border-emerald-200'
      }`}>
        <div className="flex items-start justify-between flex-wrap gap-2.5 mb-2.5">
          <div className="flex items-center gap-2.5">
            <span className={`p-1.5 rounded-lg ${hasDefects ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
              <History size={18} />
            </span>
            <div>
              <div className="text-sm font-bold text-gray-900 flex items-center gap-2 flex-wrap">
                <span>前次巡檢紀錄（{storeName}）</span>
                {prevRating && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold border ${
                    prevRating === '特優' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                    prevRating === '優' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                    prevRating === '良' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                    'bg-red-100 text-red-700 border-red-200'
                  }`}>
                    評等：{prevRating}
                  </span>
                )}
                {abnormalFlag && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-700 border border-red-200">
                    ⚠️ 異常警示
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                巡檢日期：<span className="font-semibold text-gray-700">{taipeiDate || '歷史紀錄'}</span>
                {areaManagerName && <> · 查核主管：<span className="font-semibold text-gray-700">{areaManagerName}</span></>}
              </div>
            </div>
          </div>

          {hasDefects && suggestedTopicIndices.length > 0 && (
            <button
              type="button"
              onClick={handleApplySuggestedTopics}
              className="text-xs bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold px-3 py-1.5 rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer transition-transform active:scale-95"
            >
              <Sparkles size={14} />
              <span>⚡ 一鍵帶入本次重點複查主題 ({suggestedTopicIndices.length})</span>
            </button>
          )}
        </div>

        {/* 缺失項目列表 */}
        {hasDefects ? (
          <div className="mt-3 bg-white/95 rounded-lg p-3 border border-amber-200 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-amber-900 border-b border-amber-100 pb-1.5">
              <span className="flex items-center gap-1">
                <AlertTriangle size={14} className="text-amber-600" />
                <span>前次共發現 {defects.length} 項缺失（本次巡店應加強抽查）：</span>
              </span>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {defects.map((defect, idx) => (
                <div key={defect.key || idx} className="text-xs bg-amber-50/60 rounded-md p-2 border border-amber-100 flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="font-bold text-gray-800 flex items-center gap-1.5">
                      <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                        defect.isCore ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-orange-100 text-orange-700 border border-orange-200'
                      }`}>
                        {defect.isCore ? '核心底線' : '模組細項'}
                      </span>
                      <span>{defect.label}</span>
                    </div>
                    {defect.remark && (
                      <div className="text-[11px] text-gray-600 mt-1 pl-2 border-l-2 border-amber-300">
                        備註：{defect.remark}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-xs text-emerald-800 font-medium flex items-center gap-1.5 bg-white/80 p-2.5 rounded-lg border border-emerald-200">
            <span>🎉</span>
            <span>前次巡檢全項合格無缺失，表現優良！請維持現場水準。</span>
          </div>
        )}

        {immediateImprovement && (
          <div className="mt-2 text-xs text-gray-600 bg-white/80 p-2.5 rounded-lg border border-gray-200">
            <span className="font-bold text-gray-700">前次即時改善與指示：</span>
            <span>{immediateImprovement}</span>
          </div>
        )}
      </div>
    );
  };

  const renderStep1 = () => (
    <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-xl font-bold text-gray-800 mb-6 border-b pb-3 flex items-center gap-2">
        <span className="bg-blue-100 text-blue-700 w-7 h-7 rounded-full flex items-center justify-center text-sm">1</span>
        當日作業與行程選擇
      </h2>
      <div className="space-y-5">
        {/* 問卷／巡店回填日期與時間選擇（可往前最多 5 天） */}
        {renderBackfillTimeSelector()}

        {/* 當日行程類型選擇：實地巡店 / 總部行程 / 會議行程 / 特殊行程 */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            當日行程類型 <span className="text-red-500">*</span>
            <span className="text-xs font-normal text-gray-500 ml-2">（若有總部、會議或特殊任務請點選對應行程，將直接顯示於戰情牆）</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {([
              { key: '實地巡店', icon: '🏪', label: '門市實地巡店', sub: '常規門市查核' },
              { key: '總部行程', icon: '🏢', label: '總部行程', sub: '總部辦公/公務' },
              { key: '會議行程', icon: '📅', label: '會議行程', sub: '月會/專案會議' },
              { key: '特殊行程', icon: '⭐', label: '特殊行程', sub: '支援/教育訓練' },
            ] as const).map(opt => {
              const active = taskType === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setTaskType(opt.key)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    active
                      ? 'bg-indigo-50 border-indigo-600 shadow-sm ring-1 ring-indigo-500'
                      : 'bg-white border-gray-200 hover:border-indigo-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-base font-bold text-gray-900 flex items-center gap-1.5">
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {taskType !== '實地巡店' ? (
          <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-indigo-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-indigo-950">
                  {taskType === '總部行程' ? '🏢' : taskType === '會議行程' ? '📅' : '⭐'} 登記當日「{taskType}」
                </h3>
                <p className="text-xs text-indigo-700 mt-0.5">
                  送出後，戰情牆上方與左側主管進度將同步顯示您的「{taskType}」與任務內容，不會顯示為尚未巡店。
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-800 mb-1.5">
                任務／行程內容說明 <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={scheduleNote}
                onChange={e => setScheduleNote(e.target.value)}
                placeholder={`例如：參加總部營運月會、教育訓練課程、跨區支援專案...`}
                className="w-full border border-indigo-200 rounded-xl px-4 py-3 text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-1.5">
                  行程地點／對象 <span className="text-gray-400 font-normal text-xs">（選填）</span>
                </label>
                <input
                  type="text"
                  value={scheduleLocation}
                  onChange={e => setScheduleLocation(e.target.value)}
                  placeholder={`預設顯示「${taskType}」，可填總部或地點`}
                  className="w-full border border-indigo-200 rounded-xl px-4 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-1.5">
                  預計行程時數（分鐘）
                </label>
                <div className="flex gap-2">
                  {[
                    { mins: 120, label: '2小時' },
                    { mins: 240, label: '半天(4h)' },
                    { mins: 480, label: '全天(8h)' },
                  ].map(d => (
                    <button
                      key={d.mins}
                      type="button"
                      onClick={() => setScheduleDuration(d.mins)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${
                        scheduleDuration === d.mins
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-indigo-50'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={submitScheduleForm}
              disabled={submitting}
              className="w-full py-3.5 px-5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold rounded-xl shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <CheckCircle2 size={18} />
              {submitting ? '正在送出行程...' : `立即回報當日「${taskType}」並顯示於戰情牆`}
            </button>
          </div>
        ) : (
          <>
        {/* 本機多門市草稿箱 (地下室/弱網安全暫存) */}
        {Object.keys(multiDrafts).length > 0 && (
          <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3.5 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <span>📝</span> 本機暫存草稿箱 ({Object.keys(multiDrafts).length} 間門市)
              </span>
              <span className="text-[11px] text-indigo-600 font-medium">
                地下室／離線填報安全保護中
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(multiDrafts).map(([targetStore, draft]) => {
                const isCurrent = storeName === targetStore;
                const progress = typeof draft?.progress === 'number' ? draft.progress : 0;
                return (
                  <div
                    key={targetStore}
                    className={`flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-lg border text-xs transition-all ${
                      isCurrent
                        ? 'bg-white border-indigo-500 font-bold text-indigo-950 shadow-xs ring-2 ring-indigo-400/30'
                        : 'bg-white/80 border-indigo-200 text-gray-700 hover:bg-white hover:border-indigo-400'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isCurrent) return;
                        if (storeName && storeName !== targetStore) {
                          saveDraftSafe(); // 切換前先為當前門市存檔
                        }
                        restoreDraft(draft);
                      }}
                      className="flex items-center gap-1.5 cursor-pointer text-left"
                      title={isCurrent ? '目前正在編輯此門市' : `點擊切換還原「${targetStore}」草稿`}
                    >
                      <span>🏪 {targetStore}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                        progress >= 80 ? 'bg-emerald-100 text-emerald-700' :
                        progress >= 40 ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {progress}%
                      </span>
                      <span className="text-[10px] text-gray-400 font-normal">
                        {draft.savedAt || '稍早'}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] text-emerald-600 font-bold">● 編輯中</span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDiscardDraft(targetStore);
                      }}
                      title={`清除「${targetStore}」暫存草稿`}
                      className="text-gray-400 hover:text-red-500 p-0.5 rounded transition-colors cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-semibold text-gray-700">
              巡店門市 <span className="text-red-500">*</span>
            </label>
            {storeName && (
              <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
                📍 已選擇：{storeName}
              </span>
            )}
          </div>

          {/* 門市區域索引與一鍵點選面板 */}
          {(() => {
            const visibleByRegion = Object.entries(storeRegions)
              .map(([region, stores]) => {
                const list = user?.role === 'admin'
                  ? stores
                  : stores.filter(s => user?.assigned_stores?.includes(s));
                return { region, stores: list };
              })
              .filter(g => g.stores.length > 0);

            const filteredStores = visibleByRegion
              .filter(g => selectedStoreRegionFilter === '全部' || g.region === selectedStoreRegionFilter)
              .flatMap(g => g.stores.map(s => ({ store: s, region: g.region })))
              .filter(item => !storeSearchQuery.trim() || item.store.includes(storeSearchQuery.trim()) || item.region.includes(storeSearchQuery.trim()));

            return (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-2.5 space-y-2.5">
                {visibleByRegion.length > 1 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-bold text-gray-500">區域索引：</span>
                    <button
                      type="button"
                      onClick={() => setSelectedStoreRegionFilter('全部')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                        selectedStoreRegionFilter === '全部'
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50'
                      }`}
                    >
                      全部 ({visibleByRegion.reduce((acc, g) => acc + g.stores.length, 0)})
                    </button>
                    {visibleByRegion.map(g => (
                      <button
                        key={g.region}
                        type="button"
                        onClick={() => setSelectedStoreRegionFilter(selectedStoreRegionFilter === g.region ? '全部' : g.region)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                          selectedStoreRegionFilter === g.region
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50'
                        }`}
                      >
                        {g.region} ({g.stores.length})
                      </button>
                    ))}
                  </div>
                )}

                <input
                  type="text"
                  value={storeSearchQuery}
                  onChange={e => setStoreSearchQuery(e.target.value)}
                  placeholder="🔍 輸入門市關鍵字快速篩選（或直接點選下方門市按鈕）..."
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-500"
                />

                {filteredStores.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                    {filteredStores.map(({ store }) => {
                      const active = storeName === store;
                      return (
                        <button
                          key={store}
                          type="button"
                          onClick={() => {
                            setStoreName(store);
                            fetchActionItems(store);
                            fetchLastAuditRecord(store);
                          }}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                            active
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                              : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                          }`}
                        >
                          {active ? `✓ ${store}` : store}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          <select
            value={storeName}
            onChange={(e) => {
              const val = e.target.value;
              setStoreName(val);
              fetchActionItems(val);
              fetchLastAuditRecord(val);
            }}
            className="w-full border rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
          >
            <option value="" disabled>請選擇負責的門市（亦可從上方快速索引點選）</option>
            {Object.entries(storeRegions).map(([region, stores]) => {
              // 如果是總部管理員(admin) 或 權限全開，就顯示全部；否則過濾出指派的門市
              const visibleStores = user?.role === 'admin' 
                ? stores 
                : stores.filter(s => user?.assigned_stores?.includes(s));
                
              if (visibleStores.length === 0) return null;
              
              return (
                <optgroup key={region} label={`【${region}】`}>
                  {visibleStores.map(store => (
                    <option key={store} value={store}>{store}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {user?.role === 'manager' && (!user.assigned_stores || user.assigned_stores.length === 0) && (
            <p className="text-xs text-amber-600 font-medium mt-1.5 flex items-center gap-1">
              ⚠️ 您的帳號目前尚未指派負責門市，請聯繫總部管理員於「系統設定」勾選負責門市。
            </p>
          )}
        </div>

        {/* 門市前次巡檢紀錄與歷史缺失 (PDCA 閉環) */}
        {renderHistoricalDefectCard()}
        
        {/* 前次未結案 */}
        {storeName && (
        <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100">
          <div className="flex items-center justify-between mb-3">
            <p className="text-base font-bold text-gray-800 flex items-center gap-2">
              <AlertCircle size={18} className="text-orange-500" /> 前次未結案缺失 (PDCA)
            </p>
            {actionItemsLoading && <span className="text-xs text-gray-400">載入中...</span>}
          </div>
          
          <div className="space-y-3">
            {pastActionItems.length === 0 && !actionItemsLoading ? (
              <div className="text-sm text-gray-500 bg-white p-4 rounded-lg text-center border border-dashed">
                無未結案之改善事項 🎉
              </div>
            ) : (
              pastActionItems.map(item => (
                <div key={item.id} className="border p-4 rounded-xl bg-white shadow-sm">
                  <div className="text-sm font-semibold text-gray-800 mb-2">{item.issueDescription || item.desc}</div>
                  <div className="text-xs text-gray-500 mb-3 flex gap-4">
                    <span>負責人: {item.assignee}</span>
                    <span className="text-red-500 font-medium">期限: {new Date(item.dueDate).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setPdcaResults({ ...pdcaResults, [item.id]: '已改善' })} className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-colors ${pdcaResults[item.id] === '已改善' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-green-50'}`}>✅ 現場已改善</button>
                    <button onClick={() => setPdcaResults({ ...pdcaResults, [item.id]: '未改善' })} className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-colors ${pdcaResults[item.id] === '未改善' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-red-50'}`}>❌ 依然未改善</button>
                  </div>
                  {pdcaResults[item.id] && renderDefectPhotoPair(`pdca-${item.id}`)}
                </div>
              ))
            )}
          </div>
        </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">巡店模式 <span className="text-red-500">*</span></label>
          <div className="grid grid-cols-1 gap-3">
            <label className={`border-2 p-4 rounded-xl flex items-center gap-3 cursor-pointer transition-all ${auditMode === 'A' ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-white border-gray-200 hover:border-blue-200'}`}>
              <input type="radio" name="mode" checked={auditMode === 'A'} onChange={() => setAuditMode('A')} className="w-5 h-5 text-blue-600" />
              <div>
                <div className="font-bold text-gray-800 text-base">【模式 A】快閃巡店</div>
                <div className="text-sm text-gray-500 mt-1">僅看必看底線 + 歷程追蹤，跳過第三層。</div>
              </div>
            </label>
            <label className={`border-2 p-4 rounded-xl flex items-center gap-3 cursor-pointer transition-all ${auditMode === 'B' ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-white border-gray-200 hover:border-blue-200'}`}>
              <input type="radio" name="mode" checked={auditMode === 'B'} onChange={() => setAuditMode('B')} className="w-5 h-5 text-blue-600" />
              <div>
                <div className="font-bold text-gray-800 text-base">【模式 B】主題巡店</div>
                <div className="text-sm text-gray-500 mt-1">針對特定的大項進行深度抽查。</div>
              </div>
            </label>
            <label className={`border-2 p-4 rounded-xl flex items-center gap-3 cursor-pointer transition-all ${auditMode === 'C' ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-white border-gray-200 hover:border-blue-200'}`}>
              <input type="radio" name="mode" checked={auditMode === 'C'} onChange={() => setAuditMode('C')} className="w-5 h-5 text-blue-600" />
              <div>
                <div className="font-bold text-gray-800 text-base">【模式 C】全店完整輔導</div>
                <div className="text-sm text-gray-500 mt-1">完整檢視六大模組，適合月度常規輔導。</div>
              </div>
            </label>
          </div>
        </div>

        {auditMode === 'B' && (
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
            <label className="block text-sm font-semibold text-blue-800 mb-2">請選擇本次查核主題 (可複選)</label>
            <div className="grid grid-cols-2 gap-2">
              {['行銷檔期', '陳列損耗', '寵物專業', '人員服務', '環境設備', '經營數據'].map((topic, idx) => (
                <label key={idx} className="flex items-center gap-2 text-sm text-gray-700 bg-white p-2 rounded-lg border">
                  <input 
                    type="checkbox" 
                    checked={selectedTopics.includes(idx + 1)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedTopics([...selectedTopics, idx + 1]);
                      else setSelectedTopics(selectedTopics.filter(t => t !== idx + 1));
                    }}
                    className="w-4 h-4 rounded text-blue-600"
                  />
                  {topic}
                </label>
              ))}
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </section>
  );

  const renderStep2 = () => (
    <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-in fade-in slide-in-from-right-8 duration-500">
      <div className="flex items-center justify-between mb-2 border-b pb-3 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <span className="bg-blue-100 text-blue-700 w-7 h-7 rounded-full flex items-center justify-center text-sm">2</span>
          必看核心底線
        </h2>
        <button
          type="button"
          onClick={() => {
            setCoreChecks(prev => ({
              'core-1': prev['core-1'] || '正常',
              'core-2': prev['core-2'] || '正常',
              'core-3': prev['core-3'] || '正常',
            }));
          }}
          className="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
        >
          ⚡ 未填項一鍵設為正常
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-6">不論停留時間長短，進店必須立刻檢核的重點。</p>
      
      {/* 前次巡檢缺失即時提醒 (PDCA 閉環) */}
      {lastAuditData?.hasHistory && lastAuditData.defects && lastAuditData.defects.length > 0 && (
        <div className="mb-5 bg-amber-50/80 border border-amber-300 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-amber-900 shadow-xs">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 leading-relaxed">
            <span className="font-bold">⚠️ 前次巡檢缺失重點提醒（{storeName}）：</span>
            <span>
              前次巡檢共發現 <strong>{lastAuditData.defects.length}</strong> 項缺失。請在本次進店核心底線及後續模組查核時，嚴格檢視門市是否已徹底改善與落實。
            </span>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {[
          { id: 'core-1', label: '環境異味與清潔', desc: '門口/賣場無明顯排泄物或寵物異味，地板乾淨。' },
          { id: 'core-2', label: '櫃檯焦點陳列', desc: '結帳櫃檯加價購/當期主推商品有放置於黃金焦點區。' },
          { id: 'core-3', label: '人員狀態與迎賓', desc: '門市同仁穿著制服、精神狀態良好，進店有主動招呼。' }
        ].map((item) => (
          <div key={item.id} className="border p-4 rounded-xl bg-gray-50">
            <div className="font-semibold text-gray-800 mb-1">{item.label}</div>
            <div className="text-xs text-gray-500 mb-3">{item.desc}</div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setCoreChecks({ ...coreChecks, [item.id]: '正常' })} className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-colors ${coreChecks[item.id] === '正常' ? 'bg-green-600 text-white border-green-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-green-50'}`}>✅ 正常</button>
              <button onClick={() => setCoreChecks({ ...coreChecks, [item.id]: '缺失' })} className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-colors ${coreChecks[item.id] === '缺失' ? 'bg-red-600 text-white border-red-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-red-50'}`}>❌ 缺失</button>
            </div>
            {coreChecks[item.id] === '缺失' && (
              <div className="mt-3 animate-in slide-in-from-top-1 fade-in duration-200">
                <input 
                  type="text" 
                  placeholder="請輸入缺失詳細說明 (必填)"
                  required
                  value={categoryRemarks[item.id] || ''}
                  onChange={(e) => setCategoryRemarks({ ...categoryRemarks, [item.id]: e.target.value })}
                  className="w-full border-red-300 bg-red-50 focus:ring-red-500 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 border transition-colors"
                />
                {renderDefectPhotoPair(item.id)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );

  const renderCategory = (index: number, title: string, items: string[]) => {
    if (auditMode === 'B' && !selectedTopics.includes(index)) return null; 
    
    return (
      <div id={`audit-category-${index}`} className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-gray-100 scroll-mt-32">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-sm">大項 {index}</span>
            {title}
          </h3>
          <button
            type="button"
            onClick={() => {
              const next = { ...categoryChecks };
              items.forEach((_, i) => {
                const k = `${index}-${i + 1}`;
                if (!next[k]) next[k] = '合格';
              });
              setCategoryChecks(next);
            }}
            className="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
          >
            ⚡ 本大項未填設為合格
          </button>
        </div>
        {items.map((item, i) => {
          const key = `${index}-${i+1}`;
          return (
            <div key={key} className="mb-4 border-b pb-4 last:border-b-0">
              <p className="text-sm text-gray-700 font-medium mb-3 leading-relaxed">{index}-{i+1}. {item}</p>
              <div className="grid grid-cols-4 gap-2">
                {['N/A', '合格', '待改善', '缺失'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => setCategoryChecks({ ...categoryChecks, [key]: opt })}
                    className={`py-2 rounded-lg text-sm font-semibold border transition-all ${
                      categoryChecks[key] === opt 
                        ? (opt === '缺失' || opt === '待改善' ? 'bg-red-600 text-white border-red-600' : opt === '合格' ? 'bg-green-600 text-white border-green-600' : 'bg-gray-600 text-white border-gray-600')
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {(categoryChecks[key] === '缺失' || categoryChecks[key] === '待改善') && (
                <div className="mt-3 animate-in slide-in-from-top-1 fade-in duration-200">
                  <textarea
                    placeholder="請輸入缺失/待改善詳細說明 (必填)"
                    required
                    rows={2}
                    value={categoryRemarks[key] || ''}
                    onChange={(e) => setCategoryRemarks({ ...categoryRemarks, [key]: e.target.value })}
                    className="w-full border-red-300 bg-red-50 focus:ring-red-500 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 border transition-colors resize-none"
                  />
                  {renderDefectPhotoPair(key)}
                </div>
              )}
            </div>
          );
        })}
        {(customItems[index] || []).map((item, i) => {
          const key = item;
          return (
            <div key={key} className="mb-4 border-b pb-4 last:border-b-0">
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm text-gray-700 font-medium leading-relaxed">⭐ 自訂: {item}</p>
                <button 
                  onClick={() => {
                    setCustomItems(prev => ({ ...prev, [index]: prev[index].filter((_, idx) => idx !== i) }));
                    const newChecks = { ...categoryChecks };
                    delete newChecks[key];
                    setCategoryChecks(newChecks);
                  }}
                  className="text-gray-400 hover:text-red-500"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {['N/A', '合格', '待改善', '缺失'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => setCategoryChecks({ ...categoryChecks, [key]: opt })}
                    className={`py-2 rounded-lg text-sm font-semibold border transition-all ${
                      categoryChecks[key] === opt 
                        ? (opt === '缺失' || opt === '待改善' ? 'bg-red-600 text-white border-red-600' : opt === '合格' ? 'bg-green-600 text-white border-green-600' : 'bg-gray-600 text-white border-gray-600')
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {(categoryChecks[key] === '缺失' || categoryChecks[key] === '待改善') && (
                <div className="mt-3 animate-in slide-in-from-top-1 fade-in duration-200">
                  <textarea
                    placeholder="請輸入缺失/待改善詳細說明 (必填)"
                    required
                    rows={2}
                    value={categoryRemarks[key] || ''}
                    onChange={(e) => setCategoryRemarks({ ...categoryRemarks, [key]: e.target.value })}
                    className="w-full border-red-300 bg-red-50 focus:ring-red-500 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 border transition-colors resize-none"
                  />
                  {renderDefectPhotoPair(key)}
                </div>
              )}
            </div>
          );
        })}
        <div className="mt-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
          <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">➕ 自訂新增項目 <Mic size={12}/></p>
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="輸入自訂缺失或狀況..." 
              value={customInputValues[index] || ''}
              onChange={(e) => setCustomInputValues(prev => ({ ...prev, [index]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCustomItem(index);
              }}
              className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
            />
            <button onClick={() => handleAddCustomItem(index)} className="bg-white border p-2 rounded-lg text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors"><Mic size={18} /></button>
          </div>
        </div>
      </div>
    );
  };

  const renderStep3 = () => {
    const moduleMeta = [
      { idx: 1, short: '1.行銷檔期', count: 4 },
      { idx: 2, short: '2.陳列損耗', count: 5 },
      { idx: 3, short: '3.寵物專業', count: 4 },
      { idx: 4, short: '4.人員服務', count: 3 },
      { idx: 5, short: '5.環境設備', count: 4 },
      { idx: 6, short: '6.經營數據', count: 3 },
    ].filter(m => auditMode !== 'B' || selectedTopics.includes(m.idx));

    return (
      <section className="animate-in fade-in slide-in-from-right-8 duration-500">
        <div className="flex items-center gap-2 mb-3">
          <span className="bg-blue-100 text-blue-700 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold">3</span>
          <h2 className="text-xl font-bold text-gray-800">六大模組檢核</h2>
        </div>

        {/* 六大模組浮動快速索引列 */}
        <div className="sticky top-[56px] z-30 bg-white/95 backdrop-blur-md border border-blue-100 rounded-xl p-2.5 mb-5 shadow-sm">
          <div className="text-[11px] font-bold text-gray-500 mb-1.5 flex items-center justify-between">
            <span>🧭 六大模組快速索引（點擊直接跳至該大項）：</span>
            <button
              type="button"
              onClick={() => {
                const next = { ...categoryChecks };
                moduleMeta.forEach(m => {
                  for (let i = 1; i <= m.count; i++) {
                    const k = `${m.idx}-${i}`;
                    if (!next[k]) next[k] = '合格';
                  }
                });
                setCategoryChecks(next);
              }}
              className="text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-md font-bold cursor-pointer"
            >
              ⚡ 全部未填設為合格
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {moduleMeta.map(m => {
              let answered = 0;
              let hasDefect = false;
              for (let i = 1; i <= m.count; i++) {
                const val = categoryChecks[`${m.idx}-${i}`];
                if (val) answered++;
                if (val === '缺失' || val === '待改善') hasDefect = true;
              }
              const done = answered === m.count;
              return (
                <button
                  key={m.idx}
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`audit-category-${m.idx}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center justify-between gap-1 ${
                    hasDefect
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : done
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-blue-50 hover:text-blue-700'
                  }`}
                >
                  <span className="truncate">{m.short}</span>
                  <span className="text-[10px] font-extrabold shrink-0">
                    {answered}/{m.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        
        {renderCategory(1, '行銷與檔期執行', [
          '檔期 POP 與宣傳物：海報、端架 POP、價格標卡齊全無破損。',
          '主題陳列與佈置 (VMD)：端架與焦點區依總部指引陳列，商品量感充足。',
          '檔期主打商品備貨：DM 熱銷品、特價組合包無預期缺貨。',
          '結帳區加價購專區：櫃檯加價購商品放置於視覺焦點且標價清楚。'
        ])}
        {renderCategory(2, '商品陳列與損耗管理', [
          '排面平整與拉面：商品拉面齊平、正面朝前，無缺貨空洞。',
          '效期與先進先出 (FIFO)：飼料/罐頭/零食落實舊效期在前，無過期品。',
          '臨期品與損耗處置：臨期品有獨立列管/折扣；破包凹罐及時報廢。',
          '高單價與高損品防竊：高價保健品、家電有貼防盜標籤或上鎖。',
          'PB 與高毛利商品陳列：自有品牌 (PB) 擺放於視線黃金位 (120-160cm)。'
        ])}
        {renderCategory(3, '寵物專業服務與照護', [
          '美容房環境與衛生：美容房清潔無異味，消毒紀錄表、設備運作正常。',
          '美容操作 SOP 與安全：有綁安全防護繩；接送寵物有進行體表檢查紀錄。',
          '活體照護與環境（若有）：籠舍清潔無異味，水糧充足，健康觀察卡按時填記。',
          '保健/醫療專區維護：保健品專區整潔，展示品齊全無積塵。'
        ])}
        {renderCategory(4, '人員服務與顧客體驗', [
          '儀容儀態與招呼：統一穿著制服配戴名牌，顧客進門有主動親切招呼。',
          '專業導購與衛教：能主動詢問寵物狀況，提供正確飼養/保健衛教與建議。',
          '櫃檯結帳與附加銷售 (Add-on)：結帳順暢，主動推廣加價購、PB 商品或會員綁定。'
        ])}
        {renderCategory(5, '門市環境與設備安全', [
          '門面與整體環境清潔：招牌/門口玻璃清潔，賣場無毛髮堆積或異味。',
          '賣場氣氛與燈光空調：燈光全亮，空調溫度適宜（寵物與顧客體感舒適）。',
          '後勤倉庫與公安動線：倉庫擺放整齊，通道暢通無堆積雜物，無傾倒風險。',
          '系統與設備安全運作：POS、監視器、滅火器（效期內）、電器線路運作正常。'
        ])}
        {renderCategory(6, '經營數據與團隊管理', [
          '業績與 KPI 指標跟進：店長清楚當月業績進度、PB 銷售佔比、加價購達成率。',
          '人員 1-on-1 面談紀錄：今日有進行人員面談/輔導',
          '團隊士氣與排班合理性：人員出勤正常，班表符合規範，團隊氛圍良好。'
        ])}
      </section>
    );
  };

  const renderStep4 = () => {
    const activePhotoPairs = Array.isArray(photoPairs) && photoPairs.length > 0
      ? photoPairs
      : [{ beforeUrl: '', afterUrl: '' }];

    return (
      <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-in fade-in slide-in-from-right-8 duration-500">
        <h2 className="text-xl font-bold text-gray-800 mb-6 border-b pb-3 flex items-center gap-2">
          <span className="bg-blue-100 text-blue-700 w-7 h-7 rounded-full flex items-center justify-center text-sm">4</span>
          管理閉環與新交辦
        </h2>
        
        <div className="space-y-8">
          {/* 本次新增交辦 */}
          <div>
            <p className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-blue-500" /> 本次新增交辦事項 (Action Items)
            </p>
            <div className="space-y-3">
              {newActionItems.map((item, idx) => (
                <div key={idx} className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col gap-3 relative">
                  {newActionItems.length > 1 && (
                    <button onClick={() => setNewActionItems(newActionItems.filter((_, i) => i !== idx))} className="absolute top-3 right-3 text-gray-400 hover:text-red-500">
                      <Trash2 size={16} />
                    </button>
                  )}
                  <input 
                    type="text" placeholder="輸入缺失事項或改善建議..." 
                    value={item.desc}
                    onChange={(e) => {
                      const newArr = [...newActionItems];
                      newArr[idx].desc = e.target.value;
                      setNewActionItems(newArr);
                    }}
                    className="w-full border rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                  />
                  <div className="flex gap-3">
                    <input 
                      type="text" placeholder="負責人" 
                      value={item.assignee}
                      onChange={(e) => {
                        const newArr = [...newActionItems];
                        newArr[idx].assignee = e.target.value;
                        setNewActionItems(newArr);
                      }}
                      className="w-1/2 border rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                    />
                    <input 
                      type="date" 
                      value={item.dueDate}
                      onChange={(e) => {
                        const newArr = [...newActionItems];
                        newArr[idx].dueDate = e.target.value;
                        setNewActionItems(newArr);
                      }}
                      className="w-1/2 border rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-gray-600" 
                    />
                  </div>
                </div>
              ))}
              <button 
                onClick={() => setNewActionItems([...newActionItems, { desc: '', assignee: '', dueDate: '' }])}
                className="text-blue-600 text-sm font-bold mt-2 w-full py-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                + 新增一筆交辦
              </button>
            </div>
          </div>

          <div className="h-px bg-gray-100" />

          {/* 照片上傳 (Before & After) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-base font-bold text-gray-800 flex items-center gap-2">
                <Camera size={18} className="text-purple-500" /> 現場拍照存證 (Before & After)
              </p>
              <span className="text-xs font-medium text-purple-600">點擊照片可放大檢視</span>
            </div>
            <div className="space-y-4">
              {activePhotoPairs.map((pair, idx) => (
                <div key={idx} className="bg-white p-4 rounded-xl border border-gray-200 relative shadow-sm">
                  {activePhotoPairs.length > 1 && (
                    <button onClick={() => setPhotoPairs(activePhotoPairs.filter((_, i) => i !== idx))} className="absolute top-2 right-2 text-gray-400 hover:text-red-500 z-10 bg-white rounded-full p-1 shadow-sm" title="刪除此組對比">
                      <Trash2 size={16} />
                    </button>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Before */}
                    <div className="relative">
                      <p className="text-xs font-bold text-rose-700 mb-2 text-center">改善前 (Before)</p>
                      {pair.beforeUrl ? (
                        <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-rose-200 bg-gray-50">
                          <img
                            src={pair.beforeUrl}
                            alt="Before"
                            className="w-full h-full object-cover cursor-zoom-in"
                            onClick={() => setPreviewPhotoUrl(pair.beforeUrl)}
                          />
                          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                            <label className="bg-white/95 text-gray-700 hover:text-blue-600 rounded-md px-2.5 py-1 text-xs font-bold shadow-xs cursor-pointer border border-gray-200">
                              重拍
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                                onChange={async (e) => {
                                  if (e.target.files && e.target.files[0]) {
                                    try {
                                      const base64Url = await compressImageToBase64(e.target.files[0]);
                                      const newPairs = [...activePhotoPairs];
                                      newPairs[idx] = { ...newPairs[idx], beforeUrl: base64Url };
                                      setPhotoPairs(newPairs);
                                    } catch (err) {
                                      console.error('照片讀取失敗', err);
                                      alert('照片讀取失敗，請重新拍攝');
                                    }
                                  }
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                const newPairs = [...activePhotoPairs];
                                newPairs[idx] = { ...newPairs[idx], beforeUrl: '' };
                                setPhotoPairs(newPairs);
                              }}
                              className="bg-white/95 text-gray-500 hover:text-red-600 rounded-md p-1.5 shadow-xs border border-gray-200"
                              title="移除照片"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="w-full aspect-square border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-50 hover:border-blue-400 transition-colors overflow-hidden bg-gray-50">
                          <Camera size={24} className="mb-1 text-rose-500" />
                          <span className="text-xs font-medium text-gray-600">拍照 / 上傳</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                            onChange={async (e) => {
                              if (e.target.files && e.target.files[0]) {
                                try {
                                  const base64Url = await compressImageToBase64(e.target.files[0]);
                                  const newPairs = [...activePhotoPairs];
                                  newPairs[idx] = { ...newPairs[idx], beforeUrl: base64Url };
                                  setPhotoPairs(newPairs);
                                } catch (err) {
                                  console.error('照片讀取失敗', err);
                                  alert('照片讀取失敗，請重新拍攝');
                                }
                              }
                            }} 
                          />
                        </label>
                      )}
                    </div>
                    {/* After */}
                    <div className="relative">
                      <p className="text-xs font-bold text-emerald-700 mb-2 text-center">改善後 (After)</p>
                      {pair.afterUrl ? (
                        <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-emerald-200 bg-gray-50">
                          <img
                            src={pair.afterUrl}
                            alt="After"
                            className="w-full h-full object-cover cursor-zoom-in"
                            onClick={() => setPreviewPhotoUrl(pair.afterUrl)}
                          />
                          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                            <label className="bg-white/95 text-gray-700 hover:text-blue-600 rounded-md px-2.5 py-1 text-xs font-bold shadow-xs cursor-pointer border border-gray-200">
                              重拍
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                                onChange={async (e) => {
                                  if (e.target.files && e.target.files[0]) {
                                    try {
                                      const base64Url = await compressImageToBase64(e.target.files[0]);
                                      const newPairs = [...activePhotoPairs];
                                      newPairs[idx] = { ...newPairs[idx], afterUrl: base64Url };
                                      setPhotoPairs(newPairs);
                                    } catch (err) {
                                      console.error('照片讀取失敗', err);
                                      alert('照片讀取失敗，請重新拍攝');
                                    }
                                  }
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                const newPairs = [...activePhotoPairs];
                                newPairs[idx] = { ...newPairs[idx], afterUrl: '' };
                                setPhotoPairs(newPairs);
                              }}
                              className="bg-white/95 text-gray-500 hover:text-red-600 rounded-md p-1.5 shadow-xs border border-gray-200"
                              title="移除照片"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="w-full aspect-square border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-50 hover:border-blue-400 transition-colors overflow-hidden bg-gray-50">
                          <Camera size={24} className="mb-1 text-emerald-500" />
                          <span className="text-xs font-medium text-gray-600">拍照 / 上傳</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                            onChange={async (e) => {
                              if (e.target.files && e.target.files[0]) {
                                try {
                                  const base64Url = await compressImageToBase64(e.target.files[0]);
                                  const newPairs = [...activePhotoPairs];
                                  newPairs[idx] = { ...newPairs[idx], afterUrl: base64Url };
                                  setPhotoPairs(newPairs);
                                } catch (err) {
                                  console.error('照片讀取失敗', err);
                                  alert('照片讀取失敗，請重新拍攝');
                                }
                              }
                            }} 
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <button 
                onClick={() => setPhotoPairs([...activePhotoPairs, { beforeUrl: '', afterUrl: '' }])}
                className="text-purple-600 text-sm font-bold mt-2 w-full py-3 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors border border-purple-100"
              >
                + 新增一組對比照片
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderStep5 = () => {
    const totalDefectsCount =
      Object.values(coreChecks).filter(v => v === '缺失').length +
      Object.values(categoryChecks).filter(v => v === '缺失' || v === '待改善').length;
    const totalPhotosCount =
      Object.values(defectPhotos).filter(p => p && (p.beforeUrl || p.afterUrl)).length +
      photoPairs.filter(p => p && (p.beforeUrl || p.afterUrl)).length;
    const validActionsCount = newActionItems.filter(i => i.desc?.trim()).length;

    return (
      <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-in fade-in slide-in-from-right-8 duration-500">
        <h2 className="text-xl font-bold text-gray-800 mb-6 border-b pb-3 flex items-center gap-2">
          <span className="bg-blue-100 text-blue-700 w-7 h-7 rounded-full flex items-center justify-center text-sm">5</span>
          總結與簽名
        </h2>
        
        <div className="space-y-6">
          {/* 本次巡店紀錄摘要卡片 */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-white p-2.5 rounded-lg border border-slate-100">
              <div className="text-[11px] text-gray-500 font-semibold">巡店門市</div>
              <div className="text-sm font-bold text-gray-900 mt-0.5 truncate">{storeName || '未選擇'}</div>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-100">
              <div className="text-[11px] text-gray-500 font-semibold">發現異常/待改善</div>
              <div className={`text-sm font-bold mt-0.5 ${totalDefectsCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {totalDefectsCount} 項
              </div>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-100">
              <div className="text-[11px] text-gray-500 font-semibold">改善前後照片</div>
              <div className="text-sm font-bold text-purple-600 mt-0.5">{totalPhotosCount} 組</div>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-100">
              <div className="text-[11px] text-gray-500 font-semibold">新增交辦事項</div>
              <div className="text-sm font-bold text-blue-600 mt-0.5">{validActionsCount} 筆</div>
            </div>
          </div>

          {/* 確認／調整問卷回填時間（可往前補登最多 5 天） */}
          {renderBackfillTimeSelector()}

          {/* 綜合評價 */}
          <div>
            <p className="text-sm font-bold text-gray-700 mb-3">巡店綜合評價 <span className="text-red-500">*</span></p>
            <div className="flex gap-3">
              <button onClick={() => setOverallRating('良好')} className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${overallRating === '良好' ? 'bg-green-600 text-white border-green-600 shadow-md transform scale-[1.02]' : 'bg-white text-gray-600 border-gray-200 hover:border-green-200'}`}>🟢 良好</button>
              <button onClick={() => setOverallRating('需追蹤')} className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${overallRating === '需追蹤' ? 'bg-yellow-500 text-white border-yellow-500 shadow-md transform scale-[1.02]' : 'bg-white text-gray-600 border-gray-200 hover:border-yellow-200'}`}>🟡 需追蹤</button>
              <button onClick={() => setOverallRating('需重點輔導')} className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${overallRating === '需重點輔導' ? 'bg-red-600 text-white border-red-600 shadow-md transform scale-[1.02]' : 'bg-white text-gray-600 border-gray-200 hover:border-red-200'}`}>🔴 需重點輔導</button>
            </div>
          </div>

          {/* 區主管簽名 */}
          <div>
            <div className="flex justify-between items-end mb-3">
              <p className="text-sm font-bold text-gray-700">門市端 / 區主管簽名</p>
              <button 
                onClick={() => sigCanvas.current?.clear()} 
                className="text-xs text-blue-600 font-semibold bg-blue-50 px-3 py-1 rounded-full hover:bg-blue-100"
              >
                清除重簽
              </button>
            </div>
            <div className="border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 h-48 relative overflow-hidden">
              <SignatureCanvas 
                ref={sigCanvas}
                canvasProps={{className: 'w-full h-full cursor-crosshair'}} 
              />
            </div>
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(30px)',
        borderBottom: '1px solid #e5e7eb',
        padding: '14px 20px',
        position: 'sticky', top: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', gap: '12px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)'
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
          background: 'linear-gradient(90deg, #3b82f6, #6366f1, #14b8a6)',
        }} />
        <button
          onClick={() => navigate(user?.role === 'admin' ? '/dashboard' : '/')}
          className="w-9 h-9 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-700"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-900 leading-tight">
            現場巡店作業
          </h1>
          <div className="text-xs text-gray-500 tracking-wider">
            {mgrName} · {new Date().toLocaleDateString('zh-TW')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 網路連線狀態小圖示指示 */}
          {!isOnline ? (
            <span
              title="目前為離線／弱網模式，資料已妥善暫存於本機"
              className="text-[11px] bg-amber-100 text-amber-800 px-2 py-1 rounded-lg font-bold border border-amber-300 flex items-center gap-1 shadow-xs"
            >
              <WifiOff size={13} className="text-amber-600 animate-pulse" /> 離線安全模式
            </span>
          ) : (
            <span
              title="網路連線正常"
              className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg font-bold border border-emerald-200 flex items-center gap-1"
            >
              <Wifi size={13} className="text-emerald-600" /> 連線中
            </span>
          )}

          {/* 草稿狀態與手動儲存 */}
          <button
            onClick={handleManualSave}
            title="手動儲存草稿"
            className="text-xs bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg font-bold border border-emerald-200 hover:bg-emerald-100 transition-colors flex items-center gap-1 shadow-xs"
          >
            {saveToast ? (
              <span className="text-emerald-700 flex items-center gap-1">
                <CheckCircle2 size={13} className="text-emerald-600" /> 已存
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Save size={13} /> {draftSavedAt ? draftSavedAt : '暫存草稿'}
              </span>
            )}
          </button>

          {user?.role === 'manager' && (
            <button
              id="audit-change-password"
              onClick={() => setIsChangePasswordOpen(true)}
              className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-bold border border-gray-200 hover:bg-gray-200 transition-colors flex items-center gap-1"
            >
              改密碼 <KeyRound size={12} />
            </button>
          )}
          <button
            onClick={() => {
              if (window.confirm('確定要登出嗎？未送出的草稿將不會遺失。')) {
                logout();
                navigate('/login');
              }
            }}
            className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-bold border border-gray-200 hover:bg-gray-200 transition-colors flex items-center gap-1"
          >
            登出 <LogOut size={12} />
          </button>
        </div>
      </div>
      <ChangePasswordModal open={isChangePasswordOpen} onClose={() => setIsChangePasswordOpen(false)} />

      {/* 離線弱網與上線恢復通知橫幅 */}
      {!isOnline && (
        <div className="bg-amber-600 text-white px-4 py-2.5 text-xs font-bold flex items-center justify-between sticky top-[65px] z-40 shadow-sm animate-in slide-in-from-top duration-200">
          <div className="flex items-center gap-2 max-w-4xl mx-auto w-full">
            <WifiOff size={16} className="shrink-0 animate-pulse text-amber-200" />
            <span>【離線／弱網防護啟動】目前處於無網路或弱網環境，所有填寫進度與評估項目均已即時安全備份於本機，連線恢復時可隨時送出。</span>
          </div>
        </div>
      )}
      {onlineNotice && (
        <div className="bg-emerald-600 text-white px-4 py-2 text-xs font-bold flex items-center justify-between sticky top-[65px] z-40 shadow-sm animate-in slide-in-from-top duration-200">
          <div className="flex items-center gap-2 max-w-4xl mx-auto w-full">
            <Wifi size={16} className="shrink-0 text-emerald-200" />
            <span>【網路已恢復連線】連線訊號良好，您可以正常進行拍照並提交巡店紀錄！</span>
          </div>
        </div>
      )}

      <div className="md:max-w-4xl max-w-2xl mx-auto px-4 pt-6">
        {/* 草稿自動還原提示橫幅 */}
        {hasRestoredBanner && (
          <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-300">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">📋</span>
              <div>
                <p className="text-sm font-bold text-gray-900">已自動載入您上次暫存的巡店紀錄</p>
                <p className="text-xs text-blue-700">門市：{storeName || '未指定'} · 暫存時間：{draftSavedAt || '稍早'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setHasRestoredBanner(false)}
                className="text-xs bg-blue-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors shadow-xs"
              >
                繼續填寫
              </button>
              <button
                onClick={() => {
                  if (window.confirm('確定要捨棄目前暫存草稿並從頭開始嗎？')) {
                    localStorage.removeItem(LOCAL_STORAGE_KEY);
                    window.location.reload();
                  }
                }}
                className="text-xs text-gray-500 hover:text-red-600 px-2 py-1.5 rounded-lg transition-colors font-medium"
              >
                捨棄重填
              </button>
            </div>
          </div>
        )}

        {/* 降級儲存提示 */}
        {draftWarning && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2 text-xs text-amber-800">
            <AlertCircle size={15} className="text-amber-600 shrink-0" />
            <span>{draftWarning}</span>
          </div>
        )}

        {/* Stepper Progress & 可點擊步驟索引列 */}
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-3 shadow-xs sticky top-14 z-30">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
              步驟 {currentStep} / {totalSteps}
            </span>
            <span className="text-xs font-semibold text-gray-600">
              {currentStep === 1 && '1. 基本資訊與門市選擇'}
              {currentStep === 2 && '2. 必看核心底線'}
              {currentStep === 3 && '3. 六大模組細項'}
              {currentStep === 4 && '4. PDCA 追蹤交辦'}
              {currentStep === 5 && '5. 總結評價與簽名'}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5 mb-2">
            {[
              { step: 1, label: '1.基本' },
              { step: 2, label: '2.核心' },
              { step: 3, label: '3.模組' },
              { step: 4, label: '4.追蹤' },
              { step: 5, label: '5.總結' },
            ].map(item => {
              const isSkipped = item.step === 3 && auditMode === 'A';
              const isActive = currentStep === item.step;
              const isCompleted = currentStep > item.step && !isSkipped;
              return (
                <button
                  key={item.step}
                  type="button"
                  disabled={isSkipped || (taskType !== '實地巡店' && item.step > 1)}
                  onClick={() => {
                    if (item.step > 1 && !storeName) {
                      alert('請先於步驟 1 選擇門市名稱');
                      return;
                    }
                    if (item.step > 2 && Object.keys(coreChecks).length < 3) {
                      alert('請先完成步驟 2 必看核心底線（共 3 項）');
                      setCurrentStep(2);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                      return;
                    }
                    setCurrentStep(item.step);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className={`py-1.5 px-1 rounded-lg text-[11px] sm:text-xs font-bold border transition-all cursor-pointer truncate ${
                    isSkipped || (taskType !== '實地巡店' && item.step > 1)
                      ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                      : isActive
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                      : isCompleted
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {isCompleted ? `✓ ${item.label}` : item.label}
                </button>
              );
            })}
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-blue-600 h-1.5 rounded-full transition-all duration-500 ease-out" 
              style={{ width: `${(currentStep / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        {/* Steps Content */}
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
        {currentStep === 5 && renderStep5()}

        {/* Navigation Buttons */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
          <div className="md:max-w-4xl max-w-2xl mx-auto flex gap-3">
            {currentStep > 1 && (
              <button
                onClick={handlePrev}
                className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
              >
                <ArrowLeft size={16} /> 上一步
              </button>
            )}
            
            {currentStep === 1 && taskType !== '實地巡店' ? (
              <button
                onClick={submitScheduleForm}
                disabled={submitting}
                className="flex-[2] py-3 px-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:from-indigo-700 hover:to-blue-700 transition-colors shadow-md shadow-indigo-500/30"
              >
                <Save size={16} /> {submitting ? '正在送出行程...' : `送出當日「${taskType}」`}
              </button>
            ) : currentStep < totalSteps ? (
              <button
                onClick={handleNext}
                className="flex-[2] py-3 px-4 bg-blue-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors shadow-md shadow-blue-500/30"
              >
                下一步 <ArrowRight size={16} />
              </button>
            ) : (
              <button
                onClick={submitForm}
                disabled={submitting}
                className={`flex-[2] py-3 px-4 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg ${
                  submitting
                    ? 'bg-gray-400 cursor-not-allowed shadow-none'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/40'
                }`}
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>{submitStatusText || '資料儲存中...'}</span>
                  </>
                ) : (
                  <>
                    <Save size={16} /> 送出巡店紀錄
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>

      {/* 照片全螢幕預覽燈箱 */}
      {previewPhotoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewPhotoUrl(null)}
        >
          <button
            type="button"
            onClick={() => setPreviewPhotoUrl(null)}
            className="absolute top-5 right-5 bg-white text-gray-800 rounded-full px-3.5 py-1.5 text-xs font-bold shadow-lg hover:bg-gray-100"
          >
            ✕ 關閉預覽
          </button>
          <img
            src={previewPhotoUrl}
            alt="照片預覽"
            className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
