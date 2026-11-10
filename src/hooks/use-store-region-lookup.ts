import { useCallback, useMemo } from 'react';
import type { Manager } from '../types';
import {
  UNKNOWN_REGION,
  buildStoreRegionLookup,
  normalizeStoreName,
  type StoreRegionInfo,
} from '../utils/store-region';

/**
 * 提供穩定的門市區域查詢函式（依組織主檔變動才重建對照表）
 * @param managers 門市組織主檔
 * @returns getRegionInfo 查詢門市所屬區域與負責主管
 */
export const useStoreRegionLookup = (managers: Manager[] = []) => {
  const lookup = useMemo(() => buildStoreRegionLookup(managers), [managers]);

  const getRegionInfo = useCallback(
    (storeName: string): StoreRegionInfo =>
      lookup.get(normalizeStoreName(storeName)) || { region: UNKNOWN_REGION, managerLabel: '' },
    [lookup]
  );

  return getRegionInfo;
};

