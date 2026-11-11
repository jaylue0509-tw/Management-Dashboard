import type { Manager, VisitRecord } from '../types';
import { getTaipeiDateStr, formatTaipeiReportTime } from './time-utils';
import { compareRegion, normalizeRegionName, normalizeStoreName } from './store-region';
import {
  HEADQUARTERS_POINT,
  estimateDrivingKm,
  getRegionHubPoint,
  getStoreGeoPoint,
  type GeoPoint,
} from '../data/storeCoordinates';

/** 預設汽車每公里油資／車程補助單價（新台幣 元/公里） */
export const DEFAULT_SUBSIDY_PER_KM = 6.5;

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
  totalKm: number;
  totalSubsidy: number;
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

/**
 * 判斷單一紀錄對應的地理座標點
 */
const resolveActivityPoint = (activity: VisitRecord, region: string): GeoPoint => {
  if (activity.actionType === '總部行程') {
    return HEADQUARTERS_POINT;
  }
  if (SCHEDULE_TYPES.has(activity.actionType)) {
    const text = `${activity.storeName || ''} ${activity.highlightDescription || ''}`;
    if (text.includes('總部')) return HEADQUARTERS_POINT;
    const hub = getRegionHubPoint(region);
    return { ...hub, label: `${activity.actionType}（${activity.highlightDescription || hub.label}）` };
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
  includeSchedule: boolean = true
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

  const hub = getRegionHubPoint(region);
  const legs: RouteLeg[] = [];
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

  if (mode === 'round_trip') {
    let currentPoint = hub;
    for (const stop of distinctStops) {
      const nextPoint = resolveActivityPoint(stop, region);
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
      });
      currentPoint = nextPoint;
    }

    // 末站返回區域中心
    const returnKm = estimateDrivingKm(currentPoint, hub, region);
    if (returnKm > 0) {
      legs.push({
        fromLabel: currentPoint.label,
        toLabel: hub.label,
        distanceKm: returnKm,
        subsidyCost: Math.round(returnKm * ratePerKm),
        isReturnLeg: true,
      });
    }
  } else {
    // 僅計門市間跨店移動（若單日僅 1 站，以區域中心單趟移動估算）
    if (distinctStops.length === 1) {
      const stop = distinctStops[0];
      const nextPoint = resolveActivityPoint(stop, region);
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
      });
    } else {
      for (let i = 0; i < distinctStops.length - 1; i++) {
        const fromStop = distinctStops[i];
        const toStop = distinctStops[i + 1];
        const fromPt = resolveActivityPoint(fromStop, region);
        const toPt = resolveActivityPoint(toStop, region);
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
        });
      }
    }
  }

  const totalKm = Math.round(legs.reduce((sum, l) => sum + l.distanceKm, 0) * 10) / 10;
  const totalSubsidy = Math.round(totalKm * ratePerKm);

  return {
    dateStr,
    managerName,
    region,
    department,
    storeVisitCount,
    scheduleCount,
    visitedStores,
    legs,
    totalKm,
    totalSubsidy,
  };
};

/**
 * 彙整全體區主管「當天推算費用」、「每月車程費用加總」與「所選區間費用」
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
  } = params;

  const deptKeyword = selectedDepartment === 'all' ? '' : selectedDepartment.replace('營業', '');
  const filteredRawManagers =
    selectedDepartment === 'all'
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
    if (m.deputyManagerName) {
      const depName = m.deputyManagerName.trim();
      if (depName && !rosterMap.has(depName)) {
        rosterMap.set(depName, {
          managerName: depName,
          roleLabel: '副區主管',
          region: reg,
          department: m.department || '',
          stores: new Set(),
        });
      }
      if (depName && m.storeName) {
        rosterMap.get(depName)!.stores.add(m.storeName);
      }
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
        includeSchedule
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
        includeSchedule
      );
      if (route) {
        monthDailyRoutes.push(route);
      }
    }
    monthDailyRoutes.sort((a, b) => b.dateStr.localeCompare(a.dateStr));

    const monthKm =
      Math.round(monthDailyRoutes.reduce((sum, r) => sum + r.totalKm, 0) * 10) / 10;
    const monthSubsidy = Math.round(monthKm * ratePerKm);
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
        includeSchedule
      );
      if (route) periodRoutes.push(route);
    }
    const periodKm = Math.round(periodRoutes.reduce((sum, r) => sum + r.totalKm, 0) * 10) / 10;
    const periodSubsidy = Math.round(periodKm * ratePerKm);
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
  const dayTotalSubsidy = Math.round(dayTotalKm * ratePerKm);
  const dayActiveManagers = managersReport.filter(m => m.dayKm > 0).length;
  const dayTotalVisits = managersReport.reduce((sum, m) => sum + m.dayVisitCount, 0);

  const monthTotalKm =
    Math.round(managersReport.reduce((sum, m) => sum + m.monthKm, 0) * 10) / 10;
  const monthTotalSubsidy = Math.round(monthTotalKm * ratePerKm);
  const monthActiveManagers = managersReport.filter(m => m.monthKm > 0).length;
  const monthTotalActiveDays = managersReport.reduce((sum, m) => sum + m.monthActiveDays, 0);
  const monthTotalVisits = managersReport.reduce((sum, m) => sum + m.monthVisitCount, 0);

  const periodTotalKm =
    Math.round(managersReport.reduce((sum, m) => sum + m.periodKm, 0) * 10) / 10;
  const periodTotalSubsidy = Math.round(periodTotalKm * ratePerKm);
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

