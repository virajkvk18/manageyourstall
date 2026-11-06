"""Regenerate the ManageYourStall (MYS) app icons: dist/icon-192.png and dist/icon-512.png.

Pink starburst sticker on sunny yellow with an italic "MYS" (ink outline + hard shadow).
The artwork stays inside the central safe zone so the same PNG works as a maskable icon.
Run: python make-icons.py   (needs Pillow; uses Arial Bold Italic from Windows fonts)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent / 'dist'
YELLOW, PINK, INK, PAPER = '#FFDD35', '#FF4D87', '#171717', '#FFF9ED'
FONT = 'C:/Windows/Fonts/arialbi.ttf'
S = 4  # supersampling factor for smooth edges

size = 512 * S
img = Image.new('RGB', (size, size), YELLOW)
d = ImageDraw.Draw(img)

# Starburst (same silhouette as the original stall icon), hard shadow first.
burst = [(65, 189), (148, 177), (152, 98), (227, 159), (311, 79), (323, 173), (428, 185), (362, 260),
         (431, 361), (325, 349), (288, 442), (224, 367), (113, 395), (129, 294), (65, 245)]
scale = 0.92
cx = cy = 256
pts = [((x - cx) * scale + cx, (y - cy) * scale + cy + 6) for x, y in burst]
d.polygon([((x + 14) * S, (y + 14) * S) for x, y in pts], fill=INK)
d.polygon([(x * S, y * S) for x, y in pts], fill=PINK, outline=INK, width=12 * S)

# "MYS" with hard shadow and ink outline.
font = ImageFont.truetype(FONT, 132 * S)
text_xy = (252 * S, 262 * S)
d.text((text_xy[0] + 9 * S, text_xy[1] + 9 * S), 'MYS', font=font, anchor='mm', fill=INK, stroke_width=7 * S, stroke_fill=INK)
d.text(text_xy, 'MYS', font=font, anchor='mm', fill=PAPER, stroke_width=7 * S, stroke_fill=INK)

for n in (192, 512):
    img.resize((n, n), Image.Resampling.LANCZOS).save(ROOT / f'icon-{n}.png', optimize=True)
print('Wrote', ROOT / 'icon-192.png', 'and', ROOT / 'icon-512.png')
