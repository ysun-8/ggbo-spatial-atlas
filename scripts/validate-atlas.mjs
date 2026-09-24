import fs from 'node:fs';
import path from 'node:path';
import { decodeExpression, validateSpatialData } from '../lib/atlas-format.mjs';

const [id, root = 'public', referenceRoot] = process.argv.slice(2);
const catalog = JSON.parse(fs.readFileSync('atlas/catalog.json'));
const entry = catalog.datasets.find((entry) => entry.id === id);
if (!entry) throw new Error('Unknown dataset');
const data = JSON.parse(fs.readFileSync(path.join(root, entry.path)));
validateSpatialData(data, entry.captures);
const encoding = data.dataset.expression?.encoding ?? entry.expression.encoding;
const cache = new Map();
function bufferAt(base, payload, gene) {
  const file = path.join(base, payload.dataset.gene_data_path, gene.chunk);
  if (!cache.has(file)) {
    const bytes = fs.readFileSync(file);
    cache.set(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  return cache.get(file);
}
const reference = referenceRoot ? JSON.parse(fs.readFileSync(path.join(referenceRoot, entry.path))) : null;
const referenceGenes = reference ? new Map(reference.genes.map((gene) => [gene.gene, gene])) : null;
if (reference && reference.spots.length !== data.spots.length) throw new Error('Migration changed observation count');
const referenceCells = reference ? new Map(reference.spots.map((spot) => [spot.id, spot])) : null;
if (referenceCells) for (const spot of data.spots) {
  const old = referenceCells.get(spot.barcode);
  if (!old || Math.abs(old.x - spot.x) > 0.001 || Math.abs(old.y - spot.y) > 0.001 || Math.abs(old.umap_x - spot.umap_x) > 0.0001 || Math.abs(old.umap_y - spot.umap_y) > 0.0001 || old.identity !== spot.identity || old.line !== spot.line || old.slice !== spot.slice) throw new Error('Migration changed spatial data or annotation');
}
let compared = 0;
for (const gene of data.genes) {
  const values = decodeExpression(bufferAt(root, data, gene), gene, data.spots.length, encoding);
  if (!reference) continue;
  const oldGene = referenceGenes.get(gene.gene);
  if (!oldGene) throw new Error('Migration changed genes');
  const oldValues = reference.dataset.gene_data_path
    ? decodeExpression(bufferAt(referenceRoot, reference, oldGene), oldGene, reference.spots.length, reference.dataset.expression?.encoding ?? 'uint16-uint8-log1p-v1')
    : null;
  data.spots.forEach((spot, i) => {
    const oldSpot = referenceCells.get(spot.barcode);
    const oldValue = oldValues ? oldValues[oldSpot.index] : oldSpot.expression[gene.gene];
    if (Math.abs(values[i] - oldValue) > 1e-6) throw new Error(`Migration changed ${gene.gene} expression`);
    compared++;
  });
}
console.log(JSON.stringify({ dataset: id, observations: data.spots.length, genes: data.genes.length, encoding, compared_expression_values: compared }));
