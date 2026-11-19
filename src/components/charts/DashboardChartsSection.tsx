import React from 'react';
import type { Manager } from '../../types';
import type { RegionStoreCardItem } from '../RegionGroupedStores';
import { CoverageRadarChart } from './CoverageRadarChart';
import { RiskDistributionChart } from './RiskDistributionChart';
import { IssuePieChart } from './IssuePieChart';

interface DashboardChartsSectionProps {
  radarData: { subject: string; A: number; fullMark: number }[];
  riskData: { name: string; value: number; color: string; stores?: RegionStoreCardItem[] }[];
  pieData: { name: string; value: number; color: string; stores?: RegionStoreCardItem[] }[];
  managers: Manager[];
  onStoreSelect: (storeName: string, recordId?: string) => void;
}

/**
 * 巡店戰情視覺化圖表區塊（獨立抽離以便主儀表板透過 React.lazy 非阻塞懶載入 Recharts）
 */
export const DashboardChartsSection: React.FC<DashboardChartsSectionProps> = ({
  radarData,
  riskData,
  pieData,
  managers,
  onStoreSelect,
}) => {
  return (
    <div id="section-charts" className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      <CoverageRadarChart data={radarData} />
      <RiskDistributionChart data={riskData} managers={managers} onStoreSelect={onStoreSelect} />
      <IssuePieChart data={pieData} managers={managers} onStoreSelect={onStoreSelect} />
    </div>
  );
};

