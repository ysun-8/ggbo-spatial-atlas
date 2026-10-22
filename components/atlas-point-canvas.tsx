'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { canvasProjection, pickCanvasPoint } from '@/lib/atlas-canvas.mjs';

type Point = { id: string; x: number; y: number };
type Props = {
  points: Point[]; colors: Map<string, string>; viewBox: string;
  radius: number; opacity: number; selectedId?: string;
  label: string; className?: string; onSelect?: (id: string) => void; onKeyboardSelect?: (id: string) => void;
  // When false, a parent element owns keyboard access and this canvas is decorative to assistive tech.
  interactive?: boolean;
  background?: { url: string; previewUrl?: string; width: number; height: number; opacity: number };
};

export function AtlasPointCanvas({ points, colors, viewBox, radius, opacity, selectedId, label, className, onSelect, onKeyboardSelect, background, interactive = true }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const selected = useMemo(() => points.find((point) => point.id === selectedId), [points, selectedId]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  // Only geometry or colors redraw the dense layer. Opacity is composited by CSS,
  // and the selected cell and histology are independent SVG layers.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = canvas.current;
      if (!element) return;
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      const ctx = element.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const { scale, dx, dy } = canvasProjection(viewBox, width, height);
      const r = radius * scale;
      for (const point of points) {
        const x = point.x * scale + dx, y = point.y * scale + dy;
        if (x < -r || y < -r || x > width + r || y > height + r) continue;
        ctx.fillStyle = colors.get(point.id) ?? '#888';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      element.dataset.drawCount = String(Number(element.dataset.drawCount ?? 0) + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [points, colors, viewBox, radius, size]);
  const pick = (event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return pickCanvasPoint(points, canvasProjection(viewBox, rect.width, rect.height),
      event.clientX - rect.left, event.clientY - rect.top, radius);
  };
  // A keyboard-controlled plot uses application semantics and arrow-key navigation.
  const keyboard = interactive ? { role: 'application', tabIndex: 0, 'aria-label': `${label}. Use arrow keys to select cells.` } : { 'aria-hidden': true };
  // Pointer picking works the same either way; the parent provides keyboard access when this is not interactive.
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-static-element-interactions
  return <div className={`relative overflow-hidden ${className ?? ''}`} {...keyboard} data-point-count={points.length}
    onKeyDown={(event) => {
      if (!interactive) return;
      if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key) || !points.length) return;
      event.preventDefault();
      const index = points.findIndex((point) => point.id === selectedId);
      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      const next = index < 0 ? 0 : (index + step + points.length) % points.length;
      (onKeyboardSelect ?? onSelect)?.(points[next].id);
    }}
    onPointerDown={(event) => {
      const id = pick(event);
      if (id) event.currentTarget.setAttribute('data-spot-id', id);
      else event.currentTarget.removeAttribute('data-spot-id');
    }}
    onClick={onSelect ? (event) => { const id = pick(event); if (id) onSelect(id); } : undefined}>
    {background && <svg className="pointer-events-none absolute inset-0 size-full" viewBox={viewBox} aria-hidden="true" style={{ opacity: background.opacity }}>
      {/* The small preview shows until the full-resolution image covers it. */}
      {background.previewUrl && <image href={background.previewUrl} width={background.width} height={background.height} />}
      {background.url && <image href={background.url} width={background.width} height={background.height} />}
    </svg>}
    <canvas ref={canvas} className="pointer-events-none absolute inset-0 size-full" style={{ opacity }} aria-hidden="true" />
    <svg className="pointer-events-none absolute inset-0 size-full" viewBox={viewBox} aria-hidden="true">
      {selected && <SelectedMarker x={selected.x} y={selected.y} radius={radius} fill={colors.get(selected.id)} unitsPerPixel={size.width ? 1 / canvasProjection(viewBox, size.width, size.height).scale : 0} />}
    </svg>
  </div>;
}

// The selected point keeps a ring of at least 7 px, so it stays findable at any zoom.
export function SelectedMarker({ x, y, radius, fill, unitsPerPixel }: { x: number; y: number; radius: number; fill?: string; unitsPerPixel: number }) {
  const ring = Math.max(radius * 1.6, 7 * unitsPerPixel);
  return <g>
    <circle cx={x} cy={y} r={ring} fill="none" stroke="white" strokeWidth={4} vectorEffect="non-scaling-stroke" />
    <circle cx={x} cy={y} r={ring} fill="none" stroke="#1d1a18" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    <circle cx={x} cy={y} r={Math.max(radius, 2.5 * unitsPerPixel)} fill={fill} />
  </g>;
}
