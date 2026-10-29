"""Draws the installer artwork (build/installer/*.bmp) in the look of the app: the dark
wallpaper's soft indigo / magenta / teal glows with the thin concentric rings, the teal "AI"
tile, and Figtree for the wordmark.

    python scripts/build-installer-art.py

The BMPs are committed, so packaging does not need Python or Pillow; run this only to change
the artwork. NSIS wants 24-bit BMPs: sidebar 164x314 (welcome / finish pages) and header
150x57 (the wizard's top band). Everything is drawn at 4x and scaled down for smooth edges.
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build" / "installer"
FONT_WOFF2 = (
    ROOT
    / "node_modules"
    / "@fontsource-variable"
    / "figtree"
    / "files"
    / "figtree-latin-wght-normal.woff2"
)

SCALE = 4
BASE = (10, 12, 22)
TEAL = (14, 119, 107)  # the app icon's tile
INK = (245, 247, 250)
MUTED = (170, 178, 196)


def figtree(size: int, weight: int) -> ImageFont.FreeTypeFont:
    """Figtree at a weight, converted from the bundled woff2 (needs fonttools + brotli)."""
    try:
        from fontTools.ttLib import TTFont

        font = TTFont(str(FONT_WOFF2))
        font.flavor = None
        buffer = io.BytesIO()
        font.save(buffer)
        buffer.seek(0)
        face = ImageFont.truetype(buffer, size * SCALE)
        face.set_variation_by_axes([weight])
        return face
    except Exception as error:  # fall back to the system UI font
        print(f"Figtree unavailable ({error}); using Segoe UI", file=sys.stderr)
        name = "segoeuib.ttf" if weight >= 600 else "segoeui.ttf"
        return ImageFont.truetype(name, size * SCALE)


def glow(canvas: Image.Image, centre: tuple[float, float], radius: float, colour, alpha: float):
    """A soft blurred blob, like the wallpaper's drifting glows."""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    x, y = centre[0] * SCALE, centre[1] * SCALE
    r = radius * SCALE
    ImageDraw.Draw(layer).ellipse((x - r, y - r, x + r, y + r), fill=(*colour, int(255 * alpha)))
    layer = layer.filter(ImageFilter.GaussianBlur(r * 0.55))
    canvas.alpha_composite(layer)


def rings(canvas: Image.Image, centre: tuple[float, float], radii, colour, alpha: float):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for radius in radii:
        x, y, r = centre[0] * SCALE, centre[1] * SCALE, radius * SCALE
        draw.ellipse((x - r, y - r, x + r, y + r), outline=(*colour, int(255 * alpha)), width=SCALE)
    canvas.alpha_composite(layer)


def tile(canvas: Image.Image, left: float, top: float, size: float):
    """The app icon: a rounded teal tile with a white "AI"."""
    draw = ImageDraw.Draw(canvas)
    s = SCALE
    box = (left * s, top * s, (left + size) * s, (top + size) * s)
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (box[0], box[1] + 3 * s, box[2], box[3] + 3 * s), radius=size * 0.3 * s, fill=(0, 0, 0, 120)
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(5 * s)))
    draw.rounded_rectangle(box, radius=size * 0.3 * s, fill=(*TEAL, 255))
    face = figtree(int(size * 0.46), 800)
    draw.text(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2 + s), "AI", font=face, fill=(255, 255, 255, 255), anchor="mm")


def finish(canvas: Image.Image, width: int, height: int) -> Image.Image:
    return canvas.convert("RGB").resize((width, height), Image.LANCZOS)


def sidebar() -> Image.Image:
    w, h = 164, 314
    canvas = Image.new("RGBA", (w * SCALE, h * SCALE), (*BASE, 255))
    glow(canvas, (20, 40), 120, (52, 48, 150), 0.85)
    glow(canvas, (170, 150), 100, (120, 38, 110), 0.55)
    glow(canvas, (60, 330), 130, (18, 120, 112), 0.8)
    rings(canvas, (190, 10), (60, 105, 150), (80, 200, 170), 0.22)
    tile(canvas, 20, 28, 56)

    draw = ImageDraw.Draw(canvas)
    s = SCALE
    draw.text((20 * s, 226 * s), "AI OS", font=figtree(30, 800), fill=(*INK, 255), anchor="ls")
    small = figtree(10, 500)
    for i, line in enumerate(("You and a local AI,", "working side by side.")):
        draw.text((20 * s, (246 + i * 14) * s), line, font=small, fill=(*MUTED, 255), anchor="ls")
    draw.text((20 * s, 298 * s), "Version 4.0", font=figtree(9, 600), fill=(*MUTED, 200), anchor="ls")
    return finish(canvas, w, h)


def header() -> Image.Image:
    w, h = 150, 57
    canvas = Image.new("RGBA", (w * SCALE, h * SCALE), (*BASE, 255))
    glow(canvas, (20, 10), 60, (52, 48, 150), 0.7)
    glow(canvas, (120, 70), 50, (18, 120, 112), 0.7)
    rings(canvas, (160, -10), (35, 62), (80, 200, 170), 0.2)
    tile(canvas, 98, 10, 36)
    return finish(canvas, w, h)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    sidebar().save(args.out / "sidebar.bmp", "BMP")
    header().save(args.out / "header.bmp", "BMP")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
