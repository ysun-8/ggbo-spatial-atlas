import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeExpression, validateSpatialData, filterCaptureSpots } from '../lib/atlas-format.mjs';

function encode(indices, values) {
  const buffer = new ArrayBuffer(indices.length * 8);
  const view = new DataView(buffer);
  indices.forEach((index, i) => view.setUint32(i * 4, index, true));
  values.forEach((value, i) => view.setFloat32(indices.length * 4 + i * 4, value, true));
  return buffer;
}
const v2 = 'uint32-float32-v2';
test('large primary sample indices and values above legacy count range survive decoding', () => {
  const buffer = encode([0, 65535, 65536, 131503], [Math.log1p(848), 0.7, 1.25, 6]);
  const result = decodeExpression(buffer, { offset: 0, detected: 4 }, 131504, v2);
  assert.ok(Math.abs(result[0] - Math.log1p(848)) < 1e-6);
  assert.equal(result[65536], 1.25);
  assert.equal(result[131503], 6);
  assert.equal(result[1], 0);
});
test('legacy chunks remain readable but cannot silently wrap large indices', () => {
  const buffer = new Uint8Array([1, 0, 255]).buffer;
  assert.equal(decodeExpression(buffer, { offset: 0, detected: 1 }, 2, 'uint16-uint8-log1p-v1')[1], Math.fround(Math.log1p(255)));
  assert.throws(() => decodeExpression(buffer, { offset: 0, detected: 1 }, 70000, 'uint16-uint8-log1p-v1'));
});
test('reject malformed chunks instead of returning misleading expression', () => {
  for (const [buffer, stats, count, version] of [
    [encode([2], [1]), { offset: 0, detected: 1 }, 2, v2],
    [encode([0, 0], [1, 2]), { offset: 0, detected: 2 }, 2, v2],
    [encode([0], [NaN]), { offset: 0, detected: 1 }, 2, v2],
    [encode([0], [-1]), { offset: 0, detected: 1 }, 2, v2],
    [encode([0], [1]).slice(0, 7), { offset: 0, detected: 1 }, 2, v2],
    [encode([0], [1]), { offset: -1, detected: 1 }, 2, v2],
    [encode([0], [1]), { offset: 0, detected: 1 }, 2, 'future'],
  ]) assert.throws(() => decodeExpression(buffer, stats, count, version));
});
test('zero-expression genes and nonzero byte offsets decode correctly', () => {
  assert.deepEqual([...decodeExpression(new ArrayBuffer(0), { offset: 0, detected: 0 }, 3, v2)], [0, 0, 0]);
  const buffer = new Uint8Array(11);
  buffer.set(new Uint8Array(encode([2], [3.5])), 3);
  assert.equal(decodeExpression(buffer.buffer, { offset: 3, detected: 1 }, 3, v2)[2], 3.5);
});
test('catalog geometry validates current payloads and rejects wrong image membership', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../atlas/catalog.json', import.meta.url)));
  for (const entry of catalog.datasets) {
    const data = JSON.parse(fs.readFileSync(new URL('../public' + entry.path, import.meta.url)));
    validateSpatialData(data, entry.captures);
    const invalid = structuredClone(data);
    invalid.spots[0].slice = 'unknown-region';
    assert.throws(() => validateSpatialData(invalid, entry.captures));
    const badOrder = structuredClone(data);
    badOrder.dataset.gene_data_path = '/chunks';
    badOrder.spots[0].index = 1;
    assert.throws(() => validateSpatialData(badOrder, entry.captures));
    const badImage = structuredClone(entry.captures);
    badImage[0].width = 1;
    assert.throws(() => validateSpatialData(data, badImage));
  }
});
test('a region cannot appear on two different capture images', () => {
  const capture = { id: 'a', image: '/a.png', width: 100, height: 100, marker_radius: 1, regions: [{ id: 'slice1' }] };
  assert.throws(() => validateSpatialData({ dataset: { spot_count: 0 }, spots: [], genes: [] }, [capture, { ...capture, id: 'b' }]));
});

test('identical coordinates from separate captures never share a spatial view', () => {
  const spots = [{ id: 'a:1', slice: 's1', line: 'a', x: 10, y: 10 }, { id: 'b:1', slice: 's2', line: 'a', x: 10, y: 10 }];
  assert.deepEqual(filterCaptureSpots(spots, { regions: [{ id: 's1' }] }).map(s => s.id), ['a:1']);
  assert.deepEqual(filterCaptureSpots(spots, { regions: [{ id: 's2' }] }).map(s => s.id), ['b:1']);
  assert.deepEqual(filterCaptureSpots(spots, { regions: [{ id: 's1' }] }, 's2'), []);
});
