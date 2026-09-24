/** Decode sparse expression. Indices refer to the payload's observation order. */
export function decodeExpression(buffer, stats, observationCount, encoding) {
  if (!Number.isInteger(observationCount) || observationCount < 1) throw new Error('Invalid observation count');
  if (!['uint16-uint8-log1p-v1', 'uint32-float32-v2'].includes(encoding)) throw new Error('Unsupported expression encoding');
  const { offset, detected } = stats;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(detected) || detected < 0 || detected > observationCount) throw new Error('Invalid gene record');
  const modern = encoding === 'uint32-float32-v2';
  const indexBytes = modern ? 4 : 2;
  const valueBytes = modern ? 4 : 1;
  if (!modern && observationCount > 65536) throw new Error('Legacy expression indices cannot represent this dataset');
  if (offset + detected * (indexBytes + valueBytes) > buffer.byteLength) throw new Error('Truncated gene chunk');
  const values = new Float32Array(observationCount);
  const view = new DataView(buffer);
  const valueOffset = offset + detected * indexBytes;
  let previous = -1;
  for (let i = 0; i < detected; i++) {
    const index = modern ? view.getUint32(offset + i * 4, true) : view.getUint16(offset + i * 2, true);
    const value = modern ? view.getFloat32(valueOffset + i * 4, true) : Math.log1p(view.getUint8(valueOffset + i));
    if (index >= observationCount || index <= previous) throw new Error('Invalid or unordered observation index');
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid expression value');
    previous = index;
    values[index] = value;
  }
  return values;
}

/** A physical capture has one image. Regions in another capture are never overlaid. */
export function validateSpatialData(data, captures) {
  if (!Array.isArray(captures) || !captures.length) throw new Error('No capture images configured');
  const regions = new Map();
  const captureIds = new Set();
  for (const capture of captures) {
    if (!capture.id || captureIds.has(capture.id)) throw new Error('Duplicate capture ID');
    captureIds.add(capture.id);
    if (!capture.image || !Number.isFinite(capture.width) || capture.width <= 0 || !Number.isFinite(capture.height) || capture.height <= 0 || !Number.isFinite(capture.marker_radius) || capture.marker_radius <= 0) throw new Error('Invalid capture geometry');
    for (const region of capture.regions) {
      if (regions.has(region.id)) throw new Error('A region belongs to multiple captures');
      regions.set(region.id, capture);
    }
  }
  if (data.dataset.spot_count !== data.spots.length) throw new Error('Observation count mismatch');
  const ids = new Set();
  data.spots.forEach((spot, index) => {
    if (!spot.id || ids.has(spot.id)) throw new Error('Duplicate observation ID');
    ids.add(spot.id);
    const capture = regions.get(spot.slice);
    if (!capture) throw new Error('Observation has no capture image');
    if (![spot.x, spot.y, spot.umap_x, spot.umap_y].every(Number.isFinite)) throw new Error('Invalid observation coordinates');
    if (spot.x < 0 || spot.y < 0 || spot.x > capture.width || spot.y > capture.height) throw new Error('Observation outside capture image');
    if (data.dataset.gene_data_path && spot.index !== index) throw new Error('Expression observation order mismatch');
  });
  const genes = new Set();
  for (const gene of data.genes) {
    if (!gene.gene || genes.has(gene.gene)) throw new Error('Duplicate gene');
    genes.add(gene.gene);
  }
}

export function filterCaptureSpots(spots, capture, regionId = 'all', line = 'all') {
  if (!capture) return [];
  const regionIds = new Set(capture.regions.map((region) => region.id));
  return spots.filter((spot) => regionIds.has(spot.slice) && (regionId === 'all' || spot.slice === regionId) && (line === 'all' || spot.line === line));
}
