import React, { useState, useRef, useMemo, useEffect } from 'react';
import type { RouteStop, OptimizedLeg } from '../utils/route-optimizer';
import type { GeoPoint } from '../data/storeCoordinates';
import { RAW_STORE_COORDINATES } from '../data/storeCoordinates';
import { ZoomIn, ZoomOut, RotateCcw, Play, Pause, Layers } from 'lucide-react';

interface Props {
  actualStops: RouteStop[];
  actualLegs: OptimizedLeg[];
  optimalStops?: RouteStop[];
  optimalLegs: OptimizedLeg[];
  hubPoint: GeoPoint;
  managerName?: string;
  region?: string;
  showOptimalComparison?: boolean;
  onToggleOptimalComparison?: (val: boolean) => void;
  selectedStopId?: string | null;
  onSelectStop?: (stop: RouteStop | null) => void;
}

// 台灣本島 SVG 基準解析度
const VIEW_WIDTH = 680;
const VIEW_HEIGHT = 920;

// 台灣本島大地座標範圍
const MIN_LNG = 119.85;
const MAX_LNG = 122.25;
const MIN_LAT = 21.75;
const MAX_LAT = 25.38;

/**
 * 經緯度轉換為 SVG 畫布座標
 */
export const projectToSvg = (lng: number, lat: number, isOffshore?: boolean): { x: number; y: number } => {
  if (isOffshore) {
    // 澎湖群島投影至左下角 Inset 小視窗
    const insetX = 40;
    const insetY = 700;
    const px = insetX + (lng - 119.45) * 320 + 35;
    const py = insetY + (23.75 - lat) * 320 + 40;
    return { x: px, y: py };
  }
  const x = ((lng - MIN_LNG) / (MAX_LNG - MIN_LNG)) * 570 + 45;
  const y = ((MAX_LAT - lat) / (MAX_LAT - MIN_LAT)) * 820 + 45;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
};

// 台灣本島主要地形海岸線多邊形點座標（經緯度序列）
const TAIWAN_OUTLINE_COORDS: [number, number][] = [
  // 北部富貴角、基隆、三貂角
  [121.538, 25.298], [121.652, 25.215], [121.755, 25.158], [121.942, 25.045], [121.998, 25.007],
  // 東北角至宜蘭
  [121.928, 24.895], [121.845, 24.825], [121.825, 24.695], [121.865, 24.582], [121.862, 24.498],
  // 蘇花與花蓮
  [121.745, 24.325], [121.675, 24.182], [121.625, 23.985], [121.572, 23.795], [121.525, 23.612],
  // 台東與東海岸
  [121.435, 23.325], [121.365, 23.155], [121.225, 22.925], [121.155, 22.745], [121.045, 22.612],
  // 恆春半島與鵝鑾鼻
  [120.915, 22.385], [120.885, 22.095], [120.854, 21.901], [120.735, 21.945], [120.695, 22.095],
  // 屏東枋寮與林邊
  [120.615, 22.325], [120.585, 22.425], [120.475, 22.485],
  // 高雄與台南海岸
  [120.355, 22.585], [120.255, 22.785], [120.175, 22.965], [120.075, 23.085], [120.038, 23.101],
  // 嘉義東石與雲林麥寮
  [120.125, 23.385], [120.155, 23.585], [120.215, 23.795],
  // 彰化鹿港與台中港
  [120.355, 23.995], [120.475, 24.165], [120.545, 24.325],
  // 苗栗後龍與新竹南寮
  [120.685, 24.545], [120.845, 24.765], [120.935, 24.845],
  // 桃園觀音與新北淡水
  [121.075, 25.045], [121.285, 25.115], [121.415, 25.185], [121.485, 25.265],
];

