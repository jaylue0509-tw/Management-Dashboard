import type { Manager } from '../types';
import { storeRegions } from '../data/storeRegions';

export interface StoreRegionInfo {
  region: string;
  managerLabel: string;
}

export const UNKNOWN_REGION = '其他區域';

/** 依組織主檔定義的區域排序（北 → 南 → 東） */
export const REGION_ORDER: string[] = Object.keys(storeRegions);

/**
 * 門市名稱正規化：去除前後空白與結尾「店」字
 * NOTE: 表單與主檔寫法不一致（例如「新營民生」vs「新營民生店」）時仍能正確比對
 */
export const normalizeStoreName = (name: string): string => (name || '').trim().replace(/店$/, '');

/**
 * 舊區域名稱對應（組織整併後歷史紀錄仍可能帶有舊名稱）
 */
export const normalizeRegionName = (region?: string): string => {
  if (!region) return '';
  return region === '台南區' ? '嘉南區' : region;
};

/**
 * 依 REGION_ORDER 排序區域；未定義的區域排在最後
 */
export const compareRegion = (a: string, b: string): number => {
  const idxA = REGION_ORDER.indexOf(a);
  const idxB = REGION_ORDER.indexOf(b);
  if (idxA !== -1 && idxB !== -1) return idxA - idxB;
  if (idxA !== -1) return -1;
  if (idxB !== -1) return 1;
  return a.localeCompare(b, 'zh-Hant');
};

/**
 * 組合區主管顯示文字（含副區主管）
 */
export const formatManagerLabel = (areaManagerName?: string, deputyManagerName?: string): string => {
  if (!areaManagerName) return '';
  return deputyManagerName ? `${areaManagerName} · 副區主管：${deputyManagerName}` : areaManagerName;
};

/**
 * 建立「門市 → 區域 / 負責主管」對照表
 * 先以靜態 storeRegions 為基礎，再以後端組織主檔覆蓋，確保主管資訊即時正確
 */
export const buildStoreRegionLookup = (managers: Manager[]): Map<string, StoreRegionInfo> => {
  const map = new Map<string, StoreRegionInfo>();

  for (const [region, stores] of Object.entries(storeRegions)) {
    for (const store of stores) {
      map.set(normalizeStoreName(store), { region, managerLabel: '' });
    }
  }

  for (const m of managers) {
    if (!m.storeName) continue;
    const norm = normalizeStoreName(m.storeName);
    const region = normalizeRegionName(m.region) || map.get(norm)?.region || UNKNOWN_REGION;
    map.set(norm, { region, managerLabel: formatManagerLabel(m.areaManagerName, m.deputyManagerName) });
  }

  return map;
};

export interface RegionGroup<T> {
  region: string;
  managerLabel: string;
  items: T[];
}

/**
 * 將項目依門市所屬區域分組並排序
 * @param items 待分組項目
 * @param getStoreName 取得項目門市名稱
 * @param getRegionInfo 門市區域查詢函式
 */
export const groupByRegion = <T,>(
  items: T[],
  getStoreName: (item: T) => string,
  getRegionInfo: (store: string) => StoreRegionInfo
): RegionGroup<T>[] => {
  const map = new Map<string, RegionGroup<T>>();
  for (const item of items) {
    const info = getRegionInfo(getStoreName(item));
    let group = map.get(info.region);
    if (!group) {
      group = { region: info.region, managerLabel: info.managerLabel, items: [] };
      map.set(info.region, group);
    }
    if (!group.managerLabel && info.managerLabel) group.managerLabel = info.managerLabel;
    group.items.push(item);
  }
  return Array.from(map.values()).sort((a, b) => compareRegion(a.region, b.region));
};

