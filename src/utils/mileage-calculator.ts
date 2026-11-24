import type { Manager, VisitRecord } from '../types';
import { getTaipeiDateStr, formatTaipeiReportTime } from './time-utils';
import { normalizeRegionName, normalizeStoreName, compareRegion } from './store-region';
import { BEAUTY_DIRECTORS_CONFIG } from '../data/beautyAuditConfig';
import {
  HEADQUARTERS_POINT,
  RAW_STORE_COORDINATES,
  estimateDrivingKm,
  getRegionHubPoint,
  getStoreGeoPoint,
  type GeoPoint,
} from '../data/storeCoordinates';

/** 預設汽車每公里油資／車程補助單價（新台幣 元/公里，依國內出差旅費報核單註2） */
export const DEFAULT_SUBSIDY_PER_KM = 6.5;

/** 預設機車每公里油資／車程補助單價（新台幣 元/公里，依國內出差旅費報核單註2） */
export const MOTORCYCLE_SUBSIDY_PER_KM = 3;

export type MileageCalcMode = 'round_trip' | 'store_only';

const SCHEDULE_TYPES = new Set(['總部行程', '會議行程', '特殊行程']);

export interface RouteLeg {
  fromLabel: string;
  toLabel: string;
  distanceKm: number;
  subsidyCost: number;
  visitTime?: string;
  recordId?: string;
  actionType?: string;
  isReturnLeg?: boolean;
  /** 交通方式：drive（汽機車行駛計公里）或 hsr（中南部前往中和總部搭高鐵） */
  transportMode?: 'drive' | 'hsr';
}

export interface HsrHeadquartersTrip {
  /** 中南部出發高鐵站（如：台中、彰化、嘉義、台南、左營） */
  departureStation: string;
  /** 北部抵達高鐵站（中和景平路總部固定搭至板橋站） */
  arrivalStation: string;
  /** 標準車廂單程全票（NT$） */
  oneWayFare: number;
  /** 高鐵來回票價合計（NT$） */
  roundTripFare: number;
  /** 預設高鐵站單日停車費（NT$，可於黏存單調整或刪除） */
  defaultParkingFee: number;
  /** 會議／總部行程事由 */
  meetingTitle: string;
}

export interface DailyRouteRecord {
  dateStr: string;
  managerName: string;
  region: string;
  department: string;
  storeVisitCount: number;
  scheduleCount: number;
  visitedStores: string[];
  legs: RouteLeg[];
  /** 依序排列之地理座標站點（含起點、各巡店停靠站與返程點），供地圖路線驗證與 Google Maps 導航使用 */
  waypoints: GeoPoint[];
  totalKm: number;
  totalSubsidy: number;
  /** 若為中南部主管前往中和景平路總部，標記改搭高鐵往返板橋站資訊 */
  hsrTrip?: HsrHeadquartersTrip;
}

export interface ManagerExpenseItem {
  managerName: string;
  roleLabel: string;
  region: string;
  department: string;
  assignedStoreCount: number;
  // 當天（指定日）數據
  dayDateStr: string;
  dayVisitCount: number;
  dayScheduleCount: number;
  dayKm: number;
  daySubsidy: number;
  dayRoute?: DailyRouteRecord;
  // 當月累計加總數據
  monthKey: string;
  monthActiveDays: number;
  monthVisitCount: number;
  monthScheduleCount: number;
  monthKm: number;
  monthSubsidy: number;
  monthDailyRoutes: DailyRouteRecord[];
  // 目前篩選區間數據
  periodActiveDays: number;
  periodVisitCount: number;
  periodKm: number;
  periodSubsidy: number;
}

export interface ExpenseDashboardReport {
  ratePerKm: number;
  targetDateStr: string;
  targetMonthKey: string;
  availableMonths: string[];
  // 當天總計
  dayTotalKm: number;
  dayTotalSubsidy: number;
  dayActiveManagers: number;
  dayTotalVisits: number;
  // 當月總計
  monthTotalKm: number;
  monthTotalSubsidy: number;
  monthActiveManagers: number;
  monthTotalActiveDays: number;
  monthTotalVisits: number;
  // 目前篩選區間總計
  periodTotalKm: number;
  periodTotalSubsidy: number;
  periodTotalVisits: number;
  // 各區主管完整清單
  managersReport: ManagerExpenseItem[];
}