export const TaiwanRouteMap: React.FC<Props> = ({
  actualStops,
  actualLegs,
  optimalStops = [],
  optimalLegs,
  hubPoint,
  managerName,
  region,
  showOptimalComparison = false,
  onToggleOptimalComparison,
  selectedStopId,
  onSelectStop,
}) => {
  // 地圖視角平移與縮放狀態
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // 動態巡店軌跡播放動畫
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackProgress, setPlaybackProgress] = useState<number>(1); // 0 ~ actualStops.length
  const timerRef = useRef<any>(null);

  // 當前 Hover 節點
  const [hoveredStop, setHoveredStop] = useState<RouteStop | null>(null);

  // 轉換台灣本島邊界 SVG Path
  const mainlandPathD = useMemo(() => {
    const pts = TAIWAN_OUTLINE_COORDS.map(([lng, lat]) => {
      const { x, y } = projectToSvg(lng, lat);
      return `${x},${y}`;
    });
    return `M ${pts.join(' L ')} Z`;
  }, []);

  // 計算區域 Hub 畫布座標
  const hubCoords = useMemo(() => {
    return projectToSvg(hubPoint.lng, hubPoint.lat, hubPoint.isOffshore);
  }, [hubPoint]);

  // 全台背景所有非今日巡視的門市座標（輕量灰點）
  const allBackgroundStores = useMemo(() => {
    const visitedSet = new Set(actualStops.map(s => s.storeName.replace('店', '')));
    return Object.entries(RAW_STORE_COORDINATES)
      .filter(([name]) => !visitedSet.has(name))
      .map(([name, coord]) => {
        const c = coord as { lat: number; lng: number; isOffshore?: boolean };
        return {
          name: `${name}店`,
          ...projectToSvg(c.lng, c.lat, c.isOffshore),
        };
      });
  }, [actualStops]);

  // 重設視角
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // 區域快速聚焦
  const handleFocusRegion = (reg: 'all' | 'north' | 'central' | 'south' | 'east') => {
    switch (reg) {
      case 'north':
        setZoom(1.9);
        setPan({ x: -160, y: 150 });
        break;
      case 'central':
        setZoom(2.1);
        setPan({ x: -140, y: -80 });
        break;
      case 'south':
        setZoom(2.0);
        setPan({ x: -120, y: -320 });
        break;
      case 'east':
        setZoom(2.0);
        setPan({ x: -280, y: -100 });
        break;
      default:
        handleResetView();
        break;
    }
  };

  // 動態軌跡播放器
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setPlaybackProgress(prev => {
          if (prev >= actualStops.length) {
            setIsPlaying(false);
            return actualStops.length;
          }
          return prev + 1;
        });
      }, 900);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, actualStops.length]);

  const handleStartPlay = () => {
    setPlaybackProgress(0);
    setIsPlaying(true);
  };

  // 滑鼠平移控制
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="relative w-full h-[620px] sm:h-[720px] bg-slate-900 rounded-2xl overflow-hidden select-none border border-slate-800 shadow-xl flex flex-col">
      {/* 頂部地圖工具列 */}
      <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none flex-wrap gap-2">
        {/* 左側：區域與主管標記 */}
        <div className="bg-slate-900/90 backdrop-blur-md px-3.5 py-2 rounded-xl border border-slate-700/80 shadow-lg pointer-events-auto flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping" />
          <div className="text-xs">
            <span className="font-bold text-white">
              {managerName ? `${managerName} 主管` : '全區巡店路徑'}
            </span>
            <span className="text-slate-400 ml-1.5 font-medium">
              （{region || '全台門市'} · 當日共 {actualStops.length} 站）
            </span>
          </div>
        </div>

        {/* 右側：互動控制工具群 */}
        <div className="flex items-center gap-1.5 pointer-events-auto">
          {/* 最佳化路徑對比切換開關 */}
          {actualStops.length > 1 && onToggleOptimalComparison && (
            <button
              type="button"
              onClick={() => onToggleOptimalComparison(!showOptimalComparison)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 shadow-md cursor-pointer ${
                showOptimalComparison
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-emerald-500/20'
                  : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-700/90'
              }`}
            >
              <Layers size={14} className={showOptimalComparison ? 'text-emerald-400' : 'text-slate-400'} />
              <span>{showOptimalComparison ? '最佳化對比：開啟' : '對比最佳化路徑'}</span>
            </button>
          )}

          {/* 模擬軌跡回放按鈕 */}
          {actualStops.length > 0 && (
            <button
              type="button"
              onClick={() => (isPlaying ? setIsPlaying(false) : handleStartPlay())}
              className="bg-slate-800/90 hover:bg-slate-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-700 shadow-md flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              {isPlaying ? <Pause size={13} className="text-amber-400" /> : <Play size={13} className="text-blue-400" />}
              <span>{isPlaying ? '暫停播放' : '模擬巡店軌跡'}</span>
            </button>
          )}

          {/* 視角縮放按鈕 */}
          <div className="flex items-center bg-slate-800/90 rounded-xl border border-slate-700 overflow-hidden shadow-md">
            <button
              type="button"
              onClick={() => setZoom(z => Math.min(3.5, z + 0.3))}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
              title="放大"
            >
              <ZoomIn size={15} />
            </button>
            <button
              type="button"
              onClick={() => setZoom(z => Math.max(0.8, z - 0.3))}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
              title="縮小"
            >
              <ZoomOut size={15} />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer"
              title="重設全台視角"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* 區域快速切換膠囊 (底部置中) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-slate-900/90 backdrop-blur-md px-2 py-1 rounded-xl border border-slate-700/80 shadow-lg text-[11px] font-semibold text-slate-300">
        <span className="text-slate-400 px-1 hidden sm:inline">視角：</span>
        {(
          [
            { id: 'all', label: '全台' },
            { id: 'north', label: '雙北北桃' },
            { id: 'central', label: '中投彰雲' },
            { id: 'south', label: '嘉南高屏' },
            { id: 'east', label: '宜花' },
          ] as const
        ).map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleFocusRegion(item.id)}
            className="px-2 py-1 rounded-lg hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 圖例說明 (左下角) */}
      <div className="absolute bottom-3 left-3 z-20 bg-slate-900/90 backdrop-blur-md p-2.5 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-1.5 shadow-lg hidden md:block">
        <div className="flex items-center gap-2">
          <span className="w-3 h-0.5 bg-blue-500 rounded" />
          <span>實際巡店路徑</span>
        </div>
        {showOptimalComparison && (
          <div className="flex items-center gap-2">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-emerald-400" />
            <span className="text-emerald-400">最佳化建議路徑</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full bg-amber-400 flex items-center justify-center text-[9px] font-bold text-slate-950">
            ★
          </span>
          <span>區域中心出發起點</span>
        </div>
      </div>

      {/* 互動式向量 SVG 畫布 */}
      <div
        className="w-full h-full flex-1 cursor-grab active:cursor-grabbing overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="w-full h-full transition-transform duration-75 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <defs>
            {/* 實際路徑箭頭 */}
            <marker
              id="actual-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#3b82f6" />
            </marker>

            {/* 最佳化路徑箭頭 */}
            <marker
              id="optimal-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#10b981" />
            </marker>

            {/* 台灣陸地柔和漸層 */}
            <linearGradient id="taiwan-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e293b" />
              <stop offset="50%" stopColor="#0f172a" />
              <stop offset="100%" stopColor="#1e293b" />
            </linearGradient>

            {/* 光芒濾鏡 */}
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* 背景細網格 */}
          <g stroke="#334155" strokeWidth="0.5" strokeDasharray="3,6" opacity="0.4">
            <line x1="50" y1="200" x2="630" y2="200" />
            <line x1="50" y1="400" x2="630" y2="400" />
            <line x1="50" y1="600" x2="630" y2="600" />
            <line x1="50" y1="800" x2="630" y2="800" />
            <line x1="200" y1="40" x2="200" y2="880" />
            <line x1="400" y1="40" x2="400" y2="880" />
          </g>

          {/* 台灣本島輪廓底圖 */}
          <path
            d={mainlandPathD}
            fill="url(#taiwan-gradient)"
            stroke="#38bdf8"
            strokeWidth="1.5"
            strokeOpacity="0.45"
            className="transition-all hover:stroke-opacity-80"
          />

          {/* 澎湖離島專屬 Inset 小視窗 */}
          <g transform="translate(25, 680)">
            <rect
              width="150"
              height="180"
              rx="12"
              fill="#0f172a"
              stroke="#475569"
              strokeWidth="1"
              strokeDasharray="4,4"
              opacity="0.8"
            />
            <text x="12" y="24" fill="#94a3b8" fontSize="11" fontWeight="bold">
              澎湖特區 Inset
            </text>
            <circle cx="75" cy="115" r="5" fill="#38bdf8" opacity="0.6" />
            <circle cx="95" cy="100" r="4" fill="#38bdf8" opacity="0.6" />
            <text x="75" y="132" fill="#64748b" fontSize="9" textAnchor="middle">
              馬公
            </text>
          </g>

          {/* 背景所有未訪問門市（淡色微小點） */}
          <g opacity="0.35">
            {allBackgroundStores.map((st, i) => (
              <circle
                key={i}
                cx={st.x}
                cy={st.y}
                r="2"
                fill="#94a3b8"
                className="transition-all hover:opacity-100 hover:fill-white"
              >
                <title>{st.name}</title>
              </circle>
            ))}
          </g>

          {/* 最佳化建議巡店路徑（虛線 - 翡翠綠） */}
          {showOptimalComparison && optimalLegs.length > 0 && (
            <g stroke="#10b981" strokeWidth="2.5" strokeDasharray="6,5" opacity="0.85">
              {optimalLegs.map((leg, i) => {
                const fromCoords = projectToSvg(leg.from.geoPoint.lng, leg.from.geoPoint.lat, leg.from.geoPoint.isOffshore);
                const toCoords = projectToSvg(leg.to.geoPoint.lng, leg.to.geoPoint.lat, leg.to.geoPoint.isOffshore);
                return (
                  <line
                    key={`opt-leg-${i}`}
                    x1={fromCoords.x}
                    y1={fromCoords.y}
                    x2={toCoords.x}
                    y2={toCoords.y}
                    markerEnd="url(#optimal-arrow)"
                    className="animate-pulse"
                  />
                );
              })}
            </g>
          )}

          {/* 實際巡店路徑（實線 - 亮藍色帶流光粒子） */}
          <g stroke="#3b82f6" strokeWidth="3" opacity="0.95">
            {actualLegs.map((leg, i) => {
              if (isPlaying && i >= playbackProgress) return null;
              const fromCoords = projectToSvg(leg.from.geoPoint.lng, leg.from.geoPoint.lat, leg.from.geoPoint.isOffshore);
              const toCoords = projectToSvg(leg.to.geoPoint.lng, leg.to.geoPoint.lat, leg.to.geoPoint.isOffshore);
              return (
                <g key={`act-leg-${i}`}>
                  <line
                    x1={fromCoords.x}
                    y1={fromCoords.y}
                    x2={toCoords.x}
                    y2={toCoords.y}
                    strokeLinecap="round"
                    markerEnd="url(#actual-arrow)"
                  />
                  {/* 分段里程浮動標籤 */}
                  {leg.distanceKm > 0 && (
                    <text
                      x={(fromCoords.x + toCoords.x) / 2}
                      y={(fromCoords.y + toCoords.y) / 2 - 6}
                      fill="#93c5fd"
                      fontSize="10"
                      fontWeight="bold"
                      textAnchor="middle"
                      className="bg-slate-900"
                    >
                      {leg.distanceKm}km (${leg.subsidyCost})
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* 區域出發中心 Hub 點標記 */}
          <g transform={`translate(${hubCoords.x}, ${hubCoords.y})`} className="cursor-pointer">
            <circle r="14" fill="#f59e0b" fillOpacity="0.25" className="animate-ping" />
            <circle r="9" fill="#f59e0b" stroke="#ffffff" strokeWidth="2" />
            <text y="3" fill="#ffffff" fontSize="9" fontWeight="bold" textAnchor="middle">
              ★
            </text>
            <text y="-14" fill="#fbbf24" fontSize="10" fontWeight="bold" textAnchor="middle">
              {hubPoint.label}
            </text>
          </g>

          {/* 當日巡店站點節點 (Stops) */}
          {actualStops.map((stop, i) => {
            const isVisible = !isPlaying || i < playbackProgress;
            if (!isVisible) return null;

            const coords = projectToSvg(stop.geoPoint.lng, stop.geoPoint.lat, stop.geoPoint.isOffshore);
            const isSelected = selectedStopId === stop.id;
            const isHovered = hoveredStop?.id === stop.id;

            const isAbnormal = stop.abnormalFlag;
            const nodeColor = isAbnormal ? '#ef4444' : stop.isSchedule ? '#6366f1' : '#3b82f6';

            return (
              <g
                key={stop.id}
                transform={`translate(${coords.x}, ${coords.y})`}
                className="cursor-pointer transition-transform"
                onClick={() => onSelectStop?.(isSelected ? null : stop)}
                onMouseEnter={() => setHoveredStop(stop)}
                onMouseLeave={() => setHoveredStop(null)}
              >
                {/* 選取或 Hover 外光環 */}
                {(isSelected || isHovered) && (
                  <circle r="22" fill={nodeColor} fillOpacity="0.3" className="animate-pulse" />
                )}

                {/* 節點主體圓 */}
                <circle
                  r={isSelected ? 13 : 10.5}
                  fill={nodeColor}
                  stroke="#ffffff"
                  strokeWidth="2.5"
                  filter="url(#glow)"
                />

                {/* 順序號標籤 (1, 2, 3...) */}
                <text
                  y="3.5"
                  fill="#ffffff"
                  fontSize="11"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {stop.orderIndex}
                </text>

                {/* 若開啟最佳化對比，在節點右上角標示建議最佳順序 (綠色) */}
                {showOptimalComparison && (() => {
                  const optIndex = optimalStops.findIndex(os => os.id === stop.id || os.storeName === stop.storeName);
                  if (optIndex < 0) return null;
                  const suggestedOrder = optIndex + 1;
                  return (
                    <g transform="translate(11, -11)">
                      <circle r="7.5" fill="#10b981" stroke="#ffffff" strokeWidth="1.5" />
                      <text y="2.5" fill="#ffffff" fontSize="8" fontWeight="bold" textAnchor="middle">
                        {suggestedOrder}
                      </text>
                    </g>
                  );
                })()}

                {/* 門市名稱常駐標籤 */}
                <g transform="translate(0, 20)">
                  <rect
                    x="-42"
                    y="-12"
                    width="84"
                    height="18"
                    rx="4"
                    fill="rgba(15, 23, 42, 0.85)"
                    stroke="rgba(148, 163, 184, 0.3)"
                    strokeWidth="0.8"
                  />
                  <text
                    y="1"
                    fill="#f8fafc"
                    fontSize="9.5"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {stop.storeName}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 門市節點選取資訊卡片 (浮窗 Popover) */}
      {(selectedStopId || hoveredStop) && (() => {
        const target = actualStops.find(s => s.id === selectedStopId) || hoveredStop;
        if (!target) return null;

        return (
          <div className="absolute top-16 right-3 z-30 w-72 bg-slate-900/95 backdrop-blur-md rounded-2xl border border-slate-700/80 p-4 shadow-2xl text-white animate-in fade-in slide-in-from-right-4 duration-200">
            <div className="flex items-start justify-between mb-2">
              <div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40">
                  第 {target.orderIndex} 站巡檢
                </span>
                <h4 className="text-sm font-bold text-white mt-1 flex items-center gap-1.5">
                  <span>🏪</span>
                  <span>{target.storeName}</span>
                </h4>
              </div>
              {target.overallRating && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                  target.overallRating === '特優' ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' :
                  target.overallRating === '優' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' :
                  target.overallRating === '良' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                  'bg-red-500/20 text-red-300 border-red-500/40'
                }`}>
                  評等：{target.overallRating}
                </span>
              )}
            </div>

            <div className="space-y-1.5 text-xs text-slate-300">
              <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">行程類型：</span>
                <span className="font-semibold text-slate-200">{target.actionType}</span>
              </div>
              {target.visitTime && (
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">到店時間：</span>
                  <span className="font-semibold text-blue-400">{target.visitTime}</span>
                </div>
              )}
              {target.highlightDescription && (
                <div className="pt-1">
                  <span className="text-slate-400 block mb-0.5">亮點／備註：</span>
                  <p className="text-slate-200 text-[11px] leading-relaxed bg-slate-800/60 p-2 rounded-lg border border-slate-700/50">
                    {target.highlightDescription}
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
