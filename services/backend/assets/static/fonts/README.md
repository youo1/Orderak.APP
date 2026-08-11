# Orderak self-hosted web fonts

These production assets are copied from the pinned Fontsource `5.3.0`
packages declared in `services/backend/package.json`:

- Cairo variable: Arabic and Latin subsets, weight range 200–1000.
- Tajawal: Arabic and Latin subsets at weights 400, 500, and 700.
- Noto Sans Arabic variable: Arabic and Latin subsets, weight range 100–900.

Each family is licensed under the SIL Open Font License 1.1. The corresponding
license text is stored beside the font files.

The generated theme stylesheet declares `font-display: swap` and script-aware
fallbacks. Metric overrides are derived from the packaged fonts with
`npm run fonts:metrics`; the measured source values are:

| Family | Units/em | Ascent | Descent | Line gap | x-height |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cairo | 1000 | 1303 | 571 | 0 | 500 |
| Tajawal | 1000 | 643 | 357 | 200 | 454 |
| Noto Sans Arabic | 1000 | 1374 | 738 | 0 | 536 |

Font files and licenses are immutable release assets. Updating a package or
font file requires regenerating the design-system fixture, rerunning visual
baselines, and preserving the applicable license attribution.