/**
 * 將 ISO 時間轉為時間戳毫秒數以利依先後順序排列當日行程
 */
const toTimestamp = (iso?: string): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

const SORTED_STORE_NAMES = Object.keys(RAW_STORE_COORDINATES).sort((a, b) => b.length - a.length);

/** 中南部區域（往返中和景平路總部固定搭高鐵至板橋站；北區新北／北桃／竹苗／宜花則開車往返） */
const CENTRAL_SOUTH_HSR_REGIONS = new Set(['中投區', '彰雲區', '嘉南區', '高雄區', '高屏區']);

/** 台灣高鐵標準車廂全票（各站 ↔ 板橋站，供中南部主管赴中和景平路總部自動計費） */
const HSR_TO_BANQIAO_FARES: Record<string, number> = {
  台中: 670,
  彰化: 790,
  雲林: 900,
  嘉義: 1050,
  台南: 1320,
  左營: 1460,
};

/** 預設高鐵站當日停車費（比照紙本零用金黏存單：高鐵停車費 $250） */
const DEFAULT_HSR_PARKING_FEE = 250;

/**
 * 判斷單筆行程是否為前往中和景平路總部（含總部行程、月會、雙週會、行營採、寵物雲會報等）
 */
export const isHeadquartersActivity = (activity: VisitRecord): boolean => {
  if (activity.actionType === '總部行程') return true;
  if (!SCHEDULE_TYPES.has(activity.actionType)) return false;
  const text = `${activity.storeName || ''} ${activity.highlightDescription || ''}`;
  return /總部|月會|雙週會|行營採|會報|景平路/.test(text);
};

/**
 * 判斷該區域／出發起點是否屬於中南部（赴中和景平路總部必搭高鐵；北區則開車）
 */
export const isCentralSouthHsrRegion = (region: string, hubPoint?: GeoPoint): boolean => {
  const normalized = normalizeRegionName(region);
  if (CENTRAL_SOUTH_HSR_REGIONS.has(normalized)) return true;
  if (['新北區', '北桃區', '竹苗區', '宜花區'].includes(normalized)) return false;
  return Boolean(hubPoint && hubPoint.lat < 24.45);
};

/**
 * 依中南部區域與出發座標決定最近之高鐵出發站與至板橋站標準車廂單程票價
 */
const resolveHsrStationToBanqiao = (
  region: string,
  hubPoint?: GeoPoint
): { station: string; oneWayFare: number } => {
  const normalized = normalizeRegionName(region);
  if (normalized === '中投區') return { station: '台中', oneWayFare: HSR_TO_BANQIAO_FARES['台中'] };
  if (normalized === '彰雲區') {
    // 若出發點偏雲林（北緯 < 23.78），對應高鐵雲林站；否則對應高鐵彰化站
    if (hubPoint && hubPoint.lat < 23.78) {
      return { station: '雲林', oneWayFare: HSR_TO_BANQIAO_FARES['雲林'] };
    }
    return { station: '彰化', oneWayFare: HSR_TO_BANQIAO_FARES['彰化'] };
  }
  if (normalized === '嘉南區') {
    // 台南市區（北緯 < 23.15）搭台南站，新營／嘉義搭嘉義站
    if (hubPoint && hubPoint.lat < 23.15) {
      return { station: '台南', oneWayFare: HSR_TO_BANQIAO_FARES['台南'] };
    }
    return { station: '嘉義', oneWayFare: HSR_TO_BANQIAO_FARES['嘉義'] };
  }
  if (normalized === '高雄區' || normalized === '高屏區') {
    return { station: '左營', oneWayFare: HSR_TO_BANQIAO_FARES['左營'] };
  }
  // 依出發緯度保底推算
  const lat = hubPoint?.lat ?? 24.16;
  if (lat < 22.85) return { station: '左營', oneWayFare: HSR_TO_BANQIAO_FARES['左營'] };
  if (lat < 23.25) return { station: '台南', oneWayFare: HSR_TO_BANQIAO_FARES['台南'] };
  if (lat < 23.65) return { station: '嘉義', oneWayFare: HSR_TO_BANQIAO_FARES['嘉義'] };
  if (lat < 24.0) return { station: '彰化', oneWayFare: HSR_TO_BANQIAO_FARES['彰化'] };
  return { station: '台中', oneWayFare: HSR_TO_BANQIAO_FARES['台中'] };
};

