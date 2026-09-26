# gGBO Spatial Atlas

An interactive viewer for spatial transcriptomics from giant glioblastoma organoids (gGBOs) and primary GBM tissue.

**Live site:** https://ysun-8.github.io/ggbo-spatial-atlas/

- Datasets and how to add one: [docs/DATASETS.md](docs/DATASETS.md)
- Methods page shown on the site: [public/about.html](public/about.html)

## Run locally

Requires Node.js 22.13 or later.

```sh
npm ci
npm run dev
```

## Test and build

```sh
npm test
GITHUB_PAGES=true NEXT_PUBLIC_BASE_PATH=/ggbo-spatial-atlas npm run build:pages
```

Pushing to `main` builds and deploys the site to GitHub Pages.

## Where the data live

- Organoid data are in this repository under `public/`.
- Primary GBM data are in [ysun-8/primary-gbm-spatial-atlas](https://github.com/ysun-8/primary-gbm-spatial-atlas), which only hosts data files. Those catalog entries point there with `asset_base_url`.

Data are split across two sites because GitHub Pages allows at most 1 GB per site.

## Contact

Please report problems through [GitHub issues](https://github.com/ysun-8/ggbo-spatial-atlas/issues).
