'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Link2, Minus, Plus, RotateCcw, Search, Share, X } from 'lucide-react';

import { detectedCeiling, readView, writeView, assetPath, pinchCamera, parseZoom, cameraCenter, cameraForCenter, fitCamera, sameCamera, datasetFamily, carryManualMax } from '@/lib/atlas-display.mjs';
import { nearestPoint, nextPointInDirection } from '@/lib/atlas-canvas.mjs';
import { searchGenes } from '@/lib/atlas-genes.mjs';
import { AtlasPointCanvas, SelectedMarker } from '@/components/atlas-point-canvas';
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

// Zone and tumor-state colors are sampled from manuscript Figure 2 (B, G, H, I).
// Other cell types avoid red, blue, and green so they don't read as zones.
const identityColors: Record<string, string> = {
  OPZ: '#d90017',
  IQZ: '#2c69a8',
  HCZ: '#40a23a',
  'proliferating tumor': '#ee5e52',
  'RG-like': '#5a95cf',
  'hypoxic niche': '#4eb05c',
  IR: '#8e5bb5',
  'IR tumor 1': '#8e5bb5',
  'IR tumor 2': '#c495d6',
  'IFN-response tumor': '#8e5bb5',
  'cytokine-response tumor': '#b07aa1',
  'IFN-response': '#b07aa1',
  'CAR-T': '#e6a100',
  myeloid: '#e07b25',
  Myeloid: '#e07b25',
  'myeloid 1': '#e07b25',
  'myeloid 2': '#a0522d',
  'myeloid/stromal': '#e07b25',
  'M1 myeloid': '#e07b25',
  endothelial: '#16a3b0',
  perivascular: '#9c7c38',
  oligo: '#c9b11a',
  stroma: '#8c564b',
  'CAF-stroma': '#8c564b',
  'necrotic core': '#5b4636',
  hemorrhage: '#7a3b52',
  'hemorrhage/debris': '#7a3b52',
};

const identityNames: Record<string, string> = {
  OPZ: 'Outer proliferative zone',
  IQZ: 'Intermediate quiescent zone',
  HCZ: 'Hypoxic core zone',
  IR: 'Immune-responsive tumor',
  'IR tumor 1': 'Immune-responsive tumor 1',
  'IR tumor 2': 'Immune-responsive tumor 2',
};

const fallbackIdentityColors = ['#e07b25', '#8e5bb5', '#16a3b0', '#8c564b', '#c9b11a'];
const minZoom = 0.8;
const regularMaxZoom = 3;
const hdMaxZoom = 20;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function publicPath(path: string, assetBase = '') {
  return assetPath(path, basePath, assetBase);
}

type DatasetEntry = (typeof catalog.datasets)[number] & { asset_base_url?: string };
const datasetOptions: DatasetEntry[] = catalog.datasets;
// Readers pick a data type, then a condition, then a line or sample. Labels stay as in the catalog.
const datasetGroups = [...new Map(datasetOptions.map((entry) => [entry.navigation.group, {
  id: entry.navigation.group, label: entry.navigation.label, ...datasetFamily(entry.navigation.label),
}])).values()];
const datasetFamilies = [...new Set(datasetGroups.map((group) => group.family))];
if (catalog.schema_version !== 2 || !datasetOptions.length || new Set(datasetOptions.map((entry) => entry.id)).size !== datasetOptions.length || !datasetOptions.some((entry) => entry.id === catalog.default_dataset)) {
  throw new Error('Invalid dataset catalog');
}

const gradientOptions = [
  {
    id: 'viridis',
    label: 'Viridis',
    stops: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  },
  {
    // Grey to magenta, as in the manuscript's gene panels.
    id: 'magenta',
    label: 'Magenta',
    stops: ['#d3d3d3', '#b4209d'],
  },
  {
    id: 'magma',
    label: 'Magma',
    stops: ['#1c1936', '#4a2d82', '#c13575', '#f18345', '#fae766'],
  },
  {
    id: 'seurat',
    label: 'Seurat-style',
    stops: ['#3b4cc0', '#2f7fbc', '#35b7b0', '#7ad151', '#fde725', '#f98e09', '#d7191c'],
  },
] as const;

type GradientId = (typeof gradientOptions)[number]['id'];

