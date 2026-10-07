# The Orderak mark

The final artwork for plan item B9: direction B from the logo canvas, chosen by
the owner as decision D-14 on 28 September 2026 — a smiling shopping bag shaped
as a speech bubble, because Orderak is a shop that runs through conversations.
Every surface takes its mark from this folder; nothing redraws it.

## Geometry

The mark is drawn on a 120-unit grid and centred on it: the bag spans x 16–104
and y 16.5–103.5, with the speech-bubble tail at the lower left. The smile is a
filled outline (radius 12 to 20 around 60, 34.5, with round ends), so it can be
cut out of the bag wherever the mark is one colour.

The **small-size cut** (`svg/orderak-mark-small.svg`) has a heavier smile
(radius 12 to 25) and is framed 2 units around the bag instead of on the full
grid. It exists because at 16 px the master's smile is about one pixel wide and
disappears.

## Colour

Every colour is a role of the generated design system
(`design/design-system.default.json`, standard contrast); none is chosen here.

| Use | Bag | Smile |
| --- | --- | --- |
| On a light surface | primary `#014D4E` | onPrimary `#FFFFFF` |
| On a primary surface (app icon, store art) | primaryContainer `#B0EEEE` | cut out, the primary surface shows through |
| In a browser in dark mode (favicon only) | dark primary `#95D1D2` | dark onPrimary `#003738` |
| Single colour | onSurface `#151D1E`, or `#FFFFFF` on dark | cut out |
| Inside the Android app | tinted `colorScheme.primary` | cut out |

## Clear space and minimum size

- Keep clear space of **one quarter of the mark's height** on every side. The
  lockup files already include it.
- The master mark is never drawn smaller than **24 px** (24 dp). From 16 to
  32 px, use the small-size cut.
- A lockup's wordmark is never set below **16 px** cap height.
- Do not recolour the mark outside the table above, add a check or a badge,
  outline it, stretch it, or rotate it. Do not set the wordmark in another
  typeface: both wordmarks are Cairo ExtraBold (D-07), outlined, so the files
  render the same without the font.

## Files

| File | What it is | Used by |
| --- | --- | --- |
| `svg/orderak-mark.svg` | The master, light surfaces | Documentation, the design library |
| `svg/orderak-mark-small.svg` | Small-size cut, 16–32 px | Favicons |
| `svg/orderak-favicon.svg` | Small-size cut that follows the browser's colour scheme | `services/backend/assets/static/orderak-favicon.svg`, `apps/admin-web/public/favicon.svg` |
| `svg/orderak-mark-on-primary.svg` | The mark on a primary square | Store and social art |
| `svg/orderak-mark-mono.svg`, `svg/orderak-mark-mono-inverse.svg` | Single colour, dark and light | Print, embossing, one-colour contexts |
| `svg/orderak-lockup-ar.svg`, `svg/orderak-lockup-en.svg` | Mark with one wordmark | Arabic-only and Latin-only placements |
| `svg/orderak-logo.svg` | Stacked: the mark, أوردرك, Orderak | `services/backend/assets/static/orderak-logo.svg` |
| `svg/orderak-logo-horizontal.svg` | Arabic first: أوردرك over Orderak, the mark on the right | `services/backend/assets/static/orderak-logo-horizontal.svg` |
| `svg/play-feature-graphic.svg` | Source of the Play feature graphic | `png/play/play-feature-graphic.png` |
| `android/ic_launcher_foreground.xml`, `android/ic_launcher_monochrome.xml` | Adaptive and themed icon layers, the mark at 0.58 scale (50.5 dp of 108) inside the 66 dp safe zone | `app/src/main/res/drawable/` |
| `android/ic_orderak_logo.xml` | The mark as one path with the smile cut out, to be tinted | `app/src/main/res/drawable/` |
| `png/android/mipmap-*/ic_launcher.png`, `ic_launcher_round.png` | Launcher icons for Android 7 (API 24–25), which has no adaptive icons | `app/src/main/res/mipmap-*/` |
| `png/web/orderak-favicon-{16,32,48}.png`, `ico/orderak-favicon.ico` | Raster favicons for browsers without SVG favicons | `services/backend/assets/static/`, `services/backend/assets/favicon.ico` |
| `png/web/orderak-icon-180.png` | Apple touch icon, full bleed (iOS rounds the corners) | `services/backend/assets/static/` |
| `png/web/orderak-icon-{192,512}.png` | Web app icons, purpose `any` | `services/backend/assets/static/`, the Open Graph image |
| `png/web/orderak-icon-maskable-512.png` | Web app icon, purpose `maskable`; the mark sits inside the 80% safe circle | `services/backend/assets/static/` |
| `png/play/play-icon.png`, `png/play/play-feature-graphic.png` | Google Play listing art, 512×512 and 1024×500 | Owner action O-08 |

The launcher background colour is primary `#014D4E`.

## How these files were made

`source/` holds the scripts that produced every file here, for the next change
to the mark. Nothing in CI runs them.

- `build.py` writes the SVGs and the Android vector drawables. It needs Python
  with `fonttools`, `brotli` and `uharfbuzz`, and the Cairo fonts in
  `apps/admin-web/src/fonts`: the wordmarks are shaped by HarfBuzz, so the
  Arabic joins correctly, and then outlined.
- `raster.html` draws each raster variant; `render-all.ps1` screenshots it with
  headless Edge or Chrome at scale 1 on a transparent background, at every
  size listed above.
- `make-ico.mjs` packs the 16, 32 and 48 px PNGs into `orderak-favicon.ico`.
