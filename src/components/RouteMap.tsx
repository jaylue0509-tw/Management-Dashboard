import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GeoPoint } from '../data/storeCoordinates';
import type { OptimizedLeg, RouteStop } from '../utils/route-optimizer';
import { Minus, Plus, Maximize2 } from 'lucide-react';

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
const MIN_ZOOM = 5;
const MAX_ZOOM = 16;
const FIT_PADDING = 70;
const MARKER_RADIUS = 14;
// NOTE: 使用 CARTO Voyager 底圖（含道路與地名），區主管一眼即可辨識實際地理位置
const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];

/**
 * 經緯度轉換為 Web Mercator 世界像素座標
 */
const toWorldPx = (lat: number, lng: number, zoom: number): { x: number; y: number } => {
  const scale = TILE_SIZE * 2 ** zoom;
  const latRad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const x = ((lng + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
};

/**
 * 計算能完整容納所有點位的最大縮放層級，讓當日路線自動填滿地圖
 */
const computeFitZoom = (points: GeoPoint[], width: number, height: number): number => {
  if (points.length <= 1) return 14;
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
 * 真實街道底圖上的當日巡店路線圖
 * - 自動縮放至當日所有站點範圍
 * - 同座標站點自動錯開、店名標籤自動避讓，避免文字重疊
 */
export const RouteMap: React.FC<Props> = ({
  stops,
  legs,
  hubPoint,
  color,
  selectedStopId,
  onSelectStop,
  height = 520,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(800);
  const [zoomDelta, setZoomDelta] = useState<number>(0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // 監聽容器寬度，確保手機與桌機皆能正確自動縮放
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

  // 站點組合變更時（切換主管、日期、實際/建議）重設視角
  const routeKey = stops.map(s => s.id).join('|') + hubPoint.label;
  useEffect(() => {
    setZoomDelta(0);
    setPan({ x: 0, y: 0 });
  }, [routeKey]);

  const fitZoom = useMemo(() => computeFitZoom(allPoints, width, height), [allPoints, width, height]);
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitZoom + zoomDelta));

  // 以所有點位的中心為地圖中心
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

  // 底圖圖磚
  const tiles = useMemo(() => {
    const maxIndex = 2 ** zoom - 1;
    const x0 = Math.floor(viewport.left / TILE_SIZE);
    const x1 = Math.floor((viewport.left + width) / TILE_SIZE);
    const y0 = Math.max(0, Math.floor(viewport.top / TILE_SIZE));
    const y1 = Math.min(maxIndex, Math.floor((viewport.top + height) / TILE_SIZE));
    const list: { key: string; src: string; left: number; top: number }[] = [];
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const wrappedX = ((tx % (maxIndex + 1)) + maxIndex + 1) % (maxIndex + 1);
        const sub = TILE_SUBDOMAINS[(tx + ty) % TILE_SUBDOMAINS.length];
        list.push({
          key: `${zoom}-${tx}-${ty}`,
          src: `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${wrappedX}/${ty}.png`,
          left: tx * TILE_SIZE - viewport.left,
          top: ty * TILE_SIZE - viewport.top,
        });
      }
    }
    return list;
  }, [zoom, viewport, width, height]);

  // 站點螢幕座標（同位置自動環狀錯開，避免標記完全疊在一起）
  const hubPos = project(hubPoint);
  const markerPositions = useMemo(() => {
    const placed: { x: number; y: number }[] = [{ ...hubPos }];
    return stops.map(stop => {
      const base = project(stop.geoPoint);
      let pos = { ...base };
      let attempt = 0;
      while (placed.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < MARKER_RADIUS * 2 + 2) && attempt < 18) {
        attempt++;
        const ring = Math.ceil(attempt / 6);
        const angle = (attempt % 6) * (Math.PI / 3) - Math.PI / 2;
        pos = {
          x: base.x + Math.cos(angle) * (MARKER_RADIUS * 2 + 4) * ring,
          y: base.y + Math.sin(angle) * (MARKER_RADIUS * 2 + 4) * ring,
        };
      }
      placed.push(pos);
      return pos;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, zoom, viewport]);

  const posById = new Map<string, { x: number; y: number }>();
  stops.forEach((s, i) => posById.set(s.id, markerPositions[i]));

  // 店名標籤自動避讓（右 → 左 → 下 → 上）
  const labelPlacements = useMemo(() => {
    const obstacles: Rect[] = [
      { x: hubPos.x - MARKER_RADIUS, y: hubPos.y - MARKER_RADIUS, w: MARKER_RADIUS * 2, h: MARKER_RADIUS * 2 },
      ...markerPositions.map(p => ({ x: p.x - MARKER_RADIUS, y: p.y - MARKER_RADIUS, w: MARKER_RADIUS * 2, h: MARKER_RADIUS * 2 })),
    ];
    const result: { x: number; y: number }[] = [];
    stops.forEach((stop, i) => {
      const p = markerPositions[i];
      const w = stop.storeName.length * 13 + 18;
      const h = 22;
      const candidates: Rect[] = [
        { x: p.x + MARKER_RADIUS + 4, y: p.y - h / 2, w, h },
        { x: p.x - MARKER_RADIUS - 4 - w, y: p.y - h / 2, w, h },
        { x: p.x - w / 2, y: p.y + MARKER_RADIUS + 4, w, h },
        { x: p.x - w / 2, y: p.y - MARKER_RADIUS - 4 - h, w, h },
      ];
      const chosen = candidates.find(c => !obstacles.some(o => rectsOverlap(c, o))) || candidates[0];
      obstacles.push(chosen);
      result.push({ x: chosen.x, y: chosen.y });
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, markerPositions]);

  const getLegEndpoints = (leg: OptimizedLeg) => {
    const fromId = 'id' in leg.from ? leg.from.id : null;
    const toId = 'id' in leg.to ? leg.to.id : null;
    const a = (fromId && posById.get(fromId)) || hubPos;
    const b = (toId && posById.get(toId)) || hubPos;
    return { a, b };
  };

  // 拖曳平移
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

  // 縮放時以畫面中心為基準，保持平移量比例
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
      className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 select-none touch-none cursor-grab active:cursor-grabbing"
      style={{ height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* 街道底圖 */}
      {tiles.map(t => (
        <img
          key={t.key}
          src={t.src}
          alt=""
          draggable={false}
          className="absolute pointer-events-none"
          style={{ left: t.left, top: t.top, width: TILE_SIZE, height: TILE_SIZE }}
        />
      ))}

      {/* 路線線段 */}
      <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
        <defs>
          <marker id={`route-arrow-${color.replace('#', '')}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
          </marker>
        </defs>
        {legs.map((leg, i) => {
          const { a, b } = getLegEndpoints(leg);
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          return (
            <g key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeWidth={7} strokeLinecap="round" opacity={0.9} />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={leg.isReturnLeg ? '#94a3b8' : color}
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray={leg.isReturnLeg ? '8 7' : undefined}
              />
              {/* 方向箭頭置於線段中點 */}
              {!leg.isReturnLeg && Math.hypot(b.x - a.x, b.y - a.y) > 40 && (
                <line
                  x1={midX - (b.x - a.x) * 0.001}
                  y1={midY - (b.y - a.y) * 0.001}
                  x2={midX}
                  y2={midY}
                  stroke={color}
                  strokeWidth={4}
                  markerEnd={`url(#route-arrow-${color.replace('#', '')})`}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* 出發點（區域中心） */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-amber-500 border-[3px] border-white shadow-md flex items-center justify-center text-sm"
        style={{ left: hubPos.x, top: hubPos.y }}
        title={`出發／返回：${hubPoint.label}`}
      >
        🏠
      </div>

      {/* 站點標記 */}
      {stops.map((stop, i) => {
        const p = markerPositions[i];
        const isSelected = selectedStopId === stop.id;
        const bg = stop.abnormalFlag ? '#dc2626' : color;
        return (
          <button
            key={stop.id}
            type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={() => onSelectStop?.(isSelected ? null : stop.id)}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-md text-white font-extrabold flex items-center justify-center cursor-pointer transition-transform"
            style={{
              left: p.x,
              top: p.y,
              width: MARKER_RADIUS * 2,
              height: MARKER_RADIUS * 2,
              background: bg,
              fontSize: 13,
              transform: `translate(-50%, -50%) scale(${isSelected ? 1.25 : 1})`,
              zIndex: isSelected ? 30 : 20,
              boxShadow: isSelected ? `0 0 0 5px ${bg}40` : undefined,
            }}
            title={`${stop.orderIndex}. ${stop.storeName}${stop.visitTime ? `（${stop.visitTime}）` : ''}`}
          >
            {stop.orderIndex}
          </button>
        );
      })}

      {/* 店名標籤 */}
      {stops.map((stop, i) => {
        const l = labelPlacements[i];
        if (!l) return null;
        const isSelected = selectedStopId === stop.id;
        return (
          <div
            key={`label-${stop.id}`}
            className={`absolute pointer-events-none whitespace-nowrap rounded-md px-2 text-[12px] font-bold leading-[22px] shadow-sm border ${
              isSelected ? 'bg-slate-900 text-white border-slate-900' : 'bg-white/95 text-slate-800 border-slate-200'
            }`}
            style={{ left: l.x, top: l.y, zIndex: isSelected ? 25 : 15 }}
          >
            {stop.storeName}
          </div>
        );
      })}

      {/* 縮放控制 */}
      <div className="absolute top-3 right-3 z-40 flex flex-col bg-white rounded-lg shadow-md border border-slate-200 overflow-hidden" onPointerDown={e => e.stopPropagation()}>
        <button type="button" onClick={() => changeZoom(1)} className="p-2 hover:bg-slate-100 text-slate-700 cursor-pointer" title="放大">
          <Plus size={16} />
        </button>
        <button type="button" onClick={() => changeZoom(-1)} className="p-2 hover:bg-slate-100 text-slate-700 border-t border-slate-200 cursor-pointer" title="縮小">
          <Minus size={16} />
        </button>
        <button
          type="button"
          onClick={() => {
            setZoomDelta(0);
            setPan({ x: 0, y: 0 });
          }}
          className="p-2 hover:bg-slate-100 text-slate-700 border-t border-slate-200 cursor-pointer"
          title="顯示整條路線"
        >
          <Maximize2 size={15} />
        </button>
      </div>

      {/* 圖例 */}
      <div className="absolute bottom-6 left-3 z-40 bg-white/95 rounded-lg shadow-sm border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 flex items-center gap-3 pointer-events-none">
        <span className="flex items-center gap-1"><span>🏠</span>出發／返回點</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-1 rounded" style={{ background: color }} />去程</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-dashed border-slate-400" />返程</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-600" />有異常</span>
      </div>

      {/* 圖資來源標示（授權要求） */}
      <div className="absolute bottom-0 right-0 z-40 bg-white/80 px-1.5 text-[10px] text-slate-500 pointer-events-none">
        © OpenStreetMap contributors © CARTO
      </div>
    </div>
  );
};
