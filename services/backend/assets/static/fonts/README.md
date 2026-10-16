# Orderak self-hosted web fonts

Owner decision D-07 (2026-09-28): Cairo is the only approved web font family.
Retired families no longer ship; only the Cairo files and their license remain
in this directory.

These production assets are copied from the pinned Fontsource `5.3.0` package
declared in `services/backend/package.json`:

- Cairo variable: Arabic and Latin subsets, weight range 200–1000.

Cairo is licensed under the SIL Open Font License 1.1. The corresponding
license text is stored beside the font files.

The generated theme stylesheet declares `font-display: swap` and script-aware
fallbacks. Metric overrides are derived from the packaged font with
`node scripts/report-font-metrics.mjs` in `services/backend`; the measured
source values are:

| Family | Units/em | Ascent | Descent | Line gap | x-height |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cairo | 1000 | 1303 | 571 | 0 | 500 |

Font files and licenses are immutable release assets. Updating a package or
font file requires regenerating the design-system fixture, rerunning visual
baselines, and preserving the applicable license attribution.
