# Primary FFPE Visium HD

All four January 2026 primary GBM objects are available inside the main gGBO Spatial Atlas under “Visium HD · primary GBM,” followed by a sample selector. The default remains Visium HD baseline UP-11789. Only the data files are hosted separately.

| Sample | Retained cells | SCT/data genes | Source coordinate order |
| --- | ---: | ---: | --- |
| 26455A4 | 131,504 | 17,871 | y, x |
| 41602A8 | 89,591 | 17,634 | x, y |
| 26941A3 | 87,500 | 17,879 | x, y |
| 26547A15 | 34,963 | 17,680 | x, y |

The exports retain all 343,558 source cells, the complete SCT/data gene lists, original identity labels, QC measurements, and existing UMAP coordinates. The original source RDS files are read only. Markers show segmentation centers. Polygon outlines and the OPZ/IQZ/HCZ signature scores are not included in this viewer release.

## Spatial alignment

The saved objects do not all use the same coordinate order. For 26455A4, Seurat's first coordinate is the image row and the second is the image column. Its capture recipe therefore explicitly sets `coordinate_order` to `yx`. The other three use `xy`. The exporter applies this mapping before scaling to the matching hires image. Full-resolution coordinates in the exported payload also use horizontal x and vertical y.

Every retained center was checked against the bounding box of its own cell polygon in the original `outs/segmented_outputs/cell_segmentations.geojson`, matched by cell ID. All 343,558 centers passed. Exported image coordinates also match the source `tissue_hires_scalef` values. Static plots of all four corrected overlays were inspected. The imaged tissue extends beyond the captured cells; those additional tissue areas do not contain measurements in these objects.

Repeat the independent source geometry check with:

```sh
python3 scripts/validate-primary-geometry.py /path/to/GBM_Spatial public
```

## Rendering and compression

All HD views use canvas for both spatial and UMAP points. Canvas uses the same view-box projection as the SVG viewer and selects the nearest cell within the click radius. Spatial clicks still distinguish selection from dragging. The selected cell remains linked between the views. This avoids creating one browser element for each point, but interactive performance has not yet been measured in the browser.

Primary metadata and expression chunks are gzip compressed without removing data. Metadata downloads total 30,065,233 bytes, compared with 163,965,925 bytes before compression. Each metadata compression round trip was checked. The browser also continues to support the older uncompressed datasets. The exporter supports compressed metadata whenever the catalog path ends in `.gz`.

## Validation and remaining work

All source expression values passed the R export round-trip checks, with maximum float32 error of approximately 2.22e-7. The JavaScript validator independently decoded all genes in all four exports. Source annotation counts match the earlier object inventory. Ten automated tests, TypeScript checking, and the GitHub Pages production build passed. The tests include selection beyond cell index 65,535 and projection with zoom and letterboxing.

Interactive browser verification is pending. The browser tool could not verify its required security policy and denied access to the local preview. Consequently, pan/zoom responsiveness, rendered gene colors, and linked cell selection in the actual browser have not been claimed as verified.

Before splitting the sites, the combined public assets occupied 1,375,453,092 bytes. A measured gzip estimate for all remaining plain JSON and binary files reduces this to 1,078,563,051 bytes, before application build assets. That is still above GitHub Pages' stated 1 GB published-site limit. See [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). Separate data hosting resolves this limit. The main viewer is 783,157,321 bytes and the primary data host is 544,554,341 bytes. Both workflows check the final site size before deployment. Browser interaction review remains pending.
