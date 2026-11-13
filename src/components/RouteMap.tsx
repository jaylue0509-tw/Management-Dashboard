import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GeoPoint } from '../data/storeCoordinates';
import type { OptimizedLeg, RouteStop } from '../utils/route-optimizer';
import { Minus, Plus, Maximize2, Layers, X, Eye, Clock } from 'lucide-react';

interface Props {
  stops: RouteStop[];
  legs: OptimizedLeg[];
  hubPoint: GeoPoint;
  /** 路線主色（實際＝藍、建議＝綠） */
  color: string;
  selectedStopId?: string | null;
  onSelectStop?: (stopId: string | null) => void;
  onJumpToActivity?: (storeName: string, recordId?: string) => void;
  height?: number;
}

const TILE_SIZE = 256;
const MIN_ZOOM = 7;
const MAX_ZOOM = 17;
const FIT_PADDING = 90;
const PIN_RADIUS = 14;

type BasemapType = 'streets' | 'osm' | 'topo';

const BASEMAP_CONFIGS: Record<BasemapType, { name: string; getUrl: (z: number, x: number, y: number) => string }> = {
  streets: {
    name: '精細街道圖',
    getUrl: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
  },
  osm: {
    name: 'OpenStreetMap',
    getUrl: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  },
  topo: {
    name: '彩色地形圖',
    getUrl: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
  },
};

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

interface Rect { x: number; y: number; w: number; h: number }

const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * 現代化真實街道巡店路線圖
 * - 支援滾輪以游標為中心縮放、雙擊放大、拖曳平移
 * - 站點標籤智慧碰撞避讓，避免密集門市文字互相遮擋
 * - 路線中段標示預估里程，點擊節點浮出站點詳情卡
 */
