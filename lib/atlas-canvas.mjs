// Match SVG's default xMidYMid meet projection, including letterboxing.
export function canvasProjection(viewBox, width, height) {
  const [x, y, w, h] = viewBox.split(' ').map(Number);
  const scale = Math.min(width / w, height / h);
  return { scale, dx: (width - w * scale) / 2 - x * scale, dy: (height - h * scale) / 2 - y * scale };
}

export function pickCanvasPoint(points, projection, x, y, radius) {
  const { scale, dx, dy } = projection;
  let nearest;
  let distance = Math.max(5, radius * scale) ** 2;
  for (const point of points) {
    const d = (point.x * scale + dx - x) ** 2 + (point.y * scale + dy - y) ** 2;
    if (d <= distance) { distance = d; nearest = point.id; }
  }
  return nearest;
}

export function nearestPoint(points, x, y) {
  let nearest, distance = Infinity;
  for (const point of points) {
    const d = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (d < distance) { distance = d; nearest = point; }
  }
  return nearest;
}

const arrowVectors = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// Arrow keys move to the closest point ahead, favoring points in line with the key's direction.
export function nextPointInDirection(points, from, key) {
  const [ux, uy] = arrowVectors[key] ?? [0, 0];
  let best, bestScore = Infinity;
  for (const point of points) {
    if (point === from) continue;
    const dx = point.x - from.x, dy = point.y - from.y;
    const along = dx * ux + dy * uy;
    if (along <= 0) continue;
    const score = along + 2 * Math.abs(dx * uy - dy * ux);
    if (score < bestScore) { bestScore = score; best = point; }
  }
  return best;
}
