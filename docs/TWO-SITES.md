# Two GitHub Pages atlases

The gGBO repository is the source of the shared viewer code. The primary repository contains the same viewer and its own data. Each published site stays below 1 GB.

| Site | Repository | Default dataset |
| --- | --- | --- |
| [gGBO Spatial Atlas](https://ysun-8.github.io/ggbo-spatial-atlas/) | ysun-8/ggbo-spatial-atlas | UP-11789 baseline |
| [Primary GBM Spatial Atlas](https://ysun-8.github.io/primary-gbm-spatial-atlas/) | ysun-8/primary-gbm-spatial-atlas | 26455A4 |

Primary FFPE tumor data belong to the second site. Late-passage FFPE organoids stay in the gGBO site.

## Update the shared viewer

Make viewer changes in the gGBO repository, then run:

```sh
node scripts/sync-primary-site.mjs ../primary-gbm-spatial-atlas
```

The script copies code and documentation, and installs `atlas/primary-catalog.json` as the primary repository's active `atlas/catalog.json`. It does not copy or delete data assets, install dependencies, commit, or publish. Review and commit both repositories. Update each site's data in its own `public` directory. The complete export recipes are retained in both repositories, but exports require an entry in that repository's active catalog.

Each deployment derives its base path from the repository name. Run tests and build each repository separately. The workflow rejects a built site of 1,000,000,000 bytes or more before uploading it to Pages.

```sh
npm test
GITHUB_PAGES=true NEXT_PUBLIC_BASE_PATH=/primary-gbm-spatial-atlas SITE_ORIGIN=https://ysun-8.github.io npm run build:pages
node scripts/check-pages-size.mjs
```

Use `/ggbo-spatial-atlas` for the gGBO build. Interactive browser checks remain pending because the browser tool's required security check was unavailable during this release.
