"""Deterministic derivatives; Pillow required. Never modifies the artist's original."""
from pathlib import Path
from math import hypot
import re
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / 'src/assets/branding/matu-art-official.png').convert('RGBA')
art = source.crop(source.getchannel('A').getbbox())  # Remove transparent padding only.
theme = (ROOT / 'src/styles/themes.css').read_text(encoding='utf-8')
pink = re.search(r'--cherry:\s*(#[0-9a-fA-F]{6})', theme).group(1)
out = ROOT / 'public/branding'
out.mkdir(exist_ok=True)

def render(size, maskable=False, favicon=False):
    # All artwork fits within the central 78%-diameter circle for maskable icons.
    scale = size * .78 / hypot(*art.size) if maskable else size * (.94 if favicon else .84) / max(art.size)
    image = art.resize(tuple(round(v * scale) for v in art.size), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size, size), pink)
    canvas.alpha_composite(image, ((size-image.width)//2, (size-image.height)//2))
    return canvas

for size in (16, 32, 48):
    render(size, favicon=True).save(out / f'favicon-v2-{size}.png')
render(48, favicon=True).save(out / 'favicon-v2.ico', sizes=[(16,16),(32,32),(48,48)], append_images=[render(16, favicon=True), render(32, favicon=True)])
for size in (192, 512):
    render(size).save(out / f'pwa-v2-{size}.png')
    render(size, maskable=True).save(out / f'pwa-maskable-v2-{size}.png')
render(180).save(out / 'apple-touch-v2-180.png')
print(f'Generated icons from original artwork; background {pink}')