/** 常見公務／會議／受訓地點關鍵字座標對照，確保特殊行程不會與出發點重疊為 0 公里 */
const SCHEDULE_LANDMARK_COORDS: { keywords: string[]; lat: number; lng: number; label: string }[] = [
  { keywords: ['流行音樂中心', '北流', '南港'], lat: 25.0525, lng: 121.5985, label: '臺北流行音樂中心（台北市南港區市民大道八段99號）' },
  { keywords: ['台北車站', '北車', '中正區'], lat: 25.0478, lng: 121.517, label: '台北車站（台北市中正區北平西路3號）' },
  { keywords: ['信義', '101', '世貿'], lat: 25.033, lng: 121.5654, label: '台北市信義區世貿中心' },
  { keywords: ['內湖'], lat: 25.0697, lng: 121.5885, label: '台北市內湖科技園區' },
  { keywords: ['板橋車站', '新板'], lat: 25.0143, lng: 121.4637, label: '板橋車站（新北市板橋區縣民大道二段7號）' },
  { keywords: ['桃園高鐵', '青埔', '中壢'], lat: 25.0132, lng: 121.2148, label: '高鐵桃園站（桃園市中壢區高鐵北路一段6號）' },
  { keywords: ['新竹高鐵', '竹北'], lat: 24.8084, lng: 121.0402, label: '高鐵新竹站（新竹縣竹北市高鐵七路6號）' },
  { keywords: ['台中高鐵', '烏日'], lat: 24.1118, lng: 120.6158, label: '高鐵台中站（台中市烏日區站區二路8號）' },
  { keywords: ['左營高鐵', '左營'], lat: 22.6873, lng: 120.3077, label: '高鐵左營站（高雄市左營區高鐵路105號）' },
];

/**
 * 判斷單一紀錄對應的地理座標點（供車資核算引擎與巡店路徑地圖共用，確保特殊行程定位 100% 一致）
 * 針對「特殊行程／會議行程」自動掃描門市名稱與地標關鍵字，並確保目的地座標不與出發基準點完全重疊為 0 公里
 */
export const resolveActivityPoint = (
  activity: VisitRecord,
  region: string,
  hubPoint?: GeoPoint
): GeoPoint => {
  const hub = hubPoint || getRegionHubPoint(region);

  if (activity.actionType === '總部行程') {
    return HEADQUARTERS_POINT;
  }
  if (SCHEDULE_TYPES.has(activity.actionType)) {
    const text = `${activity.storeName || ''} ${activity.highlightDescription || ''}`;
    if (text.includes('總部') || text.includes('月會') || text.includes('雙週會') || text.includes('行營採')) {
      return HEADQUARTERS_POINT;
    }

    // 1. 檢查公務／特殊行程內容是否提及任一門市名稱（如「在彰化中正處理事務」）
    for (const storeKey of SORTED_STORE_NAMES) {
      if (storeKey.length >= 2 && text.includes(storeKey)) {
        const pt = RAW_STORE_COORDINATES[storeKey];
        return {
          lat: pt.lat,
          lng: pt.lng,
          isOffshore: pt.isOffshore,
          label: `${storeKey}店`,
        };
      }
    }

    // 2. 檢查是否提及常見受訓／高鐵／會展地標
    for (const lm of SCHEDULE_LANDMARK_COORDS) {
      if (lm.keywords.some(kw => text.includes(kw))) {
        return { lat: lm.lat, lng: lm.lng, label: lm.label };
      }
    }

    // 3. 若未提及特定地點，預設以總部大樓作為公務目的地；若出發點已極接近總部，則以台北市中心為公務點，確保點對點距離 > 0
    const distToHq = estimateDrivingKm(hub, HEADQUARTERS_POINT, region);
    if (distToHq >= 2.0) {
      return {
        lat: HEADQUARTERS_POINT.lat,
        lng: HEADQUARTERS_POINT.lng,
        label: activity.highlightDescription
          ? `${activity.highlightDescription}（新北市中和區景平路258號）`
          : HEADQUARTERS_POINT.label,
      };
    }

    return {
      lat: 25.0525,
      lng: 121.5985,
      label: activity.highlightDescription
        ? `${activity.highlightDescription}（台北市南港區市民大道八段99號）`
        : '台北市區公務地點',
    };
  }
  return getStoreGeoPoint(activity.storeName, region);
};

