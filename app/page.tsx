'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleDot,
  Crosshair,
  Dna,
  ImageIcon,
  Minus,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import catalog from '@/atlas/catalog.json';
import { decodeExpression, validateSpatialData, filterCaptureSpots } from '@/lib/atlas-format.mjs';

type Capture = (typeof catalog.datasets)[number]['captures'][number];

type GeneStat = {
  gene: string;
  min: number;
  max: number;
  q95: number;
  detected: number;
  chunk?: string;
  offset?: number;
};

type Spot = {
  id: string;
  barcode: string;
  index?: number;
  x: number;
  y: number;
  fullres_x: number;
  fullres_y: number;
  umap_x: number;
  umap_y: number;
  line: string;
  slice: string;
  identity: string;
  cluster: string;
  counts: number;
  features: number;
  mito: number;
  expression?: Record<string, number>;
};

type VisiumData = {
  dataset: {
    name: string;
    cohort: string;
    technology: string;
    kind?: string;
    observation_label?: string;
    image_width?: number;
    image_height?: number;
    spot_diameter?: number;
    source_object: string;
    spot_count: number;
    lines: string[];
    slices?: string[];
    identities: string[];
    image?: string;
    images?: Record<string, string>;
    image_dimensions?: Record<string, { width: number; height: number }>;
    gene_data_path?: string;
    captures: Capture[];
    expression: { assay: string; layer: string; encoding: string };
    embedding: string;
    embedding_label: string;
    tissue_type: string;
    description: string;
  };
  genes: GeneStat[];
  spots: Spot[];
};

const identityColors: Record<string, string> = {
  OPZ: '#45b8ac',
  IQZ: '#ef9d3c',
  HCZ: '#d34f73',
  IR: '#7868d8',
  'CAR-T': '#2c7fb8',
  'M1 myeloid': '#458b74',
  perivascular: '#6f9847',
  endothelial: '#3b8f9c',
  'IFN-response': '#7868d8',
  Myeloid: '#2c7fb8',
};

const fallbackIdentityColors = ['#4d908e', '#f8961e', '#b56576', '#577590', '#8f6bb3'];
const minZoom = 0.8;
const regularMaxZoom = 3;
const hdMaxZoom = 20;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function publicPath(path: string) {
  if (!path.startsWith('/')) return path;
  return `${basePath}${path}`;
}

const datasetOptions = catalog.datasets;
if (catalog.schema_version !== 2 || !datasetOptions.length || new Set(datasetOptions.map((entry) => entry.id)).size !== datasetOptions.length || !datasetOptions.some((entry) => entry.id === catalog.default_dataset)) {
  throw new Error('Invalid dataset catalog');
}

const gradientOptions = [
  {
    id: 'seurat',
    label: 'Seurat-style',
    stops: ['#3b4cc0', '#2f7fbc', '#35b7b0', '#7ad151', '#fde725', '#f98e09', '#d7191c'],
  },
  {
    id: 'magma',
    label: 'Magma',
    stops: ['#1c1936', '#4a2d82', '#c13575', '#f18345', '#fae766'],
  },
  {
    id: 'viridis',
    label: 'Viridis',
    stops: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  },
] as const;

type GradientId = (typeof gradientOptions)[number]['id'];

function hexToRgb(hex: string) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

const gradientRgb = Object.fromEntries(gradientOptions.map((gradient) => [gradient.id, gradient.stops.map(hexToRgb)]));

