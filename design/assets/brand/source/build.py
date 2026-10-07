"""Build the final Orderak mark set (plan item B9, direction B, decision D-14).

Every colour is a generated design-system role (standard contrast, light scheme
unless named): primary #014D4E, onPrimary #FFFFFF, primaryContainer #B0EEEE,
onSurface #151D1E. Wordmarks are Cairo ExtraBold (wght 800), shaped by HarfBuzz
and outlined, so no file depends on a font being available.
"""
import io
import json
import os
import sys

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONTS, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

PRIMARY = "#014D4E"
ON_PRIMARY = "#FFFFFF"
PRIMARY_CONTAINER = "#B0EEEE"
ON_SURFACE = "#151D1E"

# ---- the mark, on its 120-unit grid, centred (bbox x 16..104, y 16.5..103.5) ----
BAG = ("M30 16.5H90A8 8 0 0 1 97.9 23.3L104 78.5A12 12 0 0 1 92 90.5H50L28 103.5L32 90.5H28"
       "A12 12 0 0 1 16 78.5L22.1 23.3A8 8 0 0 1 30 16.5Z")
# The smile, as a filled outline (radius 12..20 around 60,34.5, round ends of radius 4),
# so it can be cut out of the bag for the single-colour versions.
SMILE = "M40 34.5A20 20 0 0 0 80 34.5A4 4 0 0 0 72 34.5A12 12 0 0 1 48 34.5A4 4 0 0 0 40 34.5Z"
# Small-size cut (32 px and below): a heavier smile (radius 12..25, ends of 6.5).
SMILE_SMALL = "M35 36.5A25 25 0 0 0 85 36.5A6.5 6.5 0 0 0 72 36.5A12 12 0 0 1 48 36.5A6.5 6.5 0 0 0 35 36.5Z"
MARK_BOX = (16, 16.5, 104, 103.5)  # x0, y0, x1, y1 on the grid
MARK_H = MARK_BOX[3] - MARK_BOX[1]


def mark_group(bag, smile, small=False, transform=""):
    s = SMILE_SMALL if small else SMILE
    t = f' transform="{transform}"' if transform else ""
    return f'<g{t}><path d="{BAG}" fill="{bag}"/><path d="{s}" fill="{smile}"/></g>'


def mono_group(fill, small=False, transform=""):
    s = SMILE_SMALL if small else SMILE
    t = f' transform="{transform}"' if transform else ""
    return f'<g{t}><path d="{BAG}{s}" fill="{fill}" fill-rule="evenodd"/></g>'


def svg(w, h, body, label, view=None):
    view = view or f"0 0 {w} {h}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" width="{w}" height="{h}" '
            f'role="img" aria-label="{label}"><title>{label}</title>{body}</svg>\n')


def write(name, content):
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(content)


# ---- wordmarks ----
def load(path):
    font = TTFont(path)
    font.flavor = None
    static = instancer.instantiateVariableFont(font, {"wght": 800})
    buf = io.BytesIO()
    static.save(buf)
    return static, buf.getvalue()


def word(text, path, direction, script, lang):
    font, data = load(path)
    hbfont = hb.Font(hb.Face(data))
    buf = hb.Buffer()
    buf.add_str(text)
    buf.direction, buf.script, buf.language = direction, script, lang
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    gs, order = font.getGlyphSet(), font.getGlyphOrder()
    pen, bounds = SVGPathPen(gs), BoundsPen(gs)
    x = 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        m = (1, 0, 0, -1, x + pos.x_offset, -pos.y_offset)
        gs[order[info.codepoint]].draw(TransformPen(pen, m))
        gs[order[info.codepoint]].draw(TransformPen(bounds, m))
        x += pos.x_advance
    x0, y0, x1, y1 = bounds.bounds  # already in y-down space
    return {"d": pen.getCommands(), "box": (x0, y0, x1, y1)}


AR = word("أوردرك", f"{FONTS}/cairo-arabic-variable.woff2", "rtl", "Arab", "ar")
EN = word("Orderak", f"{FONTS}/cairo-latin-core-variable.woff2", "ltr", "Latn", "en")


def placed_word(w, size, x, y_center, fill):
    """Word scaled to font-size `size` (px per em), its ink box centred on y_center, left ink edge at x."""
    k = size / 1000
    x0, y0, x1, y1 = w["box"]
    tx = x - x0 * k
    ty = y_center - (y0 + y1) / 2 * k
    width = (x1 - x0) * k
    height = (y1 - y0) * k
    return f'<path transform="translate({tx:.2f} {ty:.2f}) scale({k:.5f})" d="{w["d"]}" fill="{fill}"/>', width, height


def mark_at(x, y, height, bag, smile, small=False):
    k = height / MARK_H
    tx = x - MARK_BOX[0] * k
    ty = y - MARK_BOX[1] * k
    return mark_group(bag, smile, small, f"translate({tx:.2f} {ty:.2f}) scale({k:.5f})"), (MARK_BOX[2] - MARK_BOX[0]) * k


