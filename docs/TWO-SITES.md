# One viewer with a separate data host

Visitors use [gGBO Spatial Atlas](https://ysun-8.github.io/ggbo-spatial-atlas/) for both organoids and primary tumors. The default remains Visium HD baseline UP-11789. Primary GBM appears in the same dataset selector, with four sample options.

The `ysun-8/primary-gbm-spatial-atlas` repository hosts only primary metadata, expression chunks, and lossless histology images. It does not host another viewer. Its root redirects to the main atlas with primary sample 26455A4 selected. The main catalog sets `asset_base_url` for these four entries, and the viewer resolves all their assets relative to that address. Both Pages sites share the ysun-8.github.io origin.

The main build is 783,157,321 bytes and the data host is 544,554,341 bytes. Each deployment checks its own 1 GB limit. Data should be deployed and checked before viewer entries are enabled or changed.

## Local directories

- `visium-atlas-prototype` is the main viewer and organoid data repository.
- `primary-gbm-spatial-data-host` is the data-only repository to publish.
- `primary-gbm-spatial-atlas` is an unpublished local benchmark checkout retained from the earlier two-viewer proposal. Do not publish that checkout.

To validate the main catalog against both local asset roots:

```sh
ATLAS_REMOTE_ASSET_ROOT=../primary-gbm-spatial-data-host/public npm test
node scripts/validate-atlas.mjs primary-26455a4 ../primary-gbm-spatial-data-host/public
```

The main repository contains all shared viewer and export code. Keep the primary data host free of application code and build dependencies. Replace a dataset's metadata and gene chunks together. `scripts/sync-primary-site.mjs` updates the optional local benchmark only; it is not the publishing workflow.

Browser interaction checks remain pending because the browser tool's required security check was unavailable. Automated checks do not establish measured interaction speed.
