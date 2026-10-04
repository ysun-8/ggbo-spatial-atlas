import test from 'node:test';
import assert from 'node:assert/strict';
import { detectedCeiling, readView, writeView, assetPath, pinchCamera, cameraCenter, cameraForCenter, parseZoom } from '../lib/atlas-display.mjs';

test('sparse genes scale on detected values without a maximum fallback', () => {
  const values = [...Array(1000).fill(0), ...Array(99).fill(2), 1000];
  assert.equal(detectedCeiling(values), 2);
  assert.equal(detectedCeiling([0, 0]), 0);
  assert.equal(detectedCeiling([0, 3]), 3);
  assert.equal(detectedCeiling([1, 2, 3]), 2.9);
});
const datasets = [{id:'baseline'}, {id:'hd-12163'}];
test('shareable view round trips special characters and manual scale', () => {
  const view = {dataset:'baseline',capture:'capture-a',region:'slice 1',line:'UP-11789',gene:'HLA-DRA',mode:'gene',max:'2.5',cmap:'',zoom:'',cell:'',he:'',dots:'',dot:''};
  assert.deepEqual(readView(writeView(view), datasets, 'baseline'), view);
});
test('invalid URLs fall back safely and CAR-T alias preserves older IDs', () => {
  const view = readView('?dataset=missing&max=-5&mode=unknown',datasets,'baseline');
  assert.equal(view.dataset,'baseline'); assert.equal(view.max,''); assert.equal(view.mode,'identity');
  assert.equal(readView('?dataset=hd-12163-car-t',datasets,'baseline').dataset,'hd-12163');
});

test('legacy CAR-T links resolve to the canonical dataset ID', () => {
  assert.equal(readView('?dataset=hd-12163', [{id:'hd-12163-car-t'}], 'hd-12163-car-t').dataset, 'hd-12163-car-t');
});

test('assets resolve under one viewer or an optional separate data host', () => {
  assert.equal(assetPath('/data/example.json', '/ggbo-spatial-atlas'), '/ggbo-spatial-atlas/data/example.json');
  assert.equal(assetPath('/data/example.json', '/ggbo-spatial-atlas', 'https://ysun-8.github.io/primary-gbm-spatial-atlas'), 'https://ysun-8.github.io/primary-gbm-spatial-atlas/data/example.json');
  assert.equal(assetPath('https://example.org/image.webp', '/atlas'), 'https://example.org/image.webp');
});

test('pinch zoom keeps the image point under the fingers', () => {
  const start = { x: 40, y: -20, distance: 100, camera: { x: 10, y: 5, scale: 2 } };
  // The image point under the start midpoint, in unscaled panel units.
  const anchor = { x: (start.x - start.camera.x) / start.camera.scale, y: (start.y - start.camera.y) / start.camera.scale };
  const next = pinchCamera(start, { x: 70, y: 0, distance: 150 }, 0.8, 20);
  assert.equal(next.scale, 3);
  assert.ok(Math.abs(next.x + anchor.x * next.scale - 70) < 1e-9 && Math.abs(next.y + anchor.y * next.scale - 0) < 1e-9);
  assert.equal(pinchCamera(start, { x: 40, y: -20, distance: 10000 }, 0.8, 20).scale, 20);
});

test('full views round trip camera, colormap, opacity, and selected cell', () => {
  const view = { dataset: 'baseline', capture: 'a', region: 'all', line: 'all', gene: 'CA9', mode: 'gene', max: '',
    cmap: 'magenta', zoom: '3.5,1200.5,800', cell: 'cellid_000023980-1', he: '70', dots: '90', dot: '55' };
  assert.deepEqual(readView(writeView(view), datasets, 'baseline'), view);
  const bad = readView('?cmap=Bad1&zoom=0,1,2&he=5&dots=abc&dot=200', datasets, 'baseline');
  assert.deepEqual([bad.cmap, bad.zoom, bad.he, bad.dots, bad.dot], ['', '', '', '', '']);
});

test('camera centers convert between panel pixels and image units', () => {
  const image = { width: 3000, height: 2000 }, panel = { width: 600, height: 500 };
  const camera = cameraForCenter({ cx: 900, cy: 1300 }, 4, image, panel);
  const center = cameraCenter(camera, image, panel);
  assert.ok(Math.abs(center.cx - 900) < 1e-9 && Math.abs(center.cy - 1300) < 1e-9);
  assert.deepEqual(parseZoom('2,10,20'), { scale: 2, cx: 10, cy: 20 });
  assert.equal(parseZoom('nope'), null);
});
