'use client';

import { useEffect, useRef, useState } from 'react';
import { canvasProjection, pickCanvasPoint } from '@/lib/atlas-canvas.mjs';

type Point = { id: string; x: number; y: number };
type Props = {
  points: Point[]; colors: Map<string, string>; viewBox: string;
  radius: number; opacity: number; selectedId?: string;
  label: string; className?: string; onSelect?: (id: string) => void;
  background?: { url: string; width: number; height: number; opacity: number };
};

export function AtlasPointCanvas({ points, colors, viewBox, radius, opacity, selectedId, label, className, onSelect, background }: Props) {
  const imageUrl = background?.url;
  const imageWidth = background?.width ?? 0;
  const imageHeight = background?.height ?? 0;
  const imageOpacity = background?.opacity ?? 0;
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(() => setRevision((value) => value + 1));
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    image.current = null;
    if (!imageUrl) return;
    const next = new Image();
    next.onload = () => { image.current = next; setRevision((value) => value + 1); };
    next.src = imageUrl;
    return () => { next.onload = null; image.current = null; };
  }, [imageUrl]);
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
      if (imageUrl && image.current) {
        ctx.globalAlpha = imageOpacity;
        ctx.drawImage(image.current, dx, dy, imageWidth * scale, imageHeight * scale);
      }
      ctx.globalAlpha = opacity;
      const r = radius * scale;
      const draw = (point: Point, selected = false) => {
        const x = point.x * scale + dx, y = point.y * scale + dy;
        const size = selected ? Math.max(r * 1.5, 3) : r;
        if (x < -size || y < -size || x > width + size || y > height + size) return;
        ctx.fillStyle = colors.get(point.id) ?? '#888';
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke(); }
      };
      for (const point of points) if (point.id !== selectedId) draw(point);
      const selected = selectedId && points.find((point) => point.id === selectedId);
      if (selected) { ctx.globalAlpha = 1; draw(selected, true); }
    });
    return () => cancelAnimationFrame(frame);
  }, [points, colors, viewBox, radius, opacity, selectedId, imageUrl, imageWidth, imageHeight, imageOpacity, revision]);
  const pick = (event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return pickCanvasPoint(points, canvasProjection(viewBox, rect.width, rect.height),
      event.clientX - rect.left, event.clientY - rect.top, radius);
  };
  // Canvas supplies a generated image; an img element cannot draw or select these points.
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
  return <canvas ref={canvas} className={className} role="img" aria-label={label} data-point-count={points.length}
    onPointerDown={(event) => {
      const id = pick(event);
      if (id) event.currentTarget.setAttribute('data-spot-id', id);
      else event.currentTarget.removeAttribute('data-spot-id');
    }}
    onClick={onSelect ? (event) => { const id = pick(event); if (id) onSelect(id); } : undefined} />;
}
