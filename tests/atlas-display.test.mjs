import test from 'node:test';
import assert from 'node:assert/strict';
import { detectedCeiling, readView, writeView, assetPath } from '../lib/atlas-display.mjs';

test('sparse genes scale on detected values without a maximum fallback', () => {
  const values = [...Array(1000).fill(0), ...Array(99).fill(2), 1000];
  assert.equal(detectedCeiling(values), 2);
  assert.equal(detectedCeiling([0, 0]), 0);
  assert.equal(detectedCeiling([0, 3]), 3);
  assert.equal(detectedCeiling([1, 2, 3]), 2.9);
});
const datasets = [{id:'baseline'}, {id:'hd-12163'}];
test('shareable view round trips special characters and manual scale', () => {
  const view = {dataset:'baseline',capture:'capture-a',region:'slice 1',line:'UP-11789',gene:'HLA-DRA',mode:'gene',max:'2.5'};
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
