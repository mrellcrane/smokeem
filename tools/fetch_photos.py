"""Fetch the CC0 photo textures (Poly Haven) used by maps with `look.photo`.

Each set is a color map (1024 px) and an OpenGL normal map (512 px), saved as JPEG into
src/world/photos/. Run from the repo root:

    python3 tools/fetch_photos.py

Credits are written to src/world/photos/CREDITS.md. Needs Pillow.
"""
import io
import json
import urllib.request
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'src' / 'world' / 'photos'
# Poly Haven asset ids, keyed by the name the game loads them as.
ASSETS = {
    'dirt': 'dirt',
    'concrete': 'concrete_floor_worn_001',
    'planks': 'weathered_planks',
}
BASE = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k'


def fetch(url):
    # (The API turns away Python's default user agent.)
    req = urllib.request.Request(url, headers={'User-Agent': 'smokeem-fetch-photos/1.0'})
    with urllib.request.urlopen(req) as r:
        return r.read()


def save(data, path, size, quality):
    img = Image.open(io.BytesIO(data)).convert('RGB')
    if img.size[0] != size:
        img = img.resize((size, size), Image.LANCZOS)
    img.save(path, 'JPEG', quality=quality, optimize=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ['# Photo textures', '', 'CC0 (public domain) from Poly Haven, https://polyhaven.com. Fetched and resized by',
             '`tools/fetch_photos.py`.', '']
    for name, pid in ASSETS.items():
        save(fetch(f'{BASE}/{pid}/{pid}_diff_1k.jpg'), OUT / f'{name}.jpg', 1024, 82)
        save(fetch(f'{BASE}/{pid}/{pid}_nor_gl_1k.jpg'), OUT / f'{name}_n.jpg', 512, 88)
        info = json.loads(fetch(f'https://api.polyhaven.com/info/{pid}'))
        size = info.get('dimensions', [0])[0] / 1000
        authors = ', '.join(info.get('authors', {}).keys())
        lines.append(f'- `{name}`: "{info.get("name", pid)}" ({pid}), {size:g} m across, by {authors}.')
        print(name, pid, size)
    (OUT / 'CREDITS.md').write_text('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
