// R type-7 percentile over detected cells, independent of the visible region.
export function detectedCeiling(values) {
  const positive = Array.from(values).filter((value) => value > 0 && Number.isFinite(value)).sort((a, b) => a - b);
  if (!positive.length) return 0;
  const rank = (positive.length - 1) * 0.95;
  const low = Math.floor(rank), high = Math.ceil(rank);
  return positive[low] + (positive[high] - positive[low]) * (rank - low);
}

const percent = (value, min, max) => {
  const number = Number(value);
  return value && Number.isInteger(number) && number >= min && number <= max ? String(number) : '';
};

// Zoom is "scale,centerX,centerY" in image units, so a link frames the same tissue at any window size.
export function parseZoom(value) {
  const [scale, cx, cy] = String(value ?? '').split(',').map(Number);
  return [scale, cx, cy].every(Number.isFinite) && scale > 0 ? { scale, cx, cy } : null;
}

export function readView(search, datasets, defaultDataset) {
  const params = new URLSearchParams(search);
  let id = params.get('dataset');
  if (id === 'hd-12163' && datasets.some((d) => d.id === 'hd-12163-car-t')) id = 'hd-12163-car-t';
  if (id === 'hd-12163-car-t' && !datasets.some((d) => d.id === id)) id = 'hd-12163';
  const entry = datasets.find((dataset) => dataset.id === id) ?? datasets.find((dataset) => dataset.id === defaultDataset);
  const max = Number(params.get('max'));
  const zoom = params.get('zoom') ?? '';
  return { dataset: entry.id, capture: params.get('capture') ?? '', region: params.get('region') ?? 'all',
    line: params.get('line') ?? 'all', gene: params.get('gene') ?? 'CA9',
    mode: params.get('mode') === 'gene' ? 'gene' : 'identity',
    max: Number.isFinite(max) && max > 0 ? String(max) : '',
    cmap: /^[a-z]+$/.test(params.get('cmap') ?? '') ? params.get('cmap') : '',
    zoom: parseZoom(zoom) ? zoom : '',
    cell: params.get('cell') ?? '', show: params.get('show') ?? '',
    he: percent(params.get('he'), 10, 100), dots: percent(params.get('dots'), 10, 100), dot: percent(params.get('dot'), 25, 100) };
}

export function writeView(view) {
  const params = new URLSearchParams();
  for (const key of ['dataset', 'capture', 'region', 'line', 'gene', 'mode', 'max', 'cmap', 'he', 'dots', 'dot', 'zoom', 'cell', 'show']) {
    if (view[key] && view[key] !== 'all') params.set(key, view[key]);
  }
  return '?' + params.toString();
}

// Camera offsets are pixels from the panel center; these convert to and from an image-space center.
function imageUnitsPerPixel(scale, image, panel) {
  return Math.max(image.width / panel.width, image.height / panel.height) / scale;
}

export function cameraCenter(camera, image, panel) {
  const units = imageUnitsPerPixel(camera.scale, image, panel);
  return { cx: image.width / 2 - camera.x * units, cy: image.height / 2 - camera.y * units };
}

export function cameraForCenter(center, scale, image, panel) {
  const units = imageUnitsPerPixel(scale, image, panel);
  return { x: (image.width / 2 - center.cx) / units, y: (image.height / 2 - center.cy) / units, scale };
}

export function assetPath(path, basePath = '', assetBase = '') {
  if (/^https?:\/\//.test(path)) return path;
  if (assetBase) return new URL(path.replace(/^\//, ''), assetBase.replace(/\/?$/, '/')).href;
  return path.startsWith('/') ? basePath + path : path;
}

// Two-finger zoom: keep the image point under the fingers' starting midpoint under their current midpoint.
// Midpoints are in pixels relative to the panel center, like the camera offset.
export function pinchCamera(start, current, minScale, maxScale) {
  const scale = Math.min(maxScale, Math.max(minScale, start.camera.scale * (current.distance / start.distance)));
  const ratio = scale / start.camera.scale;
  return { scale, x: current.x - (start.x - start.camera.x) * ratio, y: current.y - (start.y - start.camera.y) * ratio };
}

// The home view frames the shown cells with a margin instead of the whole slide image.
// It never zooms out past the full image, and the slide's other tissue stays visible around it.
export function fitCamera(points, image, panel, maxScale, margin = 0.08) {
  if (!points.length || !panel.width || !panel.height) return { x: 0, y: 0, scale: 1 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const width = Math.max(1, (maxX - minX) * (1 + 2 * margin));
  const height = Math.max(1, (maxY - minY) * (1 + 2 * margin));
  const fullUnits = imageUnitsPerPixel(1, image, panel);
  const scale = Math.min(maxScale, Math.max(1, Math.min(panel.width * fullUnits / width, panel.height * fullUnits / height)));
  return cameraForCenter({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }, scale, image, panel);
}

export function sameCamera(a, b) {
  return Math.abs(a.scale - b.scale) < 1e-6 && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

// Splits a catalog label like "Visium HD · CAR-T" into the data type and the condition.
export function datasetFamily(label) {
  const parts = label.split(' · ');
  const condition = parts.pop();
  if (condition === 'primary GBM') return { family: 'Visium HD · primary GBM', condition: '' };
  const family = parts.join(' · ');
  return { family: family === 'Visium HD' ? 'Visium HD · gGBO' : family, condition };
}

// A manual maximum is a shared scale only within one data type; switching data type clears it.
export function carryManualMax(previous, family) {
  const max = Number(previous?.max);
  if (!(Number.isFinite(max) && max > 0)) return { max: '', cleared: '' };
  return previous.family === family ? { max: previous.max, cleared: '' } : { max: '', cleared: previous.max };
}
