/**
 * 美容總監巡店表核心題庫、零容忍安全紅線與共用標籤定義
 * 與後端 backend/utils.py 維持 1:1 鍵名對照，供填報表單、動態牆與高層專項戰情看板共用
 */

export type BeautyAuditMode = 'A' | 'B' | 'C';
export type BeautyCheckStatus = 'N/A' | '合格' | '待改善' | '缺失';
export type BeautyOverallRating = '優良標竿' | '需追蹤改善' | '高風險（立即重點輔導）';

export interface BeautyCoreCheckItem {
  id: string;
  title: string;
  standard: string;
  passLabel: string;
  failLabel: '違規' | '待改善';
}

export interface BeautySubCheckItem {
  id: string;
  code: string;
  title: string;
  description: string;
}

export interface BeautyTopicGroup {
  id: number;
  title: string;
  subtitle?: string;
  allowBatchNA?: boolean;
  hasCoachingSection?: boolean;
  items: BeautySubCheckItem[];
}

export const BEAUTY_AUDIT_MODES: Array<{
  id: BeautyAuditMode;
  badge: string;
  title: string;
  durationMin: number;
  summary: string;
  useCase: string;
}> = [
  {
    id: 'A',
    badge: '模式 A',
    title: '快閃抽查（15 分鐘）',
    durationMin: 15,
    summary: '僅檢核「第二層必看安全底線」＋「第 0 區歷程追蹤」，跳過第三層。',
    useCase: '適用：順路經過、突擊安全檢查',
  },
  {
    id: 'B',
    badge: '模式 B',
    title: '主題深度輔導（30 分鐘）',
    durationMin: 30,
    summary: '針對特定的 1～3 個大項進行深度抽查與現場指導。',
    useCase: '適用：住宿旺季前健檢、客訴後專案輔導、技術抽考',
  },
  {
    id: 'C',
    badge: '模式 C',
    title: '全區美容/住宿完整評鑑（60 分鐘）',
    durationMin: 60,
    summary: '六大核心大項全開，完整檢視安全、技術、住宿、衛生、客服與團隊。',
    useCase: '適用：新店開幕驗收、美容師升等考核、季度大檢討',
  },
];

/** 第二層：每次進店必看安全與衛生底線（零容忍紅線） */
export const BEAUTY_CORE_SAFETY_ITEMS: BeautyCoreCheckItem[] = [
  {
    id: 'b-core-1',
    title: '1. 美容操作防墜與牽繩',
    standard:
      '美容桌上操作時 100% 繫妥安全防護繩；美容師離開工作台時，毛孩必須入籠，嚴禁單獨留置桌上。',
    passLabel: '合格',
    failLabel: '違規',
  },
  {
    id: 'b-core-2',
    title: '2. 美容/住宿區空氣與異味',
    standard: '進門無刺鼻阿摩尼亞味、排泄物積留或潮濕霉味；排風與除濕設備正常運轉。',
    passLabel: '合格',
    failLabel: '待改善',
  },
  {
    id: 'b-core-3',
    title: '3. 住宿水糧與門鎖安全',
    standard: '住宿房內清潔無排泄物、乾淨飲水充足；雙重門禁（防逃脫柵欄）確實關閉上鎖。',
    passLabel: '合格',
    failLabel: '違規',
  },
];

