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
  createdAt?: string;

  // New AuditApp fields
  auditMode?: 'A' | 'B' | 'C' | '';
  selectedTopics?: number[];
  coreChecks?: Record<string, string>;
  categoryChecks?: Record<string, string>;
  pdcaResults?: Record<string, string>;
  overallRating?: string;
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
  coverageRate?: number;
  pdcaRate?: number;
  redLightStores?: number;
  assignedStoresCount?: number;
  uniqueVisitedStoresCount?: number;
  coverageStoresInfo?: { visited: string[], unvisited: string[] };
  pdcaStoresInfo?: { closed: string[], open: string[] };
  redLightStoresList?: { store: string; reasons: string[]; reportTime?: string }[];
  visitStoresList?: string[];
  abnormalStoresList?: { store: string; reasons: string[]; reportTime?: string }[];
}
