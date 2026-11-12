import type { GeoPoint } from '../data/storeCoordinates';
import { estimateDrivingKm, getRegionHubPoint } from '../data/storeCoordinates';
import { DEFAULT_SUBSIDY_PER_KM } from './mileage-calculator';

/**
 * 巡店行程單一站點定義
 */
export interface RouteStop {
  id: string;
  storeName: string;
  label: string;
  geoPoint: GeoPoint;
  visitTime?: string;
  actionType: string;
  recordId?: string;
  overallRating?: string;
  abnormalFlag?: boolean;
  highlightDescription?: string;
  orderIndex: number; // 實際訪問順序 (1-based)
  isSchedule: boolean;
}

/**
 * 路徑單一分段 (Leg)
 */
export interface OptimizedLeg {
  from: RouteStop | { label: string; geoPoint: GeoPoint };
  to: RouteStop | { label: string; geoPoint: GeoPoint };
  distanceKm: number;
  subsidyCost: number;
  isReturnLeg?: boolean;
}

/**
 * 車程最佳化分析結果
 */
export interface RouteOptimizationResult {
  managerName: string;
  region: string;
  dateStr: string;
  ratePerKm: number;
  hubPoint: GeoPoint;

  // 實際巡店路線
  actualStops: RouteStop[];
  actualLegs: OptimizedLeg[];
  actualTotalKm: number;
  actualTotalCost: number;

  // 最佳化建議巡店路線
  optimalStops: RouteStop[];
  optimalLegs: OptimizedLeg[];
  optimalTotalKm: number;
  optimalTotalCost: number;

  // 效益比對指標
  savedKm: number;
  savedCost: number;
  savedMinutes: number; // 預估節省車程時間（分）
  efficiencyScore: number; // 效率分數 (0-100)
  isAlreadyOptimal: boolean;
  suggestionText: string;
  adviceBullets: string[];
}

/**
 * 依據兩點經緯度與區域特性計算預估道路里程
 */
const getLegKm = (a: GeoPoint, b: GeoPoint, region?: string): number => {
  return estimateDrivingKm(a, b, region);
};

/**
 * 旅行推銷員問題 (TSP) 全局最短路徑窮舉演算法 (當站點 <= 8 時保證絕對最優)
 */
const findOptimalPermutationExact = (
  hub: GeoPoint,
  stops: RouteStop[],
  region: string
): RouteStop[] => {
  const n = stops.length;
  if (n <= 1) return [...stops];

  let bestOrder: RouteStop[] = [...stops];
  let minTotalKm = Number.POSITIVE_INFINITY;

  // 遞迴全排列搜索
  const permute = (currentPerm: RouteStop[], remaining: RouteStop[], currentDist: number) => {
    // 剪枝優化：如果目前部分路徑累計里程已經超過當前最優，提早剪枝
    if (currentDist >= minTotalKm) return;

    if (remaining.length === 0) {
      // 加上末站返回 Hub 的距離
      const lastStop = currentPerm[currentPerm.length - 1];
      const returnDist = getLegKm(lastStop.geoPoint, hub, region);
      const total = currentDist + returnDist;
      if (total < minTotalKm) {
        minTotalKm = total;
        bestOrder = [...currentPerm];
      }
      return;
    }

    for (let i = 0; i < remaining.length; i++) {
      const nextStop = remaining[i];
      const prevPoint = currentPerm.length === 0 ? hub : currentPerm[currentPerm.length - 1].geoPoint;
      const legDist = getLegKm(prevPoint, nextStop.geoPoint, region);

      permute(
        [...currentPerm, nextStop],
        remaining.filter((_, idx) => idx !== i),
        currentDist + legDist
      );
    }
  };

  permute([], stops, 0);
  return bestOrder;
};

/**
 * 當站點 > 8 時，採用貪婪最近鄰 + 2-opt 局部搜索快速求取高質量近似最優解
 */
const findOptimalPermutationHeuristic = (
  hub: GeoPoint,
  stops: RouteStop[],
  region: string
): RouteStop[] => {
  const unvisited = [...stops];
  const route: RouteStop[] = [];
  let currentPoint = hub;

  // 1. 最近鄰貪婪建構
  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < unvisited.length; i++) {
      const dist = getLegKm(currentPoint, unvisited[i].geoPoint, region);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    const next = unvisited.splice(nearestIdx, 1)[0];
    route.push(next);
    currentPoint = next.geoPoint;
  }

  // 2. 2-opt 局部交叉解開優化
  let improved = true;
  let iterations = 0;
  while (improved && iterations < 50) {
    improved = false;
    iterations++;
    for (let i = 0; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        const prevPoint = i === 0 ? hub : route[i - 1].geoPoint;
        const nextPoint = k === route.length - 1 ? hub : route[k + 1].geoPoint;

        const currentDist =
          getLegKm(prevPoint, route[i].geoPoint, region) +
          getLegKm(route[k].geoPoint, nextPoint, region);

        const newDist =
          getLegKm(prevPoint, route[k].geoPoint, region) +
          getLegKm(route[i].geoPoint, nextPoint, region);

        if (newDist + 0.1 < currentDist) {
          // 反轉 i 到 k 區段
          const reversed = route.slice(i, k + 1).reverse();
          route.splice(i, k - i + 1, ...reversed);
          improved = true;
        }
      }
    }
  }

  return route;
};

/**
 * 依據站點順序建構完整 Legs 分段陣列與總里程
 */
