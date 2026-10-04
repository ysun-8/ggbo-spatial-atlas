# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Readers after publication:** glioblastoma and organoid researchers who come from the gGBO hypoxia paper and want to look up their own genes of interest in gGBOs and primary GBM, on the tissue, without downloading or processing the data.
- **Our own lab and collaborators:** browsing the datasets, checking results, and pulling views for figures and discussions.

## Product Purpose

An interactive viewer for the spatial transcriptomics behind the gGBO hypoxia paper. gGBOs form a hypoxia gradient from rim to core, and their tumor cells organize into three zones along it. The atlas lets people see those zones, gene expression, and treatment responses on the H&E of each section. Success means a reader can open a dataset, find a gene, and judge the spatial pattern for themselves, then share that exact view.

## Positioning

It shows the paper's own data in full: every spot or cell and every gene from each source Seurat object, with the source identity labels and UMAPs unchanged, on the original histology. It pairs gGBOs (baseline, 5% O2, CAR-T, radiation + temozolomide) with primary GBM Visium HD from surgical samples, so the same zones and genes can be compared between organoids and tumors.

## Operating Context

- Readers often arrive from the paper or a shared link, including on phones from email or social media.
- Typical flow: choose a dataset group, then a GBO line or sample (and a capture area where there are several); color by identity or by gene; adjust the expression scale; click a spot or cell to inspect it and see it highlighted in the linked UMAP; copy a link that saves the view.
- Visium HD baseline lines are listed with UP-11789 first.

## Capabilities and Constraints

- Four dataset groups: late-passage gGBO Visium (fresh-frozen and FFPE, 4 lines, 2,383 spots); early-passage gGBO Visium (2 lines, 2,269 spots across baseline, CAR-T, and radiation); gGBO Visium HD (fresh-frozen, 4 lines, 109,755 cells across baseline 20% O2, 5% O2, and CAR-T); primary GBM Visium HD (FFPE, 4 samples, 343,558 cells, untreated).
- Expression is SCT/data. The default color maximum is the 95th percentile among expressing cells; a manual maximum lets samples share one scale. The scale changes colors only, not data.
- Visium markers are capture spots; Visium HD markers are segmented cell centers drawn as circles, not cell outlines. Tissue can appear without markers when it is not part of the selected object.
- Zone labels come from unsupervised clustering of expression in each source object, not from distance to the rim. UMAPs from different objects are not comparable.
- Terminology: OPZ (outer proliferative zone), IQZ (intermediate quiescent zone), HCZ (hypoxic core zone); CAR-T and IR (immune-responsive tumor) in CAR-T datasets; primary GBM tumor states are proliferating tumor, RG-like, and hypoxic niche, other labels are non-tumor cell types.
- Static site on GitHub Pages (`ysun-8.github.io/ggbo-spatial-atlas`). The primary GBM data is hosted from a separate repo, `ysun-8/primary-gbm-spatial-atlas`, because of size.

## Brand Commitments

- Name: gGBO Spatial Atlas.
- Labels, zone names, and colors must match the manuscript figures exactly.
- The site states only what is in the data and the paper. No interpretive text beyond methods and label definitions.

## Evidence on Hand

- Dataset counts and source objects: `docs/DATASETS.md`, `scripts/export-config.json`.
- Methods and label definitions: `public/about.html`.
- Export validation reports: `docs/*-validation.json`.
- There are no user testimonials, usage numbers, or press. Do not invent them.

## Product Principles

1. The data is the authority. Show source objects as they are and never imply more than they say.
2. Match the paper. A reader moving between a figure and the atlas should see the same names, labels, and colors.
3. Let readers judge for themselves: make comparison across samples and conditions honest, with shared scales and clear caveats.
4. A shared link should reopen the exact view, on any device.

## Accessibility & Inclusion

Must be usable on phones: scrolling the page, panning, and zooming the tissue all need to work by touch.
