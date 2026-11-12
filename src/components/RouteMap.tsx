import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GeoPoint } from '../data/storeCoordinates';
import type { OptimizedLeg, RouteStop } from '../utils/route-optimizer';
import { Minus, Plus, Maximize2, Layers } from 'lucide-react';

interface Props {
  stops: RouteStop[];
  legs: OptimizedLeg[];
  hubPoint: GeoPoint;
  /** 路線主色（實際＝藍、建議＝綠） */
  color: string;
  selectedStopId?: string | null;
  onSelectStop?: (stopId: string | null) => void;
  height?: number;
}

const TILE_SIZE = 256;
const MIN_ZOOM = 7;
const MAX_ZOOM = 17;
const FIT_PADDING = 80;

/**
 * 經緯度轉 Web Mercator 世界像素座標
 */
const toWorldPx = (lat: number, lng: number, zoom: number): { x: number; y: number } => {
  const scale = TILE_SIZE * 2 ** zoom;
  const latRad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const x = ((lng + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
};

/**
 * 計算能完整容納所有點位的最大縮放層級
 */
const computeFitZoom = (points: GeoPoint[], width: number, height: number): number => {
  if (points.length <= 1) return 13;
  for (let z = 15; z >= MIN_ZOOM; z--) {
    const pxs = points.map(p => toWorldPx(p.lat, p.lng, z));
    const w = Math.max(...pxs.map(p => p.x)) - Math.min(...pxs.map(p => p.x));
    const h = Math.max(...pxs.map(p => p.y)) - Math.min(...pxs.map(p => p.y));
    if (w + FIT_PADDING * 2 <= width && h + FIT_PADDING * 2 <= height) return z;
  }
  return MIN_ZOOM;
};

/**
 * 專業地圖圖資配置（完全無浮水印、高解析度道路地名）
 */
type BasemapType = 'streets' | 'osm' | 'topo';

const BASEMAP_CONFIGS: Record<BasemapType, { name: string; getUrl: (z: number, x: number, y: number) => string }> = {
  // ESRI World Street Map：全球頂級街道圖，包含台灣繁體中文地名、國道、省道、市區街道，100% 無浮水印
  streets: {
    name: '精細街道圖',
    getUrl: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
  },
  // OpenStreetMap 官方公開圖磚（備援圖資）
  osm: {
    name: 'OpenStreetMap',
    getUrl: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  },
  // ESRI Topo 地形圖
  topo: {
    name: '彩色地形圖',
    getUrl: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
  },
};

/**
 * 現代化真實街道巡店路線圖（無浮水印、高質感流線、直觀站點標記）
 */
export const RouteMap: React.FC<Props> = ({
  stops,
  legs,
  hubPoint,
  color,
  selectedStopId,
  onSelectStop,
  height = 580,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(850);
  const [zoomDelta, setZoomDelta] = useState<number>(0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [basemap, setBasemap] = useState<BasemapType>('streets');
  const [tileErrorMap, setTileErrorMap] = useState<Record<string, boolean>>({});
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // 監聽容器寬度
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const allPoints = useMemo(() => [hubPoint, ...stops.map(s => s.geoPoint)], [hubPoint, stops]);

  // 站點切換時自動平滑回正
  const routeKey = stops.map(s => s.id).join('|') + hubPoint.label;
  useEffect(() => {
    setZoomDelta(0);
    setPan({ x: 0, y: 0 });
  }, [routeKey]);

  const fitZoom = useMemo(() => computeFitZoom(allPoints, width, height), [allPoints, width, height]);
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitZoom + zoomDelta));

  // 以所有站點的地理幾何中心為地圖視角中心
  const viewport = useMemo(() => {
    const pxs = allPoints.map(p => toWorldPx(p.lat, p.lng, zoom));
    const cx = (Math.max(...pxs.map(p => p.x)) + Math.min(...pxs.map(p => p.x))) / 2 - pan.x;
    const cy = (Math.max(...pxs.map(p => p.y)) + Math.min(...pxs.map(p => p.y))) / 2 - pan.y;
    return { left: cx - width / 2, top: cy - height / 2 };
  }, [allPoints, zoom, pan, width, height]);

  const project = (p: GeoPoint) => {
    const w = toWorldPx(p.lat, p.lng, zoom);
    return { x: w.x - viewport.left, y: w.y - viewport.top };
  };

  // 產生無水印街道圖磚清單
  const tiles = useMemo(() => {
    const maxIndex = 2 ** zoom - 1;
    const x0 = Math.floor(viewport.left / TILE_SIZE);
    const x1 = Math.floor((viewport.left + width) / TILE_SIZE);
    const y0 = Math.max(0, Math.floor(viewport.top / TILE_SIZE));
    const y1 = Math.min(maxIndex, Math.floor((viewport.top + height) / TILE_SIZE));
    const list: { key: string; src: string; left: number; top: number }[] = [];
    const config = BASEMAP_CONFIGS[basemap];

    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const wrappedX = ((tx % (maxIndex + 1)) + maxIndex + 1) % (maxIndex + 1);
        list.push({
          key: `${basemap}-${zoom}-${tx}-${ty}`,
          src: config.getUrl(zoom, wrappedX, ty),
          left: tx * TILE_SIZE - viewport.left,
          top: ty * TILE_SIZE - viewport.top,
        });
      }
    }
    return list;
  }, [zoom, viewport, width, height, basemap]);

  // 站點座標投影
  const hubPos = project(hubPoint);

  // 門市座標（同位置自動小半徑環狀錯開，避免完全覆蓋）
  const markerPositions = useMemo(() => {
    const placed: { x: number; y: number }[] = [{ ...hubPos }];
    return stops.map(stop => {
      const base = project(stop.geoPoint);
      let pos = { ...base };
      let attempt = 0;
      while (placed.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < 30) && attempt < 12) {
        attempt++;
        const angle = (attempt * Math.PI) / 3;
        pos = {
          x: base.x + Math.cos(angle) * 32,
          y: base.y + Math.sin(angle) * 32,
        };
      }
      placed.push(pos);
      return pos;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, zoom, viewport]);

  const posById = new Map<string, { x: number; y: number }>();
  stops.forEach((s, i) => posById.set(s.id, markerPositions[i]));

  const getLegEndpoints = (leg: OptimizedLeg) => {
    const fromId = 'id' in leg.from ? leg.from.id : null;
    const toId = 'id' in leg.to ? leg.to.id : null;
    const a = (fromId && posById.get(fromId)) || hubPos;
    const b = (toId && posById.get(toId)) || hubPos;
    return { a, b };
  };

  // 滑鼠與觸控平移控制
  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
    });
  };
  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const changeZoom = (delta: number) => {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta));
    if (next === zoom) return;
    const factor = 2 ** (next - zoom);
    setPan(p => ({ x: p.x * factor, y: p.y * factor }));
    setZoomDelta(d => d + (next - zoom));
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-2xl border border-slate-200/90 bg-[#f7f5f0] select-none touch-none cursor-grab active:cursor-grabbing shadow-sm"
      style={{ height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* 1. 底層精美網格與大地背景（預防圖磚載入瞬間之空白） */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(#94a3b8 0.75px, transparent 0.75px), radial-gradient(#cbd5e1 0.75px, #f7f5f0 0.75px)',
          backgroundSize: '24px 24px',
          backgroundPosition: '0 0, 12px 12px',
        }}
      />

      {/* 2. 無浮水印真實街道底圖圖磚 */}
      {tiles.map(t => {
        if (tileErrorMap[t.key]) return null;
        return (
          <img
            key={t.key}
            src={t.src}
            alt=""
            draggable={false}
            onError={() => setTileErrorMap(prev => ({ ...prev, [t.key]: true }))}
            className="absolute pointer-events-none transition-opacity duration-300"
            style={{
              left: t.left,
              top: t.top,
              width: TILE_SIZE,
              height: TILE_SIZE,
            }}
          />
        );
      })}

      {/* 3. 巡店路線向量圖層 (SVG 雙層流線設計) */}
      <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
        <defs>
          {/* 去程方向箭頭 */}
          <marker
            id="route-arrow-head"
            viewBox="0 0 12 12"
            refX="6"
            refY="6"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 1 2 L 10 6 L 1 10 z" fill={color} />
          </marker>

          {/* 路線柔和陰影濾鏡 */}
          <filter id="route-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#0f172a" floodOpacity="0.25" />
          </filter>
        </defs>

        {legs.map((leg, i) => {
          const { a, b } = getLegEndpoints(leg);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 4) return null;

          // 微弧線貝茲控制點，使路線自然微曲有層次感
          const normalX = -dy / dist;
          const normalY = dx / dist;
          const curveOffset = Math.min(30, dist * 0.08) * (i % 2 === 0 ? 1 : -1);
          const cx = (a.x + b.x) / 2 + normalX * curveOffset;
          const cy = (a.y + b.y) / 2 + normalY * curveOffset;

          const pathD = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;

          return (
            <g key={i}>
              {/* 底層白色厚外光暈，凸顯路線辨識度 */}
              <path
                d={pathD}
                fill="none"
                stroke="#ffffff"
                strokeWidth={8}
                strokeLinecap="round"
                opacity={0.92}
              />

              {/* 頂層核心線條（去程實線，返程質感虛線） */}
              <path
                d={pathD}
                fill="none"
                stroke={leg.isReturnLeg ? '#64748b' : color}
                strokeWidth={4.5}
                strokeLinecap="round"
                strokeDasharray={leg.isReturnLeg ? '8 6' : undefined}
                filter="url(#route-shadow)"
              />

              {/* 線段中點方向箭頭 */}
              {!leg.isReturnLeg && dist > 50 && (
                <line
                  x1={cx - dx * 0.001}
                  y1={cy - dy * 0.001}
                  x2={cx}
                  y2={cy}
                  stroke={color}
                  strokeWidth={5}
                  markerEnd="url(#route-arrow-head)"
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* 4. 出發／返回起點 Marker (金色基地旗標) */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center pointer-events-none"
        style={{ left: hubPos.x, top: hubPos.y }}
      >
        <div className="relative flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-amber-400/30 animate-ping absolute" />
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-600 to-amber-400 border-2 border-white shadow-lg flex items-center justify-center text-white text-xs font-black">
            ★
          </div>
        </div>
        <div className="mt-1 px-2.5 py-0.5 rounded-full bg-slate-900/90 text-amber-300 font-bold text-[11px] shadow-md border border-slate-700 whitespace-nowrap">
          出發：{hubPoint.label}
        </div>
      </div>

      {/* 5. 門市巡檢站點 Markers (現代幾何立體 Pin) */}
      {stops.map((stop, i) => {
        const p = markerPositions[i];
        const isSelected = selectedStopId === stop.id;
        const bg = stop.abnormalFlag ? '#dc2626' : color;

        return (
          <div
            key={stop.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-30 flex flex-col items-center"
            style={{ left: p.x, top: p.y }}
          >
            {/* 站點立體 Pin 按鈕 */}
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={() => onSelectStop?.(isSelected ? null : stop.id)}
              className="relative group cursor-pointer transition-transform duration-200 active:scale-95"
              style={{
                transform: isSelected ? 'scale(1.2)' : 'scale(1)',
              }}
              title={`${stop.orderIndex}. ${stop.storeName}`}
            >
              {/* 選取或異常時的光環 */}
              {(isSelected || stop.abnormalFlag) && (
                <div
                  className="w-9 h-9 rounded-full absolute -top-1 -left-1 animate-pulse"
                  style={{ background: `${bg}40` }}
                />
              )}

              {/* 實體圓心 Pin */}
              <div
                className="w-7 h-7 rounded-full border-2 border-white shadow-md text-white font-black text-xs flex items-center justify-center transition-shadow"
                style={{
                  background: `linear-gradient(135deg, ${bg}, #0f172a)`,
                  boxShadow: isSelected ? `0 0 0 3px ${bg}80, 0 8px 16px rgba(0,0,0,0.3)` : '0 3px 8px rgba(0,0,0,0.25)',
                }}
              >
                {stop.orderIndex}
              </div>
            </button>

            {/* 門市名稱與到店時間資訊卡片 */}
            <div
              className={`mt-1.5 px-2.5 py-1 rounded-xl shadow-md border transition-all pointer-events-none whitespace-nowrap flex items-center gap-1.5 ${
                isSelected
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xl scale-105'
                  : 'bg-white/95 text-slate-800 border-slate-200/90 shadow-sm'
              }`}
            >
              <span className="text-xs font-black">{stop.storeName}</span>
              {stop.visitTime && (
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                    isSelected ? 'bg-slate-800 text-blue-300' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {stop.visitTime}
                </span>
              )}
              {stop.abnormalFlag && (
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-700">
                  異常
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* 6. 右上角：地圖縮放與圖資切換控制工具列 */}
      <div
        className="absolute top-3 right-3 z-40 flex flex-col items-end gap-2"
        onPointerDown={e => e.stopPropagation()}
      >
        {/* 圖資切換選單 */}
        <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200 p-1 flex items-center gap-1 text-xs font-bold text-slate-700">
          <Layers size={14} className="text-slate-400 ml-1.5 mr-0.5" />
          {(['streets', 'osm', 'topo'] as const).map(type => (
            <button
              key={type}
              type="button"
              onClick={() => setBasemap(type)}
              className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
                basemap === type
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {BASEMAP_CONFIGS[type].name}
            </button>
          ))}
        </div>

        {/* 縮放與重設視角按鈕 */}
        <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200 overflow-hidden flex flex-col">
          <button
            type="button"
            onClick={() => changeZoom(1)}
            className="p-2.5 hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer border-b border-slate-100"
            title="放大視野"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            onClick={() => changeZoom(-1)}
            className="p-2.5 hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer border-b border-slate-100"
            title="縮小視野"
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoomDelta(0);
              setPan({ x: 0, y: 0 });
            }}
            className="p-2.5 hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
            title="自動最佳視角（完整容納當日所有站點）"
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>

      {/* 7. 左下角：精緻現代圖例說明 */}
      <div className="absolute bottom-3 left-3 z-40 bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200 px-3 py-2 text-xs text-slate-600 flex items-center gap-4 pointer-events-none">
        <span className="flex items-center gap-1.5 font-bold text-slate-700">
          <span className="w-4 h-4 rounded-full bg-amber-400 text-slate-900 text-[10px] font-black flex items-center justify-center">★</span>
          <span>出發起點</span>
        </span>
        <span className="flex items-center gap-1.5 font-bold text-slate-700">
          <span className="w-5 h-1.5 rounded-full" style={{ background: color }} />
          <span>巡店去程</span>
        </span>
        <span className="flex items-center gap-1.5 font-bold text-slate-700">
          <span className="w-5 border-t-2 border-dashed border-slate-500" />
          <span>返程路徑</span>
        </span>
        <span className="flex items-center gap-1.5 font-bold text-red-600">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600" />
          <span>異常門市</span>
        </span>
      </div>

      {/* 8. 右下角：高信賴度圖資標記 */}
      <div className="absolute bottom-1 right-2 z-40 px-2 py-0.5 rounded bg-white/80 text-[10px] font-medium text-slate-500 pointer-events-none border border-slate-200/50">
        高解析圖資 · ESRI World Street Map / OpenStreetMap
      </div>
    </div>
  );
};
