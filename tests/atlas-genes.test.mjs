import test from 'node:test';
import assert from 'node:assert/strict';
import { searchGenes, normalizeGeneTerm } from '../lib/atlas-genes.mjs';

const genes = ['CA9', 'ABCD4', 'C2CD4A', 'CD4', 'CD44', 'MKI67', 'POGLUT1', 'SLC2A1', 'H2AFX', 'PDCD10', 'PDCD1LG2'].map((gene) => ({ gene }));
const names = (result) => result.matches.map((gene) => gene.gene);

test('exact symbols rank before prefix and substring matches', () => {
  assert.deepEqual(names(searchGenes(genes, 'cd4')), ['CD4', 'CD44', 'ABCD4', 'C2CD4A']);
});

test('protein names from the paper resolve to gene symbols', () => {
  const glut1 = searchGenes(genes, 'GLUT1');
  assert.equal(names(glut1)[0], 'SLC2A1');
  assert.deepEqual(glut1.alias, { term: 'GLUT1', gene: 'SLC2A1', present: true });
  assert.equal(names(searchGenes(genes, 'Ki-67'))[0], 'MKI67');
  assert.equal(names(searchGenes(genes, 'γH2AX'))[0], 'H2AFX');
  assert.equal(normalizeGeneTerm('IL13Rα2'), 'il13ra2');
});

test('absent genes are reported instead of silently showing look-alikes', () => {
  const pd1 = searchGenes(genes, 'PD-1');
  assert.equal(pd1.exact, false);
  assert.deepEqual(pd1.alias, { term: 'PD-1', gene: 'PDCD1', present: false });
  const pdcd1 = searchGenes(genes, 'PDCD1');
  assert.equal(pdcd1.exact, false);
  assert.deepEqual(names(pdcd1), ['PDCD10', 'PDCD1LG2']);
});