// Cells or spots with no detected expression share one translucent neutral under every scale,
// so sparse genes don't paint the tissue in the scale's low color and the H&E shows through.
// Identities left out of a legend highlight use the same neutral.
const neutralColor = 'rgba(211,211,211,0.55)';

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
  const selectedGroup = datasetGroups.find((group) => group.id === selectedEntry.navigation.group)!;
  const familyGroups = datasetGroups.filter((group) => group.family === selectedGroup.family);
  const selectFamily = (family: string) => {
    const groups = datasetGroups.filter((group) => group.family === family);
    selectGroup((groups.find((group) => group.condition === selectedGroup.condition) ?? groups[0]).id);
  };
  const [selectedCaptureId, setSelectedCaptureId] = useState('');
  const activeCapture = data?.dataset.captures.find((capture) => capture.id === selectedCaptureId) ?? data?.dataset.captures[0];
  const [selectedGene, setSelectedGene] = useState('CA9');
  const [manualMax, setManualMax] = useState('');
  const [maxNotice, setMaxNotice] = useState('');
  // Identities picked in the legend are highlighted; the rest fade to neutral.
  const [shownIdentities, setShownIdentities] = useState<string[]>([]);
  const shownSet = useMemo(() => new Set(shownIdentities), [shownIdentities]);
  const toggleIdentity = (identity: string) => setShownIdentities((current) =>
    current.includes(identity) ? current.filter((item) => item !== identity) : [...current, identity]);
  const [urlReady, setUrlReady] = useState(false);
  const [gradientId, setGradientId] = useState<GradientId>('viridis');
  const [imageOpacity, setImageOpacity] = useState(50);
  const [spotOpacity, setSpotOpacity] = useState(80);
  const [hdDotSize, setHdDotSize] = useState(65);
  const requestedView = useRef<ReturnType<typeof readView> | null>(null);
  useEffect(() => {
    // The URL is only readable after hydration, so the view is restored here once.
    const view = readView(window.location.search, datasetOptions, catalog.default_dataset);
    requestedView.current = view;
    // oxlint-disable-next-line react/react-compiler
    setDatasetId(view.dataset);
    if (gradientOptions.some((option) => option.id === view.cmap)) setGradientId(view.cmap as GradientId);
    if (view.he) setImageOpacity(Number(view.he));
    if (view.dots) setSpotOpacity(Number(view.dots));
    if (view.dot) setHdDotSize(Number(view.dot));
    setUrlReady(true);
  }, []);
  const [displayMode, setDisplayMode] = useState<'gene' | 'identity'>('identity');
  const [geneResult, setGeneResult] = useState<{ data: VisiumData; gene: string; values: Float32Array } | null>(null);
  const geneValues = geneResult?.data === data && geneResult.gene === selectedGene ? geneResult.values : null;
  const [datasetError, setDatasetError] = useState(false);
  const [geneError, setGeneError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [geneRetry, setGeneRetry] = useState(0);

  const [geneLoading, setGeneLoading] = useState(false);
  const [geneNotice, setGeneNotice] = useState('');
  // The gene and mode carry over when switching datasets so readers can compare samples.
  // The maximum carries only within the data type of the dataset it was set on.
  const currentView = useRef<{ gene: string; mode: 'gene' | 'identity'; max: string; family: string } | null>(null);
  const loadedFamily = data ? datasetFamily(datasetOptions.find((entry) => entry.id === data.dataset.id)?.navigation.label ?? '').family : '';
  useEffect(() => {
    if (urlReady) currentView.current = { gene: selectedGene, mode: displayMode, max: manualMax, family: loadedFamily };
  }, [urlReady, selectedGene, displayMode, manualMax, loadedFamily]);
  const [lineFilter, setLineFilter] = useState('all');
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const needsExpression = displayMode === 'gene' || selectedSpot !== null;
  const spatialViewport = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const maxZoom = data?.dataset.kind === 'hd' ? hdMaxZoom : regularMaxZoom;
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  // Home frames the shown cells; it is refit when the panel resizes while the reader is still there.
  const [home, setHome] = useState<typeof camera | null>(null);
  const wantHome = useRef(true);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [search, setSearch] = useState('');
  const [legendOpen, setLegendOpen] = useState(true);
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler
    if (window.matchMedia('(max-width: 639px)').matches) setLegendOpen(false);
  }, []);
  const [shareStatus, setShareStatus] = useState('Copy link');
  const dragStart = useRef<{ pointerId: number; pointerX: number; pointerY: number; cameraX: number; cameraY: number; spotId: string | null } | null>(null);
  const didDrag = useRef(false);
  const cameraFrame = useRef<number | null>(null);
  const pendingCamera = useRef<typeof camera | null>(null);
  // A shared link's zoom waits until the panel has a size to frame it in.
  const pendingZoom = useRef<ReturnType<typeof parseZoom>>(null);
  const [screen, setScreen] = useState({ wide: true, coarse: false, share: false });
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1280px)');
    const coarse = window.matchMedia('(pointer: coarse)');
    // Touch devices with a share sheet share the link there instead of copying it.
    const update = () => setScreen({ wide: wide.matches, coarse: coarse.matches, share: coarse.matches && typeof navigator.share === 'function' });
    update();
    wide.addEventListener('change', update);
    coarse.addEventListener('change', update);
    return () => { wide.removeEventListener('change', update); coarse.removeEventListener('change', update); };
  }, []);

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
    // The previous dataset stays on screen until the next one arrives.
    // oxlint-disable-next-line react/react-compiler
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
        pendingZoom.current = view ? parseZoom(view.zoom) : null;
        const carried = view ?? currentView.current;
        const capture = merged.dataset.captures.find((item) => item.id === view?.capture) ?? merged.dataset.captures[0];
        setSelectedCaptureId(capture.id);
        geneChunkCache.current.clear();
        if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
        cameraFrame.current = null;
        pendingCamera.current = null;
        const gene = carried?.gene ?? 'CA9';
        const fallbackGene = payload.genes.some((item) => item.gene === 'CA9') ? 'CA9' : payload.genes[0]?.gene ?? '';
        const geneFound = payload.genes.some((item) => item.gene === gene);
        setSelectedGene(geneFound ? gene : fallbackGene);
        setGeneNotice(geneFound ? '' : `${gene} isn’t in this dataset. Showing ${fallbackGene}.`);
        setDisplayMode(carried?.mode === 'gene' ? 'gene' : 'identity');
        const previous = currentView.current;
        const max = !geneFound ? { max: '', cleared: '' } : view ? { max: view.max, cleared: '' } : carryManualMax(previous, datasetFamily(selectedDataset.navigation.label).family);
        setManualMax(max.max);
        setMaxNotice(max.cleared ? `Manual maximum ${max.cleared} cleared: it was set on ${previous?.family}. Automatic scaling is on.` : '');
        // The notice sits in the legend, so a collapsed legend opens to show it.
        if (max.cleared) setLegendOpen(true);
        setShownIdentities(view?.show ? view.show.split(',').filter((identity) => payload.dataset.identities.includes(identity)) : []);
        setGeneResult(null);
        setGeneError(false);
        // No expression request is needed in this state.
      // oxlint-disable-next-line react/react-compiler
      setGeneLoading(false);
        setLineFilter(view && payload.dataset.lines.includes(view.line) ? view.line : payload.dataset.lines.length === 1 ? payload.dataset.lines[0] : 'all');
        setSelectedSpot(view?.cell ? payload.spots.find((spot) => spot.id === view.cell) ?? null : null);
        wantHome.current = !pendingZoom.current;
        setHome(null);
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

  // Offer only the lines that have spots on the active capture area.
  const captureLines = useMemo(() => {
    if (!data) return [];
    const present = new Set((filterCaptureSpots(data.spots, activeCapture) as Spot[]).map((spot) => spot.line));
    return data.dataset.lines.filter((line) => present.has(line));
  }, [data, activeCapture]);

  // On phones the controls sit below the tissue, so a choice scrolls back up to show its result.
  const revealTissue = () => {
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('tissue')?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
  };
  // A manual maximum belongs to one gene, so choosing another gene returns to automatic scaling.
  const pickGene = (gene: string, notice = '') => {
    if (gene !== selectedGene) { setManualMax(''); setMaxNotice(''); }
    setSelectedGene(gene);
    setDisplayMode('gene');
    setGeneNotice(notice);
    setSearch('');
    revealTissue();
  };

  const automaticCeiling = useMemo(() => {
    if (geneValues) return detectedCeiling(geneValues);
    if (data && !data.dataset.gene_data_path) return detectedCeiling(data.spots.map((spot) => spot.expression?.[selectedGene] ?? 0));
    return 0;
  }, [geneValues, data, selectedGene]);
  const parsedMax = Number(manualMax);
  const hasManualMax = Number.isFinite(parsedMax) && parsedMax > 0;
  const colorCeiling = hasManualMax ? parsedMax : automaticCeiling;
  type GeneSearch = { matches: GeneStat[]; exact: boolean; alias: { term: string; gene: string; present: boolean } | null };
  const geneSearch = useMemo(() => searchGenes(data?.genes ?? [], search) as GeneSearch, [data, search]);
  const matchingGenes = geneSearch.matches;
  const [searchMiss, setSearchMiss] = useState('');
  const submitSearch = () => {
    const term = search.trim();
    if (!term) return;
    const top = geneSearch.exact || matchingGenes.length === 1 ? matchingGenes[0] : undefined;
    if (top) { pickGene(top.gene, geneSearch.alias?.gene === top.gene ? `${term} is ${top.gene}.` : ''); setSearchMiss(''); }
    else setSearchMiss(term);
  };
  const visibleGenes = matchingGenes.slice(0, search ? 60 : 12);

  const getIdentityColor = useCallback((identity: string) => {
    if (identityColors[identity]) return identityColors[identity];
    const identityIndex = data?.dataset.identities.indexOf(identity) ?? 0;
    return fallbackIdentityColors[identityIndex % fallbackIdentityColors.length];
  }, [data]);

  const colorValues = displayMode === 'gene' ? geneValues : null;
  const activeCeiling = displayMode === 'gene' ? colorCeiling : 0;
  const expressionOf = useCallback((spot: Spot) => (data?.dataset.gene_data_path && spot.index !== undefined
    ? colorValues?.[spot.index] ?? 0
    : spot.expression?.[selectedGene] ?? 0), [data, colorValues, selectedGene]);
  const geneColorsReady = displayMode === 'gene' && !(data?.dataset.gene_data_path && !colorValues);

  const spotColors = useMemo(() => new Map(filteredSpots.map((spot) => {
    if (displayMode === 'identity') return [spot.id, shownSet.size && !shownSet.has(spot.identity) ? neutralColor : getIdentityColor(spot.identity)] as const;
    if (!geneColorsReady) return [spot.id, '#b5b5b5'] as const;
    const value = expressionOf(spot);
    if (value <= 0) return [spot.id, neutralColor] as const;
    return [spot.id, interpolateColor(value / (activeCeiling || 1), gradientId)] as const;
  })), [filteredSpots, displayMode, getIdentityColor, shownSet, geneColorsReady, expressionOf, activeCeiling, gradientId]);

  // In gene mode, draw low expression first so the highest-expressing cells sit on top;
  // with a legend highlight, the highlighted identities sit on top.
  const drawnSpots = useMemo(() => {
    if (displayMode === 'identity' && shownSet.size) return [...filteredSpots].sort((a, b) => Number(shownSet.has(a.identity)) - Number(shownSet.has(b.identity)));
    if (!geneColorsReady) return filteredSpots;
    return filteredSpots.map((spot) => ({ spot, value: expressionOf(spot) }))
      .sort((a, b) => a.value - b.value)
      .map(({ spot }) => spot);
  }, [filteredSpots, displayMode, shownSet, geneColorsReady, expressionOf]);

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

  const zoomAtPoint = (element: HTMLElement, clientX: number, clientY: number, factor: number) => {
    const cursor = panelOffset(element, clientX, clientY);
    setCamera((current) => zoomCameraAt(current, cursor, factor, maxZoom));
  };

  // React registers wheel listeners as passive, so preventDefault only works on a native listener.
  const spatialPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = spatialPanelRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (!window.matchMedia('(min-width: 1280px)').matches && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (dragStart.current) return;
      const cursor = panelOffset(element, event.clientX, event.clientY);
      setCamera((current) => zoomCameraAt(current, cursor, Math.exp(-event.deltaY * 0.0015), maxZoom));
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [data, maxZoom]);

  // On touch screens, two fingers pinch to zoom. At the home view one-finger vertical swipes
  // scroll the page (touch-action: pan-y); once zoomed in, one finger pans the image freely.
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
    // A double click or double tap zooms in at that point; with Shift it zooms out.
    if (event.type !== 'pointercancel' && !didDrag.current) {
      const tap = lastTap.current;
      if (tap && event.timeStamp - tap.time < 350 && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 24) {
        zoomAtPoint(event.currentTarget, event.clientX, event.clientY, event.shiftKey ? 0.5 : 2);
        lastTap.current = null;
      } else lastTap.current = { time: event.timeStamp, x: event.clientX, y: event.clientY };
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
  // The 2048-pixel preview is sharp on a phone until the reader zooms in, so touch screens
  // fetch the 12–14 MB full-resolution H&E only then. Once fetched it stays.
  const [fullResImages, setFullResImages] = useState<string[]>([]);
  const wantsFullRes = !screen.coarse || !previewImage || camera.scale > (home?.scale ?? 1) * 1.5;
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler
    if (wantsFullRes && tissueImage && !fullResImages.includes(tissueImage)) setFullResImages((list) => [...list, tissueImage]);
  }, [wantsFullRes, tissueImage, fullResImages]);
  const fullResImage = wantsFullRes || fullResImages.includes(tissueImage) ? tissueImage : '';
  useEffect(() => {
    if (!fullResImage) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setImageState({ key: imageKey, status: image.naturalWidth === imageWidth && image.naturalHeight === imageHeight ? 'loaded' : 'error' });
    };
    image.onerror = () => { if (active) setImageState({ key: imageKey, status: 'error' }); };
    image.src = fullResImage;
    return () => { active = false; image.onload = null; image.onerror = null; };
  }, [fullResImage, imageWidth, imageHeight, imageKey]);
  // The view box matches the panel's shape, so zoomed-in views fill the whole panel.
  const panelWidth = viewportSize.width || imageWidth;
  const panelHeight = viewportSize.height || imageHeight;
  const imageUnitsPerPixel = Math.max(imageWidth / panelWidth, imageHeight / panelHeight) / camera.scale;
  const viewWidth = panelWidth * imageUnitsPerPixel;
  const viewHeight = panelHeight * imageUnitsPerPixel;
  const viewX = (imageWidth - viewWidth) / 2 - camera.x * imageUnitsPerPixel;
  const viewY = (imageHeight - viewHeight) / 2 - camera.y * imageUnitsPerPixel;
  const spatialViewBox = `${viewX} ${viewY} ${viewWidth} ${viewHeight}`;
  const imageSize = { width: imageWidth, height: imageHeight };

  useEffect(() => {
    const element = spatialViewport.current;
    // Measure directly: resize callbacks don't arrive while the page is in a background tab.
    const panel = viewportSize.width ? viewportSize : element ? { width: element.clientWidth, height: element.clientHeight } : null;
    if (!panel?.width || !activeCapture) return;
    const image = { width: activeCapture.width, height: activeCapture.height };
    const zoom = pendingZoom.current;
    if (zoom) {
      pendingZoom.current = null;
      // oxlint-disable-next-line react/react-compiler
      setCamera(cameraForCenter(zoom, Math.min(maxZoom, Math.max(minZoom, zoom.scale)), image, panel));
      return;
    }
    if (!wantHome.current && camera !== home) return;
    wantHome.current = false;
    const next = fitCamera(filteredSpots, image, panel, maxZoom);
    if (home && camera === home && sameCamera(next, home)) return;
    setHome(next);
    setCamera(next);
  }, [viewportSize, activeCapture, maxZoom, filteredSpots, camera, home]);

  // Everything needed to reopen this exact view; defaults are left out to keep links short.
  const isDefaultCamera = home !== null && camera === home;
  const panelSize = { width: panelWidth, height: panelHeight };
  const center = cameraCenter(camera, imageSize, panelSize);
  const viewQuery = writeView({ dataset: datasetId, capture: selectedCaptureId, line: lineFilter, gene: selectedGene, mode: displayMode,
    max: displayMode === 'gene' && hasManualMax ? String(parsedMax) : '', cmap: gradientId === 'viridis' ? '' : gradientId,
    he: imageOpacity === 50 ? '' : String(imageOpacity), dots: spotOpacity === 80 ? '' : String(spotOpacity),
    dot: data?.dataset.kind === 'hd' && hdDotSize !== 65 ? String(hdDotSize) : '',
    zoom: isDefaultCamera ? '' : `${camera.scale.toFixed(2)},${Math.round(center.cx)},${Math.round(center.cy)}`,
    cell: selectedSpot?.id ?? '', show: displayMode === 'identity' ? shownIdentities.join(',') : '' });
  useEffect(() => {
    if (!urlReady || !data || data.dataset.id !== datasetId) return;
    // Debounced so panning doesn't flood the browser's history API.
    const timer = window.setTimeout(() => window.history.replaceState(null, '', window.location.pathname + viewQuery + window.location.hash), 250);
    return () => window.clearTimeout(timer);
  }, [urlReady, data, datasetId, viewQuery]);

  const zoomIn = () => zoomAtCenter(isHd ? camera.scale * 1.5 : camera.scale + 0.2);
  const zoomOut = () => zoomAtCenter(isHd ? camera.scale / 1.5 : camera.scale - 0.2);
  const resetView = () => { wantHome.current = true; setCamera((current) => ({ ...current })); };

  // Selecting from the UMAP or the keyboard brings the cell into view if it is off screen.
  const revealSpot = useCallback((spot: Spot) => {
    setSelectedSpot(spot);
    setCamera((current) => {
      const image = { width: imageWidth, height: imageHeight };
      const panel = { width: panelWidth, height: panelHeight };
      const units = Math.max(imageWidth / panelWidth, imageHeight / panelHeight) / current.scale;
      const { cx, cy } = cameraCenter(current, image, panel);
      const onScreen = Math.abs(spot.x - cx) < panelWidth * units * 0.45 && Math.abs(spot.y - cy) < panelHeight * units * 0.45;
      return onScreen ? current : cameraForCenter({ cx: spot.x, cy: spot.y }, current.scale, image, panel);
    });
  }, [imageWidth, imageHeight, panelWidth, panelHeight, setSelectedSpot]);

  // Arrow keys step to the nearest cell in that direction and keep it on screen.
  const handlePlateKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Escape') { setSelectedSpot(null); return; }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomIn(); return; }
    if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomOut(); return; }
    if (event.key === '0') { event.preventDefault(); resetView(); return; }
    if (!event.key.startsWith('Arrow') || !filteredSpots.length) return;
    event.preventDefault();
    const current = selectedSpot ? filteredSpots.find((spot) => spot.id === selectedSpot.id) : undefined;
    const next = current
      ? nextPointInDirection(filteredSpots, current, event.key)
      : nearestPoint(filteredSpots, viewX + viewWidth / 2, viewY + viewHeight / 2);
    if (next) revealSpot(next);
  };
  const activeGradient = gradientOptions.find((option) => option.id === gradientId) ?? gradientOptions[0];
  const gradientCss = `linear-gradient(90deg, ${activeGradient.stops.join(', ')})`;

  const useCanvas = isHd;
  const umapPoints = useMemo(() => !useCanvas || !umapBounds ? [] : drawnSpots.map((spot) => ({
    id: spot.id, x: 14 + ((spot.umap_x - umapBounds.minX) / (umapBounds.maxX - umapBounds.minX || 1)) * 212,
    y: 166 - ((spot.umap_y - umapBounds.minY) / (umapBounds.maxY - umapBounds.minY || 1)) * 152,
  })), [useCanvas, umapBounds, drawnSpots]);

  // Camera and search updates reuse these dense layers without rebuilding points.
  const spatialPanel = useMemo(() => {
    if (useCanvas) return null;
    return (
      <g>
        <g opacity={imageOpacity / 100} className="pointer-events-none">
          {previewImage && <image key={previewImage} href={previewImage} width={imageWidth} height={imageHeight} />}
          {fullResImage && <image key={fullResImage} href={fullResImage} width={imageWidth} height={imageHeight} />}
        </g>
        <g>
          {drawnSpots.map((spot) => {
            const isSelected = selectedSpot?.id === spot.id;
            return (
              <circle key={spot.id} data-spot-id={spot.id} cx={spot.x} cy={spot.y} r={isSelected ? selectedPointRadius : pointRadius} fill={spotColors.get(spot.id)} fillOpacity={spotOpacity / 100} stroke={isSelected ? '#fff' : (isHd ? 'transparent' : 'rgba(24,18,26,0.38)')} strokeWidth={isSelected ? (isHd ? 0.9 : 4) : (isHd ? 2 : 1.2)} vectorEffect="non-scaling-stroke" className={isHd ? 'cursor-pointer' : 'cursor-pointer transition-[r,stroke-width] hover:stroke-white'} />
            );
          })}
        </g>
      </g>
    );
  }, [useCanvas, imageWidth, imageHeight, fullResImage, previewImage, imageOpacity, drawnSpots, selectedSpot, selectedPointRadius, pointRadius, spotColors, spotOpacity, isHd]);

  const umapPanel = useMemo(() => useCanvas ? (
    <AtlasPointCanvas points={umapPoints} colors={spotColors} viewBox="0 0 240 180" radius={1} opacity={0.76} interactive={false}
      selectedId={selectedSpot?.id} label={`UMAP of ${observationPlural}`} className="w-full aspect-[4/3] rounded-md bg-ground"
      onSelect={(id) => { const spot = filteredSpots.find((point) => point.id === id); if (spot) revealSpot(spot); }} />
  ) : (
    <svg viewBox="0 0 240 180" className="w-full rounded-md bg-ground" aria-label={`UMAP of ${observationPlural}`} shapeRendering="geometricPrecision">
      {umapBounds && drawnSpots.map((spot) => {
        const x = 14 + ((spot.umap_x - umapBounds.minX) / (umapBounds.maxX - umapBounds.minX || 1)) * 212;
        const y = 166 - ((spot.umap_y - umapBounds.minY) / (umapBounds.maxY - umapBounds.minY || 1)) * 152;
        return <circle key={spot.id} cx={x} cy={y} r={isHd ? 1 : 1.8} fill={spotColors.get(spot.id)} opacity={0.76} onClick={() => revealSpot(spot)} className="cursor-pointer" />;
      })}
      {umapBounds && selectedSpot && filteredSpots.some((spot) => spot.id === selectedSpot.id) && <SelectedMarker
        x={14 + ((selectedSpot.umap_x - umapBounds.minX) / (umapBounds.maxX - umapBounds.minX || 1)) * 212}
        y={166 - ((selectedSpot.umap_y - umapBounds.minY) / (umapBounds.maxY - umapBounds.minY || 1)) * 152}
        radius={1.8} fill={spotColors.get(selectedSpot.id)} unitsPerPixel={0.9} />}
    </svg>
  ), [useCanvas, umapPoints, observationPlural, umapBounds, drawnSpots, filteredSpots, selectedSpot, isHd, spotColors, revealSpot]);

  const viewLabel = `${selectedEntry.navigation.label}${selectedEntry.navigation.line ? ` · ${selectedEntry.navigation.line}` : ''}`;

  // Until the cells arrive, the small H&E preview stands in so a shared link shows tissue at once.
  if (!data) {
    const loadingPreview = selectedEntry.captures[0]?.preview;
    return (
      <main className="flex min-h-screen flex-col bg-ground text-ink">
        <header className="flex items-center gap-3 border-b border-rule bg-panel px-4 py-2.5 lg:px-5">
          <ZoneMark className="size-8 shrink-0" />
          <h1 className="text-[17px] font-semibold leading-6 tracking-[-0.01em]">{catalog.site.title}</h1>
        </header>
        <div className="grid flex-1 place-items-center p-2 sm:p-3">
          <div className="relative grid w-full max-w-3xl place-items-center overflow-hidden rounded-lg border border-rule-strong bg-[#e5e1da]">
            {loadingPreview && <svg viewBox={`0 0 ${selectedEntry.captures[0].width} ${selectedEntry.captures[0].height}`} className="w-full opacity-50" aria-hidden="true">
              <image href={publicPath(loadingPreview, selectedEntry.asset_base_url)} width={selectedEntry.captures[0].width} height={selectedEntry.captures[0].height} />
            </svg>}
            <div className={`${loadingPreview ? 'absolute' : 'py-24'} flex flex-col items-center gap-3 rounded-md border border-rule bg-panel/95 px-4 py-3 text-center`}>
              {datasetError ? (
                <div role="alert" className="space-y-3">
                  <p className="text-sm font-medium">Unable to load {viewLabel}.</p>
                  <Button onClick={() => setRetry((value) => value + 1)}>Retry</Button>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-ink-2" aria-live="polite"><ZoneMark className="size-4 animate-pulse" />Loading {viewLabel}…</p>
              )}
            </div>
          </div>
        </div>
      </main>
    );
  }

  const lineLabel = data.dataset.tissue_type === 'gGBO' ? 'GBO line' : 'Sample';
  const legendIdentities = data.dataset.identities
    .map((identity, index) => ({ identity, index }))
    .sort((a, b) => zoneRank(a.identity) - zoneRank(b.identity) || a.index - b.index)
    .map(({ identity }) => identity);
  // Primary GBM tumor states are listed ahead of the non-tumor cell types.
  const tumorStates = tumorStateOrder.filter((identity) => legendIdentities.includes(identity));
  const legendGroups = tumorStates.length
    ? [{ label: 'Tumor states', identities: tumorStates }, { label: 'Other cells', identities: legendIdentities.filter((identity) => !tumorStates.includes(identity)) }]
    : [{ label: '', identities: legendIdentities }];
  const selectedValue = selectedSpot ? (geneLoading ? null : getSelectedExpression(selectedSpot)) : null;
  const selectedValueText = selectedValue !== null ? selectedValue.toFixed(2) : geneError ? 'unavailable' : '…';
  const selectedStats = data.genes.find((gene) => gene.gene === selectedGene);
  const detectedShare = selectedStats ? selectedStats.detected / Math.max(1, data.spots.length) : 0;
  const verb = screen.coarse ? 'Tap' : 'Click';
  const zoomHint = screen.coarse ? 'Double-tap or pinch to zoom.' : screen.wide ? 'Drag to pan; scroll or double-click to zoom.' : 'Drag to pan; double-click, or hold Ctrl or ⌘ and scroll, to zoom.';
  const announcement = selectedSpot ? `Selected ${selectedSpot.identity} ${observationSingular}. ${selectedGene} ${selectedValueText}.` : '';

  return (
    <main className="flex min-h-screen flex-col bg-ground text-ink xl:h-screen">
      <a href="#tissue" className="sr-only rounded-md bg-plum px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50">Skip to tissue</a>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule bg-panel px-4 py-2.5 lg:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <ZoneMark className="size-8 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-[17px] font-semibold leading-6 tracking-[-0.01em]">{catalog.site.title}</h1>
            <p className="hidden truncate text-xs leading-4 text-ink-3 md:block">{viewLabel}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-4 text-xs">
          <a className="text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-plum pointer-coarse:inline-flex pointer-coarse:h-11 pointer-coarse:items-center" href={publicPath('/about.html')}><span className="sm:hidden">Methods</span><span className="hidden sm:inline">Methods &amp; source</span></a>
          <button aria-label={screen.share ? 'Share a link to this view' : 'Copy link to this view'} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rule-strong bg-white px-2.5 font-medium text-ink transition-colors hover:border-ink-3 pointer-coarse:h-11" onClick={async () => {
            const url = window.location.origin + window.location.pathname + viewQuery + window.location.hash;
            if (screen.share) {
              // Closing the share sheet rejects the promise; there is nothing to report.
              try { await navigator.share({ title: catalog.site.title, url }); } catch { /* dismissed */ }
              return;
            }
            try { await navigator.clipboard.writeText(url); setShareStatus('Link copied'); }
            catch { setShareStatus('Copy from address bar'); }
            window.setTimeout(() => setShareStatus('Copy link'), 3000);
          }}>{screen.share ? <><Share className="size-3.5 text-ink-3" aria-hidden="true" /><span>Share</span></>
            : <><Link2 className="size-3.5 text-ink-3" aria-hidden="true" /><span aria-live="polite" className={shareStatus === 'Copy link' ? 'hidden sm:inline' : ''}>{shareStatus}</span></>}</button>
        </div>
      </header>

      {/* Phones show the tissue first with a one-line summary; tablets get two columns and wide screens three. */}
      <div className="grid flex-1 grid-cols-1 [grid-template-areas:'summary'_'view'_'data'_'color'_'side'] md:grid-cols-[272px_minmax(0,1fr)] md:[grid-template-areas:'data_view'_'color_side'] xl:min-h-0 xl:grid-cols-[264px_minmax(520px,1fr)_288px] xl:grid-rows-[minmax(0,1fr)] xl:[grid-template-areas:'rail_view_side']">
        <div className="flex items-center gap-3 border-b border-rule bg-panel px-4 py-2 [grid-area:summary] md:hidden">
          <p className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{viewLabel}{displayMode === 'gene' && <> · <span className="gene font-medium text-ink">{selectedGene}</span></>}</p>
          <a href="#controls" className="inline-flex h-11 shrink-0 items-center text-[13px] font-medium text-plum underline underline-offset-2">Change</a>
        </div>

        {/* On wide screens both control sections share one scrolling rail; below that they are separate grid cells. */}
        <div className="contents xl:flex xl:min-h-0 xl:flex-col xl:overflow-y-auto xl:border-r xl:border-rule xl:bg-panel xl:[grid-area:rail]">
        <section id="controls" aria-label="Dataset and gene" className="grid scroll-mt-2 grid-cols-1 content-start gap-3 border-b border-rule bg-panel px-4 py-3.5 [grid-area:data] sm:grid-cols-2 md:grid-cols-1 md:border-r xl:border-r-0">
          <Field label="Dataset" htmlFor="dataset-family">
            <NativeSelect id="dataset-family" className="w-full bg-white" value={selectedGroup.family} onChange={(event) => { selectFamily(event.target.value); revealTissue(); }}>
              {datasetFamilies.map((family) => <option key={family} value={family}>{family}</option>)}
            </NativeSelect>
          </Field>

          {familyGroups.length > 1 && <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="control-label mb-1.5">Condition</legend>
            <div className="flex flex-wrap gap-1.5">
              {familyGroups.map((group) => (
                <button key={group.id} className={toggleClass(group.id === selectedGroup.id)} aria-pressed={group.id === selectedGroup.id} onClick={() => { selectGroup(group.id); revealTissue(); }}>{group.condition}</button>
              ))}
            </div>
          </fieldset>}

          {groupEntries.length > 1 && <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-2 md:col-span-1">
            <legend className="control-label mb-1.5">{selectedGroup.family.includes('primary') ? 'Sample' : 'GBO line'}</legend>
            <div className="flex flex-wrap gap-1.5">
              {groupEntries.map((entry) => (
                <button key={entry.id} className={toggleClass(entry.id === datasetId)} aria-pressed={entry.id === datasetId} onClick={() => { setDatasetId(entry.id); revealTissue(); }}>{entry.navigation.line}</button>
              ))}
            </div>
          </fieldset>}

          {data.dataset.captures.length > 1 && (
            <Field label="Capture area" htmlFor="capture-area">
              <NativeSelect id="capture-area" className="w-full bg-white" value={activeCapture?.id} onChange={(event) => {
                setSelectedCaptureId(event.target.value); setLineFilter('all'); setSelectedSpot(null);
                if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
                cameraFrame.current = null; pendingCamera.current = null;
                wantHome.current = true;
                setCamera({ x: 0, y: 0, scale: 1 });
              }}>
                {data.dataset.captures.map((capture) => <option key={capture.id} value={capture.id}>{capture.label.replaceAll('UP-', '')}</option>)}
              </NativeSelect>
            </Field>
          )}

          {!selectedEntry.navigation.line && !isHd && <fieldset className="m-0 min-w-0 space-y-1.5 border-0 p-0 sm:col-span-2 md:col-span-1">
            <legend className="control-label mb-1.5">{lineLabel}</legend>
            <div className="flex flex-wrap gap-1.5">
              {(captureLines.length <= 1 ? captureLines : ['all', ...captureLines]).map((line) => (
                <button key={line} className={toggleClass(lineFilter === line || captureLines.length === 1)} aria-pressed={lineFilter === line || captureLines.length === 1} onClick={() => { setLineFilter(line); setSelectedSpot(null); wantHome.current = true; revealTissue(); }}>
                  {line === 'all' ? 'All' : data.dataset.tissue_type === 'gGBO' ? formatGboLine(line) : line}
                </button>
              ))}
            </div>
          </fieldset>}

          <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-2 md:col-span-1">
            <legend className="control-label float-left mb-1.5 w-full">Color {observationPlural} by</legend>
            <div className="clear-left grid grid-cols-2 gap-0.5 rounded-lg bg-ground p-0.5">
              {(['identity', 'gene'] as const).map((mode) => (
                <button key={mode} aria-pressed={displayMode === mode} onClick={() => setDisplayMode(mode)}
                  className={`h-7 rounded-md text-[13px] font-medium transition-colors pointer-coarse:h-11 ${displayMode === mode ? 'bg-white text-plum shadow-[0_1px_2px_rgba(29,26,24,0.12)]' : 'text-ink-2 hover:text-ink'}`}>
                  {mode === 'gene' ? 'Gene' : 'Identity'}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="min-w-0 space-y-2 sm:col-span-2 md:col-span-1">
            <div className="flex items-baseline justify-between gap-2">
              <label className="control-label" htmlFor="gene-search">Gene</label>
              <span className="text-xs tabular-nums text-ink-3">{formatNumber(data.genes.length)} genes</span>
            </div>
            <div className="flex h-8 items-center gap-2 rounded-md border border-rule-strong bg-white px-2.5 focus-within:border-plum focus-within:ring-2 focus-within:ring-plum/30 pointer-coarse:h-11">
              <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
              <input id="gene-search" type="search" autoComplete="off" spellCheck={false} enterKeyHint="search" value={search}
                onChange={(event) => { setSearch(event.target.value); setSearchMiss(''); }}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitSearch(); } }}
                aria-describedby="gene-search-help"
                className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3 pointer-coarse:text-base" placeholder="Gene or protein, e.g. GLUT1" />
            </div>
            <div id="gene-search-help" className="space-y-1 empty:hidden">
              {geneSearch.alias && <p className="text-xs text-ink-2">{geneSearch.alias.term} is <span className="gene">{geneSearch.alias.gene}</span>{geneSearch.alias.present ? '.' : ', which isn’t in this dataset.'}</p>}
              {searchMiss && <p className="text-xs text-plum" role="alert">No gene named “{searchMiss}” in this dataset.{matchingGenes.length ? ' Similar names are listed below.' : ''}</p>}
              {geneNotice && <output className="block text-xs text-plum">{geneNotice}</output>}
              {geneError && <div role="alert" className="text-xs text-plum">Expression unavailable. <button className="underline underline-offset-2" onClick={() => setGeneRetry((value) => value + 1)}>Retry</button></div>}
            </div>
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:grid sm:max-h-[9.5rem] sm:grid-cols-4 sm:gap-px sm:overflow-x-visible sm:overflow-y-auto sm:pb-0 md:grid-cols-2 pointer-coarse:md:max-h-[11rem] xl:max-h-[11rem]">
              {visibleGenes.map((gene) => (
                <button key={gene.gene} aria-pressed={selectedGene === gene.gene} onClick={() => pickGene(gene.gene)}
                  className={`gene h-7 shrink-0 truncate rounded-md px-2 text-left text-[13px] transition-colors pointer-coarse:h-11 sm:shrink ${selectedGene !== gene.gene ? 'text-ink hover:bg-ground' : displayMode === 'gene' ? 'bg-plum font-medium text-white' : 'font-medium text-plum underline decoration-plum/40 underline-offset-2 hover:bg-ground'}`}>
                  {gene.gene}
                </button>
              ))}
              {search && !visibleGenes.length && !geneSearch.alias && <p className="col-span-full py-1.5 text-xs text-ink-2">No gene matches “{search}”.</p>}
            </div>
            {matchingGenes.length > visibleGenes.length && <p className="hidden text-xs text-ink-3 sm:block">{search ? `Showing ${visibleGenes.length} of ${formatNumber(matchingGenes.length)} matches.` : 'Type to search all genes. Press Enter to choose the top match.'}</p>}
          </div>
        </section>

        <section aria-label="Display settings" className="divide-y divide-rule border-b border-rule bg-panel [grid-area:color] empty:hidden md:border-r md:border-b-0 xl:border-r-0">

          {displayMode === 'gene' && <div className="space-y-3 px-4 py-3.5">
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="control-label float-left mb-1.5 w-full">Color scale</legend>
              <div className="clear-left grid gap-1 sm:grid-cols-2 md:grid-cols-1">
                {gradientOptions.map((gradient) => (
                  <button key={gradient.id} onClick={() => setGradientId(gradient.id)} aria-pressed={gradientId === gradient.id}
                    className={`flex h-7 items-center gap-2.5 rounded-md border px-2 text-left text-xs transition-colors pointer-coarse:h-11 ${gradientId === gradient.id ? 'border-plum bg-white text-ink ring-1 ring-plum' : 'border-transparent text-ink-2 hover:bg-ground hover:text-ink'}`}>
                    <span className="h-2 w-14 shrink-0 rounded-[2px]" style={{ background: `linear-gradient(90deg, ${gradient.stops.join(', ')})` }} />
                    {gradient.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>}

          {isHd && <div className="space-y-2 px-4 py-3.5">
            <label className="flex items-center justify-between" htmlFor="hd-dot-size"><span className="control-label">Cell dot size</span><span className="text-xs tabular-nums text-ink-2">{hdDotSize}%</span></label>
            <input id="hd-dot-size" className="atlas-range" aria-label="Cell dot size" aria-valuetext={`${hdDotSize}%`} type="range" min="25" max="100" step="5" value={hdDotSize} onChange={(event) => setHdDotSize(Number(event.target.value))} />
          </div>}
        </section>
        </div>

        <section aria-label="Spatial view" className="flex min-h-[min(72svh,118vw)] flex-col p-2 [grid-area:view] sm:p-3 md:min-h-[70svh] xl:min-h-0">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 pb-2">
            <p className="mr-auto text-xs text-ink-2"><span className="hidden sm:inline">H&amp;E with {isHd ? 'segmented-cell centers' : 'capture spots'}. </span>{verb} a {observationSingular} to inspect it. {zoomHint}</p>
            <div className="flex items-center gap-4">
              <OpacitySlider label="H&E" value={imageOpacity} onChange={setImageOpacity} />
              <OpacitySlider label={observationSingular === 'cell' ? 'Cells' : 'Spots'} value={spotOpacity} onChange={setSpotOpacity} />
            </div>
            <div className="flex items-center rounded-md border border-rule-strong bg-panel">
              <Button variant="ghost" size="icon-sm" className="pointer-coarse:size-11" aria-label="Zoom out" onClick={zoomOut}><Minus /></Button>
              <span className="w-11 text-center text-xs font-medium tabular-nums text-ink-2">{Math.round(camera.scale * 100)}%</span>
              <Button variant="ghost" size="icon-sm" className="pointer-coarse:size-11" aria-label="Zoom in" onClick={zoomIn}><Plus /></Button>
              <span className="h-4 w-px bg-rule" aria-hidden="true" />
              <Button variant="ghost" size="icon-sm" className="pointer-coarse:size-11" aria-label="Reset view" onClick={resetView}><RotateCcw /></Button>
            </div>
          </div>

          {/* The tissue is one keyboard stop: arrows move between cells, +/- zoom, 0 resets, Escape clears. */}
          {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div
            id="tissue"
            {...applicationRole}
            aria-label={`Tissue view, ${formatNumber(filteredSpots.length)} ${observationPlural}. Arrow keys move between ${observationPlural}, plus and minus zoom, 0 resets, Escape clears the selection.`}
            onKeyDown={handlePlateKey}
            className={`relative flex min-h-0 flex-1 select-none ${home && camera.scale > home.scale * 1.01 ? 'touch-none' : 'touch-pan-y'} items-center justify-center overflow-hidden rounded-lg border border-rule-strong bg-[#e5e1da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            ref={spatialPanelRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {data.dataset.id !== datasetId && <div className="absolute inset-0 z-20 grid place-items-center bg-ground/60">
              {datasetError ? <div role="alert" className="flex items-center gap-3 rounded-md border border-rule bg-panel px-3 py-2 text-sm">
                <span>Unable to load {viewLabel}.</span><Button size="sm" onClick={() => setRetry((value) => value + 1)}>Retry</Button>
              </div> : <output className="flex items-center gap-2 rounded-md border border-rule bg-panel px-3 py-2 text-sm text-ink-2"><ZoneMark className="size-4 animate-pulse" />Loading {viewLabel}…</output>}
            </div>}
            {fullResImage && imageStatus !== 'loaded' && <output className="absolute left-3 top-3 z-10 rounded-md border border-rule bg-panel px-2.5 py-1.5 text-xs text-ink-2">
              {imageStatus === 'error' ? <><span>Histology unavailable or image dimensions do not match.</span> <button className="underline underline-offset-2" onPointerDown={(event) => event.stopPropagation()} onClick={() => setImageRetry((value) => value + 1)}>Retry image</button></> : 'Loading full-resolution histology…'}
            </output>}
            <div ref={spatialViewport} className="absolute inset-2">
              {useCanvas ? <AtlasPointCanvas key={imageKey} points={drawnSpots} colors={spotColors} viewBox={spatialViewBox}
                radius={pointRadius} opacity={spotOpacity / 100} selectedId={selectedSpot?.id} interactive={false}
                label={`Spatial ${displayMode === 'gene' ? 'gene expression' : 'identity'} overlay`} className="size-full"
                background={{ url: fullResImage, previewUrl: previewImage, width: imageWidth, height: imageHeight, opacity: imageOpacity / 100 }} /> : <svg className="size-full overflow-visible" viewBox={spatialViewBox} aria-hidden="true" shapeRendering="geometricPrecision">
                {spatialPanel}
              </svg>}
            </div>

            <details open={legendOpen} onToggle={(event) => setLegendOpen(event.currentTarget.open)}
              className="group absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-md border border-rule bg-panel/95 shadow-[0_2px_8px_rgba(29,26,24,0.08)]">
              <summary onPointerDown={(event) => event.stopPropagation()}
                className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                {displayMode === 'gene' ? (
                  <><span className="gene font-medium">{selectedGene}</span><span className="h-2 w-12 rounded-[2px]" style={{ background: gradientCss }} aria-hidden="true" />
                    {hasManualMax && <span className="font-mono text-xs tabular-nums text-plum">max {parsedMax}</span>}</>
                ) : (
                  <><span className="font-medium">Legend</span><span className="flex gap-1" aria-hidden="true">{legendIdentities.slice(0, 6).map((identity) => <i key={identity} className="size-2 rounded-full" style={{ background: getIdentityColor(identity) }} />)}</span></>
                )}
                <ChevronDown className="ml-auto size-3.5 text-ink-3 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              {/* Pointer presses on the legend's controls must not start a pan of the tissue underneath. */}
              {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions */}
              <div className="px-3 pb-2.5" onPointerDown={(event) => event.stopPropagation()}>
                {displayMode === 'gene' ? (
                  <>
                    <p className="text-xs text-ink-3">{geneError ? 'Unavailable' : geneLoading || (isHd && !geneValues) ? 'Loading…' : `${data.dataset.expression.assay}/${data.dataset.expression.layer}`}</p>
                    <div className="mt-1.5 h-2 w-52 max-w-full rounded-[2px]" style={{ background: gradientCss }} />
                    {/* The top of the scale is edited here, next to the colors it changes. */}
                    <div className="mt-1 flex items-center justify-between gap-2 font-mono text-xs tabular-nums text-ink-2">
                      <span>0</span>
                      {/* Inputs inherit their font size (globals.css), so the 16px that keeps iOS from zooming on focus is set here. */}
                      <span className="flex items-center gap-1.5 pointer-coarse:text-base">
                        <label htmlFor="expression-max" className="font-sans text-xs text-ink-3">Max</label>
                        <input id="expression-max" type="number" min="0.000001" step="any" inputMode="decimal" value={manualMax}
                          placeholder={geneLoading || (isHd && !geneValues) ? '–' : automaticCeiling.toFixed(2)}
                          onChange={(event) => { setManualMax(event.target.value); setMaxNotice(''); }}
                          className="h-6 w-16 rounded border border-rule-strong bg-white px-1.5 text-right font-mono tabular-nums outline-none [appearance:textfield] placeholder:text-ink-2 focus:border-plum [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:ring-2 focus:ring-plum/30 pointer-coarse:h-11 pointer-coarse:w-20" />
                        {hasManualMax
                          ? <button type="button" onClick={() => { setManualMax(''); setMaxNotice(''); }} className="font-sans text-plum underline underline-offset-2 pointer-coarse:py-2.5">Reset</button>
                          : <span className="text-xs">P95</span>}
                      </span>
                    </div>
                    {manualMax && !hasManualMax && <p className="mt-1 max-w-52 text-xs leading-4 text-plum" role="alert">Enter a positive number. Automatic scaling is on.</p>}
                    {maxNotice && <output className="mt-1 block max-w-52 text-xs leading-4 text-plum">{maxNotice}</output>}
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-2"><i className="size-2.5 shrink-0 rounded-full border border-rule" style={{ background: neutralColor }} aria-hidden="true" />Not detected</p>
                    {selectedStats && <p className="mt-1.5 max-w-52 text-xs leading-4 text-ink-2">Detected in {formatNumber(selectedStats.detected)} of {formatNumber(data.spots.length)} {observationPlural} ({(detectedShare * 100).toFixed(detectedShare < 0.1 ? 1 : 0)}%).</p>}
                  </>
                ) : (
                  <fieldset className="m-0 grid gap-2 border-0 p-0">
                    <legend className="sr-only">Identity legend. Choose identities to highlight them.</legend>
                    {legendGroups.map((group) => (
                      <div key={group.label || 'all'}>
                        {group.label && <p className="mb-0.5 text-xs text-ink-3">{group.label}</p>}
                        <ul className="grid">
                          {group.identities.map((identity) => {
                            const faded = shownSet.size > 0 && !shownSet.has(identity);
                            return <li key={identity}>
                              <button type="button" aria-pressed={shownSet.has(identity)} onClick={() => toggleIdentity(identity)}
                                className={`-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded px-1 py-[3px] text-left text-[13px] leading-4 transition-colors hover:bg-ground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-plum/30 pointer-coarse:min-h-11 ${shownSet.has(identity) ? 'bg-ground' : ''} ${faded ? 'text-ink-3' : ''}`}>
                                <i className="size-2.5 shrink-0 rounded-full" style={{ background: getIdentityColor(identity), opacity: faded ? 0.35 : 1 }} aria-hidden="true" />
                                <span className="font-medium">{identity}</span>
                                {identityNames[identity] && <span className="text-ink-3">{identityNames[identity]}</span>}
                              </button>
                            </li>;
                          })}
                        </ul>
                      </div>
                    ))}
                    {shownSet.size > 0 && <button type="button" onClick={() => setShownIdentities([])} className="justify-self-start text-xs text-plum underline underline-offset-2 pointer-coarse:py-3.5">Show all</button>}
                  </fieldset>
                )}
              </div>
            </details>
            {selectedSpot && <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-md border border-rule bg-panel/95 py-1 pl-3 pr-1 text-[13px] shadow-[0_2px_8px_rgba(29,26,24,0.08)] sm:right-auto xl:hidden">
              <i className="size-2.5 shrink-0 rounded-full" style={{ background: getIdentityColor(selectedSpot.identity) }} aria-hidden="true" />
              <span className="font-medium">{selectedSpot.identity}</span>
              <span className="truncate text-ink-2"><span className="gene">{selectedGene}</span> {selectedValueText}</span>
              <a href="#linked-view" onPointerDown={(event) => event.stopPropagation()} className="ml-auto shrink-0 px-1 text-plum underline underline-offset-2 pointer-coarse:py-3.5">Details</a>
              <button aria-label="Clear selection" onPointerDown={(event) => event.stopPropagation()} onClick={() => setSelectedSpot(null)}
                className="grid size-7 shrink-0 place-items-center rounded text-ink-3 hover:bg-ground hover:text-ink pointer-coarse:size-11"><X className="size-4" /></button>
            </div>}
            <p className={`pointer-events-none absolute right-3 top-3 rounded-md bg-panel/90 px-2 py-1 text-xs text-ink-2 ${selectedSpot ? 'hidden xl:block' : 'hidden sm:block'}`}>{formatNumber(filteredSpots.length)} {observationPlural}</p>
          </div>
        </section>

        {/* "Details" on phones lands here, so the UMAP highlight and the inspector show together. */}
        <aside id="linked-view" className="scroll-mt-2 divide-y divide-rule border-t border-rule bg-panel [grid-area:side] xl:min-h-0 xl:overflow-y-auto xl:border-t-0 xl:border-l">
          <section className="px-4 py-3.5" aria-labelledby="umap-heading">
            <div className="mb-2 flex items-baseline justify-between gap-2"><h2 id="umap-heading" className="text-sm font-semibold">Linked UMAP</h2><span className="text-xs text-ink-3">{data.dataset.embedding_label}</span></div>
            {umapPanel}
          </section>

          <section id="inspector" className="scroll-mt-4 px-4 py-3.5" aria-labelledby="inspector-heading">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 id="inspector-heading" className="text-sm font-semibold">Selected {observationSingular}</h2>
              {selectedSpot && <button onClick={() => setSelectedSpot(null)} className="rounded px-1 text-xs text-ink-2 underline underline-offset-2 hover:text-ink pointer-coarse:py-3.5">Clear</button>}
            </div>
            {selectedSpot ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2.5">
                  <i className="mt-1 size-3 shrink-0 rounded-full ring-2 ring-white" style={{ background: getIdentityColor(selectedSpot.identity) }} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-base font-semibold leading-5">{selectedSpot.identity}</p>
                    {identityNames[selectedSpot.identity] && <p className="text-xs text-ink-3">{identityNames[selectedSpot.identity]}</p>}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 border-t border-rule text-sm">
                  <Reading label={data.dataset.tissue_type === 'gGBO' ? 'Line' : 'Sample'} value={data.dataset.tissue_type === 'gGBO' ? formatGboLine(selectedSpot.line) : selectedSpot.line} />
                  <Reading label="Cluster" value={selectedSpot.cluster} />
                  <Reading label="UMIs" value={formatNumber(selectedSpot.counts)} />
                  <Reading label="Genes" value={formatNumber(selectedSpot.features)} />
                  <Reading label="Mito" value={`${selectedSpot.mito.toFixed(1)}%`} />
                  <Reading label={<span className="gene">{selectedGene}</span>} value={selectedValueText} accent />
                </dl>
                {selectedSpot.expression && <div>
                  <p className="mb-2 text-xs font-medium text-ink-2">Featured genes</p>
                  <div className="space-y-1">
                    {data.genes.slice(0, 6).map((gene) => {
                      const value = selectedSpot.expression?.[gene.gene] ?? 0;
                      const width = Math.min(100, (value / (gene.q95 || gene.max || 1)) * 100);
                      return <button key={gene.gene} className="grid w-full grid-cols-[52px_1fr_32px] items-center gap-2 rounded-sm py-0.5 text-left text-xs hover:bg-ground" onClick={() => pickGene(gene.gene)}>
                        <span className="gene font-medium">{gene.gene}</span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-ground"><i className="block h-full rounded-full bg-plum" style={{ width: `${width}%` }} /></span>
                        <span className="text-right tabular-nums text-ink-2">{value.toFixed(1)}</span>
                      </button>;
                    })}
                  </div>
                </div>}
              </div>
            ) : (
              <p className="text-[13px] leading-5 text-ink-2">{verb} a {observationSingular} in the tissue or the UMAP to see its identity, cluster, QC values, and <span className="gene">{selectedGene}</span> expression.</p>
            )}
          </section>

          <section className="px-4 py-3.5" aria-labelledby="dataset-heading">
            <h2 id="dataset-heading" className="mb-1.5 text-sm font-semibold">About this dataset</h2>
            <p className="text-[13px] leading-5 text-ink-2">{data.dataset.description}</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-4">
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

// Pointer position in pixels from the panel center, the camera's frame.
function panelOffset(element: HTMLElement, clientX: number, clientY: number) {
  const bounds = element.getBoundingClientRect();
  return { x: clientX - bounds.left - bounds.width / 2, y: clientY - bounds.top - bounds.height / 2 };
}

// Zoom by a factor while keeping the image point under the cursor in place.
function zoomCameraAt(current: { x: number; y: number; scale: number }, cursor: { x: number; y: number }, factor: number, maxZoom: number) {
  const scale = Math.min(maxZoom, Math.max(minZoom, current.scale * factor));
  const ratio = scale / current.scale;
  return { x: cursor.x - (cursor.x - current.x) * ratio, y: cursor.y - (cursor.y - current.y) * ratio, scale };
}

// The tissue view handles its own arrow keys, like a map, so it takes the application role.
const applicationRole = { role: 'application', tabIndex: 0 } as const;

const zoneOrder = ['OPZ', 'IQZ', 'HCZ'];
const tumorStateOrder = ['proliferating tumor', 'RG-like', 'hypoxic niche'];
function zoneRank(identity: string) {
  const index = zoneOrder.indexOf(identity);
  return index < 0 ? zoneOrder.length : index;
}

function toggleClass(active: boolean) {
  return `h-7 pointer-coarse:h-11 rounded-md border px-2.5 text-xs font-medium tabular-nums transition-colors ${active ? 'border-plum bg-plum text-white' : 'border-rule-strong bg-white text-ink-2 hover:border-ink-3 hover:text-ink'}`;
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
    <div className="min-w-0 space-y-1.5">
      <label className="control-label block" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function OpacitySlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid grid-cols-[auto_72px_30px] items-center gap-2 text-xs font-medium text-ink-2">
      <span>{label}</span>
      <input className="atlas-range" type="range" min="10" max="100" value={value} aria-label={`${label} opacity`} aria-valuetext={`${value}%`} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="text-right tabular-nums">{value}%</span>
    </label>
  );
}

function Reading({ label, value, accent = false }: { label: React.ReactNode; value: string; accent?: boolean }) {
  return (
    <div className="border-b border-rule py-1.5">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={`font-medium tabular-nums ${accent ? 'text-plum' : ''}`}>{value}</dd>
    </div>
  );
}
