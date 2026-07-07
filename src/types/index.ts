export interface Manager {
  department: string;
  directorName: string;
  region: string;
  areaManagerName: string;
  deputyManagerName: string;
  storeName: string;
  beautyLeader: string;
  managerStatus?: string;
  
  // Dashboard fields calculated
  todayVisitCount?: number;
  assignedStoreCount?: number;
  hasAbnormal?: boolean;
  visitStatus?: '尚未回填' | '巡店中' | '已完成';
  visitedStores?: string[];
  expectedStayMinutes?: number;
}

export interface VisitRecord {
  recordId: string;
  areaManagerName: string;
  jobTitle: string;
  actionType: string;
  storeName: string;
  region: string;
  timeAgoMinutes: number;
  photoPairs?: {
    beforeUrl: string;
    afterUrl: string;
  }[];
  expectedStayMinutes: number;
  tags: string[];
  immediateImprovement: string;
  highlightDescription?: string;
  abnormalFlag: boolean;
}

export interface DashboardSummary {
  totalVisits: number;
  completedManagersCount: number;
  pendingManagersCount: number;
  visitedStoresCount: number;
  abnormalIssuesCount: number;
  improvementIssuesCount: number;
  totalExpectedStayMinutes: number;
  highlightCount: number;
}
