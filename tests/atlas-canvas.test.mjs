import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasProjection, pickCanvasPoint } from '../lib/atlas-canvas.mjs';

test('canvas matches SVG projection with zoom, pan, and letterboxing', () => {
  const p = canvasProjection('100 200 400 200', 800, 600);
  assert.deepEqual(p, { scale: 2, dx: -200, dy: -300 });
  assert.equal(pickCanvasPoint([{ id: 'cell', x: 200, y: 250 }], p, 200, 200, 2), 'cell');
  assert.equal(pickCanvasPoint([{ id: 'cell', x: 200, y: 250 }], p, 300, 300, 2), undefined);
});

test('large canvas picks the nearest cell including indices beyond 65535', () => {
  const points = Array.from({ length: 131504 }, (_, i) => ({ id: `cell-${i}`, x: i, y: 10 }));
  const p = canvasProjection('0 0 150000 100', 150000, 100);
  assert.equal(pickCanvasPoint(points, p, 131503, 10, 1), 'cell-131503');
  assert.equal(pickCanvasPoint(points, p, 200000, 10, 1), undefined);
});