const buildLegs = (
  hub: GeoPoint,
  stops: RouteStop[],
  ratePerKm: number,
  region: string
): { legs: OptimizedLeg[]; totalKm: number; totalCost: number } => {
  if (stops.length === 0) {
    return { legs: [], totalKm: 0, totalCost: 0 };
  }

  const legs: OptimizedLeg[] = [];
  let current: { label: string; geoPoint: GeoPoint } = { label: hub.label, geoPoint: hub };

  for (const stop of stops) {
    const km = getLegKm(current.geoPoint, stop.geoPoint, region);
    legs.push({
      from: current,
      to: stop,
      distanceKm: km,
      subsidyCost: Math.round(km * ratePerKm),
      isReturnLeg: false,
    });
    current = stop;
  }

  // 末站返回 Hub
  const returnKm = getLegKm(current.geoPoint, hub, region);
  if (returnKm > 0) {
    legs.push({
      from: current,
      to: { label: hub.label, geoPoint: hub },
      distanceKm: returnKm,
      subsidyCost: Math.round(returnKm * ratePerKm),
      isReturnLeg: true,
    });
  }

  const totalKm = Math.round(legs.reduce((sum, leg) => sum + leg.distanceKm, 0) * 10) / 10;
  const totalCost = Math.round(totalKm * ratePerKm);

  return { legs, totalKm, totalCost };
};

/**
 * 主計算函數：產生當日巡店路徑最佳化與對比分析
 */
export const optimizeDailyRoute = (
  managerName: string,
  region: string,
  dateStr: string,
  rawStops: RouteStop[],
  ratePerKm: number = DEFAULT_SUBSIDY_PER_KM
): RouteOptimizationResult => {
  const hubPoint = getRegionHubPoint(region);

  // 1. 實際路線：依原始時間與填寫順序排列
  const actualStops = rawStops.map((s, idx) => ({ ...s, orderIndex: idx + 1 }));
  const { legs: actualLegs, totalKm: actualTotalKm, totalCost: actualTotalCost } = buildLegs(
    hubPoint,
    actualStops,
    ratePerKm,
    region
  );

  // 2. 最佳化路線：計算最短合理路徑
  let optimalStops: RouteStop[] = [];
  if (actualStops.length <= 1) {
    optimalStops = [...actualStops];
  } else if (actualStops.length <= 8) {
    optimalStops = findOptimalPermutationExact(hubPoint, actualStops, region);
  } else {
    optimalStops = findOptimalPermutationHeuristic(hubPoint, actualStops, region);
  }
  optimalStops = optimalStops.map((s, idx) => ({ ...s, orderIndex: idx + 1 }));

  const { legs: optimalLegs, totalKm: optimalTotalKm, totalCost: optimalTotalCost } = buildLegs(
    hubPoint,
    optimalStops,
    ratePerKm,
    region
  );

  // 3. 效益指標計算
  const savedKm = Math.max(0, Math.round((actualTotalKm - optimalTotalKm) * 10) / 10);
  const savedCost = Math.max(0, Math.round(savedKm * ratePerKm));
  // 依市區/省道平均 35 km/h 換算節省車程時間（分鐘）
  const savedMinutes = Math.round((savedKm / 35) * 60);

  const efficiencyScore =
    actualTotalKm > 0
      ? Math.min(100, Math.round((optimalTotalKm / actualTotalKm) * 100))
      : 100;

  const isAlreadyOptimal = savedKm <= 1.0;

  // 4. 產生智能排程建議提示
  const adviceBullets: string[] = [];
  let suggestionText = '';

  if (actualStops.length <= 1) {
    suggestionText = '當日僅單一站點行程，路徑已是最短直達路線。';
    adviceBullets.push('單一門市/行程查核，行程集中無繞路情況。');
  } else if (isAlreadyOptimal) {
    suggestionText = `當日巡店順序安排極佳，整體路線順暢，效率達 ${efficiencyScore}%！`;
    adviceBullets.push('當日各門市拜訪順序高度符合地理沿線走向，無明顯折返跑。');
    adviceBullets.push(`總巡航里程 ${actualTotalKm} 公里，油資補助推算 \$${actualTotalCost} 元。`);
  } else {
    suggestionText = `若調整順序，當日預估可少繞行 ${savedKm} 公里，節省約 \$${savedCost} 元車資與 ${savedMinutes} 分鐘行車時間！`;

    // 找出具體的順序調整建議
    const actualOrderNames = actualStops.map(s => s.storeName).join(' ➔ ');
    const optimalOrderNames = optimalStops.map(s => s.storeName).join(' ➔ ');

    adviceBullets.push(`實際巡店順序：${actualOrderNames}`);
    adviceBullets.push(`建議最佳順序：${optimalOrderNames}`);
    adviceBullets.push(`依地理拓撲最佳化後，可大幅減少跨區來回折返，縮減車程 ${savedKm} km。`);
    if (savedMinutes >= 15) {
      adviceBullets.push(`省下的 ${savedMinutes} 分鐘車程可充實門市輔導或現場教育訓練時間。`);
    }
  }

  return {
    managerName,
    region,
    dateStr,
    ratePerKm,
    hubPoint,
    actualStops,
    actualLegs,
    actualTotalKm,
    actualTotalCost,
    optimalStops,
    optimalLegs,
    optimalTotalKm,
    optimalTotalCost,
    savedKm,
    savedCost,
    savedMinutes,
    efficiencyScore,
    isAlreadyOptimal,
    suggestionText,
    adviceBullets,
  };
};
