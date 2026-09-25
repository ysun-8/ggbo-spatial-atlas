# Fresh-frozen Visium HD datasets

The October 2025 HD series includes four baseline objects, two CAR-T objects, and two hypoxia objects. Each object remains a separate dataset with its original identity annotations and UMAP. Treatment labels come from the selected source filenames and import mapping; dose, duration, and oxygen level are not inferred.

| Line | Condition | Cells | SCT/data genes |
| --- | --- | ---: | ---: |
| UP-11972 | baseline | 8,598 | 14,597 |
| UP-11789 | baseline | 24,117 | 14,558 |
| UP-12131 | baseline | 15,850 | 14,892 |
| UP-12163 | baseline | 15,624 | 15,646 |
| UP-12131 | CAR-T | 4,496 | 12,768 |
| UP-12163 | CAR-T | 17,039 | 15,533 |
| UP-11789 | hypoxia | 10,619 | 13,997 |
| UP-12163 | hypoxia | 13,412 | 15,406 |

Baseline UP-11972 and UP-11789 share Capture A; baseline UP-12131 and UP-12163 share Capture B. CAR-T objects share Capture C, and hypoxia objects share Capture D. Each view includes only that object's retained regions. All images use the explicit on-disk hires PNG with the source object's hires scale. Markers represent cell centers, not segmentation boundaries.

New HD expression chunks use gzip compression of the existing uint32/float32 format. Offsets refer to the decompressed bytes. The browser decompresses a selected gene chunk on demand using DecompressionStream. Existing uncompressed datasets remain supported. The exporter validates every index and expression value against the source matrix, then verifies byte-for-byte gzip round trips. The JavaScript validator independently decodes every compressed gene record. Original RDS files remain read-only.

## Release validation

All seven new exports retain every source observation, adding 92,716 cells. Together with the existing UP-12163 CAR-T dataset, the HD series contains 109,755 cells. Per-dataset validation reports are stored alongside this document.

Browser checks passed for each new dataset: full cell count, histology overlay, CA9 loading from compressed chunks, region filtering, and cell inspection. Checked region counts were 1,398 (UP-11972 baseline Region 1), 7,317 (UP-11789 baseline Region 2), 7,469 (UP-12131 baseline Region 3), 4,135 (UP-12163 baseline Region 1), 2,401 (UP-12131 CAR-T Region 1), 5,700 (UP-11789 hypoxia Region 2), and 3,343 (UP-12163 hypoxia Region 1). HOPX search and loading also passed for UP-12163 hypoxia. Some source selections cover only part of a tissue section; the export includes the complete selected object, not every cell visible in the histology.

Eight format and compression tests, TypeScript checking, and the GitHub Pages production build passed. The public assets total 804,778,118 bytes before hosting compression. The four primary FFPE HD samples remain outside this release.
