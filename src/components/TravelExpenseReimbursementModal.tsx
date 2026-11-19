import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  ExternalLink,
} from 'lucide-react';
import {
  DEFAULT_SUBSIDY_PER_KM,
  MOTORCYCLE_SUBSIDY_PER_KM,
  type DailyRouteRecord,
  type ManagerExpenseItem,
} from '../utils/mileage-calculator';
import {
  buildGoogleMapsDirectionsUrl,
  formatStopForGoogleMaps,
} from '../utils/road-routing';
import {
  ExpenseRouteAttachmentCard,
  type RouteEvidenceData,
  type VerificationStatus,
} from './ExpenseRouteAttachmentCard';

export type VehicleType = 'car' | 'motorcycle';

interface ExpenseFormRow {
  id: string;
  dateStr: string; // YYYY-MM-DD
  month: string;
  day: string;
  routeAndKmText: string; // 起訖地點說明
  actualKm: number; // 實際公里數（與油資補助即時連動）
  workSummary: string; // 工作記要
  ticketFee: number; // 車(機)票費
  taxiFee: number; // 計程車費
  lodgingFee: number; // 住宿費
  mealMiscFee: number; // 膳雜費
  specialDesc: string; // 特別費/臨時費 過路費/停車費 內容說明
  specialFee: number; // 特別費/臨時費 金額
  receiptCount: number; // 單據張數
  evidence: RouteEvidenceData; // 真實 Google Maps 截圖佐證資料
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
  actualKm?: number;
  durationMin?: number;
  stopLabels?: string[];
  googleScreenshots?: string[];
}

const SCREENSHOT_CACHE_KEY = 'expense_google_screenshots_v1';
const UPPER_DIGITS = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'] as const;

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
    // 超過瀏覽器本機暫存配額時僅保留於記憶體，不影響列印與匯出
  }
};

/**
 * 將金額拆解為國內出差旅費報核單右側直書收據欄之各位數大寫中文（拾萬、萬、仟、佰、拾、元）
 */
const splitAmountToUpperDigits = (amount: number) => {
  const safeVal = Math.max(0, Math.round(amount));
  const padded = String(safeVal).padStart(6, '0').slice(-6);
  const digits = padded.split('').map(ch => UPPER_DIGITS[Number(ch)] || '零');
  return {
    shiWan: safeVal >= 100000 ? digits[0] : '零',
    wan: safeVal >= 10000 ? digits[1] : '零',
    qian: safeVal >= 1000 ? digits[2] : '零',
    bai: safeVal >= 100 ? digits[3] : '零',
    shi: safeVal >= 10 ? digits[4] : '零',
    yuan: digits[5],
  };
};

/**
 * 西元年轉民國年（如 2026 -> 115）
 */
const toRocYear = (yearStr: string): string => {
  const y = Number(yearStr);
  if (!Number.isFinite(y) || y <= 1911) return yearStr;
  return String(y - 1911);
};

/**
 * 依據單日路線紀錄轉成報核單明細列，並合併已暫存之真實 Google Maps 截圖與核定公里數
 */
const buildRowFromDailyRoute = (
  route: DailyRouteRecord,
  idx: number,
  storedMap: Record<string, StoredEvidencePatch>
): ExpenseFormRow => {
  const [, mm = '', dd = ''] = route.dateStr.split('-');
  const routeChain =
    route.legs.length > 0
      ? route.legs
          .map((leg, i) => (i === 0 ? `${leg.fromLabel}→${leg.toLabel}` : leg.toLabel))
          .join('→')
      : route.visitedStores.join('→');

  const workParts: string[] = [];
  if (route.visitedStores.length > 0) {
    workParts.push(`門市巡檢：${route.visitedStores.join('、')}`);
  }
  if (route.scheduleCount > 0) {
    workParts.push(`公務行程 ${route.scheduleCount} 項`);
  }

  const waypoints = route.waypoints || [];
  const defaultStopLabels = waypoints.map(wp => formatStopForGoogleMaps(wp.label, wp));
  const cacheKey = `${route.managerName}_${route.dateStr}`;
  const saved = storedMap[cacheKey];

  const initialScreenshots = Array.isArray(saved?.googleScreenshots) ? saved.googleScreenshots : [];
  const initialKm =
    saved?.actualKm !== undefined && (saved.actualKm > 0 || initialScreenshots.length > 0)
      ? saved.actualKm
      : Number(route.totalKm.toFixed(1));
  const initialStopLabels =
    Array.isArray(saved?.stopLabels) && saved.stopLabels.length > 0
      ? saved.stopLabels
      : defaultStopLabels.length >= 2
      ? defaultStopLabels
      : ['', ''];

  return {
    id: `route-${route.dateStr}-${idx}`,
    dateStr: route.dateStr,
    month: String(Number(mm) || mm),
    day: String(Number(dd) || dd),
    routeAndKmText: routeChain || '轄區門市巡店',
    actualKm: initialKm,
    workSummary: workParts.join('；') || '巡店督導與營運輔導',
    ticketFee: 0,
    taxiFee: 0,
    lodgingFee: 0,
    mealMiscFee: 0,
    specialDesc: '',
    specialFee: 0,
    receiptCount: 0,
    evidence: {
      waypoints,
      stopLabels: initialStopLabels,
      durationMin: saved?.durationMin ?? Math.max(0, Math.round((initialKm / 34) * 60)),
      viaRoad: '',
      verificationStatus: initialScreenshots.length > 0 ? 'google_verified' : 'pending_screenshot',
      googleScreenshots: initialScreenshots,
    },
  };
};

/**
 * HTML 特殊字元轉義（防止列印／匯出 Word 產生標籤注入或版面損壞）
 */
