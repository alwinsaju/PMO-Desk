"""Draws the installer artwork (build/installer/*.bmp) in the look of the app: the dark
wallpaper's soft indigo / magenta / teal glows with the thin concentric rings, the PMO Desk
mark (public/brand/mark-dark.svg), and Figtree for the wordmark.

    python scripts/build-installer-art.py

The BMPs are committed, so packaging does not need Python or Pillow; run this only to change
the artwork. NSIS wants 24-bit BMPs: sidebar 164x314 (welcome / finish pages) and header
150x57 (the wizard's top band). Everything is drawn at 4x and scaled down for smooth edges.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build" / "installer"


def app_version() -> str:
    """The version printed on the welcome page: always package.json's, so it cannot go stale."""
    return json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]

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
    """The PMO Desk mark (public/brand/mark-dark.svg, the light tile for dark artwork):
    a "P" of three fading pills and a ring with a tick, redrawn here with the SVG's own
    coordinates (64-unit grid) because Pillow cannot read SVG."""
    s = SCALE
    px = int(round(size * s))
    k = 3  # supersampling of the mark itself
    big = px * k
    u = big / 64

    def box(x, y, w, h):
        return (x * u, y * u, (x + w) * u, (y + h) * u)

    mark = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    # Tile: a diagonal gradient (#a7ccc3 -> #7daba1) with the top sheen, clipped to the rounded square.
    grad = Image.new("RGBA", (big, big))
    gp = grad.load()
    c0, c1 = (167, 204, 195), (125, 171, 161)
    for y in range(big):
        for x in range(big):
            t = min(1.0, max(0.0, ((x / u - 8) * 48 + (y / u - 4) * 58) / (48 * 48 + 58 * 58)))
            sheen = max(0.0, 0.35 * (1 - (y / big) / 0.5))
            col = [c0[i] + (c1[i] - c0[i]) * t for i in range(3)]
            col = [col[i] + (255 - col[i]) * sheen for i in range(3)]
            gp[x, y] = (int(col[0]), int(col[1]), int(col[2]), 255)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=18 * u, fill=255)
    mark.paste(grad, (0, 0), mask)

    ink = (15, 39, 35)
    ring = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(ring)
    d.ellipse((26 * u, 16.5 * u, 48 * u, 38.5 * u), outline=(*ink, 255), width=int(round(4.5 * u)))
    tick = [(32.6, 27.8), (36.1, 31.3), (42.3, 24.1)]
    d.line([(x * u, y * u) for x, y in tick], fill=(*ink, 255), width=int(round(3.6 * u)), joint="curve")
    for x, y in (tick[0], tick[-1]):
        r = 1.8 * u
        d.ellipse((x * u - r, y * u - r, x * u + r, y * u + r), fill=(*ink, 255))
    mark.alpha_composite(ring)
    for y, opacity in ((14, 1.0), (27, 0.7), (40, 0.42)):
        pill = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        ImageDraw.Draw(pill).rounded_rectangle(box(12.5, y, 9, 11), radius=4.5 * u, fill=(*ink, int(255 * opacity)))
        mark.alpha_composite(pill)
    mark = mark.resize((px, px), Image.LANCZOS)

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    x0, y0 = int(left * s), int(top * s)
    ImageDraw.Draw(shadow).rounded_rectangle(
        (x0, y0 + 3 * s, x0 + px, y0 + px + 3 * s), radius=size * 0.28 * s, fill=(0, 0, 0, 120)
    )
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(5 * s)))
    canvas.alpha_composite(mark, (x0, y0))

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
    draw.text((20 * s, 226 * s), "PMO Desk", font=figtree(24, 800), fill=(*INK, 255), anchor="ls")
    small = figtree(10, 500)
    for i, line in enumerate(("You and a local AI,", "working side by side.")):
        draw.text((20 * s, (246 + i * 14) * s), line, font=small, fill=(*MUTED, 255), anchor="ls")
    draw.text((20 * s, 298 * s), f"Version {app_version()}", font=figtree(9, 600), fill=(*MUTED, 200), anchor="ls")
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
