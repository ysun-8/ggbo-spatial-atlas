# gGBO Spatial Atlas

An interactive viewer for spatial transcriptomics from giant glioblastoma organoids (gGBOs) and primary GBM tissue.

**Open the atlas:** https://ysun-8.github.io/ggbo-spatial-atlas/

gGBOs form a hypoxia gradient from the rim to the core, and their tumor cells organize into three zones along it. The atlas lets you explore these zones, and how they respond to treatment, on the H&E of each section.

## What's included

| Group | Technology | Samples | Condition | Spots / cells |
| --- | --- | --- | --- | ---: |
| Late-passage gGBOs | Visium (fresh-frozen and FFPE) | 4 patient lines | Baseline | 2,383 spots |
| Early-passage gGBOs | Visium (fresh-frozen) | UP-11556, UP-11662 | Baseline | 908 spots |
| | | | CAR-T | 566 spots |
| | | | Radiation + temozolomide | 795 spots |
| gGBOs | Visium HD (fresh-frozen) | UP-11972, UP-11789, UP-12131, UP-12163 | Baseline (20% O2) | 64,189 cells |
| | | UP-11789, UP-12163 | 5% O2 | 24,031 cells |
| | | UP-12131, UP-12163 | CAR-T | 21,535 cells |
| Primary GBM | Visium HD (FFPE) | 4 surgical samples | Untreated | 343,558 cells |

| Totals | Spots / cells |
| --- | ---: |
| gGBO Visium spots | 4,652 spots |
| gGBO Visium HD cells | 109,755 cells |
| Primary GBM Visium HD cells | 343,558 cells |
| All Visium HD cells | 453,313 cells |
| **All data** | **4,652 spots and 453,313 cells** |

Every dataset includes all spots or cells and all genes from its source Seurat object. Counts for each line and sample are in [docs/DATASETS.md](docs/DATASETS.md).

## Using the atlas

- **Choose data:** pick a dataset group, then a GBO line or sample. Some Visium datasets have several capture areas.
- **Color by identity or gene:** identity shows each spot or cell's label. Gene shows expression of any gene; type in the search box to find one.
- **Expression scale:** by default, the top of the color scale is the 95th percentile among cells that express the gene. To compare samples on the same scale, enter a manual maximum.
- **Inspect a cell:** click a spot or cell to see its label, cluster, QC values, and expression. It is also highlighted in the linked UMAP.
- **Move around:** drag to pan and scroll to zoom. On a phone, swipe up and down to scroll the page, drag sideways to pan, and pinch to zoom.
- **Adjust the view:** sliders control H&E opacity, marker opacity, and (for Visium HD) cell dot size.
- **Share a view:** "Copy link" saves the dataset, gene, and color settings in the URL.

## Labels

- **OPZ, outer proliferative zone:** the rim. Dividing cells that express Ki-67, SOX2, and Nestin.
- **IQZ, intermediate quiescent zone:** the middle layer. Non-dividing, stem-like cells with radial glia features such as HOPX.
- **HCZ, hypoxic core zone:** the core. Hypoxic cells with mesenchymal features such as CD44 and GLUT1.
- **CAR-T datasets:** CAR-T marks CAR-T cell–rich spots or cells. IR marks immune-responsive tumor cells.
- **Primary GBM:** tumor cells are labeled by state (proliferating tumor, RG-like, hypoxic niche); other labels are non-tumor cell types.

Labels come from clustering in each source object. Hover over a label in the legend to see its full name.

## About the data

- Expression values are SCT-normalized (the SCT assay's `data` layer).
- Visium markers are capture spots. Visium HD markers are segmented cell centers, drawn as circles rather than cell outlines.
- UMAPs come from each source object, so UMAPs from different datasets are not directly comparable.
- Organoid data are stored in this repository. Primary GBM data are stored in [ysun-8/primary-gbm-spatial-atlas](https://github.com/ysun-8/primary-gbm-spatial-atlas).

## Citation

A manuscript describing this work is under review. Citation details will be added when it is published.

## Contact

Please report problems or ask questions through [GitHub issues](https://github.com/ysun-8/ggbo-spatial-atlas/issues).

## License

MIT. See [LICENSE](LICENSE).
