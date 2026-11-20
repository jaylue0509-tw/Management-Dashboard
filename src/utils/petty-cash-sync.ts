import { API_BASE_URL, getAuthHeaders } from '../api/api';

export interface CloudEvidencePatch {
  originSignature?: string;
  actualKm?: number;
  customAmount?: number | null;
  invoiceNumber?: string;
  itemCategory?: string;
  routeTitle?: string;
  durationMin?: number;
  viaRoad?: string;
  stopLabels?: string[];
  googleScreenshots?: string[];
}

export interface PettyCashCloudDraft {
  managerName: string;
  monthKey: string;
  formSerialNo?: string;
  purposePrefix?: string;
  vehicleType?: 'car' | 'motorcycle';
  ratePerKm?: number;
  evidencePatches: Record<string, CloudEvidencePatch>;
  customRows: Record<string, unknown>[];
  updatedAt?: string;
  updatedBy?: string;
}

/** Vercel Serverless 請求上限為 4.5MB，保守將單次雲端草稿控制在 1.8MB 以內 */
const MAX_CLOUD_PAYLOAD_CHARS = 1_800_000;

/**
 * 裁剪超大容量之截圖 base64（優先保留所有發票號碼、高鐵票、停車費、里程與地址欄位，避免超過上傳上限）
 */
const sanitizeDraftForCloudUpload = (
  draft: Omit<PettyCashCloudDraft, 'updatedAt' | 'updatedBy'>
): Omit<PettyCashCloudDraft, 'updatedAt' | 'updatedBy'> => {
  const initialStr = JSON.stringify(draft);
  if (initialStr.length <= MAX_CLOUD_PAYLOAD_CHARS) {
    return draft;
  }

  // 若總大小超過預算，移除雲端草稿中的 base64 截圖（地圖仍可依座標與路線折線 100% 即時還原）
  const slimEvidence: Record<string, CloudEvidencePatch> = {};
  for (const [k, v] of Object.entries(draft.evidencePatches || {})) {
    const { googleScreenshots: _drop, ...rest } = v;
    slimEvidence[k] = rest;
  }
  const slimCustomRows = (draft.customRows || []).map(row => {
    const ev = row?.evidence as Record<string, unknown> | undefined;
    if (!ev) return row;
    return {
      ...row,
      evidence: {
        ...ev,
        googleScreenshots: [],
      },
    };
  });

  return {
    ...draft,
    evidencePatches: slimEvidence,
    customRows: slimCustomRows,
  };
};

/**
 * 從後端資料庫取得指定區主管於指定月份的《零用金單據黏存單》雲端草稿
 */
export const fetchPettyCashDraftFromServer = async (
  managerName: string,
  monthKey: string
): Promise<PettyCashCloudDraft | null> => {
  if (!managerName || !monthKey) return null;
  try {
    const params = new URLSearchParams({
      manager_name: managerName,
      month_key: monthKey,
    });
    const res = await fetch(`${API_BASE_URL}/petty-cash-drafts?${params.toString()}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.draft && typeof json.draft === 'object' ? (json.draft as PettyCashCloudDraft) : null;
  } catch {
    return null;
  }
};

/**
 * 將《零用金單據黏存單》草稿儲存至後端資料庫（手機填寫、電腦列印、總部線上核對）
 */
export const savePettyCashDraftToServer = async (
  draft: Omit<PettyCashCloudDraft, 'updatedAt' | 'updatedBy'>
): Promise<{ ok: boolean; draft: PettyCashCloudDraft | null }> => {
  try {
    const safePayload = sanitizeDraftForCloudUpload(draft);
    const res = await fetch(`${API_BASE_URL}/petty-cash-drafts`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...safePayload, reset: false }),
    });
    if (!res.ok) return { ok: false, draft: null };
    const json = await res.json();
    return {
      ok: Boolean(json?.success),
      draft: json?.draft ? (json.draft as PettyCashCloudDraft) : null,
    };
  } catch {
    return { ok: false, draft: null };
  }
};

export interface PettyCashDraftSummaryItem {
  updatedAt: string;
  updatedBy: string;
  formSerialNo: string;
  customRowCount: number;
  invoiceCount: number;
}

/**
 * 取得指定月份各區主管《零用金單據黏存單》雲端填報狀態摘要（供車資中心總覽顯示）
 */
export const fetchPettyCashDraftsSummary = async (
  monthKey: string
): Promise<Record<string, PettyCashDraftSummaryItem>> => {
  if (!monthKey) return {};
  try {
    const params = new URLSearchParams({ month_key: monthKey });
    const res = await fetch(`${API_BASE_URL}/petty-cash-drafts/summary?${params.toString()}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) return {};
    const json = await res.json();
    return json?.byManager && typeof json.byManager === 'object'
      ? (json.byManager as Record<string, PettyCashDraftSummaryItem>)
      : {};
  } catch {
    return {};
  }
};

/**
 * 重置並清空後端資料庫中指定主管當月之黏存單草稿
 */
export const resetPettyCashDraftOnServer = async (
  managerName: string,
  monthKey: string
): Promise<boolean> => {
  if (!managerName || !monthKey) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/petty-cash-drafts`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        managerName,
        monthKey,
        reset: true,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
};