export const RouteMap: React.FC<Props> = ({
  stops,
  legs,
  hubPoint,
  color,
  selectedStopId,
  onSelectStop,
  onJumpToActivity,
  height = 580,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(850);
  const [zoomDelta, setZoomDelta] = useState<number>(0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [basemap, setBasemap] = useState<BasemapType>('streets');
  const [tileErrorMap, setTileErrorMap] = useState<Record<string, boolean>>({});
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);

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

  // 切換主管、日期或路線模式時重設視角
  const routeKey = stops.map(s => s.id).join('|') + hubPoint.label;
  useEffect(() => {
    setZoomDelta(0);
    setPan({ x: 0, y: 0 });
  }, [routeKey]);

  const fitZoom = useMemo(() => computeFitZoom(allPoints, width, height), [allPoints, width, height]);
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitZoom + zoomDelta));

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

  // 以指定容器座標 (anchorX, anchorY) 為中心縮放，讓游標位置保持在同一個地理座標上
  const zoomAtPoint = (delta: number, anchorX: number, anchorY: number) => {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta));
    if (nextZoom === zoom) return;
    const factor = 2 ** (nextZoom - zoom);
    const offsetX = anchorX - width / 2;
    const offsetY = anchorY - height / 2;
    setPan(p => ({
      x: p.x * factor - offsetX * (factor - 1),
      y: p.y * factor - offsetY * (factor - 1),
    }));
    setZoomDelta(d => d + (nextZoom - zoom));
  };

  // 綁定非被動式 wheel 事件，阻止整頁捲動並進行地圖縮放
  const zoomRef = useRef({ zoom, width, height, fitZoom });
  zoomRef.current = { zoom, width, height, fitZoom };
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastWheelAt = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      // 節流觸控板高頻 wheel 事件，避免一次跳過多縮放層級
      if (now - lastWheelAt < 110) return;
      lastWheelAt = now;
      const rect = el.getBoundingClientRect();
      const anchorX = e.clientX - rect.left;
      const anchorY = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 1 : -1;
      const { zoom: curZ, width: w, height: h } = zoomRef.current;
      const nextZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, curZ + delta));
      if (nextZ === curZ) return;
      const factor = 2 ** (nextZ - curZ);
      const offsetX = anchorX - w / 2;
      const offsetY = anchorY - h / 2;
      setPan(p => ({
        x: p.x * factor - offsetX * (factor - 1),
        y: p.y * factor - offsetY * (factor - 1),
      }));
      setZoomDelta(d => d + (nextZ - curZ));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 圖磚計算
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

  const hubPos = project(hubPoint);

  // 門市座標（同位置自動小半徑環狀錯開）
  const markerPositions = useMemo(() => {
    const placed: { x: number; y: number }[] = [{ ...hubPos }];
    return stops.map(stop => {
      const base = project(stop.geoPoint);
      let pos = { ...base };
      let attempt = 0;
      while (placed.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < 34) && attempt < 12) {
        attempt++;
        const angle = (attempt * Math.PI) / 3 - Math.PI / 2;
        const ring = attempt > 6 ? 2 : 1;
        pos = {
          x: base.x + Math.cos(angle) * 36 * ring,
          y: base.y + Math.sin(angle) * 36 * ring,
        };
      }
      placed.push(pos);
      return pos;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, zoom, viewport]);

  const posById = new Map<string, { x: number; y: number }>();
  stops.forEach((s, i) => posById.set(s.id, markerPositions[i]));

  // 店名標籤智慧避讓（計算 下 -> 右 -> 左 -> 上 碰撞情況，確保密集站點不重疊）
  const labelPlacements = useMemo(() => {
    const hubLabelW = Math.min(180, hubPoint.label.length * 11 + 48);
    const obstacles: Rect[] = [
      { x: hubPos.x - 16, y: hubPos.y - 16, w: 32, h: 32 },
      { x: hubPos.x - hubLabelW / 2, y: hubPos.y + 18, w: hubLabelW, h: 24 },
      ...markerPositions.map(p => ({ x: p.x - PIN_RADIUS, y: p.y - PIN_RADIUS, w: PIN_RADIUS * 2, h: PIN_RADIUS * 2 })),
    ];
    return stops.map((stop, i) => {
      const p = markerPositions[i];
      // 估算標籤寬高（中文約 12px + 內距與時間徽章）
      const timeExtra = stop.visitTime ? 44 : 0;
      const badgeExtra = stop.abnormalFlag ? 34 : 0;
      const textLen = Math.min(14, stop.storeName.length);
      const w = textLen * 12 + 24 + timeExtra + badgeExtra;
      const h = 26;
      const gap = PIN_RADIUS + 6;
      const candidates: Rect[] = [
        { x: p.x - w / 2, y: p.y + gap, w, h }, // 下
        { x: p.x + gap, y: p.y - h / 2, w, h }, // 右
        { x: p.x - gap - w, y: p.y - h / 2, w, h }, // 左
        { x: p.x - w / 2, y: p.y - gap - h, w, h }, // 上
        { x: p.x + gap, y: p.y + gap * 0.6, w, h }, // 右下
        { x: p.x - gap - w, y: p.y - gap * 0.6 - h, w, h }, // 左上
      ];
      // 優先選擇在畫布範圍內且不與其他標記／標籤重疊的位置
      const chosen =
        candidates.find(
          c =>
            c.x > 8 &&
            c.x + c.w < width - 8 &&
            c.y > 8 &&
            c.y + c.h < height - 40 &&
            !obstacles.some(o => rectsOverlap(c, o))
        ) ||
        candidates.find(c => !obstacles.some(o => rectsOverlap(c, o))) ||
        candidates[0];
      obstacles.push(chosen);
      return chosen;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, markerPositions, width, height]);

  const getLegEndpoints = (leg: OptimizedLeg) => {
    const fromId = 'id' in leg.from ? leg.from.id : null;
    const toId = 'id' in leg.to ? leg.to.id : null;
    const a = (fromId && posById.get(fromId)) || hubPos;
    const b = (toId && posById.get(toId)) || hubPos;
    return { a, b };
  };

  // 滑鼠與觸控平移控制
  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragRef.current.moved = true;
    }
    setPan({
      x: dragRef.current.panX + dx,
      y: dragRef.current.panY + dy,
    });
  };
  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAtPoint(1, e.clientX - rect.left, e.clientY - rect.top);
  };

  const selectedStop = useMemo(
    () => (selectedStopId ? stops.find(s => s.id === selectedStopId) || null : null),
    [stops, selectedStopId]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-2xl border border-slate-200/90 bg-[#f7f5f0] select-none touch-none cursor-grab active:cursor-grabbing shadow-sm"
      style={{ height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      {/* 1. 底層網格底襯 */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(#94a3b8 0.75px, transparent 0.75px), radial-gradient(#cbd5e1 0.75px, #f7f5f0 0.75px)',
          backgroundSize: '24px 24px',
          backgroundPosition: '0 0, 12px 12px',
        }}
      />

      {/* 2. 無浮水印街道圖磚 */}
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

      {/* 3. 巡店路線向量圖層 (SVG 雙層流線 + 弧線中點里程標籤) */}
      <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
        <defs>
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

          const normalX = -dy / dist;
          const normalY = dx / dist;
          const curveOffset = Math.min(34, dist * 0.1) * (i % 2 === 0 ? 1 : -1);
          const cx = (a.x + b.x) / 2 + normalX * curveOffset;
          const cy = (a.y + b.y) / 2 + normalY * curveOffset;
          const pathD = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;

          // 二次貝茲曲線 t=0.5 中點真實座標
          const midX = 0.25 * a.x + 0.5 * cx + 0.25 * b.x;
          const midY = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;

          return (
            <g key={i}>
              <path
                d={pathD}
                fill="none"
                stroke="#ffffff"
                strokeWidth={8}
                strokeLinecap="round"
                opacity={0.92}
              />
              <path
                d={pathD}
                fill="none"
                stroke={leg.isReturnLeg ? '#64748b' : color}
                strokeWidth={4.5}
                strokeLinecap="round"
                strokeDasharray={leg.isReturnLeg ? '8 6' : undefined}
                filter="url(#route-shadow)"
              />
              {!leg.isReturnLeg && dist > 48 && (
                <line
                  x1={midX - dx * 0.001}
                  y1={midY - dy * 0.001}
                  x2={midX}
                  y2={midY}
                  stroke={color}
                  strokeWidth={5}
                  markerEnd="url(#route-arrow-head)"
                />
              )}
              {/* 夠長的路段在中點顯示里程微膠囊 */}
              {!leg.isReturnLeg && leg.distanceKm > 0 && dist > 95 && (
                <g transform={`translate(${midX}, ${midY - 12})`}>
                  <rect
                    x="-26"
                    y="-9"
                    width="52"
                    height="17"
                    rx="8.5"
                    fill="rgba(255,255,255,0.95)"
                    stroke={color}
                    strokeWidth="1"
                  />
                  <text
                    y="3"
                    fill="#0f172a"
                    fontSize="10"
                    fontWeight="800"
                    textAnchor="middle"
                  >
                    {leg.distanceKm} km
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* 4. 出發／返回起點 Marker */}
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

      {/* 5. 門市巡檢站點 Pin 與防重疊可點擊標籤 */}
      {stops.map((stop, i) => {
        const p = markerPositions[i];
        const labelRect = labelPlacements[i];
        const isSelected = selectedStopId === stop.id;
        const bg = stop.abnormalFlag ? '#dc2626' : color;

        return (
          <React.Fragment key={stop.id}>
            {/* 立體 Pin 按鈕 */}
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 z-30"
              style={{ left: p.x, top: p.y }}
            >
              <button
                type="button"
                onPointerDown={e => e.stopPropagation()}
                onClick={() => onSelectStop?.(isSelected ? null : stop.id)}
                className="relative group cursor-pointer transition-transform duration-200 active:scale-95"
                style={{ transform: isSelected ? 'scale(1.22)' : 'scale(1)' }}
                title={`${stop.orderIndex}. ${stop.storeName}`}
              >
                {(isSelected || stop.abnormalFlag) && (
                  <div
                    className="w-9 h-9 rounded-full absolute -top-1 -left-1 animate-pulse"
                    style={{ background: `${bg}40` }}
                  />
                )}
                <div
                  className="w-7 h-7 rounded-full border-2 border-white shadow-md text-white font-black text-xs flex items-center justify-center transition-shadow"
                  style={{
                    background: `linear-gradient(135deg, ${bg}, #0f172a)`,
                    boxShadow: isSelected
                      ? `0 0 0 3px ${bg}80, 0 8px 16px rgba(0,0,0,0.3)`
                      : '0 3px 8px rgba(0,0,0,0.25)',
                  }}
                >
                  {stop.orderIndex}
                </div>
              </button>
            </div>

            {/* 自動避讓且可點擊的店名資訊標籤 */}
            {labelRect && (
              <button
                type="button"
                onPointerDown={e => e.stopPropagation()}
                onClick={() => onSelectStop?.(isSelected ? null : stop.id)}
                className={`absolute px-2.5 py-0.5 rounded-xl shadow-md border transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 max-w-[210px] ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-xl z-40 scale-105'
                    : 'bg-white/95 text-slate-800 border-slate-200/90 hover:border-blue-400 hover:bg-blue-50/90 z-25'
                }`}
                style={{ left: labelRect.x, top: labelRect.y, height: 26 }}
                title={stop.storeName}
              >
                <span className="text-xs font-black truncate">{stop.storeName}</span>
                {stop.visitTime && (
                  <span
                    className={`text-[10px] font-semibold px-1.5 rounded shrink-0 ${
                      isSelected ? 'bg-slate-800 text-blue-300' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {stop.visitTime}
                  </span>
                )}
                {stop.abnormalFlag && (
                  <span className="text-[10px] font-bold px-1.5 rounded bg-red-100 text-red-700 shrink-0">
                    異常
                  </span>
                )}
              </button>
            )}
          </React.Fragment>
        );
      })}

      {/* 6. 左上角：選取站點即時浮動詳情卡 */}
      {selectedStop && (
        <div
          className="absolute top-3 left-3 z-40 w-72 max-w-[calc(100%-24px)] bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-xl p-3.5 animate-in fade-in slide-in-from-top-2 duration-150"
          onPointerDown={e => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-black text-white"
                  style={{ background: selectedStop.abnormalFlag ? '#dc2626' : color }}
                >
                  第 {selectedStop.orderIndex} 站
                </span>
                {selectedStop.overallRating && !selectedStop.isSchedule && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    評等：{selectedStop.overallRating}
                  </span>
                )}
                {selectedStop.abnormalFlag && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                    異常警示
                  </span>
                )}
              </div>
              <h4 className="text-sm font-black text-slate-900 mt-1.5 truncate">{selectedStop.storeName}</h4>
              {selectedStop.visitTime && (
                <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                  <Clock size={11} />
                  <span>{selectedStop.visitTime} 到店回報</span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onSelectStop?.(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
              title="關閉"
            >
              <X size={14} />
            </button>
          </div>

          {selectedStop.highlightDescription && (
            <p className="mt-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200/80 rounded-lg p-2 leading-relaxed line-clamp-3">
              {selectedStop.highlightDescription}
            </p>
          )}

          {onJumpToActivity && selectedStop.recordId && !selectedStop.isSchedule && (
            <button
              type="button"
              onClick={() => onJumpToActivity(selectedStop.storeName, selectedStop.recordId)}
              className="mt-2.5 w-full py-1.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Eye size={13} />
              <span>前往戰情牆查看完整報告</span>
            </button>
          )}
        </div>
      )}

      {/* 7. 右上角：地圖縮放與圖資切換控制工具列 */}
      <div
        className="absolute top-3 right-3 z-40 flex flex-col items-end gap-2"
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200 p-1 flex items-center gap-1 text-xs font-bold text-slate-700">
          <Layers size={14} className="text-slate-400 ml-1.5 mr-0.5" />
          {(['streets', 'osm', 'topo'] as const).map(type => (
            <button
              key={type}
              type="button"
              onClick={() => setBasemap(type)}
              className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
                basemap === type ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {BASEMAP_CONFIGS[type].name}
            </button>
          ))}
        </div>

        <div className="bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200 overflow-hidden flex flex-col">
          <button
            type="button"
            onClick={() => zoomAtPoint(1, width / 2, height / 2)}
            className="p-2.5 hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer border-b border-slate-100"
            title="放大視野"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            onClick={() => zoomAtPoint(-1, width / 2, height / 2)}
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

      {/* 8. 左下角：圖例說明 */}
      <div className="absolute bottom-3 left-3 z-40 bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-slate-200 px-3 py-2 text-xs text-slate-600 flex items-center gap-3.5 pointer-events-none">
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
          <span>返程</span>
        </span>
        <span className="flex items-center gap-1.5 font-bold text-red-600">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600" />
          <span>異常</span>
        </span>
      </div>

      {/* 9. 右下角：圖資來源 */}
      <div className="absolute bottom-1 right-2 z-40 px-2 py-0.5 rounded bg-white/80 text-[10px] font-medium text-slate-500 pointer-events-none border border-slate-200/50">
        高解析圖資 · ESRI World Street Map / OpenStreetMap
      </div>
    </div>
  );
};
