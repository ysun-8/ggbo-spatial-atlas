# gGBO Spatial Atlas

An interactive viewer for glioblastoma organoid Visium and Visium HD. The default view is baseline UP-11789. The source Seurat objects remain unchanged. See [dataset methods](docs/DATASETS.md) and the viewer's [methods page](public/about.html) for provenance and interpretation.

## Run locally

Use Node.js 22.13 or later.

```sh
npm ci
npm run dev
```

For a GitHub Pages build:

```sh
npm test
npm run lint
npx tsc --noEmit --incremental false
GITHUB_PAGES=true NEXT_PUBLIC_BASE_PATH=/ggbo-spatial-atlas SITE_ORIGIN=https://ysun-8.github.io npm run build:pages
node scripts/check-pages-size.mjs
```

The static site is written to `dist/client`. The deployment workflow checks the 1 GB limit before upload.

## Viewer behavior

All HD spatial and UMAP points use canvas. Histology and the selected-cell highlight use separate layers. Changing layer opacity or selecting a cell does not invalidate the dense point drawing. Gene and palette changes update point colors; pan, zoom, resize, and marker-size changes update geometry. Canvas colors are composited as a layer, so overlap opacity differs from independently transparent SVG circles.

Gene values are SCT/data values from the source object. The automatic color maximum is a type-7 95th percentile among positive finite values across the whole selected dataset. Filtering a region does not change that limit. All-zero genes remain zero. A positive manual maximum overrides the automatic value and is shown in the legend. Neither mode changes the stored expression values.

The address bar and Copy link button preserve dataset, gene, capture, region, line filter, color mode, and manual expression maximum. Invalid selections fall back to valid values. `hd-12163-car-t` is the canonical CAR-T ID; old `hd-12163` links are accepted. Existing binary asset filenames are retained for compatibility.

## Histology images

HD histology uses lossless WebP at the original pixel dimensions. Conversion checks every decoded RGBA pixel. This reduces downloads without changing spatial coordinates or losing image information. It does not provide additional high-resolution detail or tiled zooming.

`scripts/compress-histology.py` converts catalog HD images and saves original PNGs under ignored `outputs/original-histology`. Both image scripts require Python with Pillow. R exports to WebP also require Pillow; set `ATLAS_PYTHON` if that interpreter is not `python3`.

## One viewer, optional separate data storage

The desired public interface is one atlas. A dataset can declare `asset_base_url`, such as `https://ysun-8.github.io/primary-gbm-spatial-atlas/`, to load its metadata, expression chunks, and histology from a separate static data host. Paths remain relative to that base. A host on a different origin must allow browser cross-origin reads. The primary catalog entries use `https://ysun-8.github.io/primary-gbm-spatial-atlas/` as their data host. The main dataset selector includes all four samples. The data-only host redirects its root to the main viewer.

The sibling primary checkout is retained as a local benchmark for the 131,504-cell sample. It is not the intended second public viewer. `scripts/sync-primary-site.mjs` copies shared code to that checkout without copying its data. `atlas/primary-catalog.json` provides its catalog.

## Validation status

Automated format, scale, URL, and geometry tests pass. Source expression and primary coordinate checks are described in the dataset documents. Browser interaction timings have not been measured for this change: the browser tool's required security check was unavailable. Before publication, check opacity, cell selection, gene switching, URL restoration, and zoom on UP-11789 and primary 26455A4. Each point canvas exposes `data-draw-count` for verifying that opacity and selection leave the dense layer unchanged.

## Citation and contact

For a figure, record the atlas URL with its view parameters, access date, source object, and assay/layer. A manuscript citation has not been specified for this release, so none is inferred. Questions and corrections can be submitted through [GitHub issues](https://github.com/ysun-8/ggbo-spatial-atlas/issues).
