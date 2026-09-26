"""Losslessly convert catalog HD images to WebP and verify every decoded pixel.
Run from a repository root with Pillow installed. Source PNGs are retained locally
in outputs/original-histology, and remain recoverable in Git history.
"""
import json
import shutil
from pathlib import Path
from PIL import Image

catalog_path = Path('atlas/catalog.json')
catalog = json.loads(catalog_path.read_text())
images = {capture['image'] for entry in catalog['datasets'] if entry['kind'] == 'hd' for capture in entry['captures']}
converted = {}
for image in sorted(images):
    source = Path('public') / image.lstrip('/')
    if source.suffix != '.png':
        continue
    destination = source.with_suffix('.webp')
    with Image.open(source) as original:
        original.save(destination, 'WEBP', lossless=True, method=6)
        with Image.open(destination) as decoded:
            assert original.size == decoded.size
            assert original.convert('RGBA').tobytes() == decoded.convert('RGBA').tobytes()
    if destination.stat().st_size >= source.stat().st_size:
        destination.unlink()
        continue
    converted[image] = '/' + str(destination.relative_to('public'))
    backup = Path('outputs/original-histology') / source.name
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, backup)
    print(f'{source.name}: {source.stat().st_size} -> {destination.stat().st_size} bytes; exact pixel match', flush=True)
    source.unlink()
for entry in catalog['datasets']:
    for capture in entry['captures']:
        capture['image'] = converted.get(capture['image'], capture['image'])
catalog_path.write_text(json.dumps(catalog, indent=2) + '\n')
