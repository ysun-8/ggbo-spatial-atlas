// R type-7 percentile over detected cells, independent of the visible region.
export function detectedCeiling(values) {
  const positive = Array.from(values).filter((value) => value > 0 && Number.isFinite(value)).sort((a, b) => a - b);
  if (!positive.length) return 0;
  const rank = (positive.length - 1) * 0.95;
  const low = Math.floor(rank), high = Math.ceil(rank);
  return positive[low] + (positive[high] - positive[low]) * (rank - low);
}

export function readView(search, datasets, defaultDataset) {
  const params = new URLSearchParams(search);
  let id = params.get('dataset');
  if (id === 'hd-12163' && datasets.some((d) => d.id === 'hd-12163-car-t')) id = 'hd-12163-car-t';
  if (id === 'hd-12163-car-t' && !datasets.some((d) => d.id === id)) id = 'hd-12163';
  const entry = datasets.find((dataset) => dataset.id === id) ?? datasets.find((dataset) => dataset.id === defaultDataset);
  const max = Number(params.get('max'));
  return { dataset: entry.id, capture: params.get('capture') ?? '', region: params.get('region') ?? 'all',
    line: params.get('line') ?? 'all', gene: params.get('gene') ?? 'CA9',
    mode: params.get('mode') === 'gene' ? 'gene' : 'identity',
    max: Number.isFinite(max) && max > 0 ? String(max) : '' };
}

export function writeView(view) {
  const params = new URLSearchParams();
  for (const key of ['dataset', 'capture', 'region', 'line', 'gene', 'mode', 'max']) {
    if (view[key] && view[key] !== 'all') params.set(key, view[key]);
  }
  return '?' + params.toString();
}

export function assetPath(path, basePath = '', assetBase = '') {
  if (/^https?:\/\//.test(path)) return path;
  if (assetBase) return new URL(path.replace(/^\//, ''), assetBase.replace(/\/?$/, '/')).href;
  return path.startsWith('/') ? basePath + path : path;
}
