import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const catalog = JSON.parse(fs.readFileSync('atlas/catalog.json', 'utf8'));

// WebP stores width and height in the VP8/VP8L/VP8X header.
function webpSize(file) {
  const b = fs.readFileSync(file);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8L') { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
}

test('every capture has a small preview with the same shape as its histology', () => {
  for (const dataset of catalog.datasets) {
    for (const capture of dataset.captures) {
      assert.match(capture.preview ?? '', /\.preview\.webp$/, `${capture.id} needs a preview`);
      if (dataset.asset_base_url) continue;
      const file = `public${capture.preview}`;
      assert.ok(fs.statSync(file).size < 1_000_000, `${file} should be under 1 MB`);
      const { width, height } = webpSize(file);
      assert.ok(Math.abs(width / height - capture.width / capture.height) < 0.01, `${file} aspect ratio`);
    }
  }
});
