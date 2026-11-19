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
  Map as MapIcon,
  FileSpreadsheet,
  RefreshCw,
  Loader2,
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
  buildPrintableRouteMapHtml,
  fetchRealRoadRoute,
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
  evidence: RouteEvidenceData; // 每日路線與 Google Maps 距離驗證附件資料
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

const UPPER_DIGITS = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'] as const;

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
 * 依據單日路線紀錄轉成報核單預設明細列（附帶完整站點座標與 Google Maps 距離驗證連結）
 */
const buildRowFromDailyRoute = (
  route: DailyRouteRecord,
  idx: number,
  vehicle: VehicleType
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
  const estimatedKm = Number(route.totalKm.toFixed(1));
  const estimatedMin = Math.max(5, Math.round((estimatedKm / 34) * 60));

  return {
    id: `route-${route.dateStr}-${idx}`,
    dateStr: route.dateStr,
    month: String(Number(mm) || mm),
    day: String(Number(dd) || dd),
    routeAndKmText: routeChain || '轄區門市巡店',
    actualKm: estimatedKm,
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
      geometry: waypoints.map(w => [w.lat, w.lng] as [number, number]),
      durationMin: estimatedMin,
      viaRoad: '依門市座標推估路線（點擊抓取真實路網）',
      verificationStatus: 'estimated',
      googleMapsUrl: buildGoogleMapsDirectionsUrl(waypoints, vehicle),
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
 * 東森寵物雲股份有限公司 — 國內出差旅費報核單 ＋ 附件（每日路線與 Google Maps 距離驗證佐證頁）
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

  // 明細列（每列包含對應之路線附件驗證資料）
  const [rows, setRows] = useState<ExpenseFormRow[]>([]);
  const [fetchingRowIds, setFetchingRowIds] = useState<Record<string, boolean>>({});
  const [isBatchFetchingRoad, setIsBatchFetchingRoad] = useState<boolean>(false);

  // 支付方式與備註
  const [paymentModeAutoCash, setPaymentModeAutoCash] = useState<boolean>(true);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [creditCardAmount, setCreditCardAmount] = useState<number>(0);
  const [otherPaymentAmount, setOtherPaymentAmount] = useState<number>(0);
  const [paymentNote, setPaymentNote] = useState<string>('');

  // ESC 快捷鍵關閉視窗
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  /**
   * 針對單筆明細抓取真實道路路網（OSRM），取得貼合道路的幾何折線、預估時間、途經道路與真實公里數
   */
  const fetchRoadForSingleRow = useCallback(
    async (rowId: string, waypoints: RouteEvidenceData['waypoints'], region: string, applyKm = true) => {
      if (!waypoints || waypoints.length < 2) return;
      setFetchingRowIds(prev => ({ ...prev, [rowId]: true }));
      try {
        const result = await fetchRealRoadRoute(waypoints, region);
        setRows(prev =>
          prev.map(r => {
            if (r.id !== rowId) return r;
            const keepGoogleVerified = r.evidence.verificationStatus === 'google_verified';
            return {
              ...r,
              actualKm: applyKm && !keepGoogleVerified && result.distanceKm > 0 ? result.distanceKm : r.actualKm,
              evidence: {
                ...r.evidence,
                geometry: result.geometry,
                durationMin: keepGoogleVerified ? r.evidence.durationMin : result.durationMin,
                viaRoad: result.viaRoad,
                verificationStatus: keepGoogleVerified ? 'google_verified' : result.source,
              },
            };
          })
        );
      } finally {
        setFetchingRowIds(prev => ({ ...prev, [rowId]: false }));
      }
    },
    []
  );

  // 依據主管與統計範圍（全月／單日）重新連動填入表單與附件資料
  const syncFromSystemData = useCallback(() => {
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

    const generatedRows = sourceRoutes.map((route, idx) =>
      buildRowFromDailyRoute(route, idx, vehicleType)
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
  }, [activeManager, scope, targetMonthKey, targetDateStr, vehicleType]);

  useEffect(() => {
    if (isOpen && activeManager) {
      syncFromSystemData();
    }
    // 僅於切換視窗開關、主管、統計範圍與年月時重新載入系統紀錄
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedManagerName, scope, targetMonthKey, targetDateStr]);

  // 切換至「附件」分頁時，若尚有未抓取真實路網折線的行程，自動於背景抓取前 6 筆道路軌跡讓地圖貼合街道
  useEffect(() => {
    if (!isOpen || activeViewTab !== 'attachments' || !activeManager) return;
    const pending = rows.filter(
      r =>
        r.evidence.waypoints.length >= 2 &&
        r.evidence.geometry.length <= r.evidence.waypoints.length &&
        !fetchingRowIds[r.id]
    );
    if (pending.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const item of pending.slice(0, 6)) {
        if (cancelled) break;
        await fetchRoadForSingleRow(item.id, item.evidence.waypoints, activeManager.region, false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeViewTab]);

  /**
   * 一鍵批次抓取全部行程的真實道路距離、時間、途經道路與街道折線，並同步更新主表計價公里數
   */
  const handleBatchFetchRealRoads = async () => {
    if (!activeManager || rows.length === 0 || isBatchFetchingRoad) return;
    setIsBatchFetchingRoad(true);
    try {
      for (const r of rows) {
        if (r.evidence.waypoints.length >= 2) {
          await fetchRoadForSingleRow(r.id, r.evidence.waypoints, activeManager.region, true);
        }
      }
    } finally {
      setIsBatchFetchingRoad(false);
    }
  };

  // 切換汽／機車時同步調整每公里補助單價（汽車 6.5 元、機車 3 元）
  const handleVehicleSwitch = (nextType: VehicleType) => {
    setVehicleType(nextType);
    setRatePerKm(nextType === 'motorcycle' ? MOTORCYCLE_SUBSIDY_PER_KM : DEFAULT_SUBSIDY_PER_KM);
  };

  const updateRow = <K extends keyof ExpenseFormRow>(id: string, key: K, value: ExpenseFormRow[K]) => {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, [key]: value } : r)));
  };

  const updateRowEvidenceAndKm = (
    id: string,
    patch: {
      actualKm?: number;
      durationMin?: number;
      viaRoad?: string;
      verificationStatus?: VerificationStatus;
      googleScreenshotDataUrl?: string;
    }
  ) => {
    setRows(prev =>
      prev.map(r => {
        if (r.id !== id) return r;
        const nextEvidence: RouteEvidenceData = {
          ...r.evidence,
          ...(patch.durationMin !== undefined ? { durationMin: patch.durationMin } : {}),
          ...(patch.viaRoad !== undefined ? { viaRoad: patch.viaRoad } : {}),
          ...(patch.verificationStatus !== undefined ? { verificationStatus: patch.verificationStatus } : {}),
          ...('googleScreenshotDataUrl' in patch
            ? { googleScreenshotDataUrl: patch.googleScreenshotDataUrl }
            : {}),
        };
        return {
          ...r,
          ...(patch.actualKm !== undefined ? { actualKm: patch.actualKm } : {}),
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
          geometry: [],
          durationMin: 0,
          viaRoad: '手動新增行程',
          verificationStatus: 'estimated',
          googleMapsUrl: 'https://www.google.com/maps',
        },
      },
    ]);
  };

  const handleDeleteRow = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
  };

  // 即時計算各列油資與橫向小計、直向總計、驗證統計
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

    const googleVerifiedCount = computedRows.filter(
      r => r.evidence.verificationStatus === 'google_verified'
    ).length;
    const roadVerifiedCount = computedRows.filter(
      r => r.evidence.verificationStatus === 'osrm' || r.evidence.verificationStatus === 'google_verified'
    ).length;

    const upperDigits = splitAmountToUpperDigits(totals.grandTotal);
    return { computedRows, totals, upperDigits, googleVerifiedCount, roadVerifiedCount };
  }, [rows, ratePerKm]);

  // 預設現金支付金額自動連動總計
  const effectiveCashAmount = paymentModeAutoCash
    ? Math.max(0, calculated.totals.grandTotal - creditCardAmount - otherPaymentAmount)
    : cashAmount;

  // 解析民國起訖日期與共計日數
  const dateHeaderInfo = useMemo(() => {
    const parse = (dStr: string) => {
      const [y = '', m = '', d = ''] = (dStr || '').split('-');
      return { rocY: y ? toRocYear(y) : '', m: m ? String(Number(m)) : '', d: d ? String(Number(d)) : '' };
    };
    const s = parse(startDateInput);
    const e = parse(endDateInput);
    const daysCount = rows.length > 0 ? rows.length : 0;
    return { s, e, daysCount };
  }, [startDateInput, endDateInput, rows.length]);

  /**
   * 產生精準還原公司原版面之正式 HTML 文件（主表 + 附件：每日路線與 Google Maps 距離驗證頁）
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

        const verifyTag =
          r.evidence.verificationStatus === 'google_verified'
            ? ' [GM驗證]'
            : r.evidence.verificationStatus === 'osrm'
            ? ' [路網驗證]'
            : '';

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

    // 附件頁 HTML（每筆出差路線佐證卡片，比照 Google Maps 左站點＋右地圖雙欄格式）
    const attachmentsPagesHtml =
      withAttachments && calculated.computedRows.length > 0
        ? calculated.computedRows
            .map((r, idx) => {
              const gUrl =
                r.evidence.googleMapsUrl ||
                buildGoogleMapsDirectionsUrl(r.evidence.waypoints, vehicleType);
              const statusLabel =
                r.evidence.verificationStatus === 'google_verified'
                  ? '✓ Google Maps 已核驗'
                  : r.evidence.verificationStatus === 'osrm'
                  ? '✓ 真實道路路網已驗證'
                  : '系統座標推估路線';
              const vehicleText = vehicleType === 'motorcycle' ? '機車 (3元/km)' : '汽車 (6.5元/km)';

              const waypointsListHtml =
                r.evidence.waypoints.length > 0
                  ? r.evidence.waypoints
                      .map((wp, wIdx) => {
                        const isFirst = wIdx === 0;
                        const isLast =
                          wIdx === r.evidence.waypoints.length - 1 && r.evidence.waypoints.length > 1;
                        const badge = isFirst ? '起' : isLast ? '終' : String(wIdx);
                        const bg = isFirst ? '#0f172a' : isLast ? '#dc2626' : '#2563eb';
                        return `<div class="att-stop"><span class="att-pin" style="background:${bg};">${badge}</span><span>${escapeHtml(wp.label)}</span></div>`;
                      })
                      .join('')
                  : `<div class="att-stop"><span>${escapeHtml(r.routeAndKmText)}</span></div>`;

              // 右側視覺佐證：優先採用使用者貼上的 Google Maps 官方截圖，否則輸出真實街道地圖＋藍紫導航路線＋時間公里氣泡
              const rightVisualHtml = r.evidence.googleScreenshotDataUrl
                ? `<div style="text-align:center;">
                     <img src="${r.evidence.googleScreenshotDataUrl}" alt="Google Maps 路線距離截圖" style="max-width:100%;max-height:320px;border:1px solid #cbd5e1;border-radius:8px;object-fit:contain;" />
                     <div style="font-size:9pt;color:#047857;font-weight:700;margin-top:4px;">▲ Google Maps 官方路線距離佐證截圖</div>
                   </div>`
                : forWord
                ? `<div style="border:1px dashed #94a3b8;border-radius:8px;padding:14px;background:#f8fafc;font-size:10pt;line-height:1.6;">
                     <div style="font-weight:700;color:#1e3a8a;margin-bottom:6px;">📍 Google Maps 線上距離驗證連結（請按 Ctrl+點擊 開啟比對）：</div>
                     <div style="word-break:break-all;font-size:8.5pt;"><a href="${escapeHtml(gUrl)}">${escapeHtml(gUrl)}</a></div>
                     <div style="margin-top:8px;color:#475569;font-size:9pt;">（若需在 Word 內嵌地圖圖片，建議先於系統「附件」分頁按 Ctrl+V 貼上 Google Maps 截圖後再匯出 Word，或直接使用「列印 / 另存 A4 橫式 PDF」輸出完整街道地圖）</div>
                   </div>`
                : buildPrintableRouteMapHtml({
                    waypoints: r.evidence.waypoints,
                    geometry: r.evidence.geometry,
                    distanceKm: r.actualKm,
                    durationMin: r.evidence.durationMin,
                    vehicle: vehicleType,
                    width: 540,
                    height: 310,
                  });

              return `
                <div class="att-page">
                  <div class="att-header">
                    <div>
                      <div class="att-title">東森寵物雲股份有限公司 — 國內出差旅費報核單【附件 ${idx + 1}：路線與 Google Maps 距離佐證】</div>
                      <div class="att-sub">
                        申請人：<strong>${escapeHtml(applicantName)}</strong>（${escapeHtml(departmentText)}） ｜ 出差日期：<strong>${escapeHtml(r.dateStr)}</strong> ｜ 交通工具：<strong>${vehicleText}</strong>
                      </div>
                    </div>
                    <div class="att-badge">${statusLabel}</div>
                  </div>

                  <table class="att-layout-table">
                    <tr>
                      <td class="att-left-col">
                        <div class="att-panel-title">一、當日起訖站點與停靠順序</div>
                        <div class="att-stops-box">
                          ${waypointsListHtml}
                        </div>

                        <div class="att-summary-box">
                          <div style="font-weight:700;font-size:10.5pt;color:#0f172a;">
                            ${vehicleType === 'motorcycle' ? '🛵' : '🚗'} ${escapeHtml(r.evidence.viaRoad)}
                          </div>
                          <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:baseline;">
                            <span style="font-size:13pt;font-weight:900;color:#b45309;">${r.evidence.durationMin} 分</span>
                            <span style="font-size:14pt;font-weight:900;color:#1d4ed8;">${r.actualKm.toFixed(1)} 公里</span>
                          </div>
                          <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #cbd5e1;font-size:10pt;">
                            油資補助試算：<strong>${r.actualKm.toFixed(1)} 公里 × ${ratePerKm} 元 = NT$ ${r.fuelSubsidy.toLocaleString('zh-TW')} 元</strong>
                          </div>
                        </div>

                        <div class="att-work-box">
                          <strong>工作記要：</strong>${escapeHtml(r.workSummary)}
                        </div>

                        <div class="att-gmap-link">
                          <strong>Google Maps 距離驗證連結：</strong><br/>
                          <a href="${escapeHtml(gUrl)}">${escapeHtml(gUrl)}</a>
                        </div>
                      </td>
                      <td class="att-right-col">
                        ${rightVisualHtml}
                      </td>
                    </tr>
                  </table>
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
    .v-amount span {
      font-weight: 700;
      text-decoration: underline;
    }
    .v-sign {
      margin-top: 8px;
    }
    .notes {
      margin-top: 6px;
      font-size: 9.5pt;
      font-weight: 700;
      line-height: 1.5;
    }
    .sign-row {
      margin-top: 12px;
      width: 100%;
      display: table;
      table-layout: fixed;
      font-size: 11pt;
      font-weight: 700;
    }
    .sign-cell {
      display: table-cell;
      text-align: left;
      padding-left: 6px;
    }
    /* 附件頁樣式 */
    .att-page {
      page-break-before: always;
      break-before: page;
      padding-top: 4px;
      font-family: "Microsoft JhengHei", "Noto Sans TC", sans-serif;
    }
    .att-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .att-title {
      font-size: 13pt;
      font-weight: 800;
      color: #0f172a;
    }
    .att-sub {
      font-size: 9.5pt;
      color: #334155;
      margin-top: 3px;
    }
    .att-badge {
      padding: 4px 12px;
      border-radius: 999px;
      background: #ecfdf5;
      border: 1.5px solid #10b981;
      color: #065f46;
      font-size: 9.5pt;
      font-weight: 800;
      white-space: nowrap;
    }
    table.att-layout-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .att-left-col {
      width: 44%;
      vertical-align: top;
      padding-right: 14px;
    }
    .att-right-col {
      width: 56%;
      vertical-align: top;
    }
    .att-panel-title {
      font-size: 10pt;
      font-weight: 800;
      color: #1e293b;
      margin-bottom: 6px;
    }
    .att-stops-box {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px;
      background: #f8fafc;
      margin-bottom: 10px;
    }
    .att-stop {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 9.5pt;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 5px;
    }
    .att-stop:last-child { margin-bottom: 0; }
    .att-pin {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      color: #fff;
      font-size: 8.5pt;
      font-weight: 800;
      flex-shrink: 0;
    }
    .att-summary-box {
      border: 1.5px solid #2563eb;
      border-left: 5px solid #2563eb;
      border-radius: 8px;
      padding: 10px 12px;
      background: #eff6ff;
      margin-bottom: 10px;
    }
    .att-work-box {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 9pt;
      color: #334155;
      margin-bottom: 10px;
    }
    .att-gmap-link {
      border: 1px dashed #94a3b8;
      border-radius: 8px;
      padding: 7px 9px;
      font-size: 8pt;
      color: #475569;
      word-break: break-all;
    }
    .att-gmap-link a {
      color: #1d4ed8;
      text-decoration: underline;
    }
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
    註2：汽車每公里補助<u>6.5</u>元，機車每公里補助<u>3</u>元（本次計價基準：${vehicleType === 'motorcycle' ? '機車' : '汽車'} ${ratePerKm} 元／公里${withAttachments ? '，另檢附每日路線與 Google Maps 距離佐證附件共 ' + calculated.computedRows.length + ' 頁' : ''}）
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
   * 開啟 A4 橫式列印／另存 PDF 視窗（自動等候地圖圖磚與截圖載入完畢後再啟動列印，避免地圖空白）
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

    const triggerPrintWhenImagesReady = () => {
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
      // 最多等待 4 秒避免單張慢圖磚卡住列印視窗
      const fallbackTimer = setTimeout(done, 4000);
      Promise.all(
        imgs.map(
          img =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>(resolve => {
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                })
        )
      ).then(() => {
        clearTimeout(fallbackTimer);
        done();
      });
    };

    setTimeout(triggerPrintWhenImagesReady, 220);
  };

  /**
   * 匯出可由 Microsoft Word 開啟編輯之橫式 A4 報核單（含附件頁與已上傳之 Google Maps 截圖）
   */
  const handleExportWord = () => {
    const html = buildPrintableDocumentHtml(true, includeAttachmentsInExport);
    const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `東森寵物雲_國內出差旅費報核單含附件_${applicantName || '區主管'}_${targetMonthKey}.doc`;
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
              東森寵物雲股份有限公司 — 國內出差旅費報核單＆路線距離附件
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
              <span>含距離驗證附件頁 ({rows.length}頁)</span>
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

        {/* 主表 / 附件雙分頁切換 ＋ 快速連動篩選條 */}
        <div className="bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          {/* 左側：主表 vs 附件分頁切換 */}
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
              <MapIcon size={14} />
              <span>附件：路線與 Google Maps 距離驗證</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  activeViewTab === 'attachments' ? 'bg-white/25 text-white' : 'bg-blue-100 text-blue-800'
                }`}
              >
                {calculated.roadVerifiedCount}/{rows.length}
              </span>
            </button>
          </div>

          {/* 右側：切換主管、範圍、汽機車單價與批次抓取真實路網 */}
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
              onClick={handleBatchFetchRealRoads}
              disabled={isBatchFetchingRoad || rows.length === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-extrabold cursor-pointer transition-colors shadow-2xs"
              title="批次抓取全部出差日之真實道路公里數、行車分鐘數與街道導航軌跡，並同步更新主表計價"
            >
              {isBatchFetchingRoad ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              <span>{isBatchFetchingRoad ? '抓取路網中...' : '批次抓取真實路網距離'}</span>
            </button>

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
              onClick={syncFromSystemData}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 text-xs font-bold cursor-pointer"
              title="重設為系統原始巡店紀錄"
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
                    calculated.computedRows.map((row, idx) => (
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
                                row.evidence.verificationStatus === 'google_verified'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : row.evidence.verificationStatus === 'osrm'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                              }`}
                              title="點此前往附件頁檢視地圖路線與 Google Maps 距離驗證"
                            >
                              {row.evidence.verificationStatus === 'google_verified'
                                ? '✓ GM驗證'
                                : row.evidence.verificationStatus === 'osrm'
                                ? '✓ 路網驗證'
                                : '📎 驗證附件'}
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
                    ))
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
            /* =================== 分頁二：附件（每日路線與 Google Maps 距離驗證） =================== */
            <div className="max-w-[1260px] mx-auto space-y-4">
              {/* 附件說明與批次驗證導引橫幅 */}
              <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-2xl p-4 shadow-md flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm sm:text-base font-extrabold flex items-center gap-2">
                    <MapIcon size={18} />
                    <span>報核單附件：每日路線與 Google Maps 距離佐證（共 {calculated.computedRows.length} 筆）</span>
                  </div>
                  <p className="text-xs text-blue-100">
                    每張附件皆對應主表一筆出差日期。您可以：① 點「批次抓取真實路網距離」自動繪製貼合道路的藍紫色導航線與時間公里氣泡；② 點「開啟 Google Maps 驗證距離」核對後輸入精準公里數或直接按 <strong>Ctrl+V</strong> 貼上 Google Maps 截圖，主表費用將同步即時重算。
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-3 py-1.5 rounded-xl bg-white/15 border border-white/25 text-xs font-extrabold">
                    Google Maps 已核驗：{calculated.googleVerifiedCount} / {calculated.computedRows.length}
                  </span>
                  <button
                    type="button"
                    onClick={handleBatchFetchRealRoads}
                    disabled={isBatchFetchingRoad || calculated.computedRows.length === 0}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 text-xs font-extrabold cursor-pointer shadow-sm"
                  >
                    {isBatchFetchingRoad ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    <span>一鍵批次套用真實道路距離</span>
                  </button>
                </div>
              </div>

              {calculated.computedRows.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
                  目前尚無任何出差日期明細，請先切換其他月份或點擊上方「新增列」。
                </div>
              ) : (
                <div className="space-y-4">
                  {calculated.computedRows.map((row, idx) => (
                    <ExpenseRouteAttachmentCard
                      key={row.id}
                      index={idx}
                      dateStr={row.dateStr}
                      applicantName={applicantName}
                      vehicleType={vehicleType}
                      ratePerKm={ratePerKm}
                      actualKm={row.actualKm}
                      fuelSubsidy={row.fuelSubsidy}
                      routeSummaryText={row.routeAndKmText}
                      evidence={row.evidence}
                      isFetchingRoad={Boolean(fetchingRowIds[row.id])}
                      onFetchRealRoad={() =>
                        fetchRoadForSingleRow(
                          row.id,
                          row.evidence.waypoints,
                          activeManager?.region || '新北區',
                          true
                        )
                      }
                      onUpdateKmAndMeta={patch => updateRowEvidenceAndKm(row.id, patch)}
                    />
                  ))}
                </div>
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
              <span>{activeViewTab === 'form' ? '前往檢視附件距離驗證 ➔' : '返回報核單主表 ➔'}</span>
            </button>
          </div>
          <span className="text-[11px] text-slate-400">
            列印 PDF 時系統將自動輸出「第 1 頁報核單主表 ＋ 第 2 頁起每日路線與 Google Maps 距離佐證附件」
          </span>
        </div>
      </div>
    </div>
  );
};
