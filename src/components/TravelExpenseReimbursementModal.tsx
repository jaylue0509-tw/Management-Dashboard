import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Printer,
  FileText,
  Plus,
  Trash2,
  RotateCcw,
  Car,
  Bike,
  CheckCircle2,
  Camera,
  FileSpreadsheet,
  Smartphone,
  LayoutGrid,
  Cloud,
  Loader2,
} from 'lucide-react';
import {
  fetchPettyCashDraftFromServer,
  resetPettyCashDraftOnServer,
  savePettyCashDraftToServer,
} from '../utils/petty-cash-sync';
import {
  DEFAULT_SUBSIDY_PER_KM,
  MOTORCYCLE_SUBSIDY_PER_KM,
  type DailyRouteRecord,
  type ManagerExpenseItem,
} from '../utils/mileage-calculator';
import {
  buildPrintableGoogleMapCardHtml,
  fetchRealRoadRoute,
  formatStopForGoogleMaps,
} from '../utils/road-routing';
import {
  ExpenseRouteAttachmentCard,
  type RouteEvidenceData,
  type VerificationStatus,
} from './ExpenseRouteAttachmentCard';

export type VehicleType = 'car' | 'motorcycle';
export type ExpenseCategoryItem = '油資' | '高鐵票' | '停車費' | '租車' | '過路費' | '計程車' | '其他';

const EXPENSE_ITEM_OPTIONS: ExpenseCategoryItem[] = [
  '油資',
  '高鐵票',
  '停車費',
  '租車',
  '過路費',
  '計程車',
  '其他',
];

interface PettyCashRow {
  id: string;
  dateStr: string; // YYYY-MM-DD
  shortDate: string; // MM/DD (如 10/02)
  itemCategory: ExpenseCategoryItem; // 項目（油資、高鐵票、停車費、租車...）
  routeTitle: string; // 路程第一行（如：店點巡視：彰化中山店.彰化中正店.員林三民東店.和美彰美店）
  actualKm: number; // 實際公里數（當項目為「油資」時自動計算公式列）
  customAmount: number | null; // 若使用者手動覆寫實付金額（或高鐵票／停車費金額），優先使用此值
  invoiceNumber: string; // 發票號碼（如 ET-66347944）
  evidence: RouteEvidenceData; // 點對點真實 Google Maps 距離圖資料
  /** 是否為使用者手動新增的費用列（如高鐵票／停車費／租車），採獨立清單持久化避免同日多筆互蓋 */
  isCustomRow?: boolean;
  /** 出發起始點與站點數指紋，當主管修改起始點地址時自動失效舊里程快取 */
  originSignature?: string;
  /** 對應本機與雲端草稿之唯一快取鍵（巡店油資與高鐵去程／回程／停車費各自獨立不互蓋） */
  cacheKey?: string;
}

interface TravelExpenseReimbursementModalProps {
  isOpen: boolean;
  onClose: () => void;
  managersReport: ManagerExpenseItem[];
  initialManagerName: string;
  targetMonthKey: string;
  targetDateStr: string;
  initialRatePerKm: number;
  initialScope?: 'month' | 'day';
}

interface StoredEvidencePatch {
  originSignature?: string;
  actualKm?: number;
  customAmount?: number | null;
  invoiceNumber?: string;
  itemCategory?: ExpenseCategoryItem;
  routeTitle?: string;
  durationMin?: number;
  viaRoad?: string;
  stopLabels?: string[];
  googleScreenshots?: string[];
}

const SCREENSHOT_CACHE_KEY = 'petty_cash_google_evidence_v2';
const CUSTOM_ROWS_CACHE_KEY = 'petty_cash_custom_rows_v1';

/**
 * 依據當日路線起點座標與停靠站數建立指紋，若主管變更出發起點地址即會偵測差異並重算距離
 */
const buildOriginSignature = (waypoints: RouteEvidenceData['waypoints']): string => {
  if (!waypoints || waypoints.length < 2) return '';
  const start = waypoints[0];
  return `${start.lat.toFixed(4)},${start.lng.toFixed(4)}|${waypoints.length}`;
};

