import os

file_content = """import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { Camera, Mic, Save, ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, Trash2, ChevronRight } from 'lucide-react';

const LOCAL_STORAGE_KEY = 'audit_app_draft';

export const AuditApp = () => {
  const navigate = useNavigate();
  const sigCanvas = useRef<SignatureCanvas>(null);

  // Stepper State
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 5;

  // --- Form States ---
  const [storeName, setStoreName] = useState('');
  const [mgrName, setMgrName] = useState('涂綺恬');
  const [auditMode, setAuditMode] = useState<string>('C');
  const [selectedTopics, setSelectedTopics] = useState<number[]>([]);
  const [coreChecks, setCoreChecks] = useState<Record<string, string>>({});
  const [categoryChecks, setCategoryChecks] = useState<Record<string, string>>({});
  
  // PDCA States
  const [actionItemsLoading, setActionItemsLoading] = useState(false);
  const [pastActionItems, setPastActionItems] = useState<any[]>([]);
  const [pdcaResults, setPdcaResults] = useState<Record<string, string>>({});
  const [newActionItems, setNewActionItems] = useState([{ desc: '', assignee: '', dueDate: '' }]);
  const [photos, setPhotos] = useState<string[]>([]);
  
  const [overallRating, setOverallRating] = useState('');

  // --- Local Storage Auto Save & Restore ---
  const [isDraftRestored, setIsDraftRestored] = useState(false);

  useEffect(() => {
    const draftStr = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (draftStr) {
      try {
        const draft = JSON.parse(draftStr);
        if (window.confirm('發現未送出的巡店草稿，是否要還原？')) {
          setStoreName(draft.storeName || '');
          setMgrName(draft.mgrName || '涂綺恬');
          setAuditMode(draft.auditMode || 'C');
          setSelectedTopics(draft.selectedTopics || []);
          setCoreChecks(draft.coreChecks || {});
          setCategoryChecks(draft.categoryChecks || {});
          setPdcaResults(draft.pdcaResults || {});
          setNewActionItems(draft.newActionItems || [{ desc: '', assignee: '', dueDate: '' }]);
          setOverallRating(draft.overallRating || '');
          setPhotos(draft.photos || []);
          if (draft.currentStep) setCurrentStep(draft.currentStep);
        } else {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
        }
      } catch (e) {
        console.error('Failed to parse draft', e);
      }
    }
    setIsDraftRestored(true);
  }, []);

  useEffect(() => {
    if (!isDraftRestored) return; // 等待初始化完成後再開始監聽
    
    const draft = {
      storeName, mgrName, auditMode, selectedTopics, coreChecks,
      categoryChecks, pdcaResults, newActionItems, overallRating, photos, currentStep
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(draft));
  }, [storeName, mgrName, auditMode, selectedTopics, coreChecks, categoryChecks, pdcaResults, newActionItems, overallRating, photos, currentStep, isDraftRestored]);

  const clearDraftAndReset = () => {
    if (window.confirm('確定要清除目前的草稿並重新開始嗎？')) {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      window.location.reload();
    }
  };

  // --- Fetch Action Items ---
  const fetchActionItems = async (store: string) => {
    if (!store) return;
    setActionItemsLoading(true);
    try {
      const res = await fetch(`https://management-dashboard-rust.vercel.app/api/action-items?store=${encodeURIComponent(store)}`);
      if (res.ok) {
        const data = await res.json();
        setPastActionItems(data.filter((item: any) => item.status === 'Open'));
      }
    } catch (e) {
      console.error(e);
    }
    setActionItemsLoading(false);
  };

  // --- Submit ---
  const submitForm = async () => {
    if (!storeName) return alert('請輸入門市名稱');
    if (!auditMode) return alert('請選擇巡店模式');
    if (Object.keys(coreChecks).length < 3) return alert('請完成第二層：必看核心底線');
    if (!overallRating) return alert('請選擇巡店綜合評價');
    
    const signature = sigCanvas.current?.isEmpty() ? null : sigCanvas.current?.toDataURL();

    const payload = {
      storeName,
      areaManagerName: mgrName,
      auditMode,
      selectedTopics,
      coreChecks,
      categoryChecks,
      pdcaResults,
      newActionItems: newActionItems.filter(i => i.desc),
      overallRating,
      signature,
      createdAt: new Date().toISOString()
    };

    try {
      const res = await fetch('https://management-dashboard-rust.vercel.app/api/visit-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        const validActions = newActionItems.filter(i => i.desc);
        for (const act of validActions) {
          await fetch('https://management-dashboard-rust.vercel.app/api/action-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              storeName, desc: act.desc, assignee: act.assignee,
              dueDate: act.dueDate, status: 'Open'
            })
          });
        }
        
        for (const [id, result] of Object.entries(pdcaResults)) {
          if (result === '已改善') {
            await fetch(`https://management-dashboard-rust.vercel.app/api/action-items/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'Closed' })
            });
          }
        }

        alert('送出成功！');
        localStorage.removeItem(LOCAL_STORAGE_KEY); // 送出成功後清除草稿
        navigate('/');
      }
    } catch (e) {
      alert('送出失敗');
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newUrls = Array.from(e.target.files).map(f => URL.createObjectURL(f));
      setPhotos([...photos, ...newUrls]);
    }
  };

  // --- Stepper Navigation ---
  const handleNext = () => {
    if (currentStep === 1) {
      if (!storeName) return alert('請先輸入門市名稱');
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
          <input 
            type="text" 
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            onBlur={() => fetchActionItems(storeName)}
            className="w-full border rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" 
            placeholder="輸入門市名稱並離開輸入框" 
          />
        </div>
        
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
          { id: 'core-1', label: '門面第一印象', desc: '店外無違規堆放，玻璃自動門明亮清潔' },
          { id: 'core-2', label: '人員服務狀態', desc: '人員服裝儀容標準，主動打招呼' },
          { id: 'core-3', label: '氣味與溫濕度', desc: '一進門無異味，空調溫度適宜' }
        ].map((item) => (
          <div key={item.id} className="border p-4 rounded-xl bg-gray-50">
            <div className="font-semibold text-gray-800 mb-1">{item.label}</div>
            <div className="text-xs text-gray-500 mb-3">{item.desc}</div>
            <div className="flex gap-2">
              <button onClick={() => setCoreChecks({ ...coreChecks, [item.id]: '正常' })} className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${coreChecks[item.id] === '正常' ? 'bg-green-600 text-white border-green-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-green-50'}`}>✅ 正常</button>
              <button onClick={() => setCoreChecks({ ...coreChecks, [item.id]: '缺失' })} className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${coreChecks[item.id] === '缺失' ? 'bg-red-600 text-white border-red-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-red-50'}`}>❌ 缺失</button>
            </div>
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
              <div className="flex flex-wrap gap-2">
                {['N/A', '合格', '待改善', '缺失'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => setCategoryChecks({ ...categoryChecks, [key]: opt })}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                      categoryChecks[key] === opt 
                        ? (opt === '缺失' ? 'bg-red-600 text-white border-red-600' : opt === '合格' ? 'bg-green-600 text-white border-green-600' : 'bg-blue-600 text-white border-blue-600')
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="mt-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
          <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">➕ 自訂新增項目 <Mic size={12}/></p>
          <div className="flex gap-2">
            <input type="text" placeholder="輸入自訂缺失或狀況..." className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            <button className="bg-white border p-2 rounded-lg text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors"><Mic size={18} /></button>
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
      
      {renderCategory(1, '行銷檔期與執行', [
        '檔期 POP 與宣傳物：海報、端架POP、價格牌皆無破損',
        '主題端架陳列(VMD)：端架陳列依總部指引陳列，貨量充足',
        '檔期主題缺貨：DM 促銷品、特價品皆無發生缺貨',
        '結帳台加價購陳列：櫃檯加價購商品置於視覺焦點，標價清楚'
      ])}
      {renderCategory(2, '陳列損耗與庫存管理', [
        '排面平整度：商品面齊平，無嚴重缺貨空洞',
        '先進先出(FIFO)：落實先進先出，無過期品',
        '即期品損耗處置：即期品移至專區/折扣；壞品報廢',
        '高單價/高風險防竊：依規範貼上防竊標籤/磁扣',
        'PB (自有品牌) 毛利品陳列：擺放於視線黃金段(120-160cm)'
      ])}
      {renderCategory(3, '寵物專業與活體照護', [
        '美容區環境與衛生：清潔無異味，消毒與洗衣設備正常',
        '美容交接 SOP：配戴安全繩，接送寵物實體表檢查紀錄',
        '活體維護與環境：籠具清潔無異味，水糧充足，健康卡已填寫',
        '保健/處方專區維護：分類清晰，標示牌齊全無積塵'
      ])}
      {renderCategory(4, '人員服務與顧客體驗', [
        '儀容與主動招呼：統一穿著制服配戴名牌，進客能主動親切招呼',
        '專業導購諮詢：能主動詢問寵物狀況，提供飼養衛教',
        '櫃檯結帳與推銷 (Add-on)：結帳能主動推廣加價購，會員綁定'
      ])}
      {renderCategory(5, '門市環境與設備安全', [
        '門面與招牌清潔：招牌、玻璃清潔，無毛髮、積水、異味',
        '燈光、照明與空調：照明燈亮，空調溫度適宜',
        '後勤倉庫與公安動線：倉庫走道，通道暢通無傾倒風險',
        '系統與設備運作：POS、監視器、滅火器、電箱線路運作正常'
      ])}
      {renderCategory(6, '經營數據與店務管理', [
        '業績與 KPI 目標跟進：店長清楚當月業績進度與PB 佔比',
        '人員 1-on-1 溝通紀錄：今日有進行人員對談',
        '團隊士氣與排班合理性：人員出勤正常，班表符合規範，氛圍良好'
      ])}
    </section>
  );

  const renderStep4 = () => (
    <section className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-in fade-in slide-in-from-right-8 duration-500">
      <h2 className="text-xl font-bold text-gray-800 mb-6 border-b pb-3 flex items-center gap-2">
        <span className="bg-blue-100 text-blue-700 w-7 h-7 rounded-full flex items-center justify-center text-sm">4</span>
        歷程追蹤與新交辦
      </h2>
      
      <div className="space-y-8">
        {/* 前次未結案 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-base font-bold text-gray-800 flex items-center gap-2">
              <AlertCircle size={18} className="text-orange-500" /> 前次未結案缺失 (PDCA)
            </p>
            {actionItemsLoading && <span className="text-xs text-gray-400">載入中...</span>}
          </div>
          
          <div className="space-y-3">
            {pastActionItems.length === 0 && !actionItemsLoading ? (
              <div className="text-sm text-gray-500 bg-gray-50 p-4 rounded-lg text-center border border-dashed">
                無未結案之改善事項 🎉
              </div>
            ) : (
              pastActionItems.map(item => (
                <div key={item.id} className="border p-4 rounded-xl bg-orange-50/30">
                  <div className="text-sm font-semibold text-gray-800 mb-2">{item.issueDescription}</div>
                  <div className="text-xs text-gray-500 mb-3 flex gap-4">
                    <span>負責人: {item.assignee}</span>
                    <span className="text-red-500 font-medium">期限: {new Date(item.dueDate).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setPdcaResults({ ...pdcaResults, [item.id]: '已改善' })} className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${pdcaResults[item.id] === '已改善' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-green-50'}`}>✅ 現場已改善</button>
                    <button onClick={() => setPdcaResults({ ...pdcaResults, [item.id]: '未改善' })} className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${pdcaResults[item.id] === '未改善' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-red-50'}`}>❌ 依然未改善</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="h-px bg-gray-100" />

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
            <Camera size={18} className="text-purple-500" /> 現場拍照存證 (選填)
          </p>
          <div className="flex flex-wrap gap-3">
            {photos.map((src, idx) => (
              <img key={idx} src={src} alt="" className="w-24 h-24 object-cover rounded-xl border border-gray-200 shadow-sm" />
            ))}
            <label className="w-24 h-24 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-50 hover:border-blue-400 transition-colors">
              <Camera size={24} className="mb-1" />
              <span className="text-xs font-medium">上傳照片</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} />
            </label>
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
            <button onClick={() => setOverallRating('良好')} className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${overallRating === '良好' ? 'bg-green-600 text-white border-green-600 shadow-md transform scale-[1.02]' : 'bg-white text-gray-600 border-gray-200 hover:border-green-200'}`}>😊 良好</button>
            <button onClick={() => setOverallRating('待追蹤')} className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${overallRating === '待追蹤' ? 'bg-yellow-500 text-white border-yellow-500 shadow-md transform scale-[1.02]' : 'bg-white text-gray-600 border-gray-200 hover:border-yellow-200'}`}>🤔 待追蹤</button>
            <button onClick={() => setOverallRating('需重點輔導')} className={`flex-1 py-3 rounded-xl text-sm font-bold border-2 transition-all ${overallRating === '需重點輔導' ? 'bg-red-600 text-white border-red-600 shadow-md transform scale-[1.02]' : 'bg-white text-gray-600 border-gray-200 hover:border-red-200'}`}>🚨 需重點輔導</button>
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
          onClick={() => navigate('/')}
          className="w-9 h-9 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-700"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-base font-bold text-gray-900 leading-tight">
            現場巡店作業 (草稿自動儲存)
          </h1>
          <div className="text-xs text-gray-500 tracking-wider">
            {mgrName} · {new Date().toLocaleDateString('zh-TW')}
          </div>
        </div>
        <button
          onClick={clearDraftAndReset}
          className="ml-auto text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-lg font-bold border border-red-100 hover:bg-red-100 transition-colors flex items-center gap-1"
        >
          <Trash2 size={12} /> 清除草稿
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6">
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
          <div className="max-w-2xl mx-auto flex gap-3">
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
                className="flex-[2] py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:from-blue-700 hover:to-indigo-700 transition-colors shadow-lg shadow-blue-500/40"
              >
                <Save size={16} /> 送出巡店紀錄
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
"""

with open(r'c:\Users\Jay\Management Dashboard\src\pages\AuditApp.tsx', 'w', encoding='utf-8') as f:
    f.write(file_content)

print("Successfully rewrote AuditApp.tsx")