/**
 * 計算單一主管於「單一日期」的行車路線、分段里程與預估補助金額
 */
export const calculateDailyRoute = (
  dateStr: string,
  managerName: string,
  region: string,
  department: string,
  dayActivities: VisitRecord[],
  ratePerKm: number = DEFAULT_SUBSIDY_PER_KM,
  mode: MileageCalcMode = 'round_trip',
  includeSchedule: boolean = true,
  customHubPoint?: GeoPoint
): DailyRouteRecord | null => {
  const validActivities = dayActivities
    .filter(a => includeSchedule || !SCHEDULE_TYPES.has(a.actionType))
    .sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));

  if (validActivities.length === 0) return null;

  // 同日連續同門市重複填報去重，避免同店重複計算車程
  const distinctStops: VisitRecord[] = [];
  for (const act of validActivities) {
    const prev = distinctStops[distinctStops.length - 1];
    if (
      prev &&
      !SCHEDULE_TYPES.has(act.actionType) &&
      !SCHEDULE_TYPES.has(prev.actionType) &&
      normalizeStoreName(prev.storeName) === normalizeStoreName(act.storeName)
    ) {
      continue;
    }
    distinctStops.push(act);
  }

  const hub = customHubPoint || getRegionHubPoint(region);
  const legs: RouteLeg[] = [];
  const waypoints: GeoPoint[] = [];
  const visitedStores: string[] = [];
  let storeVisitCount = 0;
  let scheduleCount = 0;

  for (const act of distinctStops) {
    if (SCHEDULE_TYPES.has(act.actionType)) {
      scheduleCount++;
    } else {
      storeVisitCount++;
      if (act.storeName && !visitedStores.includes(act.storeName)) {
        visitedStores.push(act.storeName);
      }
    }
  }

  // NOTE: 總部固定於中和景平路：北區主管開車往返計油資，中南部主管改採高鐵往返板橋站計費（不計數百公里長途開車油資）
  const useHsrForHq = isCentralSouthHsrRegion(region, hub);
  const hqStops = useHsrForHq ? distinctStops.filter(s => isHeadquartersActivity(s)) : [];
  const drivingStops = useHsrForHq
    ? distinctStops.filter(s => !isHeadquartersActivity(s))
    : distinctStops;

  let hsrTrip: HsrHeadquartersTrip | undefined;
  if (hqStops.length > 0) {
    const { station, oneWayFare } = resolveHsrStationToBanqiao(region, hub);
    const primaryHq = hqStops[0];
    const meetingTitle =
      (primaryHq.highlightDescription || '').trim() ||
      (primaryHq.storeName && primaryHq.storeName !== '總部行程' ? primaryHq.storeName : '總部會議');
    hsrTrip = {
      departureStation: station,
      arrivalStation: '板橋',
      oneWayFare,
      roundTripFare: oneWayFare * 2,
      defaultParkingFee: DEFAULT_HSR_PARKING_FEE,
      meetingTitle,
    };
  }

  if (drivingStops.length > 0) {
    if (mode === 'round_trip') {
      let currentPoint = hub;
      waypoints.push(hub);
      for (const stop of drivingStops) {
        const nextPoint = resolveActivityPoint(stop, region, hub);
        waypoints.push({
          ...nextPoint,
          label: nextPoint.label || stop.storeName || stop.actionType,
        });
        const km = estimateDrivingKm(currentPoint, nextPoint, region);
        const timeStr = formatTaipeiReportTime(stop.createdAt).split(' ')[1] || '';
        legs.push({
          fromLabel: currentPoint.label,
          toLabel: SCHEDULE_TYPES.has(stop.actionType)
            ? `${stop.actionType}${stop.highlightDescription ? `：${stop.highlightDescription}` : ''}`
            : stop.storeName,
          distanceKm: km,
          subsidyCost: Math.round(km * ratePerKm),
          visitTime: timeStr,
          recordId: stop.recordId,
          actionType: stop.actionType,
          transportMode: 'drive',
        });
        currentPoint = nextPoint;
      }

      // 末站返回區域中心或自訂起始點
      const returnKm = estimateDrivingKm(currentPoint, hub, region);
      if (returnKm > 0) {
        waypoints.push(hub);
        legs.push({
          fromLabel: currentPoint.label,
          toLabel: hub.label,
          distanceKm: returnKm,
          subsidyCost: Math.round(returnKm * ratePerKm),
          isReturnLeg: true,
          transportMode: 'drive',
        });
      }
    } else {
      // 僅計門市間跨店移動（若單日僅 1 站，以區域中心單趟移動估算）
      if (drivingStops.length === 1) {
        const stop = drivingStops[0];
        const nextPoint = resolveActivityPoint(stop, region, hub);
        waypoints.push(hub, {
          ...nextPoint,
          label: nextPoint.label || stop.storeName || stop.actionType,
        });
        const km = estimateDrivingKm(hub, nextPoint, region);
        const timeStr = formatTaipeiReportTime(stop.createdAt).split(' ')[1] || '';
        legs.push({
          fromLabel: hub.label,
          toLabel: SCHEDULE_TYPES.has(stop.actionType) ? stop.actionType : stop.storeName,
          distanceKm: km,
          subsidyCost: Math.round(km * ratePerKm),
          visitTime: timeStr,
          recordId: stop.recordId,
          actionType: stop.actionType,
          transportMode: 'drive',
        });
      } else {
        for (let i = 0; i < drivingStops.length - 1; i++) {
          const fromStop = drivingStops[i];
          const toStop = drivingStops[i + 1];
          const fromPt = resolveActivityPoint(fromStop, region, hub);
          const toPt = resolveActivityPoint(toStop, region, hub);
          if (i === 0) {
            waypoints.push({
              ...fromPt,
              label: fromPt.label || fromStop.storeName || fromStop.actionType,
            });
          }
          waypoints.push({
            ...toPt,
            label: toPt.label || toStop.storeName || toStop.actionType,
          });
          const km = estimateDrivingKm(fromPt, toPt, region);
          const timeStr = formatTaipeiReportTime(toStop.createdAt).split(' ')[1] || '';
          legs.push({
            fromLabel: SCHEDULE_TYPES.has(fromStop.actionType) ? fromStop.actionType : fromStop.storeName,
            toLabel: SCHEDULE_TYPES.has(toStop.actionType) ? toStop.actionType : toStop.storeName,
            distanceKm: km,
            subsidyCost: Math.round(km * ratePerKm),
            visitTime: timeStr,
            recordId: toStop.recordId,
            actionType: toStop.actionType,
            transportMode: 'drive',
          });
        }
      }
    }
  }

  // 中南部赴中和景平路總部：以高鐵去程＋回程（至板橋站）紀錄取代長途開車估算
  if (hsrTrip) {
    const primaryHq = hqStops[0];
    const timeStr = formatTaipeiReportTime(primaryHq.createdAt).split(' ')[1] || '';
    legs.push(
      {
        fromLabel: `高鐵${hsrTrip.departureStation}站`,
        toLabel: `高鐵${hsrTrip.arrivalStation}站（中和景平路總部 · ${hsrTrip.meetingTitle}）`,
        distanceKm: 0,
        subsidyCost: hsrTrip.oneWayFare,
        visitTime: timeStr,
        recordId: primaryHq.recordId,
        actionType: primaryHq.actionType,
        transportMode: 'hsr',
      },
      {
        fromLabel: `高鐵${hsrTrip.arrivalStation}站（總部返程）`,
        toLabel: `高鐵${hsrTrip.departureStation}站`,
        distanceKm: 0,
        subsidyCost: hsrTrip.oneWayFare,
        isReturnLeg: true,
        transportMode: 'hsr',
      }
    );
  }

  const totalKm = Math.round(legs.reduce((sum, l) => sum + l.distanceKm, 0) * 10) / 10;
  const driveSubsidy = Math.round(totalKm * ratePerKm);
  const totalSubsidy = driveSubsidy + (hsrTrip ? hsrTrip.roundTripFare : 0);

  return {
    dateStr,
    managerName,
    region,
    department,
    storeVisitCount,
    scheduleCount,
    visitedStores,
    legs,
    waypoints,
    totalKm,
    totalSubsidy,
    hsrTrip,
  };
};