const escapeHtml = (str: string | number | undefined | null): string =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * 東森寵物雲股份有限公司 — 國內出差旅費報核單 ＋ 真實 Google Maps 截圖佐證附件
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
  const [includeAttachmentsInExport, setIncludeAttachmentsInExport] = useState<boolean>(true);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const [selectedManagerName, setSelectedManagerName] = useState<string>(initialManagerName);
  const [scope, setScope] = useState<'month' | 'day'>(initialScope);
  const [vehicleType, setVehicleType] = useState<VehicleType>(
    initialRatePerKm === MOTORCYCLE_SUBSIDY_PER_KM ? 'motorcycle' : 'car'
  );
  const [ratePerKm, setRatePerKm] = useState<number>(initialRatePerKm || DEFAULT_SUBSIDY_PER_KM);

  // 表頭基本欄位（可即時編輯）
  const [applicantName, setApplicantName] = useState<string>('');
  const [jobTitle, setJobTitle] = useState<string>('區主管');
  const [departmentText, setDepartmentText] = useState<string>('');
  const [advancePayment, setAdvancePayment] = useState<string>('');
  const [tripPurpose, setTripPurpose] = useState<string>('');
  const [startDateInput, setStartDateInput] = useState<string>('');
  const [startHour, setStartHour] = useState<string>('09');
  const [endDateInput, setEndDateInput] = useState<string>('');
  const [endHour, setEndHour] = useState<string>('18');

  // 明細列（每列綁定真實 Google Maps 截圖佐證）
  const [rows, setRows] = useState<ExpenseFormRow[]>([]);

  // 支付方式與備註
  const [paymentModeAutoCash, setPaymentModeAutoCash] = useState<boolean>(true);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [creditCardAmount, setCreditCardAmount] = useState<number>(0);
  const [otherPaymentAmount, setOtherPaymentAmount] = useState<number>(0);
  const [paymentNote, setPaymentNote] = useState<string>('');

  // ESC 快捷鍵（若有放大預覽圖先關預覽圖，否則關閉報核單）
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

  // 外部選定主管或單價變更時同步初始化
  useEffect(() => {
    if (!isOpen) return;
    const fallbackMgr = initialManagerName || managersReport[0]?.managerName || '';
    setSelectedManagerName(fallbackMgr);
    setScope(initialScope);
    setRatePerKm(initialRatePerKm || DEFAULT_SUBSIDY_PER_KM);
    setVehicleType(initialRatePerKm === MOTORCYCLE_SUBSIDY_PER_KM ? 'motorcycle' : 'car');
    setActiveViewTab('form');
  }, [isOpen, initialManagerName, initialRatePerKm, initialScope, managersReport]);

  const activeManager = useMemo(
    () => managersReport.find(m => m.managerName === selectedManagerName) || managersReport[0] || null,
    [managersReport, selectedManagerName]
  );

  // 依據主管與統計範圍（全月／單日）重新連動填入表單與已保存之 Google Maps 截圖
  const syncFromSystemData = useCallback(
    (ignoreSavedCache = false) => {
      if (!activeManager) return;
      setApplicantName(activeManager.managerName);
      setJobTitle(activeManager.roleLabel || '區主管');
      setDepartmentText([activeManager.department, activeManager.region].filter(Boolean).join(' '));

      const sourceRoutes: DailyRouteRecord[] =
        scope === 'day'
          ? activeManager.dayRoute
            ? [activeManager.dayRoute]
            : []
          : [...activeManager.monthDailyRoutes].sort((a, b) => a.dateStr.localeCompare(b.dateStr));

      const storedMap = ignoreSavedCache ? {} : loadStoredEvidenceMap();
      const generatedRows = sourceRoutes.map((route, idx) =>
        buildRowFromDailyRoute(route, idx, storedMap)
      );
      setRows(generatedRows);

      const [yStr = '', mStr = ''] = targetMonthKey.split('-');
      const rocY = toRocYear(yStr);
      const periodLabel = scope === 'day' ? targetDateStr : `${rocY}年${Number(mStr)}月`;
      setTripPurpose(`${periodLabel} ${activeManager.region}門市巡店查核與營運輔導`);

      if (sourceRoutes.length > 0) {
        setStartDateInput(sourceRoutes[0].dateStr);
        setEndDateInput(sourceRoutes[sourceRoutes.length - 1].dateStr);
      } else {
        const fallbackDate = scope === 'day' ? targetDateStr : `${targetMonthKey}-01`;
        setStartDateInput(fallbackDate);
        setEndDateInput(fallbackDate);
      }
      setPaymentModeAutoCash(true);
      setCreditCardAmount(0);
      setOtherPaymentAmount(0);
      setAdvancePayment('');
      setPaymentNote('');
    },
    [activeManager, scope, targetMonthKey, targetDateStr]
  );

  useEffect(() => {
    if (isOpen && activeManager) {
      syncFromSystemData(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedManagerName, scope, targetMonthKey, targetDateStr]);

  // 切換汽／機車時同步調整每公里補助單價（汽車 6.5 元、機車 3 元）
  const handleVehicleSwitch = (nextType: VehicleType) => {
    setVehicleType(nextType);
    setRatePerKm(nextType === 'motorcycle' ? MOTORCYCLE_SUBSIDY_PER_KM : DEFAULT_SUBSIDY_PER_KM);
  };

  const updateRow = <K extends keyof ExpenseFormRow>(id: string, key: K, value: ExpenseFormRow[K]) => {
    setRows(prev =>
      prev.map(r => {
        if (r.id !== id) return r;
        const nextRow = { ...r, [key]: value };
        if (key === 'actualKm' && activeManager) {
          saveStoredEvidenceItem(`${activeManager.managerName}_${r.dateStr}`, {
            actualKm: Number(value) || 0,
          });
        }
        return nextRow;
      })
    );
  };

  const updateRowEvidence = (
    id: string,
    patch: {
      actualKm?: number;
      durationMin?: number;
      viaRoad?: string;
      stopLabels?: string[];
      verificationStatus?: VerificationStatus;
      googleScreenshots?: string[];
    }
  ) => {
    setRows(prev =>
      prev.map(r => {
        if (r.id !== id) return r;
        const nextEvidence: RouteEvidenceData = {
          ...r.evidence,
          ...(patch.durationMin !== undefined ? { durationMin: patch.durationMin } : {}),
          ...(patch.viaRoad !== undefined ? { viaRoad: patch.viaRoad } : {}),
          ...(patch.stopLabels !== undefined ? { stopLabels: patch.stopLabels } : {}),
          ...(patch.verificationStatus !== undefined ? { verificationStatus: patch.verificationStatus } : {}),
          ...(patch.googleScreenshots !== undefined ? { googleScreenshots: patch.googleScreenshots } : {}),
        };
        const nextKm = patch.actualKm !== undefined ? patch.actualKm : r.actualKm;
        const nextRouteText =
          patch.stopLabels !== undefined && patch.stopLabels.filter(Boolean).length >= 2
            ? patch.stopLabels.filter(Boolean).join('→')
            : r.routeAndKmText;

        if (activeManager) {
          saveStoredEvidenceItem(`${activeManager.managerName}_${r.dateStr}`, {
            actualKm: nextKm,
            durationMin: nextEvidence.durationMin,
            stopLabels: nextEvidence.stopLabels,
            googleScreenshots: nextEvidence.googleScreenshots,
          });
        }

        return {
          ...r,
          actualKm: nextKm,
          routeAndKmText: nextRouteText,
          evidence: nextEvidence,
        };
      })
    );
  };

  const handleAddRow = () => {
    const [, mm = '', dd = ''] = (endDateInput || targetDateStr).split('-');
    setRows(prev => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        dateStr: endDateInput || targetDateStr,
        month: String(Number(mm) || mm),
        day: String(Number(dd) || dd),
        routeAndKmText: '',
        actualKm: 0,
        workSummary: '',
        ticketFee: 0,
        taxiFee: 0,
        lodgingFee: 0,
        mealMiscFee: 0,
        specialDesc: '',
        specialFee: 0,
        receiptCount: 0,
        evidence: {
          waypoints: [],
          stopLabels: ['', ''],
          durationMin: 0,
          viaRoad: '',
          verificationStatus: 'pending_screenshot',
          googleScreenshots: [],
        },
      },
    ]);
  };

  const handleDeleteRow = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
  };

  // 即時計算各列油資、橫向小計、直向總計與截圖附件完成數
  const calculated = useMemo(() => {
    const computedRows = rows.map(row => {
      const fuelSubsidy = Math.round((Number(row.actualKm) || 0) * ratePerKm);
      const rowTotal =
        (Number(row.ticketFee) || 0) +
        (Number(row.taxiFee) || 0) +
        fuelSubsidy +
        (Number(row.lodgingFee) || 0) +
        (Number(row.mealMiscFee) || 0) +
        (Number(row.specialFee) || 0);
      return { ...row, fuelSubsidy, rowTotal };
    });

    const totals = computedRows.reduce(
      (acc, r) => ({
        actualKm: acc.actualKm + (Number(r.actualKm) || 0),
        ticketFee: acc.ticketFee + (Number(r.ticketFee) || 0),
        taxiFee: acc.taxiFee + (Number(r.taxiFee) || 0),
        fuelSubsidy: acc.fuelSubsidy + r.fuelSubsidy,
        lodgingFee: acc.lodgingFee + (Number(r.lodgingFee) || 0),
        mealMiscFee: acc.mealMiscFee + (Number(r.mealMiscFee) || 0),
        specialFee: acc.specialFee + (Number(r.specialFee) || 0),
        receiptCount: acc.receiptCount + (Number(r.receiptCount) || 0),
        grandTotal: acc.grandTotal + r.rowTotal,
      }),
      {
        actualKm: 0,
        ticketFee: 0,
        taxiFee: 0,
        fuelSubsidy: 0,
        lodgingFee: 0,
        mealMiscFee: 0,
        specialFee: 0,
        receiptCount: 0,
        grandTotal: 0,
      }
    );

    const attachedCount = computedRows.filter(r => r.evidence.googleScreenshots.length > 0).length;
    const totalScreenshotsCount = computedRows.reduce(
      (sum, r) => sum + r.evidence.googleScreenshots.length,
      0
    );
    const upperDigits = splitAmountToUpperDigits(totals.grandTotal);

    return { computedRows, totals, upperDigits, attachedCount, totalScreenshotsCount };
  }, [rows, ratePerKm]);

  const effectiveCashAmount = paymentModeAutoCash
    ? Math.max(0, calculated.totals.grandTotal - creditCardAmount - otherPaymentAmount)
    : cashAmount;

  const dateHeaderInfo = useMemo(() => {
    const parse = (dStr: string) => {
      const [y = '', m = '', d = ''] = (dStr || '').split('-');
      return { rocY: y ? toRocYear(y) : '', m: m ? String(Number(m)) : '', d: d ? String(Number(d)) : '' };
    };
    const s = parse(startDateInput);
    const e = parse(endDateInput);
    return { s, e, daysCount: rows.length };
  }, [startDateInput, endDateInput, rows.length]);

  /**
   * 產生正式 HTML 文件：
   * 第 1 頁：東森寵物雲股份有限公司《國內出差旅費報核單》主表
   * 第 2 頁起：每日【真實 Google Maps 官方截圖】佐證附件頁（原圖高清呈現，絕不使用網頁模擬地圖）
   */
  const buildPrintableDocumentHtml = (forWord = false, withAttachments = true): string => {
    const minDisplayRows = Math.max(5, calculated.computedRows.length);
    const emptyRowsCount = Math.max(0, minDisplayRows - calculated.computedRows.length);
    const totalDataRowSpan = minDisplayRows + 1;
    const rocYearHeader = dateHeaderInfo.s.rocY || toRocYear(targetMonthKey.slice(0, 4));
    const fmtNum = (n: number) => (n > 0 ? Math.round(n).toLocaleString('zh-TW') : '');
    const fmtTotalNum = (n: number) => (n > 0 ? Math.round(n).toLocaleString('zh-TW') : '0');

    const dataRowsHtml = calculated.computedRows
      .map((r, index) => {
        const rightReceiptCell =
          index === 0
            ? `<td rowspan="${totalDataRowSpan}" class="receipt-cell">
                 <div class="receipt-wrap">
                   <div class="v-col">茲收到本人出差旅費共計新台幣</div>
                   <div class="v-col v-amount">
                     <span>${calculated.upperDigits.shiWan}</span>拾
                     <span>${calculated.upperDigits.wan}</span>萬
                     <span>${calculated.upperDigits.qian}</span>仟
                     <span>${calculated.upperDigits.bai}</span>佰
                     <span>${calculated.upperDigits.shi}</span>拾
                     <span>${calculated.upperDigits.yuan}</span>元
                     零角整　此據
                   </div>
                   <div class="v-col v-sign">出差人：　　　　（簽章）</div>
                 </div>
               </td>`
            : '';

        const verifyTag = r.evidence.googleScreenshots.length > 0 ? ' [附GM截圖]' : '';
        const routeDisplay =
          r.actualKm > 0
            ? `${escapeHtml(r.routeAndKmText)}<br/><span class="km-badge">(${r.actualKm.toFixed(1)} 公里${verifyTag})</span>`
            : escapeHtml(r.routeAndKmText);

        return `
          <tr>
            <td class="c-center">${escapeHtml(r.month)}</td>
            <td class="c-center">${escapeHtml(r.day)}</td>
            <td class="c-left route-cell">${routeDisplay}</td>
            <td class="c-left">${escapeHtml(r.workSummary)}</td>
            <td class="c-right">${fmtNum(r.ticketFee)}</td>
            <td class="c-right">${fmtNum(r.taxiFee)}</td>
            <td class="c-right">${fmtNum(r.fuelSubsidy)}</td>
            <td class="c-right">${fmtNum(r.lodgingFee)}</td>
            <td class="c-right">${fmtNum(r.mealMiscFee)}</td>
            <td class="c-left">${escapeHtml(r.specialDesc)}</td>
            <td class="c-right">${fmtNum(r.specialFee)}</td>
            <td class="c-center">${fmtNum(r.receiptCount)}</td>
            <td class="c-right b-bold">${fmtNum(r.rowTotal)}</td>
            ${rightReceiptCell}
          </tr>
        `;
      })
      .join('');

    const emptyRowsHtml = Array.from({ length: emptyRowsCount })
      .map((_, i) => {
        const rightReceiptCell =
          calculated.computedRows.length === 0 && i === 0
            ? `<td rowspan="${totalDataRowSpan}" class="receipt-cell">
                 <div class="receipt-wrap">
                   <div class="v-col">茲收到本人出差旅費共計新台幣</div>
                   <div class="v-col v-amount">
                     <span>零</span>拾<span>零</span>萬<span>零</span>仟<span>零</span>佰<span>零</span>拾<span>零</span>元 零角整 此據
                   </div>
                   <div class="v-col v-sign">出差人：　　　　（簽章）</div>
                 </div>
               </td>`
            : '';
        return `
          <tr class="empty-row">
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
            <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
            ${rightReceiptCell}
          </tr>
        `;
      })
      .join('');

    // 附件頁：直接以滿版高畫質呈現「真實 Google Maps 官方截圖」
    const attachmentsPagesHtml =
      withAttachments && calculated.computedRows.length > 0
        ? calculated.computedRows
            .map((r, idx) => {
              const gUrl = buildGoogleMapsDirectionsUrl(
                r.evidence.waypoints,
                vehicleType,
                r.evidence.stopLabels
              );
              const vehicleText = vehicleType === 'motorcycle' ? '機車（3元/km）' : '汽車（6.5元/km）';
              const shots = r.evidence.googleScreenshots;

              const screenshotsHtml =
                shots.length > 0
                  ? shots
                      .map(
                        (src, sIdx) => `
                          <div class="att-shot-box">
                            <img src="${src}" alt="Google Maps 真實截圖 ${sIdx + 1}" class="att-shot-img" />
                          </div>
                        `
                      )
                      .join('')
                  : `<div class="att-empty-box">
                       <div style="font-size:12pt;font-weight:800;color:#b45309;margin-bottom:6px;">
                         ⚠ 尚未附加本筆日期之真實 Google Maps 官方截圖
                       </div>
                       <div style="font-size:9.5pt;color:#475569;margin-bottom:8px;">
                         請開啟下方 Google Maps 路線連結截圖後，於報核單「附件」分頁按 Ctrl+V 貼上，或列印後黏貼紙本 Google Maps 截圖於此處。
                       </div>
                       <div style="font-size:8.5pt;word-break:break-all;color:#1d4ed8;">
                         ${escapeHtml(gUrl)}
                       </div>
                     </div>`;

              return `
                <div class="att-page">
                  <div class="att-header">
                    <div>
                      <div class="att-title">
                        東森寵物雲股份有限公司 — 國內出差旅費報核單【附件 ${idx + 1}：Google Maps 路線距離佐證】
                      </div>
                      <div class="att-sub">
                        申請人：<strong>${escapeHtml(applicantName)}</strong>（${escapeHtml(departmentText)}）
                        ｜ 出差日期：<strong>${escapeHtml(r.dateStr)}</strong>
                        ｜ 起訖地點：<strong>${escapeHtml(r.routeAndKmText)}</strong>
                      </div>
                    </div>
                    <div class="att-metric">
                      <div>核定距離：<strong>${r.actualKm.toFixed(1)} 公里</strong>${r.evidence.durationMin > 0 ? `（約 ${r.evidence.durationMin} 分）` : ''}</div>
                      <div>油資補助：<strong>NT$ ${r.fuelSubsidy.toLocaleString('zh-TW')}</strong>（${vehicleText}）</div>
                    </div>
                  </div>

                  <div class="${shots.length > 1 ? 'att-grid-2' : 'att-grid-1'}">
                    ${screenshotsHtml}
                  </div>

                  <div class="att-footer">
                    <span>工作記要：${escapeHtml(r.workSummary)}</span>
                    <span>Google Maps 核驗連結：<a href="${escapeHtml(gUrl)}">${escapeHtml(gUrl)}</a></span>
                  </div>
                </div>
              `;
            })
            .join('')
        : '';

    const carCheck = vehicleType === 'car' ? '☑' : '☐';
    const motoCheck = vehicleType === 'motorcycle' ? '☑' : '☐';

    const wordAttrs = forWord
      ? `xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"`
      : '';

    return `<!DOCTYPE html>
<html ${wordAttrs} lang="zh-TW">
<head>
  <meta charset="utf-8" />
  <title>東森寵物雲股份有限公司 國內出差旅費報核單_${escapeHtml(applicantName)}_${escapeHtml(targetMonthKey)}</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 8mm 10mm;
    }
    @page Section1 {
      size: 29.7cm 21.0cm;
      mso-page-orientation: landscape;
      margin: 0.8cm 1.0cm;
    }
    div.Section1 { page: Section1; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      font-family: "DFKai-SB", "BiauKai", "標楷體", "Noto Serif TC", "Microsoft JhengHei", serif;
      color: #000;
      margin: 0;
      padding: 0;
      font-size: 11pt;
      line-height: 1.35;
    }
    .title-company {
      text-align: center;
      font-size: 18pt;
      font-weight: 700;
      letter-spacing: 0.35em;
      margin: 0 0 2px 0;
    }
    .title-form {
      text-align: center;
      font-size: 14pt;
      font-weight: 700;
      letter-spacing: 0.3em;
      margin: 0 0 8px 0;
    }
    table.main-table {
      width: 100%;
      border-collapse: collapse;
      border: 1.8px solid #000;
      table-layout: fixed;
    }
    table.main-table th,
    table.main-table td {
      border: 1px solid #000;
      padding: 4px 5px;
      vertical-align: middle;
      word-break: break-word;
      font-size: 10pt;
    }
    table.main-table th {
      font-weight: 700;
      text-align: center;
      background: #fff;
    }
    .c-center { text-align: center; }
    .c-left { text-align: left; }
    .c-right { text-align: right; font-variant-numeric: tabular-nums; }
    .b-bold { font-weight: 700; }
    .route-cell { font-size: 9pt; line-height: 1.25; }
    .km-badge { font-weight: 700; }
    tr.empty-row td { height: 24px; }
    .receipt-cell {
      width: 11%;
      vertical-align: top !important;
      padding: 6px 4px !important;
    }
    .receipt-wrap {
      display: flex;
      flex-direction: row-reverse;
      justify-content: space-around;
      align-items: stretch;
      height: 100%;
      min-height: 190px;
    }
    .v-col {
      writing-mode: vertical-rl;
      -webkit-writing-mode: vertical-rl;
      text-orientation: upright;
      font-size: 9.5pt;
      letter-spacing: 0.08em;
      line-height: 1.4;
    }
    .v-amount span { font-weight: 700; text-decoration: underline; }
    .v-sign { margin-top: 8px; }
    .notes { margin-top: 6px; font-size: 9.5pt; font-weight: 700; line-height: 1.5; }
    .sign-row {
      margin-top: 12px;
      width: 100%;
      display: table;
      table-layout: fixed;
      font-size: 11pt;
      font-weight: 700;
    }
    .sign-cell { display: table-cell; text-align: left; padding-left: 6px; }

    /* 真實 Google Maps 截圖附件頁樣式 */
    .att-page {
      page-break-before: always;
      break-before: page;
      font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif;
    }
    .att-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 7px;
      margin-bottom: 10px;
      gap: 12px;
    }
    .att-title { font-size: 12.5pt; font-weight: 800; color: #0f172a; }
    .att-sub { font-size: 9pt; color: #334155; margin-top: 3px; }
    .att-metric {
      text-align: right;
      background: #eff6ff;
      border: 1.5px solid #2563eb;
      border-radius: 8px;
      padding: 5px 10px;
      font-size: 9.5pt;
      color: #1e3a8a;
      white-space: nowrap;
    }
    .att-grid-1 { text-align: center; }
    .att-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .att-shot-box {
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: 6px;
      background: #ffffff;
      text-align: center;
    }
    .att-shot-img {
      max-width: 100%;
      max-height: 145mm;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .att-empty-box {
      border: 2px dashed #cbd5e1;
      border-radius: 10px;
      padding: 40px 24px;
      text-align: center;
      background: #f8fafc;
      min-height: 120mm;
    }
    .att-footer {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px dashed #cbd5e1;
      font-size: 8pt;
      color: #475569;
      display: flex;
      flex-direction: column;
      gap: 2px;
      word-break: break-all;
    }
    .att-footer a { color: #1d4ed8; text-decoration: underline; }
  </style>
</head>
<body>
<div class="Section1">
  <div class="title-company">東森寵物雲股份有限公司</div>
  <div class="title-form">國內出差旅費報核單</div>

  <table class="main-table">
    <colgroup>
      <col style="width: 3.5%;" />
      <col style="width: 3.5%;" />
      <col style="width: 17%;" />
      <col style="width: 15%;" />
      <col style="width: 6.5%;" />
      <col style="width: 6.5%;" />
      <col style="width: 7.5%;" />
      <col style="width: 6%;" />
      <col style="width: 6%;" />
      <col style="width: 8%;" />
      <col style="width: 5.5%;" />
      <col style="width: 4%;" />
      <col style="width: 6.5%;" />
      <col style="width: 10.5%;" />
    </colgroup>
    <tbody>
      <tr>
        <th colspan="2">姓　　名</th>
        <td class="c-center b-bold">${escapeHtml(applicantName)}</td>
        <th>職　　別</th>
        <td colspan="2" class="c-center">${escapeHtml(jobTitle)}</td>
        <th colspan="2">服務部門</th>
        <td colspan="2" class="c-center">${escapeHtml(departmentText)}</td>
        <th colspan="2">預借旅費</th>
        <td colspan="2" class="c-right">${advancePayment ? `NT$ ${Number(advancePayment).toLocaleString('zh-TW')}` : ''}</td>
      </tr>
      <tr>
        <th colspan="2">出差事由</th>
        <td colspan="12" class="c-left">${escapeHtml(tripPurpose)}</td>
      </tr>
      <tr>
        <th colspan="2">出差日期</th>
        <td colspan="10" class="c-left">
          中華民國　<strong>${escapeHtml(dateHeaderInfo.s.rocY)}</strong>　年　<strong>${escapeHtml(dateHeaderInfo.s.m)}</strong>　月　<strong>${escapeHtml(dateHeaderInfo.s.d)}</strong>　日　<strong>${escapeHtml(startHour)}</strong>　時起至　<strong>${escapeHtml(dateHeaderInfo.e.rocY)}</strong>　年　<strong>${escapeHtml(dateHeaderInfo.e.m)}</strong>　月　<strong>${escapeHtml(dateHeaderInfo.e.d)}</strong>　日　<strong>${escapeHtml(endHour)}</strong>　時止　共計　<strong>${dateHeaderInfo.daysCount}</strong>　日
        </td>
        <td colspan="2" class="c-center">
          附單據　<strong>${calculated.totals.receiptCount}</strong>　張
        </td>
      </tr>
      <tr>
        <th colspan="2">${escapeHtml(rocYearHeader)} 年</th>
        <th rowspan="2">起 訖 地 點<br/>實際公里數(註1)</th>
        <th rowspan="2">工 作 記 要</th>
        <th colspan="3">交 通 費</th>
        <th colspan="2">日 支 費</th>
        <th colspan="2">特別費/臨時費<br/>過路費/停車費</th>
        <th rowspan="2">單據<br/>張數</th>
        <th rowspan="2">總　計</th>
        <th rowspan="2" style="border-bottom: none; font-size: 9pt;">收據簽收欄</th>
      </tr>
      <tr>
        <th>月</th>
        <th>日</th>
        <th>車(機)票費</th>
        <th>計程車費</th>
        <th style="font-size: 8.5pt; line-height: 1.2;">
          油資補助<br/>${carCheck} 汽 車<br/>${motoCheck} 機 車<br/>(註2)
        </th>
        <th>住宿費</th>
        <th>膳雜費</th>
        <th>內容說明</th>
        <th>金額</th>
      </tr>

      ${dataRowsHtml}
      ${emptyRowsHtml}

      <tr class="b-bold">
        <th colspan="3">合　　　計（總里程 ${calculated.totals.actualKm.toFixed(1)} km）</th>
        <td class="c-center">共 ${calculated.computedRows.length} 筆行程</td>
        <td class="c-right">${fmtTotalNum(calculated.totals.ticketFee)}</td>
        <td class="c-right">${fmtTotalNum(calculated.totals.taxiFee)}</td>
        <td class="c-right">${fmtTotalNum(calculated.totals.fuelSubsidy)}</td>
        <td class="c-right">${fmtTotalNum(calculated.totals.lodgingFee)}</td>
        <td class="c-right">${fmtTotalNum(calculated.totals.mealMiscFee)}</td>
        <td></td>
        <td class="c-right">${fmtTotalNum(calculated.totals.specialFee)}</td>
        <td class="c-center">${calculated.totals.receiptCount}</td>
        <td class="c-right">${fmtTotalNum(calculated.totals.grandTotal)}</td>
      </tr>

      <tr>
        <th colspan="3" rowspan="2">支付方式及金額</th>
        <th>現金支付</th>
        <th colspan="2">信用卡</th>
        <th colspan="2">其他</th>
        <th colspan="5">備　　　　　　　　註</th>
        <td rowspan="2"></td>
      </tr>
      <tr>
        <td class="c-right b-bold">${fmtNum(effectiveCashAmount)}</td>
        <td colspan="2" class="c-right">${fmtNum(creditCardAmount)}</td>
        <td colspan="2" class="c-right">${fmtNum(otherPaymentAmount)}</td>
        <td colspan="5" class="c-left">${escapeHtml(paymentNote)}</td>
      </tr>
    </tbody>
  </table>

  <div class="notes">
    註1：駕駛自用汽、機車出差者，請註明往返目的地之實際公里數。<br/>
    註2：汽車每公里補助<u>6.5</u>元，機車每公里補助<u>3</u>元（本次計價基準：${vehicleType === 'motorcycle' ? '機車' : '汽車'} ${ratePerKm} 元／公里${withAttachments ? '，另檢附 Google Maps 距離佐證截圖附件共 ' + calculated.computedRows.length + ' 頁' : ''}）
  </div>

  <div class="sign-row">
    <div class="sign-cell">董事長</div>
    <div class="sign-cell">總經理</div>
    <div class="sign-cell">副總經理</div>
    <div class="sign-cell">會計處</div>
    <div class="sign-cell">管理部</div>
    <div class="sign-cell">部門主管</div>
    <div class="sign-cell">申請人</div>
  </div>

  ${attachmentsPagesHtml}
</div>
</body>
</html>`;
  };

  /**
   * 開啟 A4 橫式列印／另存 PDF 視窗（等待全部真實截圖載入後再啟動列印）
   */
  const handlePrintPdf = () => {
    const html = buildPrintableDocumentHtml(false, includeAttachmentsInExport);
    const printWin = window.open('', '_blank', 'width=1260,height=880');
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
        setTimeout(() => printWin.print(), 180);
      };
      const timer = setTimeout(done, 3500);
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

    setTimeout(triggerPrintWhenReady, 200);
  };

  /**
   * 匯出 Word (.doc)，內嵌完整真實 Google Maps 官方截圖原圖
   */
  const handleExportWord = () => {
    const html = buildPrintableDocumentHtml(true, includeAttachmentsInExport);
    const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `東森寵物雲_國內出差旅費報核單含GoogleMaps截圖_${applicantName || '區主管'}_${targetMonthKey}.doc`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  const rocYearHeader = dateHeaderInfo.s.rocY || toRocYear(targetMonthKey.slice(0, 4));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-slate-100 rounded-2xl w-full max-w-[1400px] max-h-[95vh] flex flex-col shadow-2xl border border-slate-300 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 頂部系統連動控制列 */}
        <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-400 text-slate-950">
              系統自動連動
            </span>
            <h2 className="text-sm sm:text-base font-extrabold tracking-wide">
              東森寵物雲股份有限公司 — 國內出差旅費報核單＆真實 Google Maps 截圖附件
            </h2>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <label className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-200 bg-white/10 border border-white/15 px-2.5 py-1.5 rounded-xl cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeAttachmentsInExport}
                onChange={e => setIncludeAttachmentsInExport(e.target.checked)}
                className="rounded text-amber-400 focus:ring-0 cursor-pointer"
              />
              <span>含真實截圖附件 ({calculated.attachedCount}/{rows.length})</span>
            </label>

            <button
              type="button"
              onClick={handlePrintPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold shadow-xs cursor-pointer transition-colors"
            >
              <Printer size={14} />
              <span>列印 / 另存 A4 PDF</span>
            </button>
            <button
              type="button"
              onClick={handleExportWord}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-xs cursor-pointer transition-colors"
            >
              <FileText size={14} />
              <span>匯出 Word (.doc)</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              title="關閉視窗 (Esc)"
              aria-label="關閉報核單"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 主表 / 附件雙分頁切換 ＋ 快速控制列 */}
        <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
            <button
              type="button"
              onClick={() => setActiveViewTab('form')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all ${
                activeViewTab === 'form'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileSpreadsheet size={14} />
              <span>主表：國內出差旅費報核單</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveViewTab('attachments')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-all ${
                activeViewTab === 'attachments'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-blue-700 hover:bg-blue-50'
              }`}
            >
              <Camera size={14} />
              <span>附件：真實 Google Maps 距離截圖</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  activeViewTab === 'attachments'
                    ? 'bg-white/25 text-white'
                    : calculated.attachedCount === rows.length && rows.length > 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {calculated.attachedCount}/{rows.length}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedManagerName}
              onChange={e => setSelectedManagerName(e.target.value)}
              className="text-xs font-extrabold text-slate-900 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 cursor-pointer"
            >
              {managersReport.map(m => (
                <option key={m.managerName} value={m.managerName}>
                  {m.managerName}（{m.region} · {m.monthActiveDays} 日）
                </option>
              ))}
            </select>

            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
              <button
                type="button"
                onClick={() => setScope('month')}
                className={`px-2 py-1 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                  scope === 'month' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                整月 ({targetMonthKey})
              </button>
              <button
                type="button"
                onClick={() => setScope('day')}
                className={`px-2 py-1 rounded-md text-[11px] font-bold cursor-pointer transition-colors ${
                  scope === 'day' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:text-slate-900'
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
                  vehicleType === 'car' ? 'bg-amber-500 text-white' : 'text-amber-900 hover:bg-amber-100'
                }`}
              >
                <Car size={12} />
                <span>汽車6.5</span>
              </button>
              <button
                type="button"
                onClick={() => handleVehicleSwitch('motorcycle')}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-extrabold cursor-pointer ${
                  vehicleType === 'motorcycle' ? 'bg-amber-500 text-white' : 'text-amber-900 hover:bg-amber-100'
                }`}
              >
                <Bike size={12} />
                <span>機車3</span>
              </button>
              <input
                type="number"
                step="0.5"
                min="0"
                value={ratePerKm}
                onChange={e => setRatePerKm(Math.max(0, Number(e.target.value) || 0))}
                className="w-11 text-center text-[11px] font-black text-amber-900 bg-white border border-amber-300 rounded px-1 py-0.5 outline-none"
                title="自訂每公里補助單價"
              />
            </div>

            <button
              type="button"
              onClick={handleAddRow}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold cursor-pointer"
            >
              <Plus size={13} />
              <span>新增列</span>
            </button>
            <button
              type="button"
              onClick={() => syncFromSystemData(true)}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-bold cursor-pointer"
              title="重設為系統原始巡店紀錄（清除本機暫存公里數與截圖）"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        </div>

        {/* 主視圖切換區 */}
        <div className="p-3 sm:p-5 overflow-auto flex-1">
          {activeViewTab === 'form' ? (
            /* =================== 分頁一：正式報核單主表 =================== */
            <div
              className="bg-white border-2 border-slate-800 shadow-lg mx-auto p-4 sm:p-6 min-w-[1060px]"
              style={{ fontFamily: '"DFKai-SB", "BiauKai", "標楷體", "Noto Serif TC", "Microsoft JhengHei", serif' }}
            >
              <div className="text-center mb-3">
                <div className="text-2xl font-bold tracking-[0.35em] text-black">
                  東森寵物雲股份有限公司
                </div>
                <div className="text-lg font-bold tracking-[0.3em] text-black mt-0.5">
                  國內出差旅費報核單
                </div>
              </div>

              <table className="w-full border-collapse border-2 border-black text-xs text-black">
                <tbody>
                  <tr>
                    <th colSpan={2} className="border border-black bg-slate-50/70 py-1.5 px-2 text-center font-bold w-[7%]">
                      姓　名
                    </th>
                    <td className="border border-black p-1 w-[16%]">
                      <input
                        type="text"
                        value={applicantName}
                        onChange={e => setApplicantName(e.target.value)}
                        className="w-full text-center font-bold bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1 py-0.5 outline-none rounded"
                      />
                    </td>
                    <th className="border border-black bg-slate-50/70 py-1.5 px-2 text-center font-bold w-[14%]">
                      職　　別
                    </th>
                    <td colSpan={2} className="border border-black p-1 w-[13%]">
                      <input
                        type="text"
                        value={jobTitle}
                        onChange={e => setJobTitle(e.target.value)}
                        className="w-full text-center bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1 py-0.5 outline-none rounded"
                      />
                    </td>
                    <th colSpan={2} className="border border-black bg-slate-50/70 py-1.5 px-2 text-center font-bold w-[13%]">
                      服務部門
                    </th>
                    <td colSpan={2} className="border border-black p-1 w-[14%]">
                      <input
                        type="text"
                        value={departmentText}
                        onChange={e => setDepartmentText(e.target.value)}
                        className="w-full text-center bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1 py-0.5 outline-none rounded"
                      />
                    </td>
                    <th colSpan={2} className="border border-black bg-slate-50/70 py-1.5 px-2 text-center font-bold w-[10%]">
                      預借旅費
                    </th>
                    <td colSpan={2} className="border border-black p-1 w-[13%]">
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={advancePayment}
                        onChange={e => setAdvancePayment(e.target.value)}
                        className="w-full text-right bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1.5 py-0.5 outline-none rounded tabular-nums"
                      />
                    </td>
                  </tr>

                  <tr>
                    <th colSpan={2} className="border border-black bg-slate-50/70 py-1.5 px-2 text-center font-bold">
                      出差事由
                    </th>
                    <td colSpan={12} className="border border-black p-1">
                      <input
                        type="text"
                        value={tripPurpose}
                        onChange={e => setTripPurpose(e.target.value)}
                        className="w-full text-left bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-2 py-0.5 outline-none rounded"
                      />
                    </td>
                  </tr>

                  <tr>
                    <th colSpan={2} className="border border-black bg-slate-50/70 py-1.5 px-2 text-center font-bold">
                      出差日期
                    </th>
                    <td colSpan={10} className="border border-black py-1.5 px-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span>中華民國</span>
                        <input
                          type="date"
                          value={startDateInput}
                          onChange={e => setStartDateInput(e.target.value)}
                          className="border border-slate-300 rounded px-1.5 py-0.5 bg-blue-50/40 font-sans text-[11px] font-bold"
                        />
                        <span className="font-bold text-blue-800">
                          （{dateHeaderInfo.s.rocY || '___'}年{dateHeaderInfo.s.m || '__'}月{dateHeaderInfo.s.d || '__'}日）
                        </span>
                        <input
                          type="text"
                          value={startHour}
                          onChange={e => setStartHour(e.target.value)}
                          className="w-8 text-center border-b border-black bg-transparent font-bold outline-none"
                        />
                        <span>時起至</span>
                        <input
                          type="date"
                          value={endDateInput}
                          onChange={e => setEndDateInput(e.target.value)}
                          className="border border-slate-300 rounded px-1.5 py-0.5 bg-blue-50/40 font-sans text-[11px] font-bold"
                        />
                        <span className="font-bold text-blue-800">
                          （{dateHeaderInfo.e.rocY || '___'}年{dateHeaderInfo.e.m || '__'}月{dateHeaderInfo.e.d || '__'}日）
                        </span>
                        <input
                          type="text"
                          value={endHour}
                          onChange={e => setEndHour(e.target.value)}
                          className="w-8 text-center border-b border-black bg-transparent font-bold outline-none"
                        />
                        <span>時止　共計</span>
                        <strong className="text-blue-700 px-1">{dateHeaderInfo.daysCount}</strong>
                        <span>日</span>
                      </div>
                    </td>
                    <td colSpan={2} className="border border-black py-1.5 px-2 text-center">
                      附單據 <strong className="text-blue-700 text-sm px-1">{calculated.totals.receiptCount}</strong> 張
                    </td>
                  </tr>

                  <tr className="bg-slate-50/80">
                    <th colSpan={2} className="border border-black py-1 text-center font-bold">
                      {rocYearHeader} 年
                    </th>
                    <th rowSpan={2} className="border border-black py-1 px-1.5 text-center font-bold">
                      起 訖 地 點<br />實際公里數(註1)
                    </th>
                    <th rowSpan={2} className="border border-black py-1 px-1.5 text-center font-bold">
                      工 作 記 要
                    </th>
                    <th colSpan={3} className="border border-black py-1 text-center font-bold">
                      交 通 費
                    </th>
                    <th colSpan={2} className="border border-black py-1 text-center font-bold">
                      日 支 費
                    </th>
                    <th colSpan={2} className="border border-black py-1 text-center font-bold">
                      特別費/臨時費<br />過路費/停車費
                    </th>
                    <th rowSpan={2} className="border border-black py-1 px-1 text-center font-bold w-[4.5%]">
                      單據<br />張數
                    </th>
                    <th rowSpan={2} className="border border-black py-1 px-1 text-center font-bold w-[7%]">
                      總　計
                    </th>
                    <th rowSpan={2} className="border border-black py-1 px-1 text-center font-bold w-[10.5%]">
                      收據簽收欄
                    </th>
                  </tr>
                  <tr className="bg-slate-50/80">
                    <th className="border border-black py-1 text-center font-bold w-[3.5%]">月</th>
                    <th className="border border-black py-1 text-center font-bold w-[3.5%]">日</th>
                    <th className="border border-black py-1 px-1 text-center font-bold w-[6%]">車(機)票費</th>
                    <th className="border border-black py-1 px-1 text-center font-bold w-[6%]">計程車費</th>
                    <th className="border border-black py-1 px-1 text-center font-bold w-[7.5%] leading-tight">
                      <div>油資補助</div>
                      <div className="text-[11px] font-normal mt-0.5">
                        <span onClick={() => handleVehicleSwitch('car')} className="cursor-pointer hover:text-blue-700 block">
                          {vehicleType === 'car' ? '☑' : '☐'} 汽 車
                        </span>
                        <span onClick={() => handleVehicleSwitch('motorcycle')} className="cursor-pointer hover:text-blue-700 block">
                          {vehicleType === 'motorcycle' ? '☑' : '☐'} 機 車
                        </span>
                      </div>
                      <div className="text-[10px]">(註2)</div>
                    </th>
                    <th className="border border-black py-1 px-1 text-center font-bold w-[5.5%]">住宿費</th>
                    <th className="border border-black py-1 px-1 text-center font-bold w-[5.5%]">膳雜費</th>
                    <th className="border border-black py-1 px-1 text-center font-bold w-[8%]">內容說明</th>
                    <th className="border border-black py-1 px-1 text-center font-bold w-[5.5%]">金額</th>
                  </tr>

                  {calculated.computedRows.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="border border-black py-8 text-center text-slate-500 font-sans">
                        此區間尚無巡店里程紀錄，可點擊上方「新增列」手動補填出差明細，或切換其他月份／主管。
                      </td>
                      <td rowSpan={2} className="border border-black align-top p-2 bg-amber-50/20">
                        <div className="flex flex-row-reverse justify-around items-stretch min-h-[170px] text-[11px]">
                          <div style={{ writingMode: 'vertical-rl' }}>茲收到本人出差旅費共計新台幣</div>
                          <div style={{ writingMode: 'vertical-rl' }}>零拾零萬零仟零佰零拾零元 零角整 此據</div>
                          <div style={{ writingMode: 'vertical-rl' }}>出差人：（簽章）</div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    calculated.computedRows.map((row, idx) => {
                      const hasShot = row.evidence.googleScreenshots.length > 0;
                      return (
                        <tr key={row.id} className="hover:bg-blue-50/30 transition-colors group">
                          <td className="border border-black p-0.5 text-center">
                            <input
                              type="text"
                              value={row.month}
                              onChange={e => updateRow(row.id, 'month', e.target.value)}
                              className="w-full text-center bg-transparent outline-none"
                            />
                          </td>
                          <td className="border border-black p-0.5 text-center">
                            <input
                              type="text"
                              value={row.day}
                              onChange={e => updateRow(row.id, 'day', e.target.value)}
                              className="w-full text-center bg-transparent outline-none"
                            />
                          </td>
                          <td className="border border-black p-1 align-top">
                            <textarea
                              rows={2}
                              value={row.routeAndKmText}
                              onChange={e => updateRow(row.id, 'routeAndKmText', e.target.value)}
                              className="w-full text-[11px] leading-snug bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 outline-none resize-none rounded px-1"
                            />
                            <div className="flex items-center justify-between gap-1 mt-0.5 pt-0.5 border-t border-dashed border-slate-200 font-sans">
                              <button
                                type="button"
                                onClick={() => setActiveViewTab('attachments')}
                                className={`text-[9.5px] px-1.5 py-0.5 rounded font-bold cursor-pointer border ${
                                  hasShot
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                                }`}
                                title="點此前往附件頁貼上或檢視真實 Google Maps 截圖"
                              >
                                {hasShot ? `✓ 已附截圖(${row.evidence.googleScreenshots.length})` : '📸 補附GM截圖'}
                              </button>
                              <div className="flex items-center gap-0.5">
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  value={row.actualKm}
                                  onChange={e => updateRow(row.id, 'actualKm', Math.max(0, Number(e.target.value) || 0))}
                                  className="w-13 text-right text-[11px] font-extrabold text-blue-700 bg-blue-50/60 border border-blue-200 rounded px-1 py-0.5 outline-none tabular-nums"
                                />
                                <span className="text-[10px] font-bold text-slate-600">km</span>
                              </div>
                            </div>
                          </td>
                          <td className="border border-black p-1 align-top relative">
                            <textarea
                              rows={3}
                              value={row.workSummary}
                              onChange={e => updateRow(row.id, 'workSummary', e.target.value)}
                              className="w-full text-[11px] leading-snug bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 outline-none resize-none rounded px-1"
                            />
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(row.id)}
                              className="opacity-0 group-hover:opacity-100 absolute top-1 right-1 p-0.5 rounded bg-rose-50 text-rose-500 hover:bg-rose-100 cursor-pointer transition-opacity"
                              title="刪除此列"
                            >
                              <Trash2 size={11} />
                            </button>
                          </td>
                          <td className="border border-black p-0.5">
                            <input
                              type="number"
                              min="0"
                              value={row.ticketFee || ''}
                              placeholder="-"
                              onChange={e => updateRow(row.id, 'ticketFee', Math.max(0, Number(e.target.value) || 0))}
                              className="w-full text-right bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1 py-1 outline-none tabular-nums font-sans"
                            />
                          </td>
                          <td className="border border-black p-0.5">
                            <input
                              type="number"
                              min="0"
                              value={row.taxiFee || ''}
                              placeholder="-"
                              onChange={e => updateRow(row.id, 'taxiFee', Math.max(0, Number(e.target.value) || 0))}
                              className="w-full text-right bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1 py-1 outline-none tabular-nums font-sans"
                            />
                          </td>
                          <td className="border border-black px-1.5 py-1 text-right font-bold text-emerald-700 bg-emerald-50/40 tabular-nums font-sans">
                            {row.fuelSubsidy > 0 ? row.fuelSubsidy.toLocaleString('zh-TW') : '-'}
                          </td>
                          <td className="border border-black p-0.5">
                            <input
                              type="number"
                              min="0"
                              value={row.lodgingFee || ''}
                              placeholder="-"
                              onChange={e => updateRow(row.id, 'lodgingFee', Math.max(0, Number(e.target.value) || 0))}
                              className="w-full text-right bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1 py-1 outline-none tabular-nums font-sans"
                            />
                          </td>
                          <td className="border border-black p-0.5">
                            <input
                              type="number"
                              min="0"
                              value={row.mealMiscFee || ''}
                              placeholder="-"
                              onChange={e => updateRow(row.id, 'mealMiscFee', Math.max(0, Number(e.target.value) || 0))}
                              className="w-full text-right bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1 py-1 outline-none tabular-nums font-sans"
                            />
                          </td>
                          <td className="border border-black p-0.5">
                            <input
                              type="text"
                              value={row.specialDesc}
                              placeholder="過路/停車"
                              onChange={e => updateRow(row.id, 'specialDesc', e.target.value)}
                              className="w-full text-left text-[11px] bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1 py-1 outline-none"
                            />
                          </td>
                          <td className="border border-black p-0.5">
                            <input
                              type="number"
                              min="0"
                              value={row.specialFee || ''}
                              placeholder="-"
                              onChange={e => updateRow(row.id, 'specialFee', Math.max(0, Number(e.target.value) || 0))}
                              className="w-full text-right bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1 py-1 outline-none tabular-nums font-sans"
                            />
                          </td>
                          <td className="border border-black p-0.5">
                            <input
                              type="number"
                              min="0"
                              value={row.receiptCount || ''}
                              placeholder="0"
                              onChange={e => updateRow(row.id, 'receiptCount', Math.max(0, Math.round(Number(e.target.value) || 0)))}
                              className="w-full text-center bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1 py-1 outline-none tabular-nums font-sans"
                            />
                          </td>
                          <td className="border border-black px-1.5 py-1 text-right font-black text-slate-900 bg-slate-50/70 tabular-nums font-sans">
                            {row.rowTotal.toLocaleString('zh-TW')}
                          </td>

                          {idx === 0 && (
                            <td rowSpan={calculated.computedRows.length + 1} className="border border-black align-top p-2 bg-amber-50/20">
                              <div className="flex flex-row-reverse justify-around items-stretch min-h-[210px] text-[12px] leading-snug select-none">
                                <div style={{ writingMode: 'vertical-rl' }} className="tracking-widest">
                                  茲收到本人出差旅費共計新台幣
                                </div>
                                <div style={{ writingMode: 'vertical-rl' }} className="tracking-widest">
                                  <strong className="text-blue-800 underline">{calculated.upperDigits.shiWan}</strong>拾
                                  <strong className="text-blue-800 underline">{calculated.upperDigits.wan}</strong>萬
                                  <strong className="text-blue-800 underline">{calculated.upperDigits.qian}</strong>仟
                                  <strong className="text-blue-800 underline">{calculated.upperDigits.bai}</strong>佰
                                  <strong className="text-blue-800 underline">{calculated.upperDigits.shi}</strong>拾
                                  <strong className="text-blue-800 underline">{calculated.upperDigits.yuan}</strong>元
                                  零角整　此據
                                </div>
                                <div style={{ writingMode: 'vertical-rl' }} className="tracking-widest">
                                  出差人：　　　（簽章）
                                </div>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}

                  <tr className="bg-amber-50/70 font-bold">
                    <th colSpan={3} className="border border-black py-2 px-2 text-center">
                      合　　計（總里程 <span className="text-blue-700 font-sans">{calculated.totals.actualKm.toFixed(1)}</span> km）
                    </th>
                    <td className="border border-black py-2 px-2 text-center font-sans text-[11px] text-slate-600">
                      共 {calculated.computedRows.length} 日出差紀錄
                    </td>
                    <td className="border border-black py-2 px-1.5 text-right tabular-nums font-sans">
                      {calculated.totals.ticketFee.toLocaleString('zh-TW')}
                    </td>
                    <td className="border border-black py-2 px-1.5 text-right tabular-nums font-sans">
                      {calculated.totals.taxiFee.toLocaleString('zh-TW')}
                    </td>
                    <td className="border border-black py-2 px-1.5 text-right tabular-nums font-sans text-emerald-800">
                      {calculated.totals.fuelSubsidy.toLocaleString('zh-TW')}
                    </td>
                    <td className="border border-black py-2 px-1.5 text-right tabular-nums font-sans">
                      {calculated.totals.lodgingFee.toLocaleString('zh-TW')}
                    </td>
                    <td className="border border-black py-2 px-1.5 text-right tabular-nums font-sans">
                      {calculated.totals.mealMiscFee.toLocaleString('zh-TW')}
                    </td>
                    <td className="border border-black" />
                    <td className="border border-black py-2 px-1.5 text-right tabular-nums font-sans">
                      {calculated.totals.specialFee.toLocaleString('zh-TW')}
                    </td>
                    <td className="border border-black py-2 px-1 text-center tabular-nums font-sans">
                      {calculated.totals.receiptCount}
                    </td>
                    <td className="border border-black py-2 px-1.5 text-right tabular-nums font-sans text-base text-blue-800">
                      {calculated.totals.grandTotal.toLocaleString('zh-TW')}
                    </td>
                  </tr>

                  <tr>
                    <th colSpan={3} rowSpan={2} className="border border-black bg-slate-50/70 py-2 text-center font-bold">
                      支付方式及金額
                    </th>
                    <th className="border border-black bg-slate-50/70 py-1 text-center font-bold">現金支付</th>
                    <th colSpan={2} className="border border-black bg-slate-50/70 py-1 text-center font-bold">信用卡</th>
                    <th colSpan={2} className="border border-black bg-slate-50/70 py-1 text-center font-bold">其他</th>
                    <th colSpan={5} className="border border-black bg-slate-50/70 py-1 text-center font-bold">
                      備　　　　　　註
                    </th>
                    <td rowSpan={2} className="border border-black bg-slate-50/30" />
                  </tr>
                  <tr>
                    <td className="border border-black p-1">
                      <input
                        type="number"
                        min="0"
                        value={effectiveCashAmount}
                        onChange={e => {
                          setPaymentModeAutoCash(false);
                          setCashAmount(Math.max(0, Number(e.target.value) || 0));
                        }}
                        className="w-full text-right font-bold text-blue-700 bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1.5 py-0.5 outline-none tabular-nums font-sans"
                      />
                    </td>
                    <td colSpan={2} className="border border-black p-1">
                      <input
                        type="number"
                        min="0"
                        value={creditCardAmount || ''}
                        placeholder="0"
                        onChange={e => setCreditCardAmount(Math.max(0, Number(e.target.value) || 0))}
                        className="w-full text-right bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1.5 py-0.5 outline-none tabular-nums font-sans"
                      />
                    </td>
                    <td colSpan={2} className="border border-black p-1">
                      <input
                        type="number"
                        min="0"
                        value={otherPaymentAmount || ''}
                        placeholder="0"
                        onChange={e => setOtherPaymentAmount(Math.max(0, Number(e.target.value) || 0))}
                        className="w-full text-right bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-1.5 py-0.5 outline-none tabular-nums font-sans"
                      />
                    </td>
                    <td colSpan={5} className="border border-black p-1">
                      <input
                        type="text"
                        value={paymentNote}
                        placeholder="可填寫匯款帳號、核銷備註或補充說明..."
                        onChange={e => setPaymentNote(e.target.value)}
                        className="w-full text-left bg-transparent hover:bg-blue-50/60 focus:bg-blue-50 px-2 py-0.5 outline-none"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-2.5 text-xs font-bold leading-relaxed text-black">
                <div>註1：駕駛自用汽、機車出差者，請註明往返目的地之實際公里數。</div>
                <div>
                  註2：汽車每公里補助<span className="underline">6.5</span>元，機車每公里補助<span className="underline">3</span>元
                </div>
              </div>

              <div className="mt-4 pt-2 grid grid-cols-7 gap-2 text-sm font-bold text-black">
                <div>董事長</div>
                <div>總經理</div>
                <div>副總經理</div>
                <div>會計處</div>
                <div>管理部</div>
                <div>部門主管</div>
                <div>申請人</div>
              </div>
            </div>
          ) : (
            /* =================== 分頁二：極簡附件截圖區 =================== */
            <div className="max-w-[1160px] mx-auto space-y-3">
              {calculated.computedRows.length === 0 ? (
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
                  目前尚無出差明細，請先切換其他月份或點擊上方「新增列」。
                </div>
              ) : (
                calculated.computedRows.map((row, idx) => (
                  <ExpenseRouteAttachmentCard
                    key={row.id}
                    index={idx}
                    dateStr={row.dateStr}
                    applicantName={applicantName}
                    routeSummaryText={row.routeAndKmText}
                    vehicleType={vehicleType}
                    ratePerKm={ratePerKm}
                    actualKm={row.actualKm}
                    fuelSubsidy={row.fuelSubsidy}
                    evidence={row.evidence}
                    onPreviewImage={setPreviewImageUrl}
                    onUpdateEvidence={patch => updateRowEvidence(row.id, patch)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* 底部狀態提示列 */}
        <div className="bg-white border-t border-slate-200 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <CheckCircle2 size={14} className="text-emerald-600" />
            <span>
              已連動 <strong>{applicantName}</strong> 巡店里程（共 <strong>{calculated.totals.actualKm.toFixed(1)} 公里</strong>），報核總金額：
              <strong className="text-blue-700 text-sm ml-1">
                NT$ {calculated.totals.grandTotal.toLocaleString('zh-TW')}
              </strong>
            </span>
            <button
              type="button"
              onClick={() => setActiveViewTab(activeViewTab === 'form' ? 'attachments' : 'form')}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline font-bold cursor-pointer ml-1"
            >
              <ExternalLink size={12} />
              <span>{activeViewTab === 'form' ? '前往補附真實 Google Maps 截圖 ➔' : '返回報核單主表 ➔'}</span>
            </button>
          </div>
          <span className="text-[11px] text-slate-400">
            所有貼上的真實 Google Maps 截圖與公里數會自動暫存于本機，列印 PDF／匯出 Word 將直接附帶原圖
          </span>
        </div>
      </div>

      {/* 真實截圖放大預覽燈箱 */}
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
            title="關閉預覽 (Esc)"
          >
            <X size={22} />
          </button>
          <img
            src={previewImageUrl}
            alt="Google Maps 官方截圖放大檢視"
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
