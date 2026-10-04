'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Minus, Plus, RotateCcw, Search } from 'lucide-react';

import { detectedCeiling, readView, writeView, assetPath, pinchCamera } from '@/lib/atlas-display.mjs';
import { AtlasPointCanvas } from '@/components/atlas-point-canvas';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
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
    id: string;
    asset_base_url?: string;
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
  'IFN-response': '#b07aa1',
  Myeloid: '#8c6d31',
  myeloid: '#2c7fb8',
  'myeloid 1': '#2c7fb8',
  'myeloid 2': '#7868d8',
  'hypoxic niche': '#d34f73',
  'necrotic core': '#7f6557',
  'proliferating tumor': '#ef9d3c',
  'RG-like': '#45b8ac',
  oligo: '#859a41',
  stroma: '#aa74a4',
  hemorrhage: '#ac443d',
  'hemorrhage/debris': '#ac443d',
};

const identityNames: Record<string, string> = {
  OPZ: 'Outer proliferative zone',
  IQZ: 'Intermediate quiescent zone',
  HCZ: 'Hypoxic core zone',
  IR: 'Immune-responsive tumor',
  'IR tumor 1': 'Immune-responsive tumor 1',
  'IR tumor 2': 'Immune-responsive tumor 2',
};

const fallbackIdentityColors = ['#4d908e', '#f8961e', '#b56576', '#577590', '#8f6bb3'];
const minZoom = 0.8;
const regularMaxZoom = 3;
const hdMaxZoom = 20;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function publicPath(path: string, assetBase = '') {
  return assetPath(path, basePath, assetBase);
}