function interpolateColor(value: number, gradientId: GradientId) {
  const stops = gradientRgb[gradientId];
  const position = Math.min(1, Math.max(0, value)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  const fraction = position - index;
  const color = stops[index].map((channel, channelIndex) =>
    Math.round(channel + (stops[index + 1][channelIndex] - channel) * fraction),
  );
  return `rgb(${color.join(',')})`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatGboLine(value: string) {
  if (value.startsWith('UP-')) return value;
  return `UP-${value.replace(/^UP/, '')}`;
}

export default function Home() {
  const [data, setData] = useState<VisiumData | null>(null);
  const [datasetId, setDatasetId] = useState(catalog.default_dataset);
  const [selectedCaptureId, setSelectedCaptureId] = useState('');
  const activeCapture = data?.dataset.captures.find((capture) => capture.id === selectedCaptureId) ?? data?.dataset.captures[0];
  const [selectedSlice, setSelectedSlice] = useState('all');
  const [selectedGene, setSelectedGene] = useState('CA9');
  const [displayMode, setDisplayMode] = useState<'gene' | 'identity'>('identity');
  const [gradientId, setGradientId] = useState<GradientId>('seurat');
  const [geneResult, setGeneResult] = useState<{ data: VisiumData; gene: string; values: Float32Array } | null>(null);
  const geneValues = geneResult?.data === data && geneResult.gene === selectedGene ? geneResult.values : null;
  const [datasetError, setDatasetError] = useState(false);
  const [geneError, setGeneError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [geneRetry, setGeneRetry] = useState(0);

  const [geneLoading, setGeneLoading] = useState(false);
  const [lineFilter, setLineFilter] = useState('all');
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const needsExpression = displayMode === 'gene' || selectedSpot !== null;
  const [imageOpacity, setImageOpacity] = useState(88);
  const [spotOpacity, setSpotOpacity] = useState(84);
  const [hdDotSize, setHdDotSize] = useState(100);
  const spatialViewport = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const maxZoom = data?.dataset.kind === 'hd' ? hdMaxZoom : regularMaxZoom;
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [search, setSearch] = useState('');
  const dragStart = useRef<{ pointerId: number; pointerX: number; pointerY: number; cameraX: number; cameraY: number; spotId: string | null } | null>(null);
  const didDrag = useRef(false);
  const cameraFrame = useRef<number | null>(null);
  const pendingCamera = useRef<typeof camera | null>(null);

  useEffect(() => () => {
    if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
  }, []);

  const scheduleCamera = useCallback((next: typeof camera) => {
    pendingCamera.current = next;
    if (cameraFrame.current !== null) return;
    cameraFrame.current = requestAnimationFrame(() => {
      cameraFrame.current = null;
      if (pendingCamera.current) setCamera(pendingCamera.current);
      pendingCamera.current = null;
    });
  }, []);

  useEffect(() => {
    const element = spatialViewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [data]);

  const geneChunkCache = useRef(new Map<string, Promise<ArrayBuffer>>());

  useEffect(() => {
    const selectedDataset = datasetOptions.find((dataset) => dataset.id === datasetId) ?? datasetOptions[0];
    const controller = new AbortController();
    setData(null);
    setDatasetError(false);
    fetch(publicPath(selectedDataset.path), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Dataset unavailable');
        return response.json() as Promise<VisiumData>;
      })
      .then((payload: VisiumData) => {
        if (controller.signal.aborted) return;
        const preferredGenes = selectedDataset.expression.featured_genes;
        const geneRank = (gene: string) => { const index = preferredGenes.indexOf(gene); return index < 0 ? preferredGenes.length : index; };
        payload.genes.sort((a, b) => geneRank(a.gene) - geneRank(b.gene) || a.gene.localeCompare(b.gene));
        // Geometry and provenance are catalog-owned; encoding is payload-owned for versioned exports.
        const merged = { ...payload, dataset: { ...payload.dataset, ...selectedDataset,
          expression: { ...selectedDataset.expression, encoding: payload.dataset.expression?.encoding ?? selectedDataset.expression.encoding } } };
        validateSpatialData(merged, merged.dataset.captures);
        setData(merged);
        setSelectedCaptureId(merged.dataset.captures[0].id);
        geneChunkCache.current.clear();
        if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
        cameraFrame.current = null;
        pendingCamera.current = null;
        setSelectedSlice('all');
        setSelectedGene(payload.genes.some((gene) => gene.gene === 'CA9') ? 'CA9' : payload.genes[0]?.gene ?? '');
        setDisplayMode('identity');
        setGeneResult(null);
        setGeneError(false);
        setGeneLoading(false);
        setLineFilter(payload.dataset.lines.length === 1 ? payload.dataset.lines[0] : 'all');
        setSelectedSpot(null);
        setCamera({ x: 0, y: 0, scale: 1 });
        setSearch('');
      })
      .catch(() => { if (!controller.signal.aborted) setDatasetError(true); });
    return () => controller.abort();
  }, [datasetId, retry]);

  useEffect(() => {
    if (!data || !needsExpression || !data.dataset.gene_data_path) {
      setGeneLoading(false);
      return;
    }

    const stats = data.genes.find((gene) => gene.gene === selectedGene);
    if (!stats?.chunk || stats.offset === undefined) {
      setGeneResult(null);
      setGeneLoading(false);
      setGeneError(true);
      return;
    }

    let active = true;
    const chunkUrl = publicPath(`${data.dataset.gene_data_path}/${stats.chunk}`);
    let request = geneChunkCache.current.get(chunkUrl);
    if (!request) {
      request = fetch(chunkUrl).then((response) => {
        if (!response.ok) throw new Error(`Unable to load ${selectedGene}`);
        if (stats.chunk!.endsWith('.gz')) {
          if (!response.body) throw new Error('Missing compressed gene data');
          return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        }
        return response.arrayBuffer();
      });
      geneChunkCache.current.set(chunkUrl, request);
      if (geneChunkCache.current.size > 8) {
        const oldest = geneChunkCache.current.keys().next().value;
        if (oldest) geneChunkCache.current.delete(oldest);
      }
    }

    setGeneResult(null);
    setGeneError(false);
    setGeneLoading(true);
    request
      .then((buffer) => {
        if (!active) return;
        const values = decodeExpression(buffer, stats, data.spots.length, data.dataset.expression.encoding);
        setGeneResult({ data, gene: selectedGene, values });
        setGeneLoading(false);
      })
      .catch(() => {
        geneChunkCache.current.delete(chunkUrl);
        if (!active) return;
        setGeneError(true);
        setGeneResult(null);
        setGeneLoading(false);
      });

    return () => { active = false; };
  }, [data, needsExpression, selectedGene, geneRetry]);

  const filteredSpots = useMemo(() => {
    if (!data) return [];
    return filterCaptureSpots(data.spots, activeCapture, selectedSlice, lineFilter) as Spot[];
  }, [data, activeCapture, lineFilter, selectedSlice]);

  const selectedGeneStats = useMemo(() => data?.genes.find((gene) => gene.gene === selectedGene), [data, selectedGene]);
  const matchingGenes = useMemo(() => {
    const query = search.toLowerCase();
    return data?.genes.filter((gene) => gene.gene.toLowerCase().includes(query)) ?? [];
  }, [data, search]);
  const visibleGenes = matchingGenes.slice(0, search ? 60 : 12);

  const getIdentityColor = useCallback((identity: string) => {
    if (identityColors[identity]) return identityColors[identity];
    const identityIndex = data?.dataset.identities.indexOf(identity) ?? 0;
    return fallbackIdentityColors[identityIndex % fallbackIdentityColors.length];
  }, [data]);

  const spotColors = useMemo(() => new Map(filteredSpots.map((spot) => {
    if (displayMode === 'identity') return [spot.id, getIdentityColor(spot.identity)] as const;
    if (data?.dataset.gene_data_path && !geneValues) return [spot.id, '#b5b5b5'] as const;
    const ceiling = selectedGeneStats?.q95 || selectedGeneStats?.max || 1;
    const value = data?.dataset.gene_data_path && spot.index !== undefined
      ? geneValues?.[spot.index] ?? 0
      : spot.expression?.[selectedGene] ?? 0;
    return [spot.id, interpolateColor(value / ceiling, gradientId)] as const;
  })), [filteredSpots, displayMode, getIdentityColor, selectedGeneStats, data, geneValues, selectedGene, gradientId]);

  const getSelectedExpression = (spot: Spot) => {
    if (data?.dataset.gene_data_path && spot.index !== undefined) return geneValues?.[spot.index] ?? null;
    return spot.expression?.[selectedGene] ?? 0;
  };

  const zoomAtCenter = (nextScale: number) => {
    setCamera((current) => {
      const scale = Math.min(maxZoom, Math.max(minZoom, nextScale));
      const ratio = scale / current.scale;
      return { x: current.x * ratio, y: current.y * ratio, scale };
    });
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (dragStart.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - bounds.left - bounds.width / 2;
    const cursorY = event.clientY - bounds.top - bounds.height / 2;

    setCamera((current) => {
      const nextScale = Math.min(maxZoom, Math.max(minZoom, current.scale * Math.exp(-event.deltaY * 0.0015)));
      const ratio = nextScale / current.scale;
      return {
        x: cursorX - (cursorX - current.x) * ratio,
        y: cursorY - (cursorY - current.y) * ratio,
        scale: nextScale,
      };
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || dragStart.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const spotId = (event.target as SVGElement).getAttribute?.('data-spot-id') ?? null;
    dragStart.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
      spotId,
    };
    didDrag.current = false;
    setIsDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || dragStart.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragStart.current.pointerX;
    const deltaY = event.clientY - dragStart.current.pointerY;
    if (Math.hypot(deltaX, deltaY) > 3) didDrag.current = true;
    scheduleCamera({
      ...camera,
      x: dragStart.current.cameraX + deltaX,
      y: dragStart.current.cameraY + deltaY,
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || dragStart.current.pointerId !== event.pointerId) return;
    // Commit the final drag position before a subsequent reset or zoom action.
    if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
    cameraFrame.current = null;
    if (pendingCamera.current) setCamera(pendingCamera.current);
    pendingCamera.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const clickedSpotId = dragStart.current?.spotId;
    if (event.type !== 'pointercancel' && !didDrag.current && clickedSpotId) {
      const clickedSpot = data?.spots.find((spot) => spot.id === clickedSpotId);
      if (clickedSpot) setSelectedSpot(clickedSpot);
    }
    dragStart.current = null;
    setIsDragging(false);
    window.setTimeout(() => { didDrag.current = false; }, 0);
  };

  const umapBounds = useMemo(() => {
    if (!data) return null;
    return data.spots.reduce((bounds, spot) => ({
      minX: Math.min(bounds.minX, spot.umap_x), maxX: Math.max(bounds.maxX, spot.umap_x),
      minY: Math.min(bounds.minY, spot.umap_y), maxY: Math.max(bounds.maxY, spot.umap_y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  }, [data]);

  const isHd = data?.dataset.kind === 'hd';
  const observationSingular = data?.dataset.observation_label ?? (isHd ? 'cell' : 'spot');
  const observationPlural = observationSingular === 'cell' ? 'cells' : 'spots';
  const imageWidth = activeCapture?.width ?? 1;
  const imageHeight = activeCapture?.height ?? 1;
  const tissueImage = activeCapture ? publicPath(activeCapture.image) : '';
  const pointRadius = (activeCapture?.marker_radius ?? 1) * (isHd ? hdDotSize / 100 : 1);
  const selectedPointRadius = pointRadius * 1.5;
  const [imageState, setImageState] = useState<{ key: string; status: 'loaded' | 'error' } | null>(null);
  const [imageRetry, setImageRetry] = useState(0);
  const imageKey = `${tissueImage}:${imageWidth}:${imageHeight}:${imageRetry}`;
  const imageStatus = imageState?.key === imageKey ? imageState.status : 'loading';
  useEffect(() => {
    if (!tissueImage) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setImageState({ key: imageKey, status: image.naturalWidth === imageWidth && image.naturalHeight === imageHeight ? 'loaded' : 'error' });
    };
    image.onerror = () => { if (active) setImageState({ key: imageKey, status: 'error' }); };
    image.src = tissueImage;
    return () => { active = false; image.onload = null; image.onerror = null; };
  }, [tissueImage, imageWidth, imageHeight, imageKey]);
  const viewWidth = imageWidth / camera.scale;
  const viewHeight = imageHeight / camera.scale;
  const imageUnitsPerPixel = imageWidth / (viewportWidth || imageWidth) / camera.scale;
  const spatialViewBox = `${(imageWidth - viewWidth) / 2 - camera.x * imageUnitsPerPixel} ${(imageHeight - viewHeight) / 2 - camera.y * imageUnitsPerPixel} ${viewWidth} ${viewHeight}`;
  const activeGradient = gradientOptions.find((option) => option.id === gradientId) ?? gradientOptions[0];
  const gradientCss = `linear-gradient(90deg, ${activeGradient.stops.join(', ')})`;

  // Camera and search updates reuse these dense layers without rebuilding points.
  const spatialPanel = useMemo(() => {
    return (
      <g>
        <image key={tissueImage} href={tissueImage} width={imageWidth} height={imageHeight} opacity={imageOpacity / 100} className="pointer-events-none" />
        <g>
          {filteredSpots.map((spot) => {
            const isSelected = selectedSpot?.id === spot.id;
            return (
              <circle key={spot.id} data-spot-id={spot.id} cx={spot.x} cy={spot.y} r={isSelected ? selectedPointRadius : pointRadius} fill={spotColors.get(spot.id)} fillOpacity={spotOpacity / 100} stroke={isSelected ? '#fff' : (isHd ? 'transparent' : 'rgba(24,18,26,0.38)')} strokeWidth={isSelected ? (isHd ? 0.9 : 4) : (isHd ? 2 : 1.2)} vectorEffect="non-scaling-stroke" className={isHd ? 'cursor-pointer' : 'cursor-pointer transition-[r,stroke-width] hover:stroke-white'} />
            );
          })}
        </g>
      </g>
    );
  }, [imageWidth, imageHeight, tissueImage, imageOpacity, filteredSpots, selectedSpot, selectedPointRadius, pointRadius, spotColors, spotOpacity, isHd]);

  const umapPanel = useMemo(() => (
    <svg viewBox="0 0 240 180" className="w-full rounded-lg bg-[#f5f2ed]" aria-label={`UMAP of visible Visium ${observationPlural}`} shapeRendering="geometricPrecision">
      {umapBounds && filteredSpots.map((spot) => {
        const x = 14 + ((spot.umap_x - umapBounds.minX) / (umapBounds.maxX - umapBounds.minX || 1)) * 212;
        const y = 166 - ((spot.umap_y - umapBounds.minY) / (umapBounds.maxY - umapBounds.minY || 1)) * 152;
        const isSelected = selectedSpot?.id === spot.id;
        return <circle key={spot.id} cx={x} cy={y} r={isSelected ? (isHd ? 3.2 : 4.5) : (isHd ? 1 : 1.8)} fill={spotColors.get(spot.id)} opacity={isSelected ? 1 : 0.76} stroke={isSelected ? '#fff' : 'none'} strokeWidth={isHd ? 1.2 : 2} vectorEffect="non-scaling-stroke" onClick={() => setSelectedSpot(spot)} className="cursor-pointer" />;
      })}
    </svg>
  ), [observationPlural, umapBounds, filteredSpots, selectedSpot, isHd, spotColors]);

  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f1ec] text-[#22201d]">
        <div className="flex items-center gap-3 rounded-xl border border-black/10 bg-white px-5 py-4 shadow-sm">
          <CircleDot className="size-5 animate-pulse text-[#9c3f68]" />
          {datasetError ? <div role="alert"><p className="text-sm font-medium">Unable to load this dataset.</p><Button className="mt-2" onClick={() => setRetry((value) => value + 1)}>Retry</Button></div> : <span className="text-sm font-medium">Loading spatial run…</span>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f3f0ea] text-[#201e1b]">
      <header className="flex min-h-14 items-center justify-between border-b border-[#d7d0c5] bg-[#fbfaf7] px-4 py-2 lg:px-6">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-[#351d4a] text-white shadow-sm">
            <Dna className="size-5" />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight">gGBO Spatial Atlas</h1>
            <p className="text-[11px] text-[#7e746a]">{data.dataset.cohort} · {data.dataset.name}</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 text-xs text-[#625b54] sm:flex">
          <span className="rounded-full border border-[#d7d0c5] bg-white px-3 py-1.5">{isHd ? 'Visium HD' : 'Regular Visium'}</span>
          <span className="rounded-full border border-[#d7d0c5] bg-white px-3 py-1.5">{formatNumber(data.dataset.spot_count)} {observationPlural}</span>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-57px)] grid-cols-1 xl:h-[calc(100vh-57px)] xl:min-h-0 xl:grid-cols-[240px_minmax(520px,1fr)_280px] xl:overflow-hidden">
        <aside className="border-b border-[#d7d0c5] bg-[#fbfaf7] p-3 xl:overflow-y-auto xl:border-b-0 xl:border-r">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <SlidersHorizontal className="size-4 text-[#8f315d]" />
              Explore
            </div>
            <span className="text-[11px] text-[#877d73]">Prototype</span>
          </div>

          <section className="space-y-1.5">
            <p className="control-label">Dataset</p>
            <div className="grid gap-1.5">
              {datasetOptions.map((dataset) => (
                <Button key={dataset.id} variant={datasetId === dataset.id ? 'default' : 'outline'} size="sm" className={datasetId === dataset.id ? 'h-auto justify-start whitespace-normal py-2 text-left bg-[#351d4a] hover:bg-[#351d4a]/90' : 'h-auto justify-start whitespace-normal py-2 text-left bg-white'} onClick={() => setDatasetId(dataset.id)}>
                  {dataset.label}
                </Button>
              ))}
            </div>
          </section>

          <section className="mt-3.5 space-y-1.5">
            <p className="control-label">Color {observationPlural} by</p>
            <div className="grid grid-cols-2 rounded-xl bg-[#ede8e0] p-1">
              <Button variant="ghost" size="sm" className={displayMode === 'gene' ? 'bg-white text-[#57234a] shadow-sm hover:bg-white' : 'text-[#776f67]'} onClick={() => setDisplayMode('gene')}>Gene</Button>
              <Button variant="ghost" size="sm" className={displayMode === 'identity' ? 'bg-white text-[#57234a] shadow-sm hover:bg-white' : 'text-[#776f67]'} onClick={() => setDisplayMode('identity')}>Identity</Button>
            </div>
          </section>

          {data.dataset.captures.length > 1 && (
            <section className="mt-3.5 space-y-1.5">
              <p className="control-label">Capture area</p>
              <div className="flex flex-wrap gap-1.5">
                {data.dataset.captures.map((capture) => (
                  <Button key={capture.id} variant={activeCapture?.id === capture.id ? 'default' : 'outline'} size="sm" onClick={() => {
                    setSelectedCaptureId(capture.id); setSelectedSlice('all'); setLineFilter('all'); setSelectedSpot(null);
                    if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
                    cameraFrame.current = null; pendingCamera.current = null;
                    setCamera({ x: 0, y: 0, scale: 1 });
                  }}>{capture.label}</Button>
                ))}
              </div>
            </section>
          )}
          {activeCapture && activeCapture.regions.length > 1 && (
            <section className="mt-3.5 space-y-1.5">
              <p className="control-label">Tissue region</p>
              <div className="flex flex-wrap gap-1.5">
                {[{ id: 'all', label: 'All' }, ...activeCapture.regions].map((region) => (
                  <Button key={region.id} variant={selectedSlice === region.id ? 'default' : 'outline'} size="sm" className={selectedSlice === region.id ? 'bg-[#9f3d6c] hover:bg-[#9f3d6c]/90' : 'bg-white'} onClick={() => { setSelectedSlice(region.id); setSelectedSpot(null); setCamera({ x: 0, y: 0, scale: 1 }); }}>
                    {region.label}
                  </Button>
                ))}
              </div>
            </section>
          )}

          {displayMode === 'gene' && (
            <section className="mt-3.5 space-y-1.5">
              <p className="control-label">Expression gradient</p>
              <div className="grid gap-1.5">
                {gradientOptions.map((gradient) => (
                  <Button key={gradient.id} variant="outline" size="sm" className={`h-9 justify-start gap-2.5 bg-white ${gradientId === gradient.id ? 'border-[#9f3d6c] ring-1 ring-[#9f3d6c]/30' : ''}`} onClick={() => setGradientId(gradient.id)} aria-pressed={gradientId === gradient.id}>
                    <span className="h-2.5 w-12 shrink-0 rounded-full" style={{ background: `linear-gradient(90deg, ${gradient.stops.join(', ')})` }} />
                    <span className="truncate text-[11px]">{gradient.label}</span>
                  </Button>
                ))}
              </div>
            </section>
          )}

          <section className="mt-3.5 space-y-1.5">
            <p className="control-label">{data.dataset.tissue_type === 'gGBO' ? 'GBO line' : 'Sample'}</p>
            <div className="flex flex-wrap gap-1.5">
              {(data.dataset.lines.length === 1 ? data.dataset.lines : ['all', ...data.dataset.lines]).map((line) => (
                <Button key={line} variant={lineFilter === line ? 'default' : 'outline'} size="sm" className={lineFilter === line ? 'bg-[#351d4a] hover:bg-[#351d4a]/90' : 'bg-white'} onClick={() => { setLineFilter(line); setSelectedSpot(null); }}>
                  {line === 'all' ? 'All' : data.dataset.tissue_type === 'gGBO' ? formatGboLine(line) : line}
                </Button>
              ))}
            </div>
          </section>

          {isHd && <section className="mt-3.5 space-y-1.5">
            <label className="flex items-center justify-between text-xs" htmlFor="hd-dot-size"><span className="control-label">Cell dot size</span><span>{hdDotSize}%</span></label>
            <input id="hd-dot-size" className="atlas-range w-full" type="range" min="25" max="150" step="5" value={hdDotSize} onChange={(event) => setHdDotSize(Number(event.target.value))} />
            <p className="text-[10px] text-[#91877d]">Display markers show cell centers, not cell boundaries. HD zoom supports up to 20×.</p>
          </section>}

          <section className="mt-3.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="control-label">Gene</p>
              <span className="text-[10px] text-[#91877d]">{formatNumber(data.genes.length)} {data.dataset.expression.assay} genes</span>
            </div>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-[#d7d0c5] bg-white px-2.5 focus-within:ring-2 focus-within:ring-[#b7517d]/25">
              <Search className="size-3.5 text-[#8f857c]" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#aaa097]" placeholder="Search genes" />
            </label>
            <div className="grid max-h-32 grid-cols-3 gap-1 overflow-auto pr-1 xl:grid-cols-2">
              {visibleGenes.map((gene) => (
                <Button key={gene.gene} variant={selectedGene === gene.gene ? 'default' : 'outline'} size="sm" className={selectedGene === gene.gene ? 'justify-start bg-[#9f3d6c] hover:bg-[#9f3d6c]/90' : 'justify-start bg-white'} onClick={() => { setSelectedGene(gene.gene); setDisplayMode('gene'); }}>
                  {gene.gene}
                </Button>
              ))}
            </div>
            {geneError && <div role="alert" className="text-xs text-[#96345f]">Expression unavailable. <button className="underline" onClick={() => setGeneRetry((value) => value + 1)}>Retry</button></div>}
            {matchingGenes.length > visibleGenes.length && <p className="text-[10px] text-[#91877d]">Type to search {formatNumber(matchingGenes.length)} available genes.</p>}
          </section>

        </aside>

        <section className="flex min-h-[560px] flex-col p-3 xl:min-h-0">
          <div className="mb-2 grid items-center gap-2 lg:grid-cols-[1fr_auto_1fr]">
            <div>
              <p className="text-sm font-semibold">Spatial view</p>
              <p className="text-xs text-[#766e67]">H&amp;E with {isHd ? 'segmented-cell centers' : 'capture spots'} · click a {observationSingular} to inspect</p>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-[#d7d0c5] bg-[#fbfaf7] px-3 py-1.5 shadow-sm">
              <label className="grid grid-cols-[auto_82px_28px] items-center gap-2 text-[10px] font-medium text-[#6e665f]">
                <span>H&amp;E</span>
                <input className="atlas-range" type="range" min="10" max="100" value={imageOpacity} onChange={(event) => setImageOpacity(Number(event.target.value))} />
                <span className="text-right tabular-nums">{imageOpacity}%</span>
              </label>
              <span className="h-5 w-px bg-[#d7d0c5]" />
              <label className="grid grid-cols-[auto_82px_28px] items-center gap-2 text-[10px] font-medium text-[#6e665f]">
                <span>{observationSingular === 'cell' ? 'Cells' : 'Spots'}</span>
                <input className="atlas-range" type="range" min="10" max="100" value={spotOpacity} onChange={(event) => setSpotOpacity(Number(event.target.value))} />
                <span className="text-right tabular-nums">{spotOpacity}%</span>
              </label>
            </div>
            <div className="flex items-center justify-self-start rounded-lg border border-[#d7d0c5] bg-[#fbfaf7] p-1 shadow-sm lg:justify-self-end">
              <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => zoomAtCenter(isHd ? camera.scale / 1.25 : camera.scale - 0.2)}><Minus /></Button>
              <span className="w-12 text-center text-[11px] font-medium text-[#6d655e]">{Math.round(camera.scale * 100)}%</span>
              <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoomAtCenter(isHd ? camera.scale * 1.25 : camera.scale + 0.2)}><Plus /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Reset view" onClick={() => setCamera({ x: 0, y: 0, scale: 1 })}><RotateCcw /></Button>
            </div>
          </div>

          <div
            className={`relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden rounded-2xl border border-[#cbc3b8] bg-[#ded9d1] p-2 shadow-[0_12px_35px_rgba(63,49,39,0.08)] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {imageStatus !== 'loaded' && <output className="absolute left-4 top-4 z-10 rounded-lg bg-white/95 p-2 text-xs">
              {imageStatus === 'error' ? <><span>Histology unavailable or image dimensions do not match.</span> <button className="underline" onClick={() => setImageRetry((value) => value + 1)}>Retry image</button></> : 'Loading histology…'}
            </output>}
            <div ref={spatialViewport} className="w-full max-w-[min(74vh,900px)] shrink-0" style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}>
              <svg className="size-full overflow-visible" viewBox={spatialViewBox} role="img" aria-label={`Spatial ${displayMode === 'gene' ? 'gene expression' : 'identity'} overlay`} shapeRendering="geometricPrecision">
                {spatialPanel}
              </svg>
            </div>

            <div className="absolute bottom-4 left-4 rounded-xl border border-black/10 bg-[#fffefa]/95 p-3 shadow-md backdrop-blur">
              {displayMode === 'gene' ? (
                <><div className="mb-2 flex items-center justify-between gap-6 text-[12px] font-medium"><span>{selectedGene}</span><span className="text-[#7d746c]">{geneError ? 'Unavailable' : geneLoading || (isHd && !geneValues) ? 'Loading…' : `0 – ${(selectedGeneStats?.q95 || selectedGeneStats?.max || 0).toFixed(2)}`}</span></div><div className="h-3 w-48 rounded-full" style={{ background: gradientCss }} /></>
              ) : (
                <div className="flex max-w-72 flex-wrap gap-x-4 gap-y-2">
                  {data.dataset.identities.map((identity) => <span key={identity} className="flex items-center gap-2 text-[13px] font-medium"><i className="size-3 rounded-full" style={{ background: getIdentityColor(identity) }} />{identity}</span>)}
                </div>
              )}
            </div>
            <div className="pointer-events-none absolute right-4 top-4 rounded-full border border-black/10 bg-[#fffefa]/90 px-3 py-1.5 text-[11px] font-medium text-[#5f5852] shadow-sm backdrop-blur">Drag to move · scroll to zoom · {formatNumber(filteredSpots.length)} {observationPlural}</div>
          </div>
        </section>

        <aside className="border-t border-[#d7d0c5] bg-[#fbfaf7] p-3 xl:overflow-y-auto xl:border-l xl:border-t-0">
          <div className="mb-3 rounded-xl border border-[#d7d0c5] bg-white p-3">
            <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold">Linked UMAP</p><span className="text-[10px] text-[#8a8179]">{data.dataset.embedding_label}</span></div>
            {umapPanel}
          </div>

          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Crosshair className="size-4 text-[#8f315d]" />{observationSingular === 'cell' ? 'Cell' : 'Spot'} inspector</div>
          {selectedSpot ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#d7d0c5] bg-white p-3.5 shadow-sm">
                <p className="truncate font-mono text-[11px] text-[#7a7169]">{selectedSpot.barcode}</p>
                <div className="mt-3 flex items-center justify-between">
                  <div><p className="text-lg font-semibold">{selectedSpot.identity}</p><p className="text-xs text-[#756d66]">{data.dataset.tissue_type === 'gGBO' ? `Line ${formatGboLine(selectedSpot.line)}` : selectedSpot.line} · Cluster {selectedSpot.cluster}</p></div>
                  <i className="size-5 rounded-full border-2 border-white shadow" style={{ background: getIdentityColor(selectedSpot.identity) }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Metric label="UMIs" value={formatNumber(selectedSpot.counts)} />
                <Metric label="Genes" value={formatNumber(selectedSpot.features)} />
                <Metric label="Mito" value={`${selectedSpot.mito.toFixed(1)}%`} />
                <Metric label={selectedGene} value={geneLoading ? '…' : (getSelectedExpression(selectedSpot)?.toFixed(2) ?? (geneError ? 'Unavailable' : '…'))} accent />
              </div>
              {selectedSpot.expression && <div className="rounded-xl border border-[#d7d0c5] bg-white p-3.5">
                <p className="mb-3 text-xs font-semibold">Selected expression</p>
                <div className="space-y-2.5">
                  {data.genes.slice(0, 6).map((gene) => {
                    const value = selectedSpot.expression?.[gene.gene] ?? 0;
                    const width = Math.min(100, (value / (gene.q95 || gene.max || 1)) * 100);
                    return <button key={gene.gene} className="grid w-full grid-cols-[42px_1fr_36px] items-center gap-2 text-left text-[11px]" onClick={() => { setSelectedGene(gene.gene); setDisplayMode('gene'); }}><span className="font-medium">{gene.gene}</span><span className="h-1.5 overflow-hidden rounded-full bg-[#eee8e1]"><i className="block h-full rounded-full bg-[#a43f6f]" style={{ width: `${width}%` }} /></span><span className="text-right tabular-nums text-[#7b726a]">{value.toFixed(1)}</span></button>;
                  })}
                </div>
              </div>}
            </div>
          ) : (
            <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-[#cfc6bb] bg-[#f5f2ed] p-6 text-center">
              <div><div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-white text-[#9c3f68] shadow-sm"><CircleDot className="size-5" /></div><p className="text-sm font-medium">Select a spatial {observationSingular}</p><p className="mt-1 text-xs leading-5 text-[#7d746c]">Inspect its identity, QC metrics, expression and position in the linked UMAP.</p></div>
            </div>
          )}
          <div className="mt-4 rounded-xl border border-[#d7d0c5] bg-[#f1ece5] p-3 text-[11px] leading-4 text-[#6e665f]">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-[#4d4742]"><ImageIcon className="size-3.5" />Prototype scope</div>
            {data.dataset.description} {formatNumber(data.genes.length)} {data.dataset.expression.assay} genes available.

          </div>
        </aside>
      </div>
    </main>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-[#d8a8bb] bg-[#fff3f7]' : 'border-[#d7d0c5] bg-white'}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#837a72]">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${accent ? 'text-[#96345f]' : ''}`}>{value}</p>
    </div>
  );
}
