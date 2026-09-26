# Dataset catalog and export

The viewer reads `atlas/catalog.json`. Add datasets here instead of editing the page. Each entry records its study group, preparation, tissue type, expression assay and layer, annotation source, and existing embedding. A capture entry specifies one histology image, its pixel dimensions, marker radius in image pixels, and its tissue regions. An observation's `slice` must match exactly one configured region. Region IDs must be unique within a dataset.

The catalog contains 2,383 late-passage Visium spots with 19,779 genes, 17,039 UP-12163 CAR-T HD cells with 15,533 genes, 908 December baseline regular Visium spots with 15,435 SCT genes, 566 December CAR-T spots with 11,391 SCT genes, and 795 December radiation spots with 16,028 SCT genes. Each December dataset includes all genes available in its SCT/data layer. The labels now distinguish tissue regions from physical captures. Missing or incorrectly sized image files produce a visible error rather than a fallback to another dataset's histology.

## Export a dataset

Source-specific mappings live in `scripts/export-config.json`. Paths are relative to a source root supplied at export time. The RDS files are read only. Each recipe selects the annotation and QC fields, and explicitly pairs each capture with an image and its Seurat `hires` or `lowres` scale. To use all available genes, omit the optional `genes` list. A short explicit list also includes inline expression for the regular-viewer preview bars.

Run from the repository root, substituting your source directory and an empty staging directory:

```sh
Rscript scripts/export_atlas.R visium-a /path/to/GBM_Spatial /tmp/atlas-export-regular
node scripts/validate-atlas.mjs visium-a /tmp/atlas-export-regular
```

The exporter checks image dimensions and spatial membership. It aligns expression and embeddings by observation ID, rejects duplicate observations and invalid coordinates, and reads every binary gene record back to compare with the source matrix. `validation.json` records intentional exclusions and numerical precision. Image membership counts alone are not a biological replicate audit.

Review the staging results before copying their `data` directory and configured image files into `public`. Copy the complete dataset and all of its chunks together. Retain the staging validation report with the release. If the selected gene universe shrinks, remove obsolete chunks only after confirming which are no longer referenced.

A migration can additionally compare all values and coordinates against the previous web export:

```sh
node scripts/validate-atlas.mjs visium-a /tmp/atlas-export-regular /path/to/previous/public
```

## Expression format

New payloads have `schema_version: 2` and `dataset.expression.encoding: "uint32-float32-v2"`. Each sparse gene record contains `detected` little-endian uint32 observation indices, followed by the same number of little-endian float32 normalized values. `offset` is a byte offset within the gene's chunk. Observation indices are zero-based and strictly increasing. Missing sparse entries represent measured zero within that gene's assay; an absent gene has no record and is not interpreted as zero.

The stored normalized values are exported directly. They are not converted back to one-byte counts. The R implementation currently limits observation counts to its signed integer range, which covers the inspected datasets. The browser rejects malformed offsets, duplicate or out-of-range indices, truncated buffers, negative expression, and unsupported versions. Legacy uint16/uint8 chunks remain readable only for datasets within their original index capacity.

Payloads carry their encoding, while the catalog is authoritative for viewer labels and capture geometry. Update catalog dimensions and image paths together with an export. Do not reuse a single global image scale. The embedded image resolution in an RDS object is not assumed to match its `lowres` scale.

Observation IDs are namespaced by dataset; original source IDs remain in `barcode`. The main identity field is configurable. Additional ident, identity, myeloid_ident, and immune_ident values are preserved in each observation's annotations when present. Selecting among secondary annotation fields in the UI is a future step.

## Validation of this migration

The two original prototype datasets were re-exported from the selected source RDS objects. Every sparse value and index was read back in R. The largest absolute float32 difference was below 0.000001. The JavaScript reader also compared 6,888 regular expression values and 264,666,787 HD expression values against the prior web exports; all agreed within that tolerance. Observation counts, identities, region membership, spatial coordinates, and UMAP positions were also checked against the previous export. Both histology PNGs are byte-for-byte unchanged.

Run `npm test` for binary boundary, malformed-data, capture-isolation, and current-payload checks. Run `npx tsc --noEmit --incremental false` for TypeScript checking. Build GitHub Pages using:

```sh
GITHUB_PAGES=true NEXT_PUBLIC_BASE_PATH=/ggbo-spatial-atlas npm run build:pages
```