# ---- 1. marks ----
write("orderak-mark.svg", svg(120, 120, mark_group(PRIMARY, ON_PRIMARY), "Orderak"))
write("orderak-mark-on-primary.svg", svg(120, 120, f'<rect width="120" height="120" fill="{PRIMARY}"/>' + mark_group(PRIMARY_CONTAINER, PRIMARY), "Orderak"))
write("orderak-mark-mono.svg", svg(120, 120, mono_group(ON_SURFACE), "Orderak"))
write("orderak-mark-mono-inverse.svg", svg(120, 120, mono_group(ON_PRIMARY), "Orderak"))
# Small-size cut: framed tight (2 units around the bag) so 16 px spends its pixels on the mark.
write("orderak-mark-small.svg", svg(92, 92, mark_group(PRIMARY, ON_PRIMARY, small=True), "Orderak", view="14 14 92 92"))

# ---- 2. lockups (all measurements in px at the file's own size) ----
CLEAR = 0.25  # clear space: a quarter of the mark's height, on every side


def lockup_ar(bag, smile, ink, name):
    mh = 72
    ar_ink = AR["box"][3] - AR["box"][1]
    size = mh / 0.8 * 1000 / ar_ink  # the mark is 0.8 of the word's full ink height (alef to descender)
    pad = CLEAR * mh
    p, ww, wh = placed_word(AR, size, 0, 0, ink)
    gap = 0.28 * mh
    w = pad + ww + gap + (MARK_BOX[2] - MARK_BOX[0]) * mh / MARK_H + pad
    h = pad + max(mh, wh) + pad
    yc = h / 2
    word_svg, _, _ = placed_word(AR, size, pad, yc, ink)
    m, mw = mark_at(pad + ww + gap, yc - mh / 2, mh, bag, smile)
    return svg(round(w), round(h), word_svg + m, "أوردرك")


def lockup_en(bag, smile, ink):
    mh = 72
    size = mh * 1000 / 900
    pad = CLEAR * mh
    m, mw = mark_at(pad, 0, mh, bag, smile)
    gap = 0.28 * mh
    _, ww, wh = placed_word(EN, size, 0, 0, ink)
    w = pad + mw + gap + ww + pad
    h = pad + max(mh, wh) + pad
    yc = h / 2
    m, _ = mark_at(pad, yc - mh / 2, mh, bag, smile)
    word_svg, _, _ = placed_word(EN, size, pad + mw + gap, yc, ink)
    return svg(round(w), round(h), m + word_svg, "Orderak")


write("orderak-lockup-ar.svg", lockup_ar(PRIMARY, ON_PRIMARY, PRIMARY, "ar"))
write("orderak-lockup-en.svg", lockup_en(PRIMARY, ON_PRIMARY, PRIMARY))


def stacked():
    """Storefront logo: the mark above أوردرك above Orderak, centred."""
    ar_size, en_size = 112, 64
    ar_w = (AR["box"][2] - AR["box"][0]) * ar_size / 1000
    mh = 0.45 * ar_w * MARK_H / (MARK_BOX[2] - MARK_BOX[0])  # mark width = 0.45 of the Arabic word
    pad = CLEAR * mh
    _, arw, arh = placed_word(AR, ar_size, 0, 0, PRIMARY)
    _, enw, enh = placed_word(EN, en_size, 0, 0, ON_SURFACE)
    mw = (MARK_BOX[2] - MARK_BOX[0]) * mh / MARK_H
    inner_w = max(mw, arw, enw)
    w = pad + inner_w + pad
    gap1, gap2 = 0.22 * mh, 0.16 * mh
    y = pad
    m, _ = mark_at((w - mw) / 2, y, mh, PRIMARY, ON_PRIMARY)
    y += mh + gap1
    ar_svg, _, _ = placed_word(AR, ar_size, (w - arw) / 2, y + arh / 2, PRIMARY)
    y += arh + gap2
    en_svg, _, _ = placed_word(EN, en_size, (w - enw) / 2, y + enh / 2, ON_SURFACE)
    y += enh + pad
    return svg(round(w), round(y), m + ar_svg + en_svg, "Orderak — أوردرك")


def horizontal():
    """Bilingual horizontal logo, Arabic first: mark on the right, أوردرك over Orderak, right-aligned to it."""
    mh = 96
    pad = CLEAR * mh
    ar_size, en_size = 84, 44
    _, arw, arh = placed_word(AR, ar_size, 0, 0, PRIMARY)
    _, enw, enh = placed_word(EN, en_size, 0, 0, ON_SURFACE)
    mw = (MARK_BOX[2] - MARK_BOX[0]) * mh / MARK_H
    gap, line_gap = 0.26 * mh, 0.12 * mh
    text_w = max(arw, enw)
    text_h = arh + line_gap + enh
    inner_h = max(mh, text_h)
    w = pad + text_w + gap + mw + pad
    h = pad + inner_h + pad
    top = pad + (inner_h - text_h) / 2
    right = pad + text_w
    ar_svg, _, _ = placed_word(AR, ar_size, right - arw, top + arh / 2, PRIMARY)
    en_svg, _, _ = placed_word(EN, en_size, right - enw, top + arh + line_gap + enh / 2, ON_SURFACE)
    m, _ = mark_at(right + gap, pad + (inner_h - mh) / 2, mh, PRIMARY, ON_PRIMARY)
    return svg(round(w), round(h), ar_svg + en_svg + m, "أوردرك — Orderak")