/**
 * 彙整全體區主管（或指定單一區主管）「當天推算費用」、「每月車程費用加總」與「所選區間費用」
 */
export const buildExpenseDashboardReport = (params: {
  allActivities: VisitRecord[];
  periodActivities: VisitRecord[];
  managers: Manager[];
  selectedDepartment: string;
  targetDateStr: string;
  targetMonthKey: string;
  ratePerKm?: number;
  mode?: MileageCalcMode;
  includeSchedule?: boolean;
  customHubPointsByManager?: Record<string, GeoPoint>;
  globalCustomHubPoint?: GeoPoint;
  restrictToManagerName?: string;
}): ExpenseDashboardReport => {
  const {
    allActivities,
    periodActivities,
    managers,
    selectedDepartment,
    targetDateStr,
    targetMonthKey,
    ratePerKm = DEFAULT_SUBSIDY_PER_KM,
    mode = 'round_trip',
    includeSchedule = true,
    customHubPointsByManager,
    globalCustomHubPoint,
    restrictToManagerName,
  } = params;

  const deptKeyword = selectedDepartment === 'all' ? '' : selectedDepartment.replace('營業', '');
  const filteredRawManagers =
    selectedDepartment === 'all' || restrictToManagerName
      ? managers
      : managers.filter(
        m => m.department.includes(deptKeyword) || m.department === selectedDepartment
      );

  // 建立每位主管（包含正區主管與副區主管）基本資料名冊
  const rosterMap = new Map<
    string,
    {
      managerName: string;
      roleLabel: string;
      region: string;
      department: string;
      stores: Set<string>;
    }
  >();

  for (const m of filteredRawManagers) {
    const reg = normalizeRegionName(m.region) || '其他區域';
    if (m.areaManagerName) {
      const name = m.areaManagerName.trim();
      if (!restrictToManagerName || name === restrictToManagerName.trim()) {
        if (!rosterMap.has(name)) {
          rosterMap.set(name, {
            managerName: name,
            roleLabel: '區主管',
            region: reg,
            department: m.department || '',
            stores: new Set(),
          });
        }
        if (m.storeName) rosterMap.get(name)!.stores.add(m.storeName);
      }
    }
    if (m.deputyManagerName) {
      const depName = m.deputyManagerName.trim();
      if (depName && (!restrictToManagerName || depName === restrictToManagerName.trim())) {
        if (!rosterMap.has(depName)) {
          rosterMap.set(depName, {
            managerName: depName,
            roleLabel: '副區主管',
            region: reg,
            department: m.department || '',
            stores: new Set(),
          });
        }
        if (m.storeName) {
          rosterMap.get(depName)!.stores.add(m.storeName);
        }
      }
    }
  }

  // 納入各處美容總監（廖羿蓁／戴欐蘐），讓美容總監登入時也能檢視個人車資與零用金黏存單
  for (const bd of BEAUTY_DIRECTORS_CONFIG) {
    if (restrictToManagerName && bd.name !== restrictToManagerName.trim()) continue;
    if (
      !restrictToManagerName &&
      selectedDepartment !== 'all' &&
      !bd.department.includes(deptKeyword) &&
      bd.department !== selectedDepartment
    ) {
      continue;
    }
    const deptStores = new Set(
      filteredRawManagers
        .filter(m => m.department === bd.department || m.directorName === bd.supervisor)
        .map(m => m.storeName)
        .filter(Boolean)
    );
    if (!rosterMap.has(bd.name)) {
      rosterMap.set(bd.name, {
        managerName: bd.name,
        roleLabel: '美容總監',
        region: bd.department === '營業二處' ? '中投區' : '新北區',
        department: bd.department,
        stores: deptStores,
      });
    }
  }

  // 統計所有可用月份（供月份下拉切換）
  const monthSet = new Set<string>([targetMonthKey]);
  for (const act of allActivities) {
    const dStr = getTaipeiDateStr(act.createdAt);
    if (dStr && dStr.length >= 7) {
      monthSet.add(dStr.slice(0, 7));
    }
  }
  const availableMonths = Array.from(monthSet).sort((a, b) => b.localeCompare(a));

  // 將活動依「主管 -> 日期」分組
  const activitiesByManagerDate = new Map<string, Map<string, VisitRecord[]>>();
  for (const act of allActivities) {
    const mgrName = (act.areaManagerName || '').trim();
    if (!mgrName || !rosterMap.has(mgrName)) continue;
    const dStr = getTaipeiDateStr(act.createdAt);
    if (!dStr) continue;
    if (!activitiesByManagerDate.has(mgrName)) {
      activitiesByManagerDate.set(mgrName, new Map());
    }
    const dateMap = activitiesByManagerDate.get(mgrName)!;
    if (!dateMap.has(dStr)) dateMap.set(dStr, []);
    dateMap.get(dStr)!.push(act);
  }

  // 目前篩選區間的活動依「主管 -> 日期」分組
  const periodByManagerDate = new Map<string, Map<string, VisitRecord[]>>();
  for (const act of periodActivities) {
    const mgrName = (act.areaManagerName || '').trim();
    if (!mgrName || !rosterMap.has(mgrName)) continue;
    const dStr = getTaipeiDateStr(act.createdAt);
    if (!dStr) continue;
    if (!periodByManagerDate.has(mgrName)) {
      periodByManagerDate.set(mgrName, new Map());
    }
    const dateMap = periodByManagerDate.get(mgrName)!;
    if (!dateMap.has(dStr)) dateMap.set(dStr, []);
    dateMap.get(dStr)!.push(act);
  }

  const managersReport: ManagerExpenseItem[] = [];

  for (const info of rosterMap.values()) {
    const dateMap = activitiesByManagerDate.get(info.managerName) || new Map<string, VisitRecord[]>();
    // 優先使用該主管專屬自訂起始點地址，其次全域自訂起始點，皆無則退回區域中心
    const mgrCustomHub = customHubPointsByManager?.[info.managerName] || globalCustomHubPoint;

    // 1. 計算「當天（targetDateStr）」路線與費用
    const dayActs = dateMap.get(targetDateStr) || [];
    const dayRoute =
      calculateDailyRoute(
        targetDateStr,
        info.managerName,
        info.region,
        info.department,
        dayActs,
        ratePerKm,
        mode,
        includeSchedule,
        mgrCustomHub
      ) || undefined;

    // 2. 計算「當月（targetMonthKey）」所有出勤日路線與加總
    const monthDailyRoutes: DailyRouteRecord[] = [];
    for (const [dStr, acts] of dateMap.entries()) {
      if (!dStr.startsWith(targetMonthKey)) continue;
      const route = calculateDailyRoute(
        dStr,
        info.managerName,
        info.region,
        info.department,
        acts,
        ratePerKm,
        mode,
        includeSchedule,
        mgrCustomHub
      );
      if (route) {
        monthDailyRoutes.push(route);
      }
    }
    monthDailyRoutes.sort((a, b) => b.dateStr.localeCompare(a.dateStr));

    const monthKm =
      Math.round(monthDailyRoutes.reduce((sum, r) => sum + r.totalKm, 0) * 10) / 10;
    const monthSubsidy = monthDailyRoutes.reduce((sum, r) => sum + r.totalSubsidy, 0);
    const monthVisitCount = monthDailyRoutes.reduce((sum, r) => sum + r.storeVisitCount, 0);
    const monthScheduleCount = monthDailyRoutes.reduce((sum, r) => sum + r.scheduleCount, 0);

    // 3. 計算「目前所選區間」加總
    const pDateMap = periodByManagerDate.get(info.managerName) || new Map<string, VisitRecord[]>();
    const periodRoutes: DailyRouteRecord[] = [];
    for (const [dStr, acts] of pDateMap.entries()) {
      const route = calculateDailyRoute(
        dStr,
        info.managerName,
        info.region,
        info.department,
        acts,
        ratePerKm,
        mode,
        includeSchedule,
        mgrCustomHub
      );
      if (route) periodRoutes.push(route);
    }
    const periodKm = Math.round(periodRoutes.reduce((sum, r) => sum + r.totalKm, 0) * 10) / 10;
    const periodSubsidy = periodRoutes.reduce((sum, r) => sum + r.totalSubsidy, 0);
    const periodVisitCount = periodRoutes.reduce((sum, r) => sum + r.storeVisitCount, 0);

    managersReport.push({
      managerName: info.managerName,
      roleLabel: info.roleLabel,
      region: info.region,
      department: info.department,
      assignedStoreCount: info.stores.size,
      dayDateStr: targetDateStr,
      dayVisitCount: dayRoute?.storeVisitCount || 0,
      dayScheduleCount: dayRoute?.scheduleCount || 0,
      dayKm: dayRoute?.totalKm || 0,
      daySubsidy: dayRoute?.totalSubsidy || 0,
      dayRoute,
      monthKey: targetMonthKey,
      monthActiveDays: monthDailyRoutes.length,
      monthVisitCount,
      monthScheduleCount,
      monthKm,
      monthSubsidy,
      monthDailyRoutes,
      periodActiveDays: periodRoutes.length,
      periodVisitCount,
      periodKm,
      periodSubsidy,
    });
  }

  // 依區域順序排列（同區域內正區主管優先於副區主管）
  managersReport.sort((a, b) => {
    const regCmp = compareRegion(a.region, b.region);
    if (regCmp !== 0) return regCmp;
    if (a.roleLabel !== b.roleLabel) return a.roleLabel === '區主管' ? -1 : 1;
    return b.monthSubsidy - a.monthSubsidy;
  });

  const dayTotalKm =
    Math.round(managersReport.reduce((sum, m) => sum + m.dayKm, 0) * 10) / 10;
  const dayTotalSubsidy = managersReport.reduce((sum, m) => sum + m.daySubsidy, 0);
  const dayActiveManagers = managersReport.filter(m => m.dayKm > 0 || m.daySubsidy > 0).length;
  const dayTotalVisits = managersReport.reduce((sum, m) => sum + m.dayVisitCount, 0);

  const monthTotalKm =
    Math.round(managersReport.reduce((sum, m) => sum + m.monthKm, 0) * 10) / 10;
  const monthTotalSubsidy = managersReport.reduce((sum, m) => sum + m.monthSubsidy, 0);
  const monthActiveManagers = managersReport.filter(m => m.monthKm > 0 || m.monthSubsidy > 0).length;
  const monthTotalActiveDays = managersReport.reduce((sum, m) => sum + m.monthActiveDays, 0);
  const monthTotalVisits = managersReport.reduce((sum, m) => sum + m.monthVisitCount, 0);

  const periodTotalKm =
    Math.round(managersReport.reduce((sum, m) => sum + m.periodKm, 0) * 10) / 10;
  const periodTotalSubsidy = managersReport.reduce((sum, m) => sum + m.periodSubsidy, 0);
  const periodTotalVisits = managersReport.reduce((sum, m) => sum + m.periodVisitCount, 0);

  return {
    ratePerKm,
    targetDateStr,
    targetMonthKey,
    availableMonths,
    dayTotalKm,
    dayTotalSubsidy,
    dayActiveManagers,
    dayTotalVisits,
    monthTotalKm,
    monthTotalSubsidy,
    monthActiveManagers,
    monthTotalActiveDays,
    monthTotalVisits,
    periodTotalKm,
    periodTotalSubsidy,
    periodTotalVisits,
    managersReport,
  };
};