/** 第三層：美容與住宿六大核心大項庫 */
export const BEAUTY_TOPIC_GROUPS: BeautyTopicGroup[] = [
  {
    id: 1,
    title: '大項 1：美容安全操作與服務 SOP',
    items: [
      {
        id: 'b-1-1',
        code: '1-1',
        title: '接送與體表檢查落實',
        description:
          '進店與離店皆與飼主核對「體表檢查紀錄表」（跳蚤壁蝨、皮膚紅腫、傷口、耳道），並請飼主簽名確認。',
      },
      {
        id: 'b-1-2',
        code: '1-2',
        title: '洗浴與吹整安全',
        description:
          '水溫測試適宜；使用烘箱時全程計時並有人員視線監看（嚴禁老犬/短吻犬/心臟病犬使用密閉烘箱）。',
      },
      {
        id: 'b-1-3',
        code: '1-3',
        title: '工具消毒與防交叉感染',
        description:
          '每服務完一隻毛孩，電剪刀頭、剪刀、梳具皆有使用酒精/紫外線消毒；毛巾「一犬一巾」不混用。',
      },
    ],
  },
  {
    id: 2,
    title: '大項 2：美容技術品質與造型美感',
    items: [
      {
        id: 'b-2-1',
        code: '2-1',
        title: '基礎護理細膩度',
        description: '指甲修剪圓潤不流血、腳底毛與肛門腺清理乾淨、耳毛拔除與耳道清潔徹底。',
      },
      {
        id: 'b-2-2',
        code: '2-2',
        title: '吹整蓬鬆度與剪工線條',
        description:
          '毛髮徹底吹乾不打結（特別是腋下、鼠蹊部）；修剪線條流暢無明顯刀痕缺角。',
      },
      {
        id: 'b-2-3',
        code: '2-3',
        title: '洗劑正確使用與稀釋',
        description:
          '依毛孩膚況正確選用機能洗劑（低敏/藥浴/蓬鬆），稀釋比例符合標準，當日未使用完之稀釋液有倒除。',
      },
    ],
  },
  {
    id: 3,
    title: '大項 3：寵物住宿照護與環境管理',
    subtitle: '無住宿業務可一鍵整項設為 N/A',
    allowBatchNA: true,
    items: [
      {
        id: 'b-3-1',
        code: '3-1',
        title: '犬貓分區與空間舒適度',
        description:
          '犬舍與貓舍完全隔離（無視覺與聽覺干擾）；房內備有乾淨睡墊、貓砂盆清潔無異味。',
      },
      {
        id: 'b-3-2',
        code: '3-2',
        title: '每日照護與健康觀察紀錄',
        description:
          '按時填寫餵食量、飲水量、大小便狀況及精神狀態，並每日定時回傳照片/影片給飼主。',
      },
      {
        id: 'b-3-3',
        code: '3-3',
        title: '放風與外出安全規範',
        description:
          '放風區一犬一梯次不混放；外出散步全程使用「雙牽繩（胸背帶+項圈）」並避開高溫時段。',
      },
      {
        id: 'b-3-4',
        code: '3-4',
        title: '飼主自備品與特殊醫囑管理',
        description:
          '飼料、藥物、玩具分房獨立收納並標示房號與姓名，特殊用藥有雙重核對紀錄。',
      },
    ],
  },
  {
    id: 4,
    title: '大項 4：美容/住宿環境衛生與設備維護',
    items: [
      {
        id: 'b-4-1',
        code: '4-1',
        title: '美容室與洗浴區清潔',
        description: '排水孔無毛髮堵塞、牆面無水垢皂垢、等待籠舍乾淨無尿漬。',
      },
      {
        id: 'b-4-2',
        code: '4-2',
        title: '每日清消紀錄落實',
        description:
          '美容區與住宿區早晚消毒紀錄表（使用寵物友善消毒液）按時簽核，無補簽或漏簽。',
      },
      {
        id: 'b-4-3',
        code: '4-3',
        title: '專業設備運作與保養',
        description:
          '吹水機濾網清潔無積毛、電動升降桌油壓正常、熱水器水溫穩定、監視器（無死角覆蓋美容桌與住宿房）錄影正常。',
      },
      {
        id: 'b-4-4',
        code: '4-4',
        title: '溫濕度與通風控制',
        description: '室內溫度維持 22~25°C、濕度 50~65%，溫濕度計顯示正常。',
      },
    ],
  },
  {
    id: 5,
    title: '大項 5：顧客溝通、衛教與客訴預防',
    items: [
      {
        id: 'b-5-1',
        code: '5-1',
        title: '溝通單與報價透明',
        description:
          '操作前與飼主確認造型需求、打結/拆結加價費用及預計完成時間，無事前未告知之爭議收費。',
      },
      {
        id: 'b-5-2',
        code: '5-2',
        title: '專業皮膚/毛髮衛教與加值推薦',
        description:
          '能根據美容時發現的皮膚/耳道/牙結石狀況，提供專業居家照護建議，並自然推薦 SPA 護理、碳酸泉或賣場機能保健/洗護商品。',
      },
      {
        id: 'b-5-3',
        code: '5-3',
        title: '客訴與突發狀況應變',
        description: '現場人員清楚美容意外（如小刮傷、緊迫）的即時通報與安撫 SOP。',
      },
    ],
  },
  {
    id: 6,
    title: '大項 6：美容營運績效與團隊培育',
    hasCoachingSection: true,
    items: [
      {
        id: 'b-6-1',
        code: '6-1',
        title: '預約排程與產能利用率',
        description:
          '美容師每日接單量（件數/產值）合理，無過度超收導致品質下降，亦無時段嚴重閒置；包月/儲值客回流率追蹤。',
      },
      {
        id: 'b-6-2',
        code: '6-2',
        title: '美容與門市跨部門協作',
        description:
          '門市人員能主動協助美容接單、推廣住宿與 SPA 活動，前場與後場溝通順暢。',
      },
    ],
  },
];

