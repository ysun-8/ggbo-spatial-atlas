"""Check exported primary cell centers against their source segmentation bounds.

Usage: python3 scripts/validate-primary-geometry.py /path/to/GBM_Spatial [public]
The source files and exported assets are read only.
"""
import gzip
import json
import re
import sys
from pathlib import Path

source = Path(sys.argv[1])
assets = Path(sys.argv[2] if len(sys.argv) > 2 else 'public')
catalog = json.loads(Path('atlas/catalog.json').read_text())
recipes = json.loads(Path('scripts/export-config.json').read_text())
for entry in catalog['datasets']:
    if not entry['id'].startswith('primary-'):
        continue
    payload = assets / entry['path'].lstrip('/')
    raw = payload.read_bytes()
    data = json.loads(gzip.decompress(raw) if payload.suffix == '.gz' else raw)
    segmentation_path = source / Path(recipes[entry['id']]['source']).parent / 'outs/segmented_outputs/cell_segmentations.geojson'
    segmentation = json.loads(segmentation_path.read_text())
    bounds = {}
    for feature in segmentation['features']:
        points = feature['geometry']['coordinates'][0]
        xs, ys = zip(*points)
        bounds[int(feature['properties']['cell_id'])] = min(xs), max(xs), min(ys), max(ys)
    del segmentation
    for spot in data['spots']:
        cell = int(re.search(r'cellid_(\d+)', spot['barcode'])[1])
        left, right, top, bottom = bounds[cell]
        x, y = spot['fullres_x'], spot['fullres_y']
        if not (left - 0.01 <= x <= right + 0.01 and top - 0.01 <= y <= bottom + 0.01):
            raise ValueError(f"{entry['id']}: center outside source segmentation bounds for {spot['barcode']}")
    scale_path = segmentation_path.parent / 'spatial/scalefactors_json.json'
    scale = json.loads(scale_path.read_text())['tissue_hires_scalef']
    for spot in data['spots']:
        if abs(spot['x'] - spot['fullres_x'] * scale) > 1e-6 or abs(spot['y'] - spot['fullres_y'] * scale) > 1e-6:
            raise ValueError(f"{entry['id']}: image scale mismatch")
    print(json.dumps({'dataset': entry['id'], 'source_segmentation_bounds_checked': len(data['spots']), 'hires_scale': scale}), flush=True)