The repository-wide linter has existing failures in the supplied UI components and pre-existing page patterns. Those have not been addressed as part of this dataset migration.

## December baseline addition

December baseline was added through catalog and export configuration only. No viewer or exporter changes were required. The source is `GBO_Baseline_Visium_Round_2_071326.RDS`. All 908 source spots are included across five retained regions: 450 spots from UP-11556 and 458 from UP-11662. Region counts are 238, 212, 146, 179, and 133 for slice1 through slice5. The original `ident` annotations and `umap.cca` embedding are preserved.

The image is the 2,000 by 1,929 pixel high-resolution PNG from December Visium_A. It contains six tissue sections, but this source object retains five regions; the middle-right tissue section has no spots from this object. This is the source selection, not an export omission. All 15,435 genes in SCT/data are available on demand. Every encoded index and value was read back against the source matrix, with maximum absolute float32 error below 0.000001. See `december-baseline-validation.json`.

Browser verification passed for all five tissue overlays, the UP-11556 filter (450 spots), Region 1 (238 spots), HOPX search and expression loading, and spot inspection. Seven format tests, TypeScript checking, and the GitHub Pages production build passed.

## December CAR-T and radiation additions

Both datasets were added through catalog and export configuration without changing the viewer or exporter. All source spots, SCT/data genes, and umap.cca coordinates are retained.

| Dataset | Spots | SCT genes | Regions | Source annotation |
| --- | ---: | ---: | --- | --- |
| December CAR-T | 566 | 11,391 | slice6 through slice11 | identity: CAR-T, IR tumor 1, IR tumor 2 |
| December radiation | 795 | 16,028 | slice12 through slice16 | ident: HCZ, IQZ, OPZ |

CAR-T uses the December Visium_B high-resolution image, and radiation uses Visium_C. Both images are 2,000 by 1,929 pixels. Coordinates and marker radii use each capture's matching hires scale. Every exported binary index and expression value was read back against the source matrix; maximum absolute float32 errors were below 0.000001. The JavaScript validator also read every gene successfully. See `visium-dec-cart-validation.json` and `visium-dec-radiation-validation.json`.

Browser checks confirmed all six CAR-T overlays and five radiation overlays. CAR-T filters returned 363 spots for UP-11556 and 272 for Region 8; radiation filters returned 236 spots for UP-11662 and 139 for Region 16. CD3D search and expression loading passed for CAR-T, and MKI67 expression loading passed for radiation. Spot inspection passed for both. Seven format tests, TypeScript checking, and the GitHub Pages production build passed.

Test the 131,504-cell primary sample separately before claiming browser performance at that scale.

## Full late-passage Visium

The full October integrated object now includes all 2,383 spots and all 19,779 SCT/data genes. Fresh-frozen A contains 574 spots, fresh-frozen B 445, FFPE UP-10072 / UP-9059 629, and FFPE UP-9121 / UP-7790 735. All eight source regions and their original zone labels and integrated CCA embedding are retained. Each capture has its own image, preparation label, scale, and spot radius. No source observations are excluded. Every encoded expression value was checked against the source matrix with maximum absolute float32 error below 0.000001. See `late-passage-validation.json`.

Release checks passed: all four late-passage overlays, capture counts, Region 7 isolation (74 spots), HOPX search and spot expression, seven format tests, TypeScript checking, and the GitHub Pages production build.

## Fresh-frozen HD expansion

The full baseline, CAR-T, and hypoxia HD series is documented in [HD-DATASETS.md](HD-DATASETS.md). New expression chunks have a `.bin.gz` suffix and are losslessly decompressed before interpreting offsets; older `.bin` chunks remain supported.

## Navigation

The dataset dropdown groups entries by Visium and Visium HD. HD baseline, CAR-T, and hypoxia each appear once, with a separate GBO line selector. Catalog navigation fields map these choices to the original per-object exports. Switching condition retains the current line when available; otherwise it selects the first available line. Capture, line, and tissue region choices precede display controls. Late-passage captures retain their FFPE-first order.

## Primary FFPE HD expansion

The separate primary catalog includes all four primary GBM samples, totaling 343,558 cells, under one dataset group with a sample selector. See [Primary FFPE Visium HD](PRIMARY-HD-DATASETS.md) for cell and gene counts, the capture-specific coordinate correction, source geometry checks, and the remaining browser and hosting work. Primary data are served from their own repository to stay within the GitHub Pages size limit, while the main atlas displays every dataset in one viewer.
