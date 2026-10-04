import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasProjection, pickCanvasPoint, nearestPoint, nextPointInDirection } from '../lib/atlas-canvas.mjs';

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

test('arrow keys move to the nearest point in that direction', () => {
  const a = { id: 'a', x: 0, y: 0 }, right = { id: 'right', x: 10, y: 1 }, diagonal = { id: 'diagonal', x: 6, y: 6 }, up = { id: 'up', x: 0, y: -8 };
  const points = [a, right, diagonal, up];
  assert.equal(nextPointInDirection(points, a, 'ArrowRight').id, 'right');
  assert.equal(nextPointInDirection(points, a, 'ArrowUp').id, 'up');
  assert.equal(nextPointInDirection(points, a, 'ArrowLeft'), undefined);
  assert.equal(nearestPoint(points, 5, 5).id, 'diagonal');
});
