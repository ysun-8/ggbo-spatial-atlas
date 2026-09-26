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