write("orderak-logo.svg", stacked())
write("orderak-logo-horizontal.svg", horizontal())

# ---- 3. favicon: the small cut, following the browser's colour scheme ----
DARK_PRIMARY, DARK_ON_PRIMARY = "#95D1D2", "#003738"  # schemes.standard.dark.primary / onPrimary
write("orderak-favicon.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 14 92 92" width="92" height="92">'
      '<style>.b{fill:' + PRIMARY + '}.s{fill:' + ON_PRIMARY + '}'
      '@media (prefers-color-scheme:dark){.b{fill:' + DARK_PRIMARY + '}.s{fill:' + DARK_ON_PRIMARY + '}}</style>'
      f'<path class="b" d="{BAG}"/><path class="s" d="{SMILE_SMALL}"/></svg>\n')


# ---- 4. Play feature graphic artwork (1024 x 500, rendered to PNG separately) ----
def feature_graphic():
    w, h = 1024, 500
    mh = 190
    ar_size, en_size = 150, 76
    _, arw, arh = placed_word(AR, ar_size, 0, 0, ON_PRIMARY)
    _, enw, enh = placed_word(EN, en_size, 0, 0, PRIMARY_CONTAINER)
    mw = (MARK_BOX[2] - MARK_BOX[0]) * mh / MARK_H
    gap, line_gap = 0.26 * mh, 0.14 * mh
    text_w, text_h = max(arw, enw), arh + line_gap + enh
    total = text_w + gap + mw
    left = (w - total) / 2
    right = left + text_w
    top = (h - text_h) / 2
    ar_svg, _, _ = placed_word(AR, ar_size, right - arw, top + arh / 2, ON_PRIMARY)
    en_svg, _, _ = placed_word(EN, en_size, right - enw, top + arh + line_gap + enh / 2, PRIMARY_CONTAINER)
    k = mh / MARK_H
    tx, ty = right + gap - MARK_BOX[0] * k, (h - mh) / 2 - MARK_BOX[1] * k
    mark = f'<path transform="translate({tx:.2f} {ty:.2f}) scale({k:.5f})" d="{BAG}{SMILE}" fill="{PRIMARY_CONTAINER}" fill-rule="evenodd"/>'
    return svg(w, h, f'<rect width="{w}" height="{h}" fill="{PRIMARY}"/>' + ar_svg + en_svg + mark, "أوردرك — Orderak")


write("play-feature-graphic.svg", feature_graphic())


# ---- 5. Android vector drawables ----
def vector(name, viewport, k, tx, ty, fill, comment):
    body = (f'<?xml version="1.0" encoding="utf-8"?>\n<!-- {comment} -->\n'
            f'<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
            f'    android:width="{viewport}dp"\n    android:height="{viewport}dp"\n'
            f'    android:viewportWidth="{viewport}"\n    android:viewportHeight="{viewport}">\n'
            f'    <group\n        android:scaleX="{k}"\n        android:scaleY="{k}"\n'
            f'        android:translateX="{tx}"\n        android:translateY="{ty}">\n'
            f'        <path\n            android:fillColor="{fill}"\n            android:fillType="evenOdd"\n'
            f'            android:pathData="{BAG}{SMILE}" />\n    </group>\n</vector>\n')
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(body)


# Adaptive icon: the mark is 0.47 of the 108 dp canvas (50.5 dp tall), centred, inside the 66 dp safe zone.
K = 0.58
T = round(54 - 60 * K, 2)
vector("ic_launcher_foreground.xml", 108, K, T, T, PRIMARY_CONTAINER,
       "Adaptive-icon foreground: the Orderak mark (plan item B9, direction B) in primaryContainer, the smile cut out so the primary background shows through. Generated from design/assets/brand; do not edit by hand.")
vector("ic_launcher_monochrome.xml", 108, K, T, T, ON_PRIMARY,
       "Themed-icon (Android 13+) layer: the mark as one silhouette with the smile cut out, tinted by the launcher. Generated from design/assets/brand; do not edit by hand.")
vector("ic_orderak_logo.xml", 120, 1, 0, 0, PRIMARY,
       "The Orderak mark on its 120-unit grid, one path with the smile cut out. Draw it tinted with MaterialTheme.colorScheme.primary so it follows light and dark. Generated from design/assets/brand; do not edit by hand.")

json.dump({"AR": AR["box"], "EN": EN["box"]}, open(os.path.join(OUT, "_boxes.json"), "w"))
print("written:", sorted(f for f in os.listdir(OUT) if f.endswith(".svg")))
