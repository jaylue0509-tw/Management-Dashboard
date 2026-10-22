import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { Camera, Mic, Save, ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, Trash2, LogOut, KeyRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { storeRegions } from '../data/storeRegions';
import { ChangePasswordModal } from '../components/ChangePasswordModal';

const LOCAL_STORAGE_KEY = 'audit_app_draft';

export const AuditApp = () => {
  const navigate = useNavigate();
  const sigCanvas = useRef<SignatureCanvas>(null);
  const { user, logout } = useAuth();
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  // Stepper State
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 5;

  // --- Form States ---
  const [storeName, setStoreName] = useState('');
  const [mgrName, setMgrName] = useState(user?.name || '未知主管');
  const [auditMode, setAuditMode] = useState<string>('C');
  const [selectedTopics, setSelectedTopics] = useState<number[]>([]);
  const [coreChecks, setCoreChecks] = useState<Record<string, string>>({});
  const [categoryChecks, setCategoryChecks] = useState<Record<string, string>>({});
  const [categoryRemarks, setCategoryRemarks] = useState<Record<string, string>>({});
  const [customItems, setCustomItems] = useState<Record<number, string[]>>({});
  const [customInputValues, setCustomInputValues] = useState<Record<number, string>>({});
  
  // PDCA States
  const [actionItemsLoading, setActionItemsLoading] = useState(false);
  const [pastActionItems, setPastActionItems] = useState<any[]>([]);
  const [pdcaResults, setPdcaResults] = useState<Record<string, string>>({});
  const [newActionItems, setNewActionItems] = useState([{ desc: '', assignee: '', dueDate: '' }]);
  const [photoPairs, setPhotoPairs] = useState<{beforeUrl: string, afterUrl: string}[]>([{beforeUrl: '', afterUrl: ''}]);
  
  const [overallRating, setOverallRating] = useState('');

  // --- Local Storage Auto Save & Safe Recovery ---
  const [isDraftRestored, setIsDraftRestored] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string>('');
  const [draftWarning, setDraftWarning] = useState<string>('');
  const [hasRestoredBanner, setHasRestoredBanner] = useState<boolean>(false);
  const [saveToast, setSaveToast] = useState<boolean>(false);

  // 安全存入 LocalStorage，防禦 QuotaExceededError 確保文字資料 100% 永不遺失
  const saveDraftSafe = () => {
    const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
    const draft = {
      storeName,
      mgrName: user?.name || mgrName,
      auditMode,
      selectedTopics,
      coreChecks,
      categoryChecks,
      categoryRemarks,
      customItems,
      pdcaResults,
      newActionItems,
      overallRating,
      photoPairs,
      currentStep,
      savedAt: timeStr
    };

    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(draft));
      setDraftSavedAt(timeStr);
      setDraftWarning('');
    } catch (quotaErr) {
      // 若因照片 Base64 累積超過行動瀏覽器 5MB 限制，自動啟動降級保護：剔除照片大圖，確保所有勾選、評分與文字備註安全入庫
      console.warn('LocalStorage 空間不足，啟用降級保護：保全所有文字、項目與進度', quotaErr);
      try {
        const slimDraft = {
          ...draft,
          photoPairs: draft.photoPairs?.map(() => ({ beforeUrl: '', afterUrl: '' })) || []
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(slimDraft));
        setDraftSavedAt(timeStr);
        setDraftWarning('文字資料已妥善暫存（因本機容量限制，照片暫不存於本機，送出時仍會上傳）');
      } catch (innerErr) {
        console.error('嚴重 LocalStorage 儲存錯誤', innerErr);
      }
    }
  };

  // 手動儲存按鈕
  const handleManualSave = () => {
    saveDraftSafe();
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2500);
  };

  // 進入頁面時無損自動還原草稿，避免主管手誤點擊取消而遺失心血
  useEffect(() => {
    const draftStr = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (draftStr) {
      try {
        const draft = JSON.parse(draftStr);
        const hasContent = Boolean(
          draft.storeName ||
          (draft.selectedTopics && draft.selectedTopics.length > 0) ||
          (draft.coreChecks && Object.keys(draft.coreChecks).length > 0) ||
          (draft.categoryChecks && Object.keys(draft.categoryChecks).length > 0)
        );

        if (hasContent) {
          setStoreName(draft.storeName || '');
          setMgrName(user?.name || draft.mgrName || '區主管');
          setAuditMode(draft.auditMode || 'C');
          setSelectedTopics(draft.selectedTopics || []);
          setCoreChecks(draft.coreChecks || {});
          setCategoryChecks(draft.categoryChecks || {});
          setCategoryRemarks(draft.categoryRemarks || {});
          setCustomItems(draft.customItems || {});
          setPdcaResults(draft.pdcaResults || {});
          setNewActionItems(draft.newActionItems || [{ desc: '', assignee: '', dueDate: '' }]);
          setOverallRating(draft.overallRating || '');
          setPhotoPairs(draft.photoPairs || [{ beforeUrl: '', afterUrl: '' }]);
          if (draft.currentStep) setCurrentStep(draft.currentStep);
          setDraftSavedAt(draft.savedAt || '稍早');
          setHasRestoredBanner(true);
        }
      } catch (e) {
        console.error('Failed to parse draft', e);
      }
    }
    setIsDraftRestored(true);
  }, [user]);

  // 當使用者登入身分載入後，同步主管姓名
  useEffect(() => {
    if (user?.name) {
      setMgrName(user.name);
    }
  }, [user?.name]);

  // 表單變更時自動儲存草稿
  useEffect(() => {
    if (!isDraftRestored) return;
    saveDraftSafe();
  }, [storeName, mgrName, auditMode, selectedTopics, coreChecks, categoryChecks, categoryRemarks, customItems, pdcaResults, newActionItems, overallRating, photoPairs, currentStep, isDraftRestored]);



  /**
   * 將使用者拍照/上傳的圖片進行客戶端等比縮放壓縮轉為 base64 (JPEG)
   * 限制最大寬高 1280px，品質 0.75，大幅降低網路傳輸耗時並確保後台有效儲存
   */
  const compressImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1280;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleAddCustomItem = (index: number) => {
    const val = customInputValues[index]?.trim();
    if (val) {
      setCustomItems(prev => ({
        ...prev,
        [index]: [...(prev[index] || []), val]
      }));
      setCustomInputValues(prev => ({ ...prev, [index]: '' }));
    }
  };

  // --- Fetch Action Items ---
  const fetchActionItems = async (store: string) => {
    if (!store) return;
    setActionItemsLoading(true);
    try {
      const res = await fetch(`/api/action-items?store=${encodeURIComponent(store)}`);
      if (res.ok) {
        const data = await res.json();
        setPastActionItems(data.filter((item: any) => item.status === 'Open'));
      }
    } catch (e) {
      console.error(e);
    }
    setActionItemsLoading(false);
  };

  // --- Submit with Retry & Data Persistence Guarantee ---
  const [submitting, setSubmitting] = useState(false);
  const [submitStatusText, setSubmitStatusText] = useState('');

  const submitForm = async () => {
    if (submitting) return;
    if (!storeName) return alert('請選擇門市名稱');
    if (!auditMode) return alert('請選擇巡店模式');
    
    // 檢查是否有缺失未填寫備註
    for (const [k, v] of Object.entries(coreChecks)) {
      if (v === '缺失' && !categoryRemarks[k]?.trim()) return alert(`核心底線有缺失未填寫說明，請返回步驟2補齊`);
    }
    for (const [k, v] of Object.entries(categoryChecks)) {
      if (v === '缺失' && !categoryRemarks[k]?.trim()) return alert(`模組細項有缺失未填寫說明，請返回步驟3補齊`);
    }

    if (Object.keys(coreChecks).length < 3) return alert('請完成第二層：必看核心底線');
    if (!overallRating) return alert('請選擇巡店綜合評價');
    
    const signature = sigCanvas.current?.isEmpty() ? null : sigCanvas.current?.toDataURL();

    // 查找所選門市所屬區域
    let detectedRegion = '';
    for (const [r, stores] of Object.entries(storeRegions)) {
      if (stores.includes(storeName)) {
        detectedRegion = r;
        break;
      }
    }

    const payload = {
      storeName,
      region: detectedRegion,
      areaManagerName: user?.name || mgrName,
      auditMode,
      selectedTopics,
      coreChecks,
      categoryChecks,
      categoryRemarks,
      pdcaResults,
      newActionItems: newActionItems.filter(i => i.desc?.trim()),
      overallRating,
      signature,
      photoPairs: photoPairs.filter(p => p.beforeUrl || p.afterUrl),
      createdAt: new Date().toISOString()
    };

    setSubmitting(true);
    setSubmitStatusText('正在安全傳輸巡店紀錄與照片...');

    // 弱網與高負載環境重試機制 (最多重試 2 次)
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const endpoints = [
      '/api/visit-records',
      'https://management-dashboard-rust.vercel.app/api/visit-records'
    ];

    let isSuccess = false;
    let lastErrorMsg = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (attempt > 1) {
          setSubmitStatusText('連線稍有延遲，正在自動為您重試 (第 2 次)...');
          await new Promise(r => setTimeout(r, 1500));
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 秒保護防呆

        // 生產環境優先使用同源相對路徑
        const targetUrl = import.meta.env.PROD ? endpoints[0] : endpoints[1];
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `伺服器回應狀態碼 ${res.status}`);
        }

        const resData = await res.json();
        if (resData && (resData.success || resData.data)) {
          isSuccess = true;
          break;
        } else {
          throw new Error('伺服器未回傳確認信號');
        }
      } catch (err: any) {
        lastErrorMsg = err?.message || '連線逾時或網路不穩';
        console.warn(`巡檢資料送出第 ${attempt} 次失敗:`, err);
      }
    }

    if (isSuccess) {
      // 伺服器確認持久化存檔後，才安全清除本機草稿
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      alert('🎉 巡店紀錄已成功儲存至雲端系統！');
      navigate(user?.role === 'admin' ? '/dashboard' : '/audit');
    } else {
      // 失敗時嚴格保留草稿與表單內容，確保主管心血不流失
      alert(`⚠️ 儲存失敗（${lastErrorMsg}）。\n\n【請放心】您填寫的所有內容已妥善暫存於手機本機草稿！請確認網路訊號後，直接再次點擊【送出巡店紀錄】即可重試。`);
    }

    setSubmitting(false);
    setSubmitStatusText('');
  };
  // --- Stepper Navigation ---
  const handleNext = () => {
    if (currentStep === 1) {
      if (!storeName) return alert('請先選擇門市名稱');
      if (auditMode === 'B' && selectedTopics.length === 0) return alert('請至少選擇一個查核主題');
    }
    if (currentStep === 2) {
      if (Object.keys(coreChecks).length < 3) return alert('請完成所有必看核心底線');
    }
    
    // 如果是模式A，Step 2 結束直接跳到 Step 4
    if (currentStep === 2 && auditMode === 'A') {
      setCurrentStep(4);
    } else {
      setCurrentStep(prev => Math.min(prev + 1, totalSteps));
    }
    window.scrollTo(0, 0);
  };

  const handlePrev = () => {
    if (currentStep === 4 && auditMode === 'A') {
      setCurrentStep(2);
    } else {
      setCurrentStep(prev => Math.max(prev - 1, 1));
    }
    window.scrollTo(0, 0);
  };

  // --- Render Sections ---
  const renderStep1 = () => (
    <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-xl font-bold text-gray-800 mb-6 border-b pb-3 flex items-center gap-2">
        <span className="bg-blue-100 text-blue-700 w-7 h-7 rounded-full flex items-center justify-center text-sm">1</span>
        基本資訊與模式
      </h2>
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">巡店門市 <span className="text-red-500">*</span></label>
            <select
              value={storeName}
              onChange={(e) => {
                setStoreName(e.target.value);
                fetchActionItems(e.target.value);
              }}
              className="w-full border rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
            >
              <option value="" disabled>請選擇負責的門市</option>
              {Object.entries(storeRegions).map(([region, stores]) => {
                // 如果是總部管理員(admin) 或 權限全開，就顯示全部；否則過濾出指派的門市
                const visibleStores = user?.role === 'admin' 
                  ? stores 
                  : stores.filter(s => user?.assigned_stores?.includes(s));
                  
                if (visibleStores.length === 0) return null;
                
                return (
                  <optgroup key={region} label={`【${region}】`}>
                    {visibleStores.map(store => (
                      <option key={store} value={store}>{store}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {user?.role === 'manager' && (!user.assigned_stores || user.assigned_stores.length === 0) && (
              <p className="text-xs text-amber-600 font-medium mt-1.5 flex items-center gap-1">
                ⚠️ 您的帳號目前尚未指派負責門市，請聯繫總部管理員於「系統設定」勾選負責門市。
              </p>
            )}
        </div>
        
        {/* 前次未結案 */}
        {storeName && (
        <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100">
          <div className="flex items-center justify-between mb-3">
            <p className="text-base font-bold text-gray-800 flex items-center gap-2">
              <AlertCircle size={18} className="text-orange-500" /> 前次未結案缺失 (PDCA)
            </p>
            {actionItemsLoading && <span className="text-xs text-gray-400">載入中...</span>}
          </div>
          
          <div className="space-y-3">
            {pastActionItems.length === 0 && !actionItemsLoading ? (
              <div className="text-sm text-gray-500 bg-white p-4 rounded-lg text-center border border-dashed">
                無未結案之改善事項 🎉
              </div>
            ) : (
              pastActionItems.map(item => (
                <div key={item.id} className="border p-4 rounded-xl bg-white shadow-sm">
                  <div className="text-sm font-semibold text-gray-800 mb-2">{item.issueDescription}</div>
                  <div className="text-xs text-gray-500 mb-3 flex gap-4">
                    <span>負責人: {item.assignee}</span>
                    <span className="text-red-500 font-medium">期限: {new Date(item.dueDate).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setPdcaResults({ ...pdcaResults, [item.id]: '已改善' })} className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-colors ${pdcaResults[item.id] === '已改善' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-green-50'}`}>✅ 現場已改善</button>
                    <button onClick={() => setPdcaResults({ ...pdcaResults, [item.id]: '未改善' })} className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-colors ${pdcaResults[item.id] === '未改善' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-red-50'}`}>❌ 依然未改善</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">巡店模式 <span className="text-red-500">*</span></label>
          <div className="grid grid-cols-1 gap-3">
            <label className={`border-2 p-4 rounded-xl flex items-center gap-3 cursor-pointer transition-all ${auditMode === 'A' ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-white border-gray-200 hover:border-blue-200'}`}>
              <input type="radio" name="mode" checked={auditMode === 'A'} onChange={() => setAuditMode('A')} className="w-5 h-5 text-blue-600" />
              <div>
                <div className="font-bold text-gray-800 text-base">【模式 A】快閃巡店</div>
                <div className="text-sm text-gray-500 mt-1">僅看必看底線 + 歷程追蹤，跳過第三層。</div>
              </div>
            </label>
            <label className={`border-2 p-4 rounded-xl flex items-center gap-3 cursor-pointer transition-all ${auditMode === 'B' ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-white border-gray-200 hover:border-blue-200'}`}>
              <input type="radio" name="mode" checked={auditMode === 'B'} onChange={() => setAuditMode('B')} className="w-5 h-5 text-blue-600" />
              <div>
                <div className="font-bold text-gray-800 text-base">【模式 B】主題巡店</div>
                <div className="text-sm text-gray-500 mt-1">針對特定的大項進行深度抽查。</div>
              </div>
            </label>
            <label className={`border-2 p-4 rounded-xl flex items-center gap-3 cursor-pointer transition-all ${auditMode === 'C' ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-white border-gray-200 hover:border-blue-200'}`}>
              <input type="radio" name="mode" checked={auditMode === 'C'} onChange={() => setAuditMode('C')} className="w-5 h-5 text-blue-600" />
              <div>
                <div className="font-bold text-gray-800 text-base">【模式 C】全店完整輔導</div>
                <div className="text-sm text-gray-500 mt-1">完整檢視六大模組，適合月度常規輔導。</div>
              </div>
            </label>
          </div>
        </div>

        {auditMode === 'B' && (
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
            <label className="block text-sm font-semibold text-blue-800 mb-2">請選擇本次查核主題 (可複選)</label>
            <div className="grid grid-cols-2 gap-2">
              {['行銷檔期', '陳列損耗', '寵物專業', '人員服務', '環境設備', '經營數據'].map((topic, idx) => (
                <label key={idx} className="flex items-center gap-2 text-sm text-gray-700 bg-white p-2 rounded-lg border">
                  <input 
                    type="checkbox" 
                    checked={selectedTopics.includes(idx + 1)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedTopics([...selectedTopics, idx + 1]);
                      else setSelectedTopics(selectedTopics.filter(t => t !== idx + 1));
                    }}
                    className="w-4 h-4 rounded text-blue-600"
                  />
                  {topic}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );

  const renderStep2 = () => (
    <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-in fade-in slide-in-from-right-8 duration-500">
      <h2 className="text-xl font-bold text-gray-800 mb-2 border-b pb-3 flex items-center gap-2">
        <span className="bg-blue-100 text-blue-700 w-7 h-7 rounded-full flex items-center justify-center text-sm">2</span>
        必看核心底線
      </h2>
      <p className="text-sm text-gray-500 mb-6">不論停留時間長短，進店必須立刻檢核的重點。</p>
      
      <div className="space-y-4">
        {[
          { id: 'core-1', label: '環境異味與清潔', desc: '門口/賣場無明顯排泄物或寵物異味，地板乾淨。' },
          { id: 'core-2', label: '櫃檯焦點陳列', desc: '結帳櫃檯加價購/當期主推商品有放置於黃金焦點區。' },
          { id: 'core-3', label: '人員狀態與迎賓', desc: '門市同仁穿著制服、精神狀態良好，進店有主動招呼。' }
        ].map((item) => (
          <div key={item.id} className="border p-4 rounded-xl bg-gray-50">
            <div className="font-semibold text-gray-800 mb-1">{item.label}</div>
            <div className="text-xs text-gray-500 mb-3">{item.desc}</div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setCoreChecks({ ...coreChecks, [item.id]: '正常' })} className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-colors ${coreChecks[item.id] === '正常' ? 'bg-green-600 text-white border-green-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-green-50'}`}>✅ 正常</button>
              <button onClick={() => setCoreChecks({ ...coreChecks, [item.id]: '缺失' })} className={`flex-1 py-3 rounded-lg text-sm font-bold border transition-colors ${coreChecks[item.id] === '缺失' ? 'bg-red-600 text-white border-red-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-red-50'}`}>❌ 缺失</button>
            </div>
            {coreChecks[item.id] === '缺失' && (
              <div className="mt-3 animate-in slide-in-from-top-1 fade-in duration-200">
                <input 
                  type="text" 
                  placeholder="請輸入缺失詳細說明 (必填)"
                  required
                  value={categoryRemarks[item.id] || ''}
                  onChange={(e) => setCategoryRemarks({ ...categoryRemarks, [item.id]: e.target.value })}
                  className="w-full border-red-300 bg-red-50 focus:ring-red-500 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 border transition-colors"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );

  const renderCategory = (index: number, title: string, items: string[]) => {
    if (auditMode === 'B' && !selectedTopics.includes(index)) return null; 
    
    return (
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-gray-100">
        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-sm">大項 {index}</span>
          {title}
        </h3>
        {items.map((item, i) => {
          const key = `${index}-${i+1}`;
          return (
            <div key={key} className="mb-4 border-b pb-4 last:border-b-0">
              <p className="text-sm text-gray-700 font-medium mb-3 leading-relaxed">{index}-{i+1}. {item}</p>
              <div className="grid grid-cols-4 gap-2">
                {['N/A', '合格', '待改善', '缺失'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => setCategoryChecks({ ...categoryChecks, [key]: opt })}
                    className={`py-2 rounded-lg text-sm font-semibold border transition-all ${
                      categoryChecks[key] === opt 
                        ? (opt === '缺失' || opt === '待改善' ? 'bg-red-600 text-white border-red-600' : opt === '合格' ? 'bg-green-600 text-white border-green-600' : 'bg-gray-600 text-white border-gray-600')
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {(categoryChecks[key] === '缺失' || categoryChecks[key] === '待改善') && (
                <div className="mt-3 animate-in slide-in-from-top-1 fade-in duration-200">
                  <textarea
                    placeholder="請輸入缺失/待改善詳細說明 (必填)"
                    required
                    rows={2}
                    value={categoryRemarks[key] || ''}
                    onChange={(e) => setCategoryRemarks({ ...categoryRemarks, [key]: e.target.value })}
                    className="w-full border-red-300 bg-red-50 focus:ring-red-500 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 border transition-colors resize-none"
                  />
                </div>
              )}
            </div>
          );
        })}
        {(customItems[index] || []).map((item, i) => {
          const key = item;
          return (
            <div key={key} className="mb-4 border-b pb-4 last:border-b-0">
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm text-gray-700 font-medium leading-relaxed">⭐ 自訂: {item}</p>
                <button 
                  onClick={() => {
                    setCustomItems(prev => ({ ...prev, [index]: prev[index].filter((_, idx) => idx !== i) }));
                    const newChecks = { ...categoryChecks };
                    delete newChecks[key];
                    setCategoryChecks(newChecks);
                  }}
                  className="text-gray-400 hover:text-red-500"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {['N/A', '合格', '待改善', '缺失'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => setCategoryChecks({ ...categoryChecks, [key]: opt })}
                    className={`py-2 rounded-lg text-sm font-semibold border transition-all ${
                      categoryChecks[key] === opt 
                        ? (opt === '缺失' || opt === '待改善' ? 'bg-red-600 text-white border-red-600' : opt === '合格' ? 'bg-green-600 text-white border-green-600' : 'bg-gray-600 text-white border-gray-600')
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {(categoryChecks[key] === '缺失' || categoryChecks[key] === '待改善') && (
                <div className="mt-3 animate-in slide-in-from-top-1 fade-in duration-200">
                  <textarea
                    placeholder="請輸入缺失/待改善詳細說明 (必填)"
                    required
                    rows={2}
                    value={categoryRemarks[key] || ''}
                    onChange={(e) => setCategoryRemarks({ ...categoryRemarks, [key]: e.target.value })}
                    className="w-full border-red-300 bg-red-50 focus:ring-red-500 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 border transition-colors resize-none"
                  />
                </div>
              )}
            </div>
          );
        })}
        <div className="mt-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
          <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">➕ 自訂新增項目 <Mic size={12}/></p>
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="輸入自訂缺失或狀況..." 
              value={customInputValues[index] || ''}
              onChange={(e) => setCustomInputValues(prev => ({ ...prev, [index]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCustomItem(index);
              }}
              className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
            />
            <button onClick={() => handleAddCustomItem(index)} className="bg-white border p-2 rounded-lg text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors"><Mic size={18} /></button>
          </div>
        </div>
      </div>
    );
  };

  const renderStep3 = () => (
    <section className="animate-in fade-in slide-in-from-right-8 duration-500">
      <div className="flex items-center gap-2 mb-4">
        <span className="bg-blue-100 text-blue-700 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold">3</span>
        <h2 className="text-xl font-bold text-gray-800">六大模組檢核</h2>
      </div>
      
      {renderCategory(1, '行銷與檔期執行', [
        '檔期 POP 與宣傳物：海報、端架 POP、價格標卡齊全無破損。',
        '主題陳列與佈置 (VMD)：端架與焦點區依總部指引陳列，商品量感充足。',
        '檔期主打商品備貨：DM 熱銷品、特價組合包無預期缺貨。',
        '結帳區加價購專區：櫃檯加價購商品放置於視覺焦點且標價清楚。'
      ])}
      {renderCategory(2, '商品陳列與損耗管理', [
        '排面平整與拉面：商品拉面齊平、正面朝前，無缺貨空洞。',
        '效期與先進先出 (FIFO)：飼料/罐頭/零食落實舊效期在前，無過期品。',
        '臨期品與損耗處置：臨期品有獨立列管/折扣；破包凹罐及時報廢。',
        '高單價與高損品防竊：高價保健品、家電有貼防盜標籤或上鎖。',
        'PB 與高毛利商品陳列：自有品牌 (PB) 擺放於視線黃金位 (120-160cm)。'
      ])}
      {renderCategory(3, '寵物專業服務與照護', [
        '美容房環境與衛生：美容房清潔無異味，消毒紀錄表、設備運作正常。',
        '美容操作 SOP 與安全：有綁安全防護繩；接送寵物有進行體表檢查紀錄。',
        '活體照護與環境（若有）：籠舍清潔無異味，水糧充足，健康觀察卡按時填記。',
        '保健/醫療專區維護：保健品專區整潔，展示品齊全無積塵。'
      ])}
      {renderCategory(4, '人員服務與顧客體驗', [
        '儀容儀態與招呼：統一穿著制服配戴名牌，顧客進門有主動親切招呼。',
        '專業導購與衛教：能主動詢問寵物狀況，提供正確飼養/保健衛教與建議。',
        '櫃檯結帳與附加銷售 (Add-on)：結帳順暢，主動推廣加價購、PB 商品或會員綁定。'
      ])}
      {renderCategory(5, '門市環境與設備安全', [
        '門面與整體環境清潔：招牌/門口玻璃清潔，賣場無毛髮堆積或異味。',
        '賣場氣氛與燈光空調：燈光全亮，空調溫度適宜（寵物與顧客體感舒適）。',
        '後勤倉庫與公安動線：倉庫擺放整齊，通道暢通無堆積雜物，無傾倒風險。',
        '系統與設備安全運作：POS、監視器、滅火器（效期內）、電器線路運作正常。'
      ])}
      {renderCategory(6, '經營數據與團隊管理', [
        '業績與 KPI 指標跟進：店長清楚當月業績進度、PB 銷售佔比、加價購達成率。',
        '人員 1-on-1 面談紀錄：今日有進行人員面談/輔導',
        '團隊士氣與排班合理性：人員出勤正常，班表符合規範，團隊氛圍良好。'
      ])}
    </section>
  );

  const renderStep4 = () => (
    <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-in fade-in slide-in-from-right-8 duration-500">
      <h2 className="text-xl font-bold text-gray-800 mb-6 border-b pb-3 flex items-center gap-2">
        <span className="bg-blue-100 text-blue-700 w-7 h-7 rounded-full flex items-center justify-center text-sm">4</span>
        管理閉環與新交辦
      </h2>
      
      <div className="space-y-8">
        {/* 本次新增交辦 */}
        <div>
          <p className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
            <CheckCircle2 size={18} className="text-blue-500" /> 本次新增交辦事項 (Action Items)
          </p>
          <div className="space-y-3">
            {newActionItems.map((item, idx) => (
              <div key={idx} className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col gap-3 relative">
                {newActionItems.length > 1 && (
                  <button onClick={() => setNewActionItems(newActionItems.filter((_, i) => i !== idx))} className="absolute top-3 right-3 text-gray-400 hover:text-red-500">
                    <Trash2 size={16} />
                  </button>
                )}
                <input 
                  type="text" placeholder="輸入缺失事項或改善建議..." 
                  value={item.desc}
                  onChange={(e) => {
                    const newArr = [...newActionItems];
                    newArr[idx].desc = e.target.value;
                    setNewActionItems(newArr);
                  }}
                  className="w-full border rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                />
                <div className="flex gap-3">
                  <input 
                    type="text" placeholder="負責人" 
                    value={item.assignee}
                    onChange={(e) => {
                      const newArr = [...newActionItems];
                      newArr[idx].assignee = e.target.value;
                      setNewActionItems(newArr);
                    }}
                    className="w-1/2 border rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                  />
                  <input 
                    type="date" 
                    value={item.dueDate}
                    onChange={(e) => {
                      const newArr = [...newActionItems];
                      newArr[idx].dueDate = e.target.value;
                      setNewActionItems(newArr);
                    }}
                    className="w-1/2 border rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 text-gray-600" 
                  />
                </div>
              </div>
            ))}
            <button 
              onClick={() => setNewActionItems([...newActionItems, { desc: '', assignee: '', dueDate: '' }])}
              className="text-blue-600 text-sm font-bold mt-2 w-full py-3 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              + 新增一筆交辦
            </button>
          </div>
        </div>

        <div className="h-px bg-gray-100" />

        {/* 照片上傳 */}
        <div>
          <p className="text-base font-bold text-gray-800 mb-3 flex items-center gap-2">
            <Camera size={18} className="text-purple-500" /> 現場拍照存證 (Before & After)
          </p>
          <div className="space-y-4">
            {photoPairs.map((pair, idx) => (
              <div key={idx} className="bg-white p-4 rounded-xl border border-gray-200 relative shadow-sm">
                {photoPairs.length > 1 && (
                  <button onClick={() => setPhotoPairs(photoPairs.filter((_, i) => i !== idx))} className="absolute top-2 right-2 text-gray-400 hover:text-red-500 z-10 bg-white rounded-full p-1 shadow-sm">
                    <Trash2 size={16} />
                  </button>
                )}
                <div className="grid grid-cols-2 gap-4">
                  {/* Before */}
                  <div>
                    <p className="text-xs font-bold text-gray-500 mb-2 text-center">改善前 (Before)</p>
                    <label className="w-full aspect-square border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-50 hover:border-blue-400 transition-colors overflow-hidden bg-gray-50">
                      {pair.beforeUrl ? (
                        <img src={pair.beforeUrl} alt="Before" className="w-full h-full object-cover" />
                      ) : (
                        <>
                          <Camera size={24} className="mb-1" />
                          <span className="text-xs font-medium">拍照 / 上傳</span>
                        </>
                      )}
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        className="hidden" 
                        onChange={async (e) => {
                          if (e.target.files && e.target.files[0]) {
                            try {
                              const base64Url = await compressImageToBase64(e.target.files[0]);
                              const newPairs = [...photoPairs];
                              newPairs[idx].beforeUrl = base64Url;
                              setPhotoPairs(newPairs);
                            } catch (err) {
                              console.error('照片讀取失敗', err);
                              alert('照片讀取失敗，請重新拍攝');
                            }
                          }
                        }} 
                      />
                    </label>
                  </div>
                  {/* After */}
                  <div>
                    <p className="text-xs font-bold text-gray-500 mb-2 text-center">改善後 (After)</p>
                    <label className="w-full aspect-square border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-50 hover:border-blue-400 transition-colors overflow-hidden bg-gray-50">
                      {pair.afterUrl ? (
                        <img src={pair.afterUrl} alt="After" className="w-full h-full object-cover" />
                      ) : (
                        <>
                          <Camera size={24} className="mb-1" />
                          <span className="text-xs font-medium">拍照 / 上傳</span>
                        </>
                      )}
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        className="hidden" 
                        onChange={async (e) => {
                          if (e.target.files && e.target.files[0]) {
                            try {
                              const base64Url = await compressImageToBase64(e.target.files[0]);
                              const newPairs = [...photoPairs];
                              newPairs[idx].afterUrl = base64Url;
                              setPhotoPairs(newPairs);
                            } catch (err) {
                              console.error('照片讀取失敗', err);
                              alert('照片讀取失敗，請重新拍攝');
                            }
                          }
                        }} 
                      />
                    </label>
                  </div>
                </div>
              </div>
            ))}
            <button 
              onClick={() => setPhotoPairs([...photoPairs, { beforeUrl: '', afterUrl: '' }])}
              className="text-purple-600 text-sm font-bold mt-2 w-full py-3 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors border border-purple-100"
            >
              + 新增一組對比照片
            </button>
          </div>
        </div>
      </div>
    </section>
  );

  const renderStep5 = () => (
    <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-in fade-in slide-in-from-right-8 duration-500">
      <h2 className="text-xl font-bold text-gray-800 mb-6 border-b pb-3 flex items-center gap-2">
        <span className="bg-blue-100 text-blue-700 w-7 h-7 rounded-full flex items-center justify-center text-sm">5</span>
        總結與簽名
      </h2>
      
      <div className="space-y-6">
        {/* 綜合評價 */}
        <div>
          <p className="text-sm font-bold text-gray-700 mb-3">巡店綜合評價 <span className="text-red-500">*</span></p>
          <div className="flex gap-3">
            <button onClick={() => setOverallRating('良好')} className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${overallRating === '良好' ? 'bg-green-600 text-white border-green-600 shadow-md transform scale-[1.02]' : 'bg-white text-gray-600 border-gray-200 hover:border-green-200'}`}>🟢 良好</button>
            <button onClick={() => setOverallRating('需追蹤')} className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${overallRating === '需追蹤' ? 'bg-yellow-500 text-white border-yellow-500 shadow-md transform scale-[1.02]' : 'bg-white text-gray-600 border-gray-200 hover:border-yellow-200'}`}>🟡 需追蹤</button>
            <button onClick={() => setOverallRating('需重點輔導')} className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${overallRating === '需重點輔導' ? 'bg-red-600 text-white border-red-600 shadow-md transform scale-[1.02]' : 'bg-white text-gray-600 border-gray-200 hover:border-red-200'}`}>🔴 需重點輔導</button>
          </div>
        </div>

        {/* 區主管簽名 */}
        <div>
          <div className="flex justify-between items-end mb-3">
            <p className="text-sm font-bold text-gray-700">門市端 / 區主管簽名</p>
            <button 
              onClick={() => sigCanvas.current?.clear()} 
              className="text-xs text-blue-600 font-semibold bg-blue-50 px-3 py-1 rounded-full hover:bg-blue-100"
            >
              清除重簽
            </button>
          </div>
          <div className="border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 h-48 relative overflow-hidden">
            <SignatureCanvas 
              ref={sigCanvas}
              canvasProps={{className: 'w-full h-full cursor-crosshair'}} 
            />
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(30px)',
        borderBottom: '1px solid #e5e7eb',
        padding: '14px 20px',
        position: 'sticky', top: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', gap: '12px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)'
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
          background: 'linear-gradient(90deg, #3b82f6, #6366f1, #14b8a6)',
        }} />
        <button
          onClick={() => navigate(user?.role === 'admin' ? '/dashboard' : '/')}
          className="w-9 h-9 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-700"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-900 leading-tight">
            現場巡店作業
          </h1>
          <div className="text-xs text-gray-500 tracking-wider">
            {mgrName} · {new Date().toLocaleDateString('zh-TW')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 草稿狀態與手動儲存 */}
          <button
            onClick={handleManualSave}
            title="手動儲存草稿"
            className="text-xs bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg font-bold border border-emerald-200 hover:bg-emerald-100 transition-colors flex items-center gap-1 shadow-xs"
          >
            {saveToast ? (
              <span className="text-emerald-700 flex items-center gap-1">
                <CheckCircle2 size={13} className="text-emerald-600" /> 已存
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Save size={13} /> {draftSavedAt ? draftSavedAt : '暫存草稿'}
              </span>
            )}
          </button>

          {user?.role === 'manager' && (
            <button
              id="audit-change-password"
              onClick={() => setIsChangePasswordOpen(true)}
              className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-bold border border-gray-200 hover:bg-gray-200 transition-colors flex items-center gap-1"
            >
              改密碼 <KeyRound size={12} />
            </button>
          )}
          <button
            onClick={() => {
              if (window.confirm('確定要登出嗎？未送出的草稿將不會遺失。')) {
                logout();
                navigate('/login');
              }
            }}
            className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-bold border border-gray-200 hover:bg-gray-200 transition-colors flex items-center gap-1"
          >
            登出 <LogOut size={12} />
          </button>
        </div>
      </div>
      <ChangePasswordModal open={isChangePasswordOpen} onClose={() => setIsChangePasswordOpen(false)} />

      <div className="md:max-w-4xl max-w-2xl mx-auto px-4 pt-6">
        {/* 草稿自動還原提示橫幅 */}
        {hasRestoredBanner && (
          <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-300">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">📋</span>
              <div>
                <p className="text-sm font-bold text-gray-900">已自動載入您上次暫存的巡店紀錄</p>
                <p className="text-xs text-blue-700">門市：{storeName || '未指定'} · 暫存時間：{draftSavedAt || '稍早'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setHasRestoredBanner(false)}
                className="text-xs bg-blue-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors shadow-xs"
              >
                繼續填寫
              </button>
              <button
                onClick={() => {
                  if (window.confirm('確定要捨棄目前暫存草稿並從頭開始嗎？')) {
                    localStorage.removeItem(LOCAL_STORAGE_KEY);
                    window.location.reload();
                  }
                }}
                className="text-xs text-gray-500 hover:text-red-600 px-2 py-1.5 rounded-lg transition-colors font-medium"
              >
                捨棄重填
              </button>
            </div>
          </div>
        )}

        {/* 降級儲存提示 */}
        {draftWarning && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2 text-xs text-amber-800">
            <AlertCircle size={15} className="text-amber-600 shrink-0" />
            <span>{draftWarning}</span>
          </div>
        )}

        {/* Stepper Progress */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded-full">Step {currentStep} of {totalSteps}</span>
            <span className="text-xs font-semibold text-gray-500">
              {currentStep === 1 && '基本資訊'}
              {currentStep === 2 && '必看核心'}
              {currentStep === 3 && '模組細項'}
              {currentStep === 4 && '追蹤交辦'}
              {currentStep === 5 && '總結簽名'}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-500 ease-out" 
              style={{ width: `${(currentStep / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        {/* Steps Content */}
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
        {currentStep === 3 && renderStep3()}
        {currentStep === 4 && renderStep4()}
        {currentStep === 5 && renderStep5()}

        {/* Navigation Buttons */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
          <div className="md:max-w-4xl max-w-2xl mx-auto flex gap-3">
            {currentStep > 1 && (
              <button
                onClick={handlePrev}
                className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
              >
                <ArrowLeft size={16} /> 上一步
              </button>
            )}
            
            {currentStep < totalSteps ? (
              <button
                onClick={handleNext}
                className="flex-[2] py-3 px-4 bg-blue-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors shadow-md shadow-blue-500/30"
              >
                下一步 <ArrowRight size={16} />
              </button>
            ) : (
              <button
                onClick={submitForm}
                disabled={submitting}
                className={`flex-[2] py-3 px-4 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg ${
                  submitting
                    ? 'bg-gray-400 cursor-not-allowed shadow-none'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/40'
                }`}
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>{submitStatusText || '資料儲存中...'}</span>
                  </>
                ) : (
                  <>
                    <Save size={16} /> 送出巡店紀錄
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
