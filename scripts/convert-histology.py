"""Convert one source PNG to lossless WebP; fail if any pixel differs."""
import sys
from PIL import Image
with Image.open(sys.argv[1]) as source:
    source.save(sys.argv[2], 'WEBP', lossless=True, method=6)
    with Image.open(sys.argv[2]) as decoded:
        if source.size != decoded.size or source.convert('RGBA').tobytes() != decoded.convert('RGBA').tobytes():
            raise ValueError('Lossless histology round trip failed')
