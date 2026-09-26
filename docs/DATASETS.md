# Datasets

All expression values are SCT-transformed from source Seurat objects. Every exported dataset keeps all cells or spots and all genes in the source object. Identity labels and UMAPs come from the source objects unchanged.

## Organoid Visium

| Dataset | Spots | Genes | Source object |
| --- | ---: | ---: | --- |
| Late-passage baseline | 2,383 | 19,779 | `GBO_Visium_CCA_Integrated_061726_Full.RDS` |
| Early-passage baseline | 908 | 15,435 | `GBO_Baseline_Visium_Round_2_071326.RDS` |
| Early-passage CAR-T | 566 | 11,391 | `GBO_CART_Visium_Round_2_081926.RDS` |
| Early-passage radiation | 795 | 16,028 | `GBO_Rad_Visium_Round_2_122825.RDS` |

## Organoid Visium HD (fresh-frozen)

| Line | Condition | Cells | Genes |
| --- | --- | ---: | ---: |
| UP-11972 | Baseline | 8,598 | 14,597 |
| UP-11789 | Baseline | 24,117 | 14,558 |
| UP-12131 | Baseline | 15,850 | 14,892 |
| UP-12163 | Baseline | 15,624 | 15,646 |
| UP-12131 | CAR-T | 4,496 | 12,768 |
| UP-12163 | CAR-T | 17,039 | 15,533 |
| UP-11789 | Hypoxia | 10,619 | 13,997 |
| UP-12163 | Hypoxia | 13,412 | 15,406 |

## Primary GBM Visium HD (FFPE)

| Sample | Cells | Genes |
| --- | ---: | ---: |
| 26455A4 | 131,504 | 17,871 |
| 41602A8 | 89,591 | 17,634 |
| 26941A3 | 87,500 | 17,879 |
| 26547A15 | 34,963 | 17,680 |

Source object paths for every dataset are listed in `scripts/export-config.json`.

## Notes

- Visium HD cells are displayed as circles as opposed to segmented cells. 
- Some organoid captures share one image, so you may see tissue without markers. That tissue belongs to another dataset or was not part of the source object.
