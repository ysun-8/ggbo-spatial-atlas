// Protein and common names used in the paper, mapped to HGNC symbols.
// Lists hold older symbols too, since datasets were annotated at different times.
export const geneAliases = {
  ki67: ['MKI67'],
  glut1: ['SLC2A1'],
  nestin: ['NES'],
  pdl1: ['CD274'],
  pd1: ['PDCD1'],
  cd45: ['PTPRC'],
  cd3: ['CD3E'],
  ccas3: ['CASP3'],
  cas3: ['CASP3'],
  h2ax: ['H2AX', 'H2AFX'],
  caix: ['CA9'],
  vegf: ['VEGFA'],
  il13r2: ['IL13RA2'],
  tenascinc: ['TNC'],
};

export function normalizeGeneTerm(term) {
  return term.toLowerCase().replaceAll('α', 'a').replaceAll('β', 'b').replace(/[^a-z0-9]/g, '');
}

// Ranks exact symbol, then alias, then prefix, then substring matches, keeping list order within each.
export function searchGenes(genes, query) {
  const term = query.trim();
  if (!term) return { matches: genes, exact: true, alias: null };
  const lower = term.toLowerCase();
  const exact = genes.filter((gene) => gene.gene.toLowerCase() === lower);
  const aliasSymbols = exact.length ? [] : geneAliases[normalizeGeneTerm(term)] ?? [];
  const aliasGene = genes.find((gene) => aliasSymbols.includes(gene.gene));
  const alias = aliasSymbols.length ? { term, gene: aliasGene?.gene ?? aliasSymbols[0], present: Boolean(aliasGene) } : null;
  const ranked = [...exact, ...(aliasGene ? [aliasGene] : []),
    ...genes.filter((gene) => gene.gene.toLowerCase().startsWith(lower)),
    ...genes.filter((gene) => gene.gene.toLowerCase().includes(lower))];
  return { matches: [...new Set(ranked)], exact: exact.length > 0 || Boolean(aliasGene), alias };
}
