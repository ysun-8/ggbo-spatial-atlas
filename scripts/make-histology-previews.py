"""Write a small WebP preview next to each catalog histology image.

The viewer shows the preview while the full-resolution image loads.
Usage: python3 scripts/make-histology-previews.py [remote-asset-root]
Remote datasets (asset_base_url) are written under remote-asset-root, e.g. ../primary-gbm-spatial-data-host/public.
"""
import json
import sys
from pathlib import Path
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
MAX_SIDE = 2048
catalog = json.load(open('atlas/catalog.json'))
remote_root = Path(sys.argv[1]) if len(sys.argv) > 1 else None
for dataset in catalog['datasets']:
    root = Path('public')
    if dataset.get('asset_base_url'):
        if remote_root is None: continue
        root = remote_root
    for capture in dataset['captures']:
        source, target = root / capture['image'].lstrip('/'), root / capture['preview'].lstrip('/')
        if target.exists() and target.stat().st_mtime >= source.stat().st_mtime: continue
        image = Image.open(source).convert('RGB')
        image.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        image.save(target, 'WEBP', quality=85, method=6)
        print(f'{target}: {image.width}x{image.height}, {target.stat().st_size / 1e6:.2f} MB')