const loadStoredEvidenceMap = (): Record<string, StoredEvidencePatch> => {
  try {
    const raw = localStorage.getItem(SCREENSHOT_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveStoredEvidenceItem = (key: string, patch: StoredEvidencePatch): void => {
  try {
    const map = loadStoredEvidenceMap();
    map[key] = { ...(map[key] || {}), ...patch };
    localStorage.setItem(SCREENSHOT_CACHE_KEY, JSON.stringify(map));
  } catch {
    // 超過瀏覽器配額時僅保留於記憶體
  }
};

const loadStoredCustomRows = (bucketKey: string): PettyCashRow[] => {
  try {
    const raw = localStorage.getItem(CUSTOM_ROWS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = parsed?.[bucketKey];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const saveStoredCustomRows = (bucketKey: string, customRows: PettyCashRow[]): void => {
  try {
    const raw = localStorage.getItem(CUSTOM_ROWS_CACHE_KEY);
    const map: Record<string, PettyCashRow[]> = raw ? JSON.parse(raw) : {};
    if (customRows.length === 0) {
      delete map[bucketKey];
    } else {
      map[bucketKey] = customRows;
    }
    localStorage.setItem(CUSTOM_ROWS_CACHE_KEY, JSON.stringify(map));
  } catch {
    // 超過瀏覽器配額時僅保留於記憶體
  }
};

/**
 * 將總金額拆解填入《零用金單據黏存單》底部「實際金額：千 百 十 萬 千 百 十 元」8 個位數格
 * 未達該位數之高位留白（與實體表單照片第 3 張一致：如 $25,093 -> 萬=2, 千=5, 百=0, 十=9, 元=3）
 */
const splitAmountTo8PlaceDigits = (amount: number): string[] => {
  const safeVal = Math.max(0, Math.round(amount));
  const str = String(safeVal);
  const cells = ['', '', '', '', '', '', '', ''];
  for (let i = 0; i < str.length && i < 8; i++) {
    cells[8 - str.length + i] = str[i];
  }
  return cells;
};

/**
 * 格式化油資計算公式第二行（完全比照紙本黏存單格式：
 * 如 "106 公里*6.5 元=$689 元 (實付 689 元)" 或 "133 公里*6.5 元=$864.5 元 (實付 865 元)"）
 */
const formatFuelFormulaLine = (km: number, rate: number, paidAmount: number): string => {
  const safeKm = Math.round((Number(km) || 0) * 10) / 10;
  const rawProduct = Math.round(safeKm * rate * 10) / 10;
  const kmText = Number.isInteger(safeKm) ? String(safeKm) : safeKm.toFixed(1);
  const productText = Number.isInteger(rawProduct) ? String(rawProduct) : rawProduct.toFixed(1);
  return `${kmText} 公里*${rate} 元=$${productText} 元 (實付 ${Math.round(paidAmount)} 元)`;
};

/**
 * 依據單日巡店與總部出差紀錄轉成《零用金單據黏存單》預設明細列
 * - 北區去中和景平路總部或一般巡店：產出 1 列「油資」（附點對點真實 Google Maps 距離圖）
 * - 中南部去中和景平路總部：比照紙本黏存單自動展開為「去程高鐵票＋回程高鐵票＋高鐵停車費」3 列（不產生假長途開車地圖）
 */
const buildRowsFromDailyRoute = (
  route: DailyRouteRecord,
  idx: number,
  storedMap: Record<string, StoredEvidencePatch>
): PettyCashRow[] => {
  const [, mm = '01', dd = '01'] = route.dateStr.split('-');
  const shortDate = `${mm.padStart(2, '0')}/${dd.padStart(2, '0')}`;
  const resultRows: PettyCashRow[] = [];

  const waypoints = route.waypoints || [];
  const hasDrivingRoute = !route.hsrTrip || (route.totalKm > 0 && waypoints.length >= 2);

  if (hasDrivingRoute) {
    // 比照紙本照片格式：「店點巡視：彰化中山店.彰化中正店.員林三民東店.和美彰美店」
    let defaultRouteTitle = '';
    if (route.visitedStores.length > 0) {
      const storesWithSuffix = route.visitedStores.map(s => (s.endsWith('店') ? s : `${s}店`));
      defaultRouteTitle = `店點巡視：${storesWithSuffix.join('.')}`;
    } else if (route.legs.length > 0) {
      const legTargets = route.legs
        .filter(l => !l.isReturnLeg && l.transportMode !== 'hsr')
        .map(l => l.toLabel);
      defaultRouteTitle = legTargets.join(' / ') || '轄區店點巡視';
    } else {
      defaultRouteTitle = '轄區店點巡視';
    }

    const originSignature = buildOriginSignature(waypoints);
    const defaultStopLabels = waypoints.map(wp =>
      formatStopForGoogleMaps(wp.label, wp, route.region)
    );
    const cacheKey = `${route.managerName}_${route.dateStr}`;
    const saved = storedMap[cacheKey];

    // NOTE: 僅當快取的起點指紋與目前出發起點一致時才沿用舊里程與站點，避免主管更新起點地址後仍被舊市中心距離覆蓋
    const isRouteCacheValid = Boolean(
      saved && saved.originSignature && saved.originSignature === originSignature
    );

    const initialScreenshots = Array.isArray(saved?.googleScreenshots) ? saved.googleScreenshots : [];
    const initialKm =
      isRouteCacheValid && saved?.actualKm !== undefined && saved.actualKm > 0
        ? saved.actualKm
        : Number(route.totalKm.toFixed(1));
    const initialStopLabels =
      isRouteCacheValid && Array.isArray(saved?.stopLabels) && saved.stopLabels.length >= 2
        ? saved.stopLabels
        : defaultStopLabels.length >= 2
        ? defaultStopLabels
        : [
            formatStopForGoogleMaps(`${route.region}中心`, undefined, route.region),
            formatStopForGoogleMaps(route.visitedStores[0] || '總部大樓', undefined, route.region),
          ];

    resultRows.push({
      id: `petty-${route.dateStr}-${idx}`,
      dateStr: route.dateStr,
      shortDate,
      itemCategory: saved?.itemCategory || '油資',
      routeTitle: saved?.routeTitle || defaultRouteTitle,
      actualKm: initialKm,
      customAmount: isRouteCacheValid && saved?.customAmount !== undefined ? saved.customAmount : null,
      invoiceNumber: saved?.invoiceNumber || '',
      isCustomRow: false,
      originSignature,
      cacheKey,
      evidence: {
        waypoints,
        stopLabels: initialStopLabels,
        geometry: waypoints.map(w => [w.lat, w.lng] as [number, number]),
        durationMin:
          isRouteCacheValid && saved?.durationMin !== undefined
            ? saved.durationMin
            : Math.max(8, Math.round((initialKm / 34) * 60)),
        viaRoad: isRouteCacheValid && saved?.viaRoad ? saved.viaRoad : '途經主要省道／快速道路',
        verificationStatus: 'google_verified',
        googleScreenshots: initialScreenshots,
      },
    });
  }

  // 中南部主管赴中和景平路總部：自動比照紙本展開「高鐵去程＋高鐵回程＋高鐵停車費」3 列
  if (route.hsrTrip) {
    const hsr = route.hsrTrip;
    const hsrEmptyEvidence: RouteEvidenceData = {
      waypoints: [],
      stopLabels: [],
      geometry: [],
      durationMin: 0,
      viaRoad: '台灣高鐵',
      verificationStatus: 'google_verified',
      googleScreenshots: [],
    };

    const hsrItems: Array<{
      suffix: string;
      category: ExpenseCategoryItem;
      title: string;
      amount: number;
    }> = [
      {
        suffix: 'hsr_out',
        category: '高鐵票',
        title: `${hsr.meetingTitle} / 高鐵：${hsr.departureStation}-${hsr.arrivalStation} (實付 ${hsr.oneWayFare} 元)`,
        amount: hsr.oneWayFare,
      },
      {
        suffix: 'hsr_back',
        category: '高鐵票',
        title: `${hsr.meetingTitle} / 高鐵：${hsr.arrivalStation}-${hsr.departureStation} (實付 ${hsr.oneWayFare} 元)`,
        amount: hsr.oneWayFare,
      },
      {
        suffix: 'hsr_park',
        category: '停車費',
        title: `${hsr.departureStation}高鐵停車費`,
        amount: hsr.defaultParkingFee,
      },
    ];

    for (const item of hsrItems) {
      const hsrCacheKey = `${route.managerName}_${route.dateStr}_${item.suffix}`;
      const savedHsr = storedMap[hsrCacheKey];
      resultRows.push({
        id: `petty-${route.dateStr}-${idx}-${item.suffix}`,
        dateStr: route.dateStr,
        shortDate,
        itemCategory: savedHsr?.itemCategory || item.category,
        routeTitle: savedHsr?.routeTitle || item.title,
        actualKm: 0,
        customAmount:
          savedHsr?.customAmount !== undefined && savedHsr.customAmount !== null
            ? savedHsr.customAmount
            : item.amount,
        invoiceNumber: savedHsr?.invoiceNumber || '',
        isCustomRow: false,
        cacheKey: hsrCacheKey,
        evidence: hsrEmptyEvidence,
      });
    }
  }

  return resultRows;
};

const escapeHtml = (str: string | number | undefined | null): string =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * 東森寵物雲股份有限公司 — 零用金單據黏存單 ＋ 點對點真實 Google Maps 距離佐證附件
 */
export const TravelExpenseReimbursementModal: React.FC<TravelExpenseReimbursementModalProps> = ({
  isOpen,
  onClose,
  managersReport,
  initialManagerName,
  targetMonthKey,
  targetDateStr,
  initialRatePerKm,
  initialScope = 'month',
}) => {
  const [activeViewTab, setActiveViewTab] = useState<'form' | 'attachments'>('form');
  const [mobileCardLayout, setMobileCardLayout] = useState<boolean>(
    () => typeof window !== 'undefined' && window.innerWidth < 768
  );
  const [includeAttachmentsInExport, setIncludeAttachmentsInExport] = useState<boolean>(true);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const [selectedManagerName, setSelectedManagerName] = useState<string>(initialManagerName);
  const [scope, setScope] = useState<'month' | 'day'>(initialScope);
  const [vehicleType, setVehicleType] = useState<VehicleType>(
    initialRatePerKm === MOTORCYCLE_SUBSIDY_PER_KM ? 'motorcycle' : 'car'
  );
  const [ratePerKm, setRatePerKm] = useState<number>(initialRatePerKm || DEFAULT_SUBSIDY_PER_KM);

  // 零用金單據黏存單表頭欄位
  const [formSerialNo, setFormSerialNo] = useState<string>('');
  const [purposePrefix, setPurposePrefix] = useState<string>('');
  const [applicantName, setApplicantName] = useState<string>('');
  const [rows, setRows] = useState<PettyCashRow[]>([]);
  const [syncVersion, setSyncVersion] = useState<number>(0);
  const rowsRef = useRef<PettyCashRow[]>([]);
  rowsRef.current = rows;

  // 雲端草稿同步狀態（手機填寫、電腦列印、總部線上核對）
  const [cloudSyncState, setCloudSyncState] = useState<
    'idle' | 'loading' | 'saving' | 'synced' | 'offline'
  >('idle');
  const [cloudSavedTime, setCloudSavedTime] = useState<string>('');
  const cloudSaveTimerRef = useRef<number | null>(null);
  const formMetaRef = useRef({
    formSerialNo: '',
    purposePrefix: '',
    vehicleType: vehicleType as VehicleType,
    ratePerKm,
  });
  formMetaRef.current = {
    formSerialNo,
    purposePrefix,
    vehicleType,
    ratePerKm,
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewImageUrl) setPreviewImageUrl(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, previewImageUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const fallbackMgr = initialManagerName || managersReport[0]?.managerName || '';
    setSelectedManagerName(fallbackMgr);
    setScope(initialScope);
    setRatePerKm(initialRatePerKm || DEFAULT_SUBSIDY_PER_KM);
    setVehicleType(initialRatePerKm === MOTORCYCLE_SUBSIDY_PER_KM ? 'motorcycle' : 'car');
    setActiveViewTab('form');
    if (typeof window !== 'undefined') {
      setMobileCardLayout(window.innerWidth < 768);
    }
  }, [isOpen, initialManagerName, initialRatePerKm, initialScope, managersReport]);

  const activeManager = useMemo(
    () => managersReport.find(m => m.managerName === selectedManagerName) || managersReport[0] || null,
    [managersReport, selectedManagerName]
  );

  const customRowsBucketKey = activeManager
    ? `${activeManager.managerName}_${targetMonthKey}`
    : '';

  // 立即將目前主管當月之黏存單草稿（發票號碼、高鐵／停車費、公里數與表頭）儲存至後端資料庫
  const flushCloudSave = useCallback(async () => {
    if (!activeManager) return;
    if (cloudSaveTimerRef.current) {
      window.clearTimeout(cloudSaveTimerRef.current);
      cloudSaveTimerRef.current = null;
    }

    const mgrName = activeManager.managerName;
    const prefix = `${mgrName}_${targetMonthKey}-`;
    const fullEvidenceMap = loadStoredEvidenceMap();
    const monthEvidencePatches: Record<string, StoredEvidencePatch> = {};
    for (const [k, v] of Object.entries(fullEvidenceMap)) {
      if (k.startsWith(prefix)) {
        monthEvidencePatches[k] = v;
      }
    }
    const bucketKey = `${mgrName}_${targetMonthKey}`;
    const customRowsList = loadStoredCustomRows(bucketKey);

    setCloudSyncState('saving');
    const result = await savePettyCashDraftToServer({
      managerName: mgrName,
      monthKey: targetMonthKey,
      formSerialNo: formMetaRef.current.formSerialNo,
      purposePrefix: formMetaRef.current.purposePrefix,
      vehicleType: formMetaRef.current.vehicleType,
      ratePerKm: formMetaRef.current.ratePerKm,
      evidencePatches: monthEvidencePatches,
      customRows: customRowsList as unknown as Record<string, unknown>[],
    });

    if (result.ok) {
      setCloudSyncState('synced');
      setCloudSavedTime(
        new Date().toLocaleTimeString('zh-TW', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Taipei',
        })
      );
    } else {
      setCloudSyncState('offline');
    }
  }, [activeManager, targetMonthKey]);

  // 800ms 防抖自動雲端存檔，避免每敲一個字就送出請求
  const scheduleCloudSave = useCallback(() => {
    if (!activeManager) return;
    if (cloudSaveTimerRef.current) {
      window.clearTimeout(cloudSaveTimerRef.current);
    }
    cloudSaveTimerRef.current = window.setTimeout(() => {
      flushCloudSave();
    }, 800);
  }, [activeManager, flushCloudSave]);

  useEffect(() => {
    return () => {
      if (cloudSaveTimerRef.current) {
        window.clearTimeout(cloudSaveTimerRef.current);
      }
    };
  }, []);

  // 依據主管與統計範圍載入系統紀錄（合併同月手動新增之高鐵／停車費列），並於背景自動計算點對點真實道路距離連動主表
  const syncFromSystemData = useCallback(
    (ignoreSavedCache = false) => {
      if (!activeManager) return;
      setApplicantName(activeManager.managerName);

      const sourceRoutes: DailyRouteRecord[] =
        scope === 'day'
          ? activeManager.dayRoute
            ? [activeManager.dayRoute]
            : []
          : [...activeManager.monthDailyRoutes].sort((a, b) => a.dateStr.localeCompare(b.dateStr));

      const bucketKey = `${activeManager.managerName}_${targetMonthKey}`;
      if (ignoreSavedCache) {
        // 清除本機當月快取與雲端資料庫草稿
        try {
          const allEv = loadStoredEvidenceMap();
          const prefix = `${activeManager.managerName}_${targetMonthKey}-`;
          for (const k of Object.keys(allEv)) {
            if (k.startsWith(prefix)) delete allEv[k];
          }
          localStorage.setItem(SCREENSHOT_CACHE_KEY, JSON.stringify(allEv));
        } catch {
          // 忽略儲存異常
        }
        saveStoredCustomRows(bucketKey, []);
        setFormSerialNo('');
        resetPettyCashDraftOnServer(activeManager.managerName, targetMonthKey).then(() => {
          setCloudSyncState('idle');
          setCloudSavedTime('');
        });
      }

      const storedMap = ignoreSavedCache ? {} : loadStoredEvidenceMap();
      const generatedRows = sourceRoutes.flatMap((route, idx) =>
        buildRowsFromDailyRoute(route, idx, storedMap)
      );

      let mergedRows = generatedRows;
      if (!ignoreSavedCache) {
        const savedCustomRows = loadStoredCustomRows(bucketKey)
          .filter(r => scope !== 'day' || r.dateStr === targetDateStr)
          .map(r => ({ ...r, isCustomRow: true }));
        if (savedCustomRows.length > 0) {
          mergedRows = [...generatedRows, ...savedCustomRows].sort((a, b) =>
            a.shortDate.localeCompare(b.shortDate)
          );
        }
      }

      setRows(mergedRows);
      setSyncVersion(v => v + 1);

      // 產生如「2026/10/01~10/31 營運二處巡店暨總部會議交通費申請」之用途說明前綴
      const [yStr = '2026', mStr = '01'] = targetMonthKey.split('-');
      const lastDay = new Date(Number(yStr), Number(mStr), 0).getDate();
      const dateSpanText =
        scope === 'day'
          ? targetDateStr.replace(/-/g, '/')
          : `${yStr}/${mStr}/01~${mStr}/${String(lastDay).padStart(2, '0')}`;
      const deptLabel = (activeManager.department || '營運處').replace('營業', '營運');
      setPurposePrefix(`${dateSpanText} ${deptLabel}巡店暨總部會議交通費申請`);
    },
    [activeManager, scope, targetMonthKey, targetDateStr]
  );

  // 開啟黏存單或切換主管／月份時，先載入本機快取快速顯示，再向後端資料庫拉取雲端草稿同步還原
  useEffect(() => {
    if (!isOpen || !activeManager) return;
    syncFromSystemData(false);

    let cancelled = false;
    setCloudSyncState('loading');
    fetchPettyCashDraftFromServer(activeManager.managerName, targetMonthKey).then(draft => {
      if (cancelled) return;
      if (!draft) {
        setCloudSyncState('idle');
        setCloudSavedTime('');
        return;
      }

      // 合併雲端草稿中的各日發票／里程調整至本機快取
      if (draft.evidencePatches && typeof draft.evidencePatches === 'object') {
        const currentEv = loadStoredEvidenceMap();
        for (const [k, v] of Object.entries(draft.evidencePatches)) {
          currentEv[k] = {
            ...(currentEv[k] || {}),
            ...(v as StoredEvidencePatch),
            // 若雲端因容量裁剪不含截圖，保留本機既有截圖避免覆蓋
            googleScreenshots:
              Array.isArray(v.googleScreenshots) && v.googleScreenshots.length > 0
                ? v.googleScreenshots
                : currentEv[k]?.googleScreenshots || [],
          };
        }
        try {
          localStorage.setItem(SCREENSHOT_CACHE_KEY, JSON.stringify(currentEv));
        } catch {
          // 忽略儲存異常
        }
      }

      // 合併雲端手動新增列（高鐵票／停車費／租車等）
      if (Array.isArray(draft.customRows)) {
        const bucketKey = `${activeManager.managerName}_${targetMonthKey}`;
        saveStoredCustomRows(bucketKey, draft.customRows as unknown as PettyCashRow[]);
      }

      // 先以合併後的快取重建列表，再套用雲端保存的表頭與車輛單價
      syncFromSystemData(false);
      if (draft.formSerialNo !== undefined) setFormSerialNo(draft.formSerialNo);
      if (draft.purposePrefix) setPurposePrefix(draft.purposePrefix);
      if (draft.vehicleType === 'car' || draft.vehicleType === 'motorcycle') {
        setVehicleType(draft.vehicleType);
      }
      if (typeof draft.ratePerKm === 'number' && draft.ratePerKm > 0) {
        setRatePerKm(draft.ratePerKm);
      }

      setCloudSyncState('synced');
      if (draft.updatedAt) {
        const d = new Date(draft.updatedAt);
        if (!Number.isNaN(d.getTime())) {
          setCloudSavedTime(
            d.toLocaleTimeString('zh-TW', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Taipei',
            })
          );
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeManager, targetMonthKey, syncFromSystemData]);

  // 開啟黏存單或起點變更重建列表後，自動於背景計算每筆油資行程的點對點真實道路軌跡與公里數（無須手動再按一次）
  useEffect(() => {
    if (!isOpen || !activeManager || syncVersion === 0) return;
    const currentRows = rowsRef.current;
    const pendingRows = currentRows.filter(
      r =>
        r.itemCategory === '油資' &&
        r.evidence.waypoints.length >= 2 &&
        r.evidence.geometry.length <= r.evidence.waypoints.length
    );
    if (pendingRows.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const item of pendingRows) {
        if (cancelled) break;
        const road = await fetchRealRoadRoute(item.evidence.waypoints, activeManager.region);
        if (cancelled) break;
        setRows(prev =>
          prev.map(r => {
            if (r.id !== item.id) return r;
            const nextKm = road.distanceKm > 0 ? road.distanceKm : r.actualKm;
            if (!r.isCustomRow && activeManager) {
              saveStoredEvidenceItem(`${activeManager.managerName}_${r.dateStr}`, {
                originSignature: r.originSignature,
                actualKm: nextKm,
                durationMin: road.durationMin,
                viaRoad: road.viaRoad,
              });
            }
            return {
              ...r,
              actualKm: nextKm,
              evidence: {
                ...r.evidence,
                geometry: road.geometry,
                durationMin: road.durationMin,
                viaRoad: road.viaRoad,
                verificationStatus: 'google_verified',
              },
            };
          })
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeManager, syncVersion]);

  const handleVehicleSwitch = (nextType: VehicleType) => {
    setVehicleType(nextType);
    const nextRate = nextType === 'motorcycle' ? MOTORCYCLE_SUBSIDY_PER_KM : DEFAULT_SUBSIDY_PER_KM;
    setRatePerKm(nextRate);
    formMetaRef.current = { ...formMetaRef.current, vehicleType: nextType, ratePerKm: nextRate };
    scheduleCloudSave();
  };

  const handleUpdateFormSerialNo = (val: string) => {
    setFormSerialNo(val);
    formMetaRef.current = { ...formMetaRef.current, formSerialNo: val };
    scheduleCloudSave();
  };

  const handleUpdatePurposePrefix = (val: string) => {
    setPurposePrefix(val);
    formMetaRef.current = { ...formMetaRef.current, purposePrefix: val };
    scheduleCloudSave();
  };

  const persistRowPatch = (
    row: PettyCashRow,
    patch: StoredEvidencePatch
  ) => {
    if (!activeManager || row.isCustomRow) return;
    const key = row.cacheKey || `${activeManager.managerName}_${row.dateStr}`;
    saveStoredEvidenceItem(key, {
      originSignature: row.originSignature,
      ...patch,
    });
  };

  // 將手動新增列之變更同步寫入獨立清單（同日多筆高鐵票／停車費不互相覆蓋，重開彈窗仍保留）
  const persistCustomRowsSnapshot = (nextAllRows: PettyCashRow[]) => {
    if (!customRowsBucketKey) return;
    const customOnly = nextAllRows.filter(r => r.isCustomRow);
    if (scope === 'day') {
      // 單日檢視時僅替換當日的手動列，保留同月其他日期的手動列
      const otherDaysCustom = loadStoredCustomRows(customRowsBucketKey).filter(
        r => r.dateStr !== targetDateStr
      );
      saveStoredCustomRows(customRowsBucketKey, [...otherDaysCustom, ...customOnly]);
    } else {
      saveStoredCustomRows(customRowsBucketKey, customOnly);
    }
  };

  const updateRow = <K extends keyof PettyCashRow>(id: string, key: K, value: PettyCashRow[K]) => {
    setRows(prev => {
      const nextList = prev.map(r => {
        if (r.id !== id) return r;
        const nextRow = { ...r, [key]: value };
        // 修改日期短格式（如 10/05）時同步更新完整 YYYY-MM-DD，確保單日篩選與排序一致
        if (key === 'shortDate' && typeof value === 'string') {
          const match = value.trim().match(/^(\d{1,2})[/-](\d{1,2})$/);
          if (match) {
            const yearPrefix = (r.dateStr || targetMonthKey || '2026-01').slice(0, 4);
            const mm = match[1].padStart(2, '0');
            const dd = match[2].padStart(2, '0');
            nextRow.dateStr = `${yearPrefix}-${mm}-${dd}`;
          }
        }
        // 修改公里數時，若先前有手動鎖定金額則自動解除鎖定，讓實付金額隨公里數×單價即時更新
        if (key === 'actualKm') {
          nextRow.customAmount = null;
        }
        persistRowPatch(nextRow, {
          actualKm: nextRow.actualKm,
          customAmount: nextRow.customAmount,
          invoiceNumber: nextRow.invoiceNumber,
          itemCategory: nextRow.itemCategory,
          routeTitle: nextRow.routeTitle,
        });
        return nextRow;
      });
      if (prev.some(r => r.id === id && r.isCustomRow)) {
        persistCustomRowsSnapshot(nextList);
      }
      return nextList;
    });
    scheduleCloudSave();
  };

  const updateRowEvidence = (
    id: string,
    patch: {
      actualKm?: number;
      durationMin?: number;
      viaRoad?: string;
      waypoints?: RouteEvidenceData['waypoints'];
      geometry?: [number, number][];
      stopLabels?: string[];
      verificationStatus?: VerificationStatus;
      googleScreenshots?: string[];
    }
  ) => {
    setRows(prev => {
      const nextList = prev.map(r => {
        if (r.id !== id) return r;
        const nextEvidence: RouteEvidenceData = {
          ...r.evidence,
          ...(patch.waypoints !== undefined ? { waypoints: patch.waypoints } : {}),
          ...(patch.geometry !== undefined ? { geometry: patch.geometry } : {}),
          ...(patch.durationMin !== undefined ? { durationMin: patch.durationMin } : {}),
          ...(patch.viaRoad !== undefined ? { viaRoad: patch.viaRoad } : {}),
          ...(patch.stopLabels !== undefined ? { stopLabels: patch.stopLabels } : {}),
          ...(patch.verificationStatus !== undefined ? { verificationStatus: patch.verificationStatus } : {}),
          ...(patch.googleScreenshots !== undefined ? { googleScreenshots: patch.googleScreenshots } : {}),
        };
        const nextKm = patch.actualKm !== undefined ? patch.actualKm : r.actualKm;
        const nextCustomAmount = patch.actualKm !== undefined ? null : r.customAmount;
        const nextRow: PettyCashRow = {
          ...r,
          actualKm: nextKm,
          customAmount: nextCustomAmount,
          evidence: nextEvidence,
        };

        persistRowPatch(nextRow, {
          actualKm: nextKm,
          customAmount: nextCustomAmount,
          durationMin: nextEvidence.durationMin,
          viaRoad: nextEvidence.viaRoad,
          stopLabels: nextEvidence.stopLabels,
          googleScreenshots: nextEvidence.googleScreenshots,
        });

        return nextRow;
      });
      if (prev.some(r => r.id === id && r.isCustomRow)) {
        persistCustomRowsSnapshot(nextList);
      }
      return nextList;
    });
    scheduleCloudSave();
  };

  const handleAddRow = (presetCategory: ExpenseCategoryItem = '油資') => {
    const [, mm = '01', dd = '01'] = targetDateStr.split('-');
    const shortDate = `${mm.padStart(2, '0')}/${dd.padStart(2, '0')}`;
    const defaultTitle =
      presetCategory === '高鐵票'
        ? '店點巡視 / 高鐵：台中-左營 (實付 790 元)'
        : presetCategory === '停車費'
        ? '高鐵停車費'
        : presetCategory === '租車'
        ? '店點巡視：門市A.門市B'
        : '店點巡視：';

    const newRow: PettyCashRow = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dateStr: targetDateStr,
      shortDate,
      itemCategory: presetCategory,
      routeTitle: defaultTitle,
      actualKm: presetCategory === '油資' ? 10 : 0,
      customAmount: presetCategory === '高鐵票' ? 790 : presetCategory === '停車費' ? 250 : null,
      invoiceNumber: '',
      isCustomRow: true,
      evidence: {
        waypoints: [],
        stopLabels: [
          formatStopForGoogleMaps(`${activeManager?.region || '新北區'}中心`, undefined, activeManager?.region),
          '東森寵物雲總部 235台灣新北市中和區景平路258號',
        ],
        geometry: [],
        durationMin: 15,
        viaRoad: '途經主要幹道',
        verificationStatus: 'google_verified',
        googleScreenshots: [],
      },
    };

    setRows(prev => {
      const nextList = [...prev, newRow];
      persistCustomRowsSnapshot(nextList);
      return nextList;
    });
    scheduleCloudSave();
  };

  const handleDeleteRow = (id: string) => {
    setRows(prev => {
      const target = prev.find(r => r.id === id);
      const nextList = prev.filter(r => r.id !== id);
      if (target?.isCustomRow) {
        persistCustomRowsSnapshot(nextList);
      }
      return nextList;
    });
    scheduleCloudSave();
  };

  // 即時計算每一列之實付金額、油資公式文字、總計金額與底部 8 位數拆解
  const calculated = useMemo(() => {
    const computedRows = rows.map(row => {
      const autoFuelCost = Math.round((Number(row.actualKm) || 0) * ratePerKm);
      const paidAmount =
        row.customAmount !== null && row.customAmount !== undefined
          ? Math.round(Number(row.customAmount) || 0)
          : row.itemCategory === '油資'
          ? autoFuelCost
          : 0;
      const formulaLine =
        row.itemCategory === '油資'
          ? formatFuelFormulaLine(row.actualKm, ratePerKm, paidAmount)
          : '';
      return {
        ...row,
        autoFuelCost,
        paidAmount,
        formulaLine,
      };
    });

    const grandTotal = computedRows.reduce((sum, r) => sum + r.paidAmount, 0);
    const totalKm = computedRows.reduce(
      (sum, r) => sum + (r.itemCategory === '油資' ? Number(r.actualKm) || 0 : 0),
      0
    );
    const digitCells = splitAmountTo8PlaceDigits(grandTotal);
    const fuelRows = computedRows.filter(r => r.itemCategory === '油資');

    return { computedRows, grandTotal, totalKm, digitCells, fuelRows };
  }, [rows, ratePerKm]);

  const fullPurposeText = `${purposePrefix}，共 ${calculated.grandTotal.toLocaleString('zh-TW')} 元`;

  /**
   * 產生 1:1 還原《東森寵物雲股份有限公司 零用金單據黏存單》＋《附件：點對點真實 Google Maps 距離圖》之列印／Word HTML
   */
  const buildPrintableDocumentHtml = (forWord = false, withAttachments = true): string => {
    const emptyCount = Math.max(0, 10 - calculated.computedRows.length);
    const actualRenderedRows = calculated.computedRows.length + emptyCount;

    const dataRowsHtml = calculated.computedRows
      .map((r, idx) => {
        const leftPasteCell =
          idx === 0
            ? `<td rowspan="${actualRenderedRows + 1}" class="paste-strip">
                 <div class="paste-vertical-text">報 銷 時 請 經 手 人 將 發 票 或 其 他 單 據 黏 在 此 處</div>
               </td>`
            : '';
        const routeHtml = r.formulaLine
          ? `<div>${escapeHtml(r.routeTitle)}</div><div class="formula-line">${escapeHtml(r.formulaLine)}</div>`
          : `<div>${escapeHtml(r.routeTitle)}</div>`;

        return `
          <tr>
            ${leftPasteCell}
            <td class="c-center">${idx + 1}</td>
            <td class="c-center">${escapeHtml(r.shortDate)}</td>
            <td class="c-center">${escapeHtml(r.itemCategory)}</td>
            <td class="c-left">${routeHtml}</td>
            <td class="c-right b-bold">$${r.paidAmount.toLocaleString('zh-TW')}</td>
            <td class="c-center invoice-cell">${escapeHtml(r.invoiceNumber)}</td>
          </tr>
        `;
      })
      .join('');

    const emptyRowsHtml = Array.from({ length: emptyCount })
      .map((_, i) => {
        const leftPasteCell =
          calculated.computedRows.length === 0 && i === 0
            ? `<td rowspan="${emptyCount + 1}" class="paste-strip">
                 <div class="paste-vertical-text">報 銷 時 請 經 手 人 將 發 票 或 其 他 單 據 黏 在 此 處</div>
               </td>`
            : '';
        return `
          <tr class="empty-row">
            ${leftPasteCell}
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
          </tr>
        `;
      })
      .join('');

    // 附件頁：每一筆油資行程輸出點對點真實 Google Maps 距離畫面（或已附加之截圖）
    const attachmentsHtml =
      withAttachments && calculated.fuelRows.length > 0
        ? calculated.fuelRows
            .map((r, idx) => {
              const visualHtml =
                r.evidence.googleScreenshots.length > 0
                  ? r.evidence.googleScreenshots
                      .map(
                        src =>
                          `<div style="text-align:center;margin-bottom:8px;"><img src="${src}" alt="Google Maps 截圖" style="max-width:100%;max-height:340px;border:1px solid #cbd5e1;border-radius:8px;object-fit:contain;" /></div>`
                      )
                      .join('')
                  : buildPrintableGoogleMapCardHtml({
                      stopLabels: r.evidence.stopLabels,
                      waypoints: r.evidence.waypoints,
                      geometry: r.evidence.geometry,
                      distanceKm: r.actualKm,
                      durationMin: r.evidence.durationMin,
                      viaRoad: r.evidence.viaRoad,
                      vehicle: vehicleType,
                      width: 520,
                      height: 310,
                    });

              return `
                <div class="att-block">
                  <div class="att-bar">
                    <span><strong>附件 ${idx + 1}（對應序號 ${calculated.computedRows.indexOf(r) + 1}）</strong>｜日期：<strong>${escapeHtml(r.dateStr)}</strong>｜${escapeHtml(r.routeTitle)}</span>
                    <span><strong>${escapeHtml(r.formulaLine)}</strong></span>
                  </div>
                  ${visualHtml}
                </div>
              `;
            })
            .join('')
        : '';

    const wordAttrs = forWord
      ? `xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"`
      : '';

    const d = calculated.digitCells;

    return `<!DOCTYPE html>
<html ${wordAttrs} lang="zh-TW">
<head>
  <meta charset="utf-8" />
  <title>東森寵物雲股份有限公司_零用金單據黏存單_${escapeHtml(applicantName)}_${escapeHtml(targetMonthKey)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm;
    }
    @page Section1 {
      size: 21.0cm 29.7cm;
      mso-page-orientation: portrait;
      margin: 1.0cm 1.2cm;
    }
    div.Section1 { page: Section1; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      font-family: "Microsoft JhengHei", "PMingLiU", "新細明體", "Noto Sans TC", sans-serif;
      color: #000;
      margin: 0;
      padding: 0;
      font-size: 10pt;
      line-height: 1.35;
    }
    .title-company {
      text-align: center;
      font-size: 17pt;
      font-weight: 800;
      letter-spacing: 0.12em;
      margin: 0;
    }
    .sub-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin: 2px 0 6px 0;
      font-size: 11.5pt;
      font-weight: 800;
    }
    table.petty-table {
      width: 100%;
      border-collapse: collapse;
      border: 1.8px solid #000;
      table-layout: fixed;
    }
    table.petty-table th,
    table.petty-table td {
      border: 1px solid #000;
      padding: 4px 6px;
      vertical-align: middle;
      word-break: break-word;
      font-size: 9.5pt;
    }
    table.petty-table th {
      font-weight: 800;
      text-align: center;
      background: #f8fafc;
    }
    .purpose-label {
      font-size: 13pt;
      font-weight: 800;
      letter-spacing: 0.2em;
      text-align: center;
    }
    .purpose-val {
      font-size: 11pt;
      font-weight: 800;
      padding: 6px 10px !important;
    }
    .paste-strip {
      width: 32px;
      text-align: center;
      vertical-align: middle !important;
      padding: 8px 4px !important;
    }
    .paste-vertical-text {
      writing-mode: vertical-rl;
      -webkit-writing-mode: vertical-rl;
      text-orientation: upright;
      font-weight: 800;
      font-size: 10pt;
      letter-spacing: 0.25em;
      margin: 0 auto;
    }
    .c-center { text-align: center; }
    .c-left { text-align: left; }
    .c-right { text-align: right; font-variant-numeric: tabular-nums; }
    .b-bold { font-weight: 800; }
    .formula-line { font-weight: 700; margin-top: 1px; }
    .invoice-cell { font-size: 8.5pt; font-family: monospace, sans-serif; }
    tr.empty-row td { height: 24px; }

    /* 第三張照片：底部物品費用／進項稅額／實際金額位數與簽核表 */
    table.footer-table {
      width: 100%;
      border-collapse: collapse;
      border: 1.8px solid #000;
      border-top: none;
      table-layout: fixed;
    }
    table.footer-table th,
    table.footer-table td {
      border: 1px solid #000;
      padding: 4px 6px;
      text-align: center;
      font-size: 9.5pt;
      font-weight: 800;
    }
    .sign-grid {
      width: 100%;
      border-collapse: collapse;
      border: 1.8px solid #000;
      border-top: none;
      table-layout: fixed;
    }
    .sign-grid td {
      border: 1px solid #000;
      padding: 10px 8px 26px 8px;
      font-size: 10.5pt;
      font-weight: 800;
      vertical-align: top;
    }
    .att-section-title {
      page-break-before: always;
      break-before: page;
      font-size: 13pt;
      font-weight: 800;
      border-bottom: 2px solid #000;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .att-block {
      page-break-inside: avoid;
      break-inside: avoid;
      margin-bottom: 16px;
    }
    .att-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0f172a;
      color: #fff;
      padding: 6px 10px;
      border-radius: 6px 6px 0 0;
      font-size: 9pt;
    }
  </style>
</head>
<body>
<div class="Section1">
  <div class="title-company">東森寵物雲股份有限公司</div>
  <div class="sub-bar">
    <span>零用金單據黏存單</span>
    <span>NO. ${escapeHtml(formSerialNo || '______________')}</span>
  </div>

  <table class="petty-table">
    <colgroup>
      <col style="width: 5%;" />
      <col style="width: 6%;" />
      <col style="width: 8%;" />
      <col style="width: 9%;" />
      <col style="width: 49%;" />
      <col style="width: 11%;" />
      <col style="width: 12%;" />
    </colgroup>
    <tbody>
      <!-- 用途說明列 -->
      <tr>
        <td colspan="3" class="purpose-label">用 途 說 明</td>
        <td colspan="4" class="purpose-val">${escapeHtml(fullPurposeText)}</td>
      </tr>
      <!-- 明細表頭 -->
      <tr>
        <td class="paste-strip" style="border-bottom:none;"></td>
        <th>序號</th>
        <th>日期</th>
        <th>項目</th>
        <th>路　　　　　　程</th>
        <th>金額</th>
        <th>發票號碼</th>
      </tr>
      ${dataRowsHtml}
      ${emptyRowsHtml}
      <!-- 合計列 -->
      <tr>
        <td colspan="4" class="c-center b-bold" style="font-size:10.5pt;">合計</td>
        <td class="c-right b-bold" style="font-size:10.5pt;">$${calculated.grandTotal.toLocaleString('zh-TW')}</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <!-- 底部結算表格（物品費用、進項稅額、實際金額 千百十萬千百十元） -->
  <table class="footer-table">
    <colgroup>
      <col style="width: 16%;" />
      <col style="width: 14%;" />
      <col style="width: 8.75%;" />
      <col style="width: 8.75%;" />
      <col style="width: 8.75%;" />
      <col style="width: 8.75%;" />
      <col style="width: 8.75%;" />
      <col style="width: 8.75%;" />
      <col style="width: 8.75%;" />
      <col style="width: 8.75%;" />
    </colgroup>
    <tbody>
      <tr>
        <td>物 品 費 用</td>
        <td>金　額</td>
        <td colspan="8" class="c-right" style="padding-right:14px;font-size:11pt;">$${calculated.grandTotal.toLocaleString('zh-TW')}</td>
      </tr>
      <tr>
        <td rowspan="2">進 項 稅 額</td>
        <td>可 扣 抵</td>
        <td colspan="8"></td>
      </tr>
      <tr>
        <td>不 扣 抵</td>
        <td colspan="8"></td>
      </tr>
      <tr>
        <td rowspan="2">實 際 金 額</td>
        <td>新台幣</td>
        <td>千</td>
        <td>百</td>
        <td>十</td>
        <td>萬</td>
        <td>千</td>
        <td>百</td>
        <td>十</td>
        <td>元</td>
      </tr>
      <tr>
        <td></td>
        <td>${d[0]}</td>
        <td>${d[1]}</td>
        <td>${d[2]}</td>
        <td>${d[3]}</td>
        <td>${d[4]}</td>
        <td>${d[5]}</td>
        <td>${d[6]}</td>
        <td>${d[7]}</td>
      </tr>
    </tbody>
  </table>

  <!-- 五級簽核欄（皆留白供紙本手寫簽名） -->
  <table class="sign-grid">
    <tr>
      <td>總 經 理</td>
      <td>副 總 經 理</td>
      <td>部 門 主 管</td>
      <td>審　　核</td>
      <td>請 款 人</td>
    </tr>
  </table>

  ${
    attachmentsHtml
      ? `<div class="att-section-title">東森寵物雲股份有限公司 — 零用金單據黏存單【附件：點對點 Google Maps 距離驗證】</div>
         ${attachmentsHtml}`
      : ''
  }
</div>
</body>
</html>`;
  };

  /**
   * 列印 / 另存 A4 PDF（等待所有真實 Google Maps 圖磚載入完成後啟動列印）
   */
  const handlePrintPdf = () => {
    const html = buildPrintableDocumentHtml(false, includeAttachmentsInExport);
    const printWin = window.open('', '_blank', 'width=1100,height=900');
    if (!printWin) {
      alert('瀏覽器阻擋了彈出視窗，請允許本站開啟列印視窗後再試。');
      return;
    }
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
    printWin.focus();

    const triggerPrintWhenReady = () => {
      const imgs = Array.from(printWin.document.images || []);
      if (imgs.length === 0) {
        printWin.print();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        setTimeout(() => printWin.print(), 200);
      };
      const timer = setTimeout(done, 4000);
      Promise.all(
        imgs.map(img =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>(resolve => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              })
        )
      ).then(() => {
        clearTimeout(timer);
        done();
      });
    };

    setTimeout(triggerPrintWhenReady, 220);
  };

  const handleExportWord = () => {
    const html = buildPrintableDocumentHtml(true, includeAttachmentsInExport);
    const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `東森寵物雲_零用金單據黏存單_${applicantName || '區主管'}_${targetMonthKey}.doc`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 backdrop-blur-xs p-1.5 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-slate-100 rounded-2xl w-full max-w-[1280px] max-h-[96vh] flex flex-col shadow-2xl border border-slate-300 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 頂部導覽與匯出列 */}
        <div className="bg-slate-900 text-white px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-400 text-slate-950">
              自動連動
            </span>
            <h2 className="text-xs sm:text-base font-extrabold tracking-wide">
              東森寵物雲股份有限公司 — 零用金單據黏存單＆點對點 Google Maps 附件
            </h2>
            <button
              type="button"
              onClick={flushCloudSave}
              disabled={cloudSyncState === 'saving' || cloudSyncState === 'loading'}
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border transition-colors cursor-pointer ${
                cloudSyncState === 'synced'
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30'
                  : cloudSyncState === 'offline'
                  ? 'bg-amber-500/20 border-amber-400/50 text-amber-200 hover:bg-amber-500/30'
                  : 'bg-white/10 border-white/20 text-sky-200 hover:bg-white/20'
              }`}
              title="點擊立即將本月份發票號碼、高鐵／停車費與明細草稿同步儲存至雲端資料庫（手機填、電腦印）"
            >
              {cloudSyncState === 'saving' || cloudSyncState === 'loading' ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Cloud size={11} />
              )}
              <span>
                {cloudSyncState === 'loading'
                  ? '載入雲端草稿...'
                  : cloudSyncState === 'saving'
                  ? '雲端存檔中...'
                  : cloudSyncState === 'synced'
                  ? `已自動同步雲端${cloudSavedTime ? ` ${cloudSavedTime}` : ''}`
                  : cloudSyncState === 'offline'
                  ? '暫存本機（點此重試同步）'
                  : '點此儲存雲端草稿'}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <label className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-bold text-amber-200 bg-white/10 border border-white/15 px-2.5 py-1.5 rounded-xl cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeAttachmentsInExport}
                onChange={e => setIncludeAttachmentsInExport(e.target.checked)}
                className="rounded text-amber-400 focus:ring-0 cursor-pointer"
              />
              <span>含 Google Maps 附件 ({calculated.fuelRows.length})</span>
            </label>

            <button
              type="button"
              onClick={handlePrintPdf}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold shadow-xs cursor-pointer"
            >
              <Printer size={14} />
              <span>列印 / PDF</span>
            </button>
            <button
              type="button"
              onClick={handleExportWord}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-xs cursor-pointer"
            >
              <FileText size={14} />
              <span className="hidden sm:inline">匯出 Word</span>
              <span className="sm:hidden">Word</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              title="關閉視窗"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 主表／附件切換 ＋ 手機好填模式切換 ＋ 新增項目列 */}
        <div className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
              <button
                type="button"
                onClick={() => setActiveViewTab('form')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all ${
                  activeViewTab === 'form'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileSpreadsheet size={13} />
                <span>主表：零用金單據黏存單</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveViewTab('attachments')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all ${
                  activeViewTab === 'attachments'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-blue-700 hover:bg-blue-50'
                }`}
              >
                <Camera size={13} />
                <span>附件：點對點真實 Google Maps 距離 ({calculated.fuelRows.length})</span>
              </button>
            </div>

            {activeViewTab === 'form' && (
              <button
                type="button"
                onClick={() => setMobileCardLayout(prev => !prev)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold border cursor-pointer transition-colors ${
                  mobileCardLayout
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
                title="切換手機大字好填卡片模式或傳統 A4 表格預覽模式"
              >
                {mobileCardLayout ? <LayoutGrid size={13} /> : <Smartphone size={13} />}
                <span>{mobileCardLayout ? '切換正式表格預覽' : '手機好填模式'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {managersReport.length > 1 && (
              <select
                value={selectedManagerName}
                onChange={e => setSelectedManagerName(e.target.value)}
                className="text-xs font-extrabold text-slate-900 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1.5 outline-none focus:border-blue-500 cursor-pointer"
              >
                {managersReport.map(m => (
                  <option key={m.managerName} value={m.managerName}>
                    {m.managerName}（{m.region} · {m.monthActiveDays}日）
                  </option>
                ))}
              </select>
            )}

            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
              <button
                type="button"
                onClick={() => setScope('month')}
                className={`px-2 py-1 rounded-md text-[11px] font-bold cursor-pointer ${
                  scope === 'month' ? 'bg-blue-600 text-white' : 'text-slate-600'
                }`}
              >
                整月 ({targetMonthKey})
              </button>
              <button
                type="button"
                onClick={() => setScope('day')}
                className={`px-2 py-1 rounded-md text-[11px] font-bold cursor-pointer ${
                  scope === 'day' ? 'bg-blue-600 text-white' : 'text-slate-600'
                }`}
              >
                單日 ({targetDateStr.slice(5)})
              </button>
            </div>

            <div className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-1.5 py-1">
              <button
                type="button"
                onClick={() => handleVehicleSwitch('car')}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-extrabold cursor-pointer ${
                  vehicleType === 'car' ? 'bg-amber-500 text-white' : 'text-amber-900'
                }`}
              >
                <Car size={12} />
                <span>汽車6.5</span>
              </button>
              <button
                type="button"
                onClick={() => handleVehicleSwitch('motorcycle')}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-extrabold cursor-pointer ${
                  vehicleType === 'motorcycle' ? 'bg-amber-500 text-white' : 'text-amber-900'
                }`}
              >
                <Bike size={12} />
                <span>機車3</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleAddRow('油資')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold cursor-pointer"
            >
              <Plus size={13} />
              <span>＋油資</span>
            </button>
            <button
              type="button"
              onClick={() => handleAddRow('高鐵票')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-bold cursor-pointer"
            >
              <Plus size={13} />
              <span>＋高鐵/停車</span>
            </button>
            <button
              type="button"
              onClick={() => syncFromSystemData(true)}
              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 cursor-pointer"
              title="重設為系統原始巡店紀錄"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>

        {/* 主視圖內容區 */}
        <div className="p-2.5 sm:p-5 overflow-auto flex-1">
          {activeViewTab === 'form' ? (
            mobileCardLayout ? (
              /* =================== 手機專屬大觸控卡片填報模式 =================== */
              <div className="max-w-xl mx-auto space-y-3">
                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-2.5">
                  <div className="text-center font-extrabold text-base text-slate-900">
                    東森寵物雲股份有限公司 — 零用金單據黏存單
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-bold text-slate-600">
                      請款人
                      <input
                        type="text"
                        value={applicantName}
                        onChange={e => setApplicantName(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-bold text-slate-900"
                      />
                    </label>
                    <label className="text-xs font-bold text-slate-600">
                      單號 NO.
                      <input
                        type="text"
                        value={formSerialNo}
                        placeholder="選填"
                        onChange={e => handleUpdateFormSerialNo(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-bold text-slate-900"
                      />
                    </label>
                  </div>
                  <label className="block text-xs font-bold text-slate-600">
                    用途說明（自動帶入後方總金額）
                    <input
                      type="text"
                      value={purposePrefix}
                      onChange={e => handleUpdatePurposePrefix(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-bold text-slate-900"
                    />
                  </label>
                  <div className="text-xs font-extrabold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                    完整用途：{fullPurposeText}
                  </div>
                </div>

                {calculated.computedRows.map((row, idx) => (
                  <div
                    key={row.id}
                    className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-2xs space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-xs font-extrabold">
                          #{idx + 1}
                        </span>
                        <input
                          type="text"
                          value={row.shortDate}
                          onChange={e => updateRow(row.id, 'shortDate', e.target.value)}
                          className="w-16 text-center text-sm font-extrabold border border-slate-300 rounded-lg py-1"
                        />
                        <select
                          value={row.itemCategory}
                          onChange={e => updateRow(row.id, 'itemCategory', e.target.value as ExpenseCategoryItem)}
                          className="text-sm font-extrabold bg-slate-50 border border-slate-300 rounded-lg px-2 py-1"
                        >
                          {EXPENSE_ITEM_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(row.id)}
                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <textarea
                      rows={2}
                      value={row.routeTitle}
                      onChange={e => updateRow(row.id, 'routeTitle', e.target.value)}
                      placeholder="店點巡視：門市A.門市B..."
                      className="w-full text-xs sm:text-sm font-medium border border-slate-300 rounded-xl p-2.5 outline-none focus:border-blue-500"
                    />

                    {row.itemCategory === '油資' && (
                      <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-2.5 flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-xs font-extrabold text-blue-900">
                          {row.formulaLine}
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveViewTab('attachments')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold cursor-pointer"
                        >
                          <Camera size={12} />
                          <span>查看 Google Maps 距離圖</span>
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2">
                      {row.itemCategory === '油資' && (
                        <label className="text-[11px] font-bold text-slate-600">
                          公里數 (km)
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={row.actualKm}
                            onChange={e => updateRow(row.id, 'actualKm', Math.max(0, Number(e.target.value) || 0))}
                            className="mt-0.5 w-full rounded-lg border border-blue-300 bg-blue-50/40 px-2 py-1.5 text-sm font-extrabold text-blue-700 tabular-nums"
                          />
                        </label>
                      )}
                      <label className="text-[11px] font-bold text-slate-600">
                        實付金額 ($)
                        <input
                          type="number"
                          min="0"
                          value={row.paidAmount}
                          onChange={e => updateRow(row.id, 'customAmount', Math.max(0, Number(e.target.value) || 0))}
                          className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-extrabold text-emerald-700 tabular-nums"
                        />
                      </label>
                      <label className={`text-[11px] font-bold text-slate-600 ${row.itemCategory === '油資' ? '' : 'col-span-2'}`}>
                        發票號碼
                        <input
                          type="text"
                          value={row.invoiceNumber}
                          placeholder="ET-12345678"
                          onChange={e => updateRow(row.id, 'invoiceNumber', e.target.value)}
                          className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-mono uppercase"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* =================== 1:1 正式《零用金單據黏存單》A4 直式表單 =================== */
              <div className="bg-white border-2 border-slate-900 shadow-lg mx-auto p-4 sm:p-7 max-w-[940px] text-black">
                {/* 抬頭 */}
                <div className="text-center text-2xl font-extrabold tracking-[0.15em] text-black">
                  東森寵物雲股份有限公司
                </div>
                <div className="flex items-end justify-between mt-1 mb-2 text-sm sm:text-base font-extrabold">
                  <span>零用金單據黏存單</span>
                  <div className="flex items-center gap-1">
                    <span>NO.</span>
                    <input
                      type="text"
                      value={formSerialNo}
                      placeholder="____________"
                      onChange={e => handleUpdateFormSerialNo(e.target.value)}
                      className="w-36 border-b border-black text-center font-mono text-sm outline-none bg-transparent focus:bg-blue-50"
                    />
                  </div>
                </div>

                {/* 主表格（含左側直書黏貼欄 + 6 欄明細） */}
                <table className="w-full border-collapse border-2 border-black text-xs sm:text-sm text-black">
                  <thead>
                    {/* 用途說明列 */}
                    <tr>
                      <th
                        colSpan={3}
                        className="border border-black py-2.5 px-2 text-center text-sm sm:text-base font-extrabold tracking-[0.25em] w-[20%] bg-slate-50/70"
                      >
                        用途說明
                      </th>
                      <td colSpan={4} className="border border-black p-1.5">
                        <div className="flex flex-wrap items-center gap-1">
                          <input
                            type="text"
                            value={purposePrefix}
                            onChange={e => handleUpdatePurposePrefix(e.target.value)}
                            className="flex-1 min-w-[260px] font-extrabold text-sm sm:text-base bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1.5 py-0.5 rounded outline-none"
                          />
                          <span className="font-extrabold text-sm sm:text-base text-blue-900 whitespace-nowrap pr-2">
                            ，共 {calculated.grandTotal.toLocaleString('zh-TW')} 元
                          </span>
                        </div>
                      </td>
                    </tr>
                    <tr className="bg-slate-100/80">
                      <th className="border border-black w-[36px]" />
                      <th className="border border-black py-1.5 px-1 text-center font-extrabold w-[6%]">序號</th>
                      <th className="border border-black py-1.5 px-1 text-center font-extrabold w-[9%]">日期</th>
                      <th className="border border-black py-1.5 px-1 text-center font-extrabold w-[10%]">項目</th>
                      <th className="border border-black py-1.5 px-2 text-center font-extrabold">路　　　　　　程</th>
                      <th className="border border-black py-1.5 px-1.5 text-center font-extrabold w-[12%]">金額</th>
                      <th className="border border-black py-1.5 px-1.5 text-center font-extrabold w-[15%]">發票號碼</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculated.computedRows.length === 0 ? (
                      <tr>
                        <td className="border border-black py-8 px-1 text-center align-middle w-[36px]">
                          <div
                            style={{ writingMode: 'vertical-rl' }}
                            className="mx-auto font-extrabold tracking-[0.25em] text-xs select-none"
                          >
                            報銷時請經手人將發票或其他單據黏在此處
                          </div>
                        </td>
                        <td colSpan={6} className="border border-black py-10 text-center text-slate-500">
                          此區間尚無巡店紀錄，可點擊上方「＋油資」或「＋高鐵/停車」新增項目，或切換其他月份／區主管。
                        </td>
                      </tr>
                    ) : (
                      calculated.computedRows.map((row, idx) => (
                        <tr key={row.id} className="hover:bg-blue-50/25 group">
                          {idx === 0 && (
                            <td
                              rowSpan={calculated.computedRows.length + 1}
                              className="border border-black py-4 px-1 text-center align-middle w-[36px] bg-slate-50/40 select-none"
                            >
                              <div
                                style={{ writingMode: 'vertical-rl' }}
                                className="mx-auto font-extrabold tracking-[0.35em] text-xs sm:text-sm leading-relaxed"
                              >
                                報銷時請經手人將發票或其他單據黏在此處
                              </div>
                            </td>
                          )}
                          {/* 序號 */}
                          <td className="border border-black py-1.5 px-1 text-center font-bold tabular-nums">
                            {idx + 1}
                          </td>
                          {/* 日期 MM/DD */}
                          <td className="border border-black p-0.5 text-center">
                            <input
                              type="text"
                              value={row.shortDate}
                              onChange={e => updateRow(row.id, 'shortDate', e.target.value)}
                              className="w-full text-center font-bold bg-transparent hover:bg-blue-50 focus:bg-blue-50 py-1 outline-none rounded tabular-nums"
                            />
                          </td>
                          {/* 項目 */}
                          <td className="border border-black p-0.5 text-center">
                            <select
                              value={row.itemCategory}
                              onChange={e =>
                                updateRow(row.id, 'itemCategory', e.target.value as ExpenseCategoryItem)
                              }
                              className="w-full text-center font-bold bg-transparent hover:bg-blue-50 focus:bg-blue-50 py-1 outline-none rounded cursor-pointer"
                            >
                              {EXPENSE_ITEM_OPTIONS.map(opt => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </td>
                          {/* 路程（第一行店點巡視 + 第二行油資公式連動） */}
                          <td className="border border-black p-1.5 align-middle relative">
                            <input
                              type="text"
                              value={row.routeTitle}
                              onChange={e => updateRow(row.id, 'routeTitle', e.target.value)}
                              className="w-full font-semibold text-xs sm:text-[13px] bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1 py-0.5 outline-none rounded"
                            />
                            {row.itemCategory === '油資' && (
                              <div className="flex flex-wrap items-center justify-between gap-1.5 px-1 mt-0.5">
                                <span className="text-xs sm:text-[13px] font-extrabold text-slate-900">
                                  {row.formulaLine}
                                </span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={row.actualKm}
                                    onChange={e =>
                                      updateRow(row.id, 'actualKm', Math.max(0, Number(e.target.value) || 0))
                                    }
                                    className="w-14 text-right text-xs font-extrabold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1 py-0.5 outline-none tabular-nums"
                                    title="修改公里數（即時連動公式與金額）"
                                  />
                                  <span className="text-[11px] font-bold text-slate-500">km</span>
                                  <button
                                    type="button"
                                    onClick={() => setActiveViewTab('attachments')}
                                    className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white border border-blue-200 transition-colors cursor-pointer"
                                    title="查看此筆點對點真實 Google Maps 距離圖"
                                  >
                                    🗺️ 點對點地圖
                                  </button>
                                </div>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(row.id)}
                              className="opacity-0 group-hover:opacity-100 absolute top-1 right-1 p-1 rounded bg-rose-50 text-rose-500 hover:bg-rose-100 cursor-pointer transition-opacity"
                              title="刪除此列"
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                          {/* 金額 */}
                          <td className="border border-black p-1 text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              <span className="font-bold text-slate-600">$</span>
                              <input
                                type="number"
                                min="0"
                                value={row.paidAmount}
                                onChange={e =>
                                  updateRow(row.id, 'customAmount', Math.max(0, Number(e.target.value) || 0))
                                }
                                className="w-18 text-right font-extrabold text-sm bg-transparent hover:bg-blue-50 focus:bg-blue-50 px-1 py-0.5 outline-none rounded tabular-nums"
                              />
                            </div>
                          </td>
                          {/* 發票號碼 */}
                          <td className="border border-black p-1 text-center">
                            <input
                              type="text"
                              value={row.invoiceNumber}
                              placeholder="ET-00000000"
                              onChange={e => updateRow(row.id, 'invoiceNumber', e.target.value)}
                              className="w-full text-center font-mono text-xs bg-transparent hover:bg-blue-50 focus:bg-blue-50 px-1 py-1 outline-none rounded uppercase"
                            />
                          </td>
                        </tr>
                      ))
                    )}

                    {/* 合計列 */}
                    <tr className="bg-amber-50/70 font-extrabold">
                      <td colSpan={4} className="border border-black py-2 text-center text-sm sm:text-base">
                        合計
                      </td>
                      <td className="border border-black py-2 px-2 text-right text-sm sm:text-base text-blue-900 tabular-nums">
                        ${calculated.grandTotal.toLocaleString('zh-TW')}
                      </td>
                      <td className="border border-black" />
                    </tr>
                  </tbody>
                </table>

                {/* 第三張照片：底部物品費用／進項稅額／實際金額位數格與五級簽核欄 */}
                <table className="w-full border-collapse border-2 border-t-0 border-black text-xs sm:text-sm font-extrabold text-black table-fixed">
                  <tbody>
                    <tr>
                      <td className="border border-black py-1.5 text-center w-[16%] bg-slate-50/70">物 品 費 用</td>
                      <td className="border border-black py-1.5 text-center w-[14%] bg-slate-50/70">金　額</td>
                      <td colSpan={8} className="border border-black py-1.5 px-4 text-right text-base tabular-nums">
                        ${calculated.grandTotal.toLocaleString('zh-TW')}
                      </td>
                    </tr>
                    <tr>
                      <td rowSpan={2} className="border border-black py-1.5 text-center bg-slate-50/70">
                        進 項 稅 額
                      </td>
                      <td className="border border-black py-1 text-center bg-slate-50/70">可 扣 抵</td>
                      <td colSpan={8} className="border border-black" />
                    </tr>
                    <tr>
                      <td className="border border-black py-1 text-center bg-slate-50/70">不 扣 抵</td>
                      <td colSpan={8} className="border border-black" />
                    </tr>
                    <tr>
                      <td rowSpan={2} className="border border-black py-1.5 text-center bg-slate-50/70">
                        實 際 金 額
                      </td>
                      <td className="border border-black py-1 text-center bg-slate-50/70">新台幣</td>
                      {(['千', '百', '十', '萬', '千', '百', '十', '元'] as const).map((unit, uIdx) => (
                        <td key={`u-${uIdx}`} className="border border-black py-1 text-center bg-slate-50/50">
                          {unit}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="border border-black py-1.5 text-center text-xs text-slate-400">$</td>
                      {calculated.digitCells.map((digit, dIdx) => (
                        <td
                          key={`d-${dIdx}`}
                          className="border border-black py-1.5 text-center text-base font-black text-blue-900 tabular-nums"
                        >
                          {digit}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>

                {/* 五級簽核列（留白供紙本手寫簽名） */}
                <div className="grid grid-cols-5 border-2 border-t-0 border-black text-xs sm:text-sm font-extrabold">
                  <div className="border-r border-black p-2 pb-9">總 經 理</div>
                  <div className="border-r border-black p-2 pb-9">副 總 經 理</div>
                  <div className="border-r border-black p-2 pb-9">部 門 主 管</div>
                  <div className="border-r border-black p-2 pb-9">審　　核</div>
                  <div className="p-2 pb-9">請 款 人</div>
                </div>
              </div>
            )
          ) : (
            /* =================== 分頁二：點對點真實 Google Maps 距離圖附件 =================== */
            <div className="max-w-[1180px] mx-auto space-y-3.5">
              {calculated.fuelRows.length === 0 ? (
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
                  目前無「油資」項目明細，請於主表點擊「＋油資」或切換其他月份。
                </div>
              ) : (
                calculated.fuelRows.map((row, idx) => (
                  <ExpenseRouteAttachmentCard
                    key={row.id}
                    index={idx}
                    dateStr={row.dateStr}
                    applicantName={applicantName}
                    region={activeManager?.region || '新北區'}
                    routeSummaryText={`${row.routeTitle} ｜ ${row.formulaLine}`}
                    vehicleType={vehicleType}
                    ratePerKm={ratePerKm}
                    actualKm={row.actualKm}
                    fuelSubsidy={row.paidAmount}
                    evidence={row.evidence}
                    onPreviewImage={setPreviewImageUrl}
                    onUpdateEvidence={patch => updateRowEvidence(row.id, patch)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* 底部狀態列 */}
        <div className="bg-white border-t border-slate-200 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <CheckCircle2 size={14} className="text-emerald-600" />
            <span>
              請款人：<strong>{applicantName}</strong> ｜ 總油資里程：
              <strong>{calculated.totalKm.toFixed(1)} 公里</strong> ｜ 報銷合計：
              <strong className="text-blue-700 text-sm ml-1">
                ${calculated.grandTotal.toLocaleString('zh-TW')} 元
              </strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveViewTab(activeViewTab === 'form' ? 'attachments' : 'form')}
            className="text-blue-600 hover:underline font-extrabold cursor-pointer"
          >
            {activeViewTab === 'form' ? '查看點對點 Google Maps 距離附件 ➔' : '返回零用金單據黏存單主表 ➔'}
          </button>
        </div>
      </div>

      {/* 截圖放大預覽燈箱 */}
      {previewImageUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4"
          onClick={e => {
            e.stopPropagation();
            setPreviewImageUrl(null);
          }}
        >
          <button
            type="button"
            onClick={() => setPreviewImageUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/15 hover:bg-white/25 text-white cursor-pointer"
          >
            <X size={22} />
          </button>
          <img
            src={previewImageUrl}
            alt="放大檢視"
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