export const BEAUTY_COACHING_TARGET_OPTIONS = ['美容師', '資深美容師', '助理/實習生'] as const;

/** 美容一處固定轄區（其餘區域全歸屬美容二處） */
export const BEAUTY_DEPT_1_REGIONS = new Set(['新北區', '北桃區', '竹苗區', '宜花區', '嘉南區', '台南區']);

/** 各美容處總監固定組織配置（與後端 backend/database.py 保持 1:1 一致） */
export interface BeautyDirectorProfile {
  name: string;
  nickname: string;
  department: '美容一處' | '美容二處';
  supervisor: string;
  regions: string[];
}

export const BEAUTY_DIRECTORS_CONFIG: BeautyDirectorProfile[] = [
  {
    name: '廖羿蓁',
    nickname: 'kelly',
    department: '美容一處',
    supervisor: '簡楷潔',
    regions: ['新北區', '北桃區', '竹苗區', '宜花區', '嘉南區'],
  },
  {
    name: '戴欐蘐',
    nickname: '小貝',
    department: '美容二處',
    supervisor: '蔡嘉峯',
    regions: ['中投區', '彰雲區', '高雄區', '高屏區'],
  },
];

/**
 * 依據區域名稱取得負責的美容總監配置（美容一處：新北/北桃/竹苗/宜花/嘉南；其餘為美容二處）
 */
export const getBeautyDirectorByRegion = (region?: string): BeautyDirectorProfile => {
  const clean = (region || '').trim();
  if (BEAUTY_DEPT_1_REGIONS.has(clean)) {
    return BEAUTY_DIRECTORS_CONFIG[0];
  }
  return BEAUTY_DIRECTORS_CONFIG[1];
};

/**
 * 判斷指定門市／區域是否屬於該位美容總監的管轄範圍
 */
export const isRegionInBeautyDirectorScope = (
  region: string | undefined,
  department: string | undefined
): boolean => {
  const cleanRegion = (region || '').trim();
  const inDept1 = BEAUTY_DEPT_1_REGIONS.has(cleanRegion);
  if (department === '美容一處') return inDept1;
  if (department === '美容二處') return !inDept1;
  return false;
};

/** 供動態牆與報表快速查找之美容巡店細項名稱對照表 */
export const BEAUTY_ITEM_LABEL_MAP: Record<string, string> = {
  'b-core-1': '美容操作防墜與牽繩',
  'b-core-2': '美容/住宿區空氣與異味',
  'b-core-3': '住宿水糧與門鎖安全',
  ...Object.fromEntries(
    BEAUTY_TOPIC_GROUPS.flatMap(g => g.items.map(it => [it.id, it.title]))
  ),
};

export const BEAUTY_TOPIC_NAMES: string[] = BEAUTY_TOPIC_GROUPS.map(g =>
  g.title.replace(/^大項\s*\d+：/, '')
);
