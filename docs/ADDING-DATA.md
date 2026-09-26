# Adding a dataset

1. Add an entry to `atlas/catalog.json` and a recipe to `scripts/export-config.json`.
2. Export into an empty folder, then validate:

   ```sh
   Rscript scripts/export_atlas.R <dataset-id> /path/to/GBM_Spatial /tmp/atlas-export
   node scripts/validate-atlas.mjs <dataset-id> /tmp/atlas-export
   ```

3. Copy the exported `data` folder and images into `public/`. For primary GBM data, copy them into the data host repository instead.
4. Save the export's `validation.json` in `docs/` as `<dataset-id>-validation.json`.

The exporter never modifies the source RDS files, and it stops if any exported value doesn't match the source.

## File format

- `data/<id>.json` (or `.json.gz`) holds cell positions, annotations, QC values, UMAP coordinates, and per-gene summary values.
- `data/<id>-genes/chunk-NNN.bin` (or `.bin.gz`) holds expression, 128 genes per chunk. Each gene is stored as its nonzero cell indices (uint32) followed by their values (float32). Cells without an entry have a value of zero.

## Run the viewer locally

Requires Node.js 22.13 or later.

```sh
npm ci
npm run dev
```

## Test and build the site

```sh
npm test
GITHUB_PAGES=true NEXT_PUBLIC_BASE_PATH=/ggbo-spatial-atlas npm run build:pages
```

Pushing to `main` builds and deploys the site to GitHub Pages.