type DatasetEntry = (typeof catalog.datasets)[number] & { asset_base_url?: string };
const datasetOptions: DatasetEntry[] = catalog.datasets;
const datasetGroups = [...new Map(datasetOptions.map((entry) => [entry.navigation.group, {
  id: entry.navigation.group, label: entry.navigation.label,
}])).values()];
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
  const selectedEntry = datasetOptions.find((entry) => entry.id === datasetId)!;
  const groupEntries = datasetOptions.filter((entry) => entry.navigation.group === selectedEntry.navigation.group);
  const selectGroup = (group: string) => {
    const entries = datasetOptions.filter((entry) => entry.navigation.group === group);
    const next = entries.find((entry) => entry.navigation.line === selectedEntry.navigation.line) ?? entries[0];
    if (next) setDatasetId(next.id);
  };
  const [selectedCaptureId, setSelectedCaptureId] = useState('');
  const activeCapture = data?.dataset.captures.find((capture) => capture.id === selectedCaptureId) ?? data?.dataset.captures[0];
  const [selectedGene, setSelectedGene] = useState('CA9');
  const [manualMax, setManualMax] = useState('');
  const [urlReady, setUrlReady] = useState(false);
  const requestedView = useRef<ReturnType<typeof readView> | null>(null);
  useEffect(() => {
    requestedView.current = readView(window.location.search, datasetOptions, catalog.default_dataset);
    setDatasetId(requestedView.current.dataset);
    setUrlReady(true);
  }, []);
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
  const [imageOpacity, setImageOpacity] = useState(50);
  const [spotOpacity, setSpotOpacity] = useState(80);
  const [hdDotSize, setHdDotSize] = useState(40);
  const spatialViewport = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const maxZoom = data?.dataset.kind === 'hd' ? hdMaxZoom : regularMaxZoom;
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [search, setSearch] = useState('');
  const [shareStatus, setShareStatus] = useState('Copy link');
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
  }, [setCamera]);

  useEffect(() => {
    const element = spatialViewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [data]);

  const geneChunkCache = useRef(new Map<string, Promise<ArrayBuffer>>());

  useEffect(() => {
    if (!urlReady) return;
    const selectedDataset = datasetOptions.find((dataset) => dataset.id === datasetId) ?? datasetOptions[0];
    const controller = new AbortController();
    // Clear stale dataset controls while the replacement request is in flight.
    // oxlint-disable-next-line react/react-compiler
    setData(null);
    setDatasetError(false);
    fetch(publicPath(selectedDataset.path, selectedDataset.asset_base_url), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Dataset unavailable');
        if (selectedDataset.path.endsWith('.gz')) {
          if (!response.body) throw new Error('Dataset response is empty');
          return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json() as Promise<VisiumData>;
        }
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
        const view = requestedView.current?.dataset === datasetId ? requestedView.current : null;
        requestedView.current = null;
        const capture = merged.dataset.captures.find((item) => item.id === view?.capture) ?? merged.dataset.captures[0];
        setSelectedCaptureId(capture.id);
        geneChunkCache.current.clear();
        if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
        cameraFrame.current = null;
        pendingCamera.current = null;
        const gene = view?.gene ?? 'CA9';
        setSelectedGene(payload.genes.some((item) => item.gene === gene) ? gene : payload.genes[0]?.gene ?? '');
        setDisplayMode(view?.mode === 'gene' ? 'gene' : 'identity');
        setManualMax(view?.max ?? '');
        setGeneResult(null);
        setGeneError(false);
        // No expression request is needed in this state.
      // oxlint-disable-next-line react/react-compiler
      setGeneLoading(false);
        setLineFilter(view && payload.dataset.lines.includes(view.line) ? view.line : payload.dataset.lines.length === 1 ? payload.dataset.lines[0] : 'all');
        setSelectedSpot(null);
        setCamera({ x: 0, y: 0, scale: 1 });
        setSearch('');
      })
      .catch(() => { if (!controller.signal.aborted) setDatasetError(true); });
    return () => controller.abort();
  }, [datasetId, retry, urlReady]);

  useEffect(() => {
    if (!data || !needsExpression || !data.dataset.gene_data_path) {
      // Synchronize the request status when leaving expression mode.
      // oxlint-disable-next-line react/react-compiler
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
    const chunkUrl = publicPath(`${data.dataset.gene_data_path}/${stats.chunk}`, data.dataset.asset_base_url);
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
    return filterCaptureSpots(data.spots, activeCapture, 'all', lineFilter) as Spot[];
  }, [data, activeCapture, lineFilter]);

  const automaticCeiling = useMemo(() => {
    if (geneValues) return detectedCeiling(geneValues);
    if (data && !data.dataset.gene_data_path) return detectedCeiling(data.spots.map((spot) => spot.expression?.[selectedGene] ?? 0));
    return 0;
  }, [geneValues, data, selectedGene]);
  const parsedMax = Number(manualMax);
  const hasManualMax = Number.isFinite(parsedMax) && parsedMax > 0;
  const colorCeiling = hasManualMax ? parsedMax : automaticCeiling;
  useEffect(() => {
    if (!urlReady || !data || data.dataset.id !== datasetId) return;
    const query = writeView({ dataset: datasetId, capture: selectedCaptureId, line: lineFilter, gene: selectedGene, mode: displayMode, max: hasManualMax ? String(parsedMax) : '' });
    window.history.replaceState(null, '', window.location.pathname + query + window.location.hash);
  }, [urlReady, data, datasetId, selectedCaptureId, lineFilter, selectedGene, displayMode, hasManualMax, parsedMax]);
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

  const colorValues = displayMode === 'gene' ? geneValues : null;
  const activeCeiling = displayMode === 'gene' ? colorCeiling : 0;
  const spotColors = useMemo(() => new Map(filteredSpots.map((spot) => {
    if (displayMode === 'identity') return [spot.id, getIdentityColor(spot.identity)] as const;
    if (data?.dataset.gene_data_path && !colorValues) return [spot.id, '#b5b5b5'] as const;
    const ceiling = activeCeiling || 1;
    const value = data?.dataset.gene_data_path && spot.index !== undefined
      ? colorValues?.[spot.index] ?? 0
      : spot.expression?.[selectedGene] ?? 0;
    return [spot.id, interpolateColor(value / ceiling, gradientId)] as const;
  })), [filteredSpots, displayMode, getIdentityColor, activeCeiling, data, colorValues, selectedGene, gradientId]);

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

  // React registers wheel listeners as passive, so preventDefault only works on a native listener.
  const spatialPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = spatialPanelRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (dragStart.current) return;
      const bounds = element.getBoundingClientRect();
      const cursorX = event.clientX - bounds.left - bounds.width / 2;
      const cursorY = event.clientY - bounds.top - bounds.height / 2;
      setCamera((current) => {
        const nextScale = Math.min(maxZoom, Math.max(minZoom, current.scale * Math.exp(-event.deltaY * 0.0015)));
        const ratio = nextScale / current.scale;
        return { x: cursorX - (cursorX - current.x) * ratio, y: cursorY - (cursorY - current.y) * ratio, scale: nextScale };
      });
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [data, maxZoom]);

  // On touch screens, one-finger vertical swipes scroll the page (touch-action: pan-y),
  // one-finger horizontal drags pan the image, and two fingers pinch to zoom.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ x: number; y: number; distance: number; camera: typeof camera } | null>(null);
  const touchGesture = (element: HTMLElement) => {
    const [a, b] = [...touches.current.values()];
    const bounds = element.getBoundingClientRect();
    return { x: (a.x + b.x) / 2 - bounds.left - bounds.width / 2, y: (a.y + b.y) / 2 - bounds.top - bounds.height / 2,
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.current.size === 2) {
        event.currentTarget.setPointerCapture(event.pointerId);
        pinch.current = { ...touchGesture(event.currentTarget), camera: pendingCamera.current ?? camera };
        dragStart.current = null;
        didDrag.current = true;
        setIsDragging(false);
        return;
      }
    }
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
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch.current && touches.current.size === 2) {
        scheduleCamera(pinchCamera(pinch.current, touchGesture(event.currentTarget), minZoom, maxZoom));
        return;
      }
    }
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
    touches.current.delete(event.pointerId);
    if (pinch.current) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (touches.current.size < 2) {
        if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
        cameraFrame.current = null;
        if (pendingCamera.current) setCamera(pendingCamera.current);
        pendingCamera.current = null;
        pinch.current = null;
      }
      return;
    }
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
  const tissueImage = activeCapture ? publicPath(activeCapture.image, data?.dataset.asset_base_url) : '';
  const previewImage = activeCapture?.preview ? publicPath(activeCapture.preview, data?.dataset.asset_base_url) : '';
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
  // The view box matches the panel's shape, so zoomed-in views fill the whole panel.
  const panelWidth = viewportSize.width || imageWidth;
  const panelHeight = viewportSize.height || imageHeight;
  const imageUnitsPerPixel = Math.max(imageWidth / panelWidth, imageHeight / panelHeight) / camera.scale;
  const viewWidth = panelWidth * imageUnitsPerPixel;
  const viewHeight = panelHeight * imageUnitsPerPixel;
  const spatialViewBox = `${(imageWidth - viewWidth) / 2 - camera.x * imageUnitsPerPixel} ${(imageHeight - viewHeight) / 2 - camera.y * imageUnitsPerPixel} ${viewWidth} ${viewHeight}`;
  const activeGradient = gradientOptions.find((option) => option.id === gradientId) ?? gradientOptions[0];
  const gradientCss = `linear-gradient(90deg, ${activeGradient.stops.join(', ')})`;

  const useCanvas = isHd;
  const umapPoints = useMemo(() => !useCanvas || !umapBounds ? [] : filteredSpots.map((spot) => ({
    id: spot.id, x: 14 + ((spot.umap_x - umapBounds.minX) / (umapBounds.maxX - umapBounds.minX || 1)) * 212,
    y: 166 - ((spot.umap_y - umapBounds.minY) / (umapBounds.maxY - umapBounds.minY || 1)) * 152,
  })), [useCanvas, umapBounds, filteredSpots]);

  // Camera and search updates reuse these dense layers without rebuilding points.
  const spatialPanel = useMemo(() => {
    if (useCanvas) return null;
    return (
      <g>
        <g opacity={imageOpacity / 100} className="pointer-events-none">
          {previewImage && <image key={previewImage} href={previewImage} width={imageWidth} height={imageHeight} />}
          <image key={tissueImage} href={tissueImage} width={imageWidth} height={imageHeight} />
        </g>
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
  }, [useCanvas, imageWidth, imageHeight, tissueImage, previewImage, imageOpacity, filteredSpots, selectedSpot, selectedPointRadius, pointRadius, spotColors, spotOpacity, isHd]);

  const umapPanel = useMemo(() => useCanvas ? (
    <AtlasPointCanvas points={umapPoints} colors={spotColors} viewBox="0 0 240 180" radius={1} opacity={0.76}
      selectedId={selectedSpot?.id} label={`UMAP of visible Visium ${observationPlural}`} className="w-full aspect-[4/3] rounded-md bg-ground"
      onSelect={(id) => { const spot = filteredSpots.find((point) => point.id === id); if (spot) setSelectedSpot(spot); }} />
  ) : (
    <svg viewBox="0 0 240 180" className="w-full rounded-md bg-ground" aria-label={`UMAP of visible Visium ${observationPlural}`} shapeRendering="geometricPrecision">
      {umapBounds && filteredSpots.map((spot) => {
        const x = 14 + ((spot.umap_x - umapBounds.minX) / (umapBounds.maxX - umapBounds.minX || 1)) * 212;
        const y = 166 - ((spot.umap_y - umapBounds.minY) / (umapBounds.maxY - umapBounds.minY || 1)) * 152;
        const isSelected = selectedSpot?.id === spot.id;
        return <circle key={spot.id} cx={x} cy={y} r={isSelected ? (isHd ? 3.2 : 4.5) : (isHd ? 1 : 1.8)} fill={spotColors.get(spot.id)} opacity={isSelected ? 1 : 0.76} stroke={isSelected ? '#fff' : 'none'} strokeWidth={isHd ? 1.2 : 2} vectorEffect="non-scaling-stroke" onClick={() => setSelectedSpot(spot)} className="cursor-pointer" />;
      })}
    </svg>
  ), [useCanvas, umapPoints, observationPlural, umapBounds, filteredSpots, selectedSpot, isHd, spotColors, setSelectedSpot]);

  const viewLabel = `${selectedEntry.navigation.label}${selectedEntry.navigation.line ? ` · ${selectedEntry.navigation.line}` : ''}`;

  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center bg-ground px-6 text-ink">
        <div className="flex flex-col items-center gap-4 text-center">
          <ZoneMark className={`size-10 ${datasetError ? '' : 'animate-pulse'}`} />
          {datasetError ? (
            <div role="alert" className="space-y-3">
              <p className="text-sm font-medium">Unable to load {viewLabel}.</p>
              <Button onClick={() => setRetry((value) => value + 1)}>Retry</Button>
            </div>
          ) : (
            <p className="text-sm text-ink-2" aria-live="polite">Loading {viewLabel}…</p>
          )}
        </div>
      </main>
    );
  }

  const lineLabel = data.dataset.tissue_type === 'gGBO' ? 'GBO line' : 'Sample';
  const legendIdentities = data.dataset.identities
    .map((identity, index) => ({ identity, index }))
    .sort((a, b) => zoneRank(a.identity) - zoneRank(b.identity) || a.index - b.index)
    .map(({ identity }) => identity);
  const selectedValue = selectedSpot ? (geneLoading ? null : getSelectedExpression(selectedSpot)) : null;

  return (
    <main className="flex min-h-screen flex-col bg-ground text-ink xl:h-screen">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule bg-panel px-4 py-2.5 lg:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <ZoneMark className="size-8 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold leading-5 tracking-[-0.01em]">{catalog.site.title}</h1>
            <p className="truncate text-xs leading-4 text-ink-3">{viewLabel}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4 text-xs">
          <span className="hidden tabular-nums text-ink-2 md:inline">{formatNumber(data.dataset.spot_count)} {observationPlural}</span>
          <a className="text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-plum" href={publicPath('/about.html')} target="_blank" rel="noreferrer">Methods &amp; source</a>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rule-strong bg-white px-2.5 font-medium text-ink transition-colors hover:border-ink-3" onClick={async () => {
            try { await navigator.clipboard.writeText(window.location.href); setShareStatus('Link copied'); }
            catch { setShareStatus('Copy from address bar'); }
            window.setTimeout(() => setShareStatus('Copy link'), 3000);
          }}><Link2 className="size-3.5 text-ink-3" aria-hidden="true" /><span aria-live="polite">{shareStatus}</span></button>
        </div>
      </header>

      {/* Phones see the tissue right after the dataset choice; wide screens get three columns. */}
      <div className="grid flex-1 grid-cols-1 [grid-template-areas:'data'_'view'_'color'_'side'] xl:min-h-0 xl:grid-cols-[264px_minmax(520px,1fr)_288px] xl:grid-rows-[auto_minmax(0,1fr)] xl:[grid-template-areas:'data_view_side'_'color_view_side']">
        <section aria-label="Dataset" className="grid gap-3 border-b border-rule bg-panel px-4 py-3.5 [grid-area:data] sm:grid-cols-2 xl:grid-cols-1 xl:border-r">
          <Field label="Dataset" htmlFor="dataset-group">
            <NativeSelect id="dataset-group" className="w-full bg-white" value={selectedEntry.navigation.group} onChange={(event) => selectGroup(event.target.value)}>
              <optgroup label="Visium">
                {datasetGroups.filter((group) => !group.id.startsWith('hd-')).map((group) => <option key={group.id} value={group.id}>{group.label.replace('Visium · ', '')}</option>)}
              </optgroup>
              <optgroup label="Visium HD">
                {datasetGroups.filter((group) => group.id.startsWith('hd-')).map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
              </optgroup>
            </NativeSelect>
          </Field>

          {isHd && <Field label={lineLabel} htmlFor="hd-line">
            <NativeSelect id="hd-line" className="w-full bg-white" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
              {groupEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.navigation.line}</option>)}
            </NativeSelect>
          </Field>}

          {data.dataset.captures.length > 1 && (
            <Field label="Capture area" htmlFor="capture-area">
              <NativeSelect id="capture-area" className="w-full bg-white" value={activeCapture?.id} onChange={(event) => {
                setSelectedCaptureId(event.target.value); setLineFilter('all'); setSelectedSpot(null);
                if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
                cameraFrame.current = null; pendingCamera.current = null;
                setCamera({ x: 0, y: 0, scale: 1 });
              }}>
                {data.dataset.captures.map((capture) => <option key={capture.id} value={capture.id}>{capture.label.replaceAll('UP-', '')}</option>)}
              </NativeSelect>
            </Field>
          )}

          {!isHd && <fieldset className="m-0 min-w-0 space-y-1.5 border-0 p-0 sm:col-span-2 xl:col-span-1">
            <legend className="control-label mb-1.5">{lineLabel}</legend>
            <div className="flex flex-wrap gap-1.5">
              {(data.dataset.lines.length === 1 ? data.dataset.lines : ['all', ...data.dataset.lines]).map((line) => (
                <button key={line} className={toggleClass(lineFilter === line)} aria-pressed={lineFilter === line} onClick={() => { setLineFilter(line); setSelectedSpot(null); }}>
                  {line === 'all' ? 'All' : data.dataset.tissue_type === 'gGBO' ? formatGboLine(line) : line}
                </button>
              ))}
            </div>
          </fieldset>}
        </section>

        <section aria-label="Display" className="divide-y divide-rule border-b border-rule bg-panel [grid-area:color] xl:min-h-0 xl:overflow-y-auto xl:border-r xl:border-b-0">
          <fieldset className="m-0 min-w-0 border-0 px-4 py-3.5">
            <legend className="control-label float-left mb-1.5 w-full">Color {observationPlural} by</legend>
            <div className="clear-left grid grid-cols-2 gap-0.5 rounded-lg bg-ground p-0.5">
              {(['gene', 'identity'] as const).map((mode) => (
                <button key={mode} aria-pressed={displayMode === mode} onClick={() => setDisplayMode(mode)}
                  className={`h-7 rounded-md text-[13px] font-medium transition-colors ${displayMode === mode ? 'bg-white text-plum shadow-[0_1px_2px_rgba(29,26,24,0.12)]' : 'text-ink-2 hover:text-ink'}`}>
                  {mode === 'gene' ? 'Gene' : 'Identity'}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2 px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <label className="control-label" htmlFor="gene-search">Gene</label>
              <span className="text-[11px] tabular-nums text-ink-3">{formatNumber(data.genes.length)} genes</span>
            </div>
            <div className="flex h-8 items-center gap-2 rounded-md border border-rule-strong bg-white px-2.5 focus-within:border-plum focus-within:ring-2 focus-within:ring-plum/15">
              <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
              <input id="gene-search" type="search" autoComplete="off" spellCheck={false} value={search} onChange={(event) => setSearch(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3" placeholder="Search genes" />
            </div>
            <div className="-mx-1 grid max-h-[9.5rem] grid-cols-3 gap-px overflow-y-auto px-1 sm:grid-cols-4 xl:max-h-[11rem] xl:grid-cols-2">
              {visibleGenes.map((gene) => (
                <button key={gene.gene} aria-pressed={selectedGene === gene.gene} onClick={() => { setSelectedGene(gene.gene); setDisplayMode('gene'); }}
                  className={`gene h-7 truncate rounded-md px-2 text-left text-[13px] transition-colors ${selectedGene !== gene.gene ? 'text-ink hover:bg-ground' : displayMode === 'gene' ? 'bg-plum font-medium text-white' : 'bg-plum-soft font-medium text-plum'}`}>
                  {gene.gene}
                </button>
              ))}
              {search && !visibleGenes.length && <p className="col-span-full py-1.5 text-xs text-ink-2">No gene matches “{search}”.</p>}
            </div>
            {geneError && <div role="alert" className="text-xs text-plum">Expression unavailable. <button className="underline underline-offset-2" onClick={() => setGeneRetry((value) => value + 1)}>Retry</button></div>}
            {matchingGenes.length > visibleGenes.length && <p className="text-[11px] text-ink-3">{search ? `Showing ${visibleGenes.length} of ${formatNumber(matchingGenes.length)} matches.` : 'Type to search all genes.'}</p>}
          </div>

          {displayMode === 'gene' && <div className="space-y-3 px-4 py-3.5">
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="control-label float-left mb-1.5 w-full">Color scale</legend>
              <div className="clear-left grid gap-1 sm:grid-cols-3 xl:grid-cols-1">
                {gradientOptions.map((gradient) => (
                  <button key={gradient.id} onClick={() => setGradientId(gradient.id)} aria-pressed={gradientId === gradient.id}
                    className={`flex h-7 items-center gap-2.5 rounded-md border px-2 text-left text-xs transition-colors ${gradientId === gradient.id ? 'border-plum bg-white text-ink ring-1 ring-plum' : 'border-transparent text-ink-2 hover:bg-ground hover:text-ink'}`}>
                    <span className="h-2 w-14 shrink-0 rounded-[2px]" style={{ background: `linear-gradient(90deg, ${gradient.stops.join(', ')})` }} />
                    {gradient.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <label className="control-label" htmlFor="expression-max">Expression maximum</label>
              <input id="expression-max" type="number" min="0.000001" step="any" inputMode="decimal" placeholder={`Automatic (${automaticCeiling ? automaticCeiling.toFixed(2) : 'P95'})`} value={manualMax} onChange={(event) => setManualMax(event.target.value)}
                className="h-8 w-full rounded-md border border-rule-strong bg-white px-2.5 text-sm tabular-nums outline-none placeholder:text-ink-3 focus:border-plum focus:ring-2 focus:ring-plum/15" />
              {manualMax && !hasManualMax
                ? <p className="text-xs text-plum" role="alert">Enter a positive number. Automatic scaling is on.</p>
                : <p className="text-[11px] leading-4 text-ink-3">Leave blank for automatic scaling. Enter the same maximum to compare samples. Values are {data.dataset.expression.assay}/{data.dataset.expression.layer}.</p>}
            </div>
          </div>}

          {isHd && <div className="space-y-2 px-4 py-3.5">
            <label className="flex items-center justify-between" htmlFor="hd-dot-size"><span className="control-label">Cell dot size</span><span className="text-xs tabular-nums text-ink-2">{hdDotSize}%</span></label>
            <input id="hd-dot-size" className="atlas-range" type="range" min="25" max="100" step="5" value={hdDotSize} onChange={(event) => setHdDotSize(Number(event.target.value))} />
          </div>}
        </section>

        <section aria-label="Spatial view" className="flex min-h-[min(72svh,118vw)] flex-col p-2 [grid-area:view] sm:p-3 xl:min-h-0">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 pb-2">
            <p className="mr-auto text-xs text-ink-2">H&amp;E with {isHd ? 'segmented-cell centers' : 'capture spots'}. Click a {observationSingular} to inspect it.</p>
            <div className="flex items-center gap-4">
              <OpacitySlider label="H&E" value={imageOpacity} onChange={setImageOpacity} />
              <OpacitySlider label={observationSingular === 'cell' ? 'Cells' : 'Spots'} value={spotOpacity} onChange={setSpotOpacity} />
            </div>
            <div className="flex items-center rounded-md border border-rule-strong bg-panel">
              <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => zoomAtCenter(isHd ? camera.scale / 1.25 : camera.scale - 0.2)}><Minus /></Button>
              <span className="w-11 text-center text-[11px] font-medium tabular-nums text-ink-2" aria-live="polite">{Math.round(camera.scale * 100)}%</span>
              <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => zoomAtCenter(isHd ? camera.scale * 1.25 : camera.scale + 0.2)}><Plus /></Button>
              <span className="h-4 w-px bg-rule" aria-hidden="true" />
              <Button variant="ghost" size="icon-sm" aria-label="Reset view" onClick={() => setCamera({ x: 0, y: 0, scale: 1 })}><RotateCcw /></Button>
            </div>
          </div>

          <div
            className={`relative flex min-h-0 flex-1 touch-pan-y select-none items-center justify-center overflow-hidden rounded-lg border border-rule-strong bg-[#e5e1da] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            ref={spatialPanelRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {imageStatus !== 'loaded' && <output className="absolute left-3 top-3 z-10 rounded-md border border-rule bg-panel px-2.5 py-1.5 text-xs text-ink-2">
              {imageStatus === 'error' ? <><span>Histology unavailable or image dimensions do not match.</span> <button className="underline underline-offset-2" onClick={() => setImageRetry((value) => value + 1)}>Retry image</button></> : 'Loading full-resolution histology…'}
            </output>}
            <div ref={spatialViewport} className="absolute inset-2">
              {useCanvas ? <AtlasPointCanvas key={imageKey} points={filteredSpots} colors={spotColors} viewBox={spatialViewBox}
                radius={pointRadius} opacity={spotOpacity / 100} selectedId={selectedSpot?.id}
                onKeyboardSelect={(id) => { const spot = filteredSpots.find((point) => point.id === id); if (spot) setSelectedSpot(spot); }}
                label={`Spatial ${displayMode === 'gene' ? 'gene expression' : 'identity'} overlay`} className="size-full"
                background={{ url: tissueImage, previewUrl: previewImage, width: imageWidth, height: imageHeight, opacity: imageOpacity / 100 }} /> : <svg className="size-full overflow-visible" viewBox={spatialViewBox} aria-label={`Spatial ${displayMode === 'gene' ? 'gene expression' : 'identity'} overlay`} shapeRendering="geometricPrecision">
                {spatialPanel}
              </svg>}
            </div>

            <figure className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-md border border-rule bg-panel/95 px-3 py-2.5 shadow-[0_2px_8px_rgba(29,26,24,0.08)]">
              {displayMode === 'gene' ? (
                <>
                  <figcaption className="flex items-baseline justify-between gap-6 text-[13px]">
                    <span className="gene font-medium">{selectedGene}</span>
                    <span className="text-[11px] text-ink-3">{geneError ? 'Unavailable' : geneLoading || (isHd && !geneValues) ? 'Loading…' : `${data.dataset.expression.assay}/${data.dataset.expression.layer}`}</span>
                  </figcaption>
                  <div className="mt-2 h-2 w-52 max-w-full rounded-[2px]" style={{ background: gradientCss }} />
                  <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-ink-2"><span>0</span><span>{geneLoading || (isHd && !geneValues) ? '–' : `${colorCeiling.toFixed(2)}${hasManualMax ? '' : ' (P95)'}`}</span></div>
                  <p className="mt-1.5 max-w-52 text-[11px] leading-4 text-ink-3">{hasManualMax ? 'Manual maximum.' : '95th percentile of expressing cells.'} Higher values use the top color.</p>
                </>
              ) : (
                <ul className="grid gap-1.5" aria-label="Identity legend">
                  {legendIdentities.map((identity) => (
                    <li key={identity} className="flex items-center gap-2 text-[13px] leading-4">
                      <i className="size-2.5 shrink-0 rounded-full" style={{ background: getIdentityColor(identity) }} aria-hidden="true" />
                      <span className="font-medium">{identity}</span>
                      {identityNames[identity] && <span className="hidden text-ink-3 sm:inline">{identityNames[identity]}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </figure>
            <p className="pointer-events-none absolute right-3 top-3 hidden rounded-md bg-panel/90 px-2 py-1 text-[11px] text-ink-2 sm:block">{formatNumber(filteredSpots.length)} {observationPlural} · drag to pan, scroll to zoom</p>
          </div>
        </section>

        <aside className="divide-y divide-rule border-t border-rule bg-panel [grid-area:side] xl:min-h-0 xl:overflow-y-auto xl:border-t-0 xl:border-l">
          <section className="px-4 py-3.5" aria-labelledby="umap-heading">
            <div className="mb-2 flex items-baseline justify-between gap-2"><h2 id="umap-heading" className="text-[13px] font-semibold">Linked UMAP</h2><span className="text-[11px] text-ink-3">{data.dataset.embedding_label}</span></div>
            {umapPanel}
          </section>

          <section className="px-4 py-3.5" aria-labelledby="inspector-heading" aria-live="polite">
            <h2 id="inspector-heading" className="mb-2 text-[13px] font-semibold">Selected {observationSingular}</h2>
            {selectedSpot ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2.5">
                  <i className="mt-1 size-3 shrink-0 rounded-full ring-2 ring-white" style={{ background: getIdentityColor(selectedSpot.identity) }} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-base font-semibold leading-5">{selectedSpot.identity}</p>
                    {identityNames[selectedSpot.identity] && <p className="text-xs text-ink-3">{identityNames[selectedSpot.identity]}</p>}
                    <p className="mt-1 truncate font-mono text-[11px] text-ink-3" title={selectedSpot.barcode}>{selectedSpot.barcode}</p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 border-t border-rule text-sm">
                  <Reading label={data.dataset.tissue_type === 'gGBO' ? 'Line' : 'Sample'} value={data.dataset.tissue_type === 'gGBO' ? formatGboLine(selectedSpot.line) : selectedSpot.line} />
                  <Reading label="Cluster" value={selectedSpot.cluster} />
                  <Reading label="UMIs" value={formatNumber(selectedSpot.counts)} />
                  <Reading label="Genes" value={formatNumber(selectedSpot.features)} />
                  <Reading label="Mito" value={`${selectedSpot.mito.toFixed(1)}%`} />
                  <Reading label={<span className="gene">{selectedGene}</span>} value={selectedValue !== null ? selectedValue.toFixed(2) : geneError ? 'Unavailable' : '…'} accent />
                </dl>
                {selectedSpot.expression && <div>
                  <p className="mb-2 text-xs font-medium text-ink-2">Featured genes</p>
                  <div className="space-y-1">
                    {data.genes.slice(0, 6).map((gene) => {
                      const value = selectedSpot.expression?.[gene.gene] ?? 0;
                      const width = Math.min(100, (value / (gene.q95 || gene.max || 1)) * 100);
                      return <button key={gene.gene} className="grid w-full grid-cols-[52px_1fr_32px] items-center gap-2 rounded-sm py-0.5 text-left text-xs hover:bg-ground" onClick={() => { setSelectedGene(gene.gene); setDisplayMode('gene'); }}>
                        <span className="gene font-medium">{gene.gene}</span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-ground"><i className="block h-full rounded-full bg-plum" style={{ width: `${width}%` }} /></span>
                        <span className="text-right tabular-nums text-ink-2">{value.toFixed(1)}</span>
                      </button>;
                    })}
                  </div>
                </div>}
              </div>
            ) : (
              <p className="text-[13px] leading-5 text-ink-2">Click a {observationSingular} in the tissue or the UMAP to see its identity, cluster, QC values, and <span className="gene">{selectedGene}</span> expression.</p>
            )}
          </section>

          <section className="px-4 py-3.5" aria-labelledby="dataset-heading">
            <h2 id="dataset-heading" className="mb-1.5 text-[13px] font-semibold">About this dataset</h2>
            <p className="text-[13px] leading-5 text-ink-2">{data.dataset.description}</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] leading-4">
              <dt className="text-ink-3">Cohort</dt><dd className="text-ink-2">{data.dataset.cohort}</dd>
              <dt className="text-ink-3">{isHd ? 'Cells' : 'Spots'}</dt><dd className="tabular-nums text-ink-2">{formatNumber(data.dataset.spot_count)}</dd>
              {data.dataset.source_object && <><dt className="text-ink-3">Source</dt><dd className="break-all font-mono text-ink-2">{data.dataset.source_object}</dd></>}
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}

const zoneOrder = ['OPZ', 'IQZ', 'HCZ'];
function zoneRank(identity: string) {
  const index = zoneOrder.indexOf(identity);
  return index < 0 ? zoneOrder.length : index;
}

function toggleClass(active: boolean) {
  return `h-7 rounded-md border px-2.5 text-xs font-medium tabular-nums transition-colors ${active ? 'border-plum bg-plum text-white' : 'border-rule-strong bg-white text-ink-2 hover:border-ink-3 hover:text-ink'}`;
}

// The gGBO zones from rim to core: OPZ, IQZ, HCZ.
function ZoneMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill={identityColors.OPZ} />
      <circle cx="16" cy="16" r="10.25" fill={identityColors.IQZ} stroke="var(--atlas-panel)" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="5.5" fill={identityColors.HCZ} stroke="var(--atlas-panel)" strokeWidth="1.5" />
    </svg>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="control-label block" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function OpacitySlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid grid-cols-[auto_72px_30px] items-center gap-2 text-[11px] font-medium text-ink-2">
      <span>{label}</span>
      <input className="atlas-range" type="range" min="10" max="100" value={value} aria-label={`${label} opacity`} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="text-right tabular-nums">{value}%</span>
    </label>
  );
}

function Reading({ label, value, accent = false }: { label: React.ReactNode; value: string; accent?: boolean }) {
  return (
    <div className="border-b border-rule py-1.5">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className={`font-medium tabular-nums ${accent ? 'text-plum' : ''}`}>{value}</dd>
    </div>
  );
}
