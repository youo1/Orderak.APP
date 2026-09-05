---
status: current
generated: false
owner: backend
last_verified: 2026-09-04
applies_to: [production, staging]
---
# Orderak Design System — reference

The reference for every visual decision in Orderak: what the tokens are and
how to choose between them. Generated from the brand seed `#014D4E` and
validated at generation; `orderak-tokens.css` is the machine-readable form of
everything below, and is the value that actually ships.

For how the system is generated, versioned, served and recovered, see the
design system domain, which is authoritative for that.

This document is self-sufficient: a developer who was not part of the design
conversation can work from it alone.

## The rule for every future screen

1. Check this system first.
2. Reuse existing tokens, components and patterns.
3. Never invent a colour, spacing value, type size, radius, duration or shadow.
   A literal outside `orderak-tokens.css` is a bug.
4. If something genuinely is missing, add it **at the system level** — a token,
   a component variant, a documented pattern — never a one-off inside a screen.
   Record the addition here.
5. Implement the screen from those parts.
6. Run the consistency check at the end of this document.

## Retired legacy — do not reintroduce

| Retired | Replacement |
| --- | --- |
| `--primary: #006A62` and the pre-generator seed | the generated Dark Teal scheme |
| `font-family: Inter` | Cairo, on every surface including admin |
| `.spinner` + `@keyframes spin` | `.ork-spinner` (honours reduced motion) |

Confirmed by the product owner, 2026-09-04. Existing screens that conflict get
rebuilt on these tokens, not patched.

## Type scale

Cairo, one family for both scripts. Fifteen Material 3 roles. Weight is 400 or
500 — there is no bold display type in this product.

| Role | Size | Line height | Weight | Tracking |
| --- | --- | --- | --- | --- |
| `display-large` | 3.5625rem | 4rem | 400 | `-0.0044em` |
| `display-medium` | 2.8125rem | 3.25rem | 400 | `0em` |
| `display-small` | 2.25rem | 2.75rem | 400 | `0em` |
| `headline-large` | 2rem | 2.5rem | 400 | `0em` |
| `headline-medium` | 1.75rem | 2.25rem | 400 | `0em` |
| `headline-small` | 1.5rem | 2rem | 400 | `0em` |
| `title-large` | 1.375rem | 1.75rem | 400 | `0em` |
| `title-medium` | 1rem | 1.5rem | 500 | `0.0094em` |
| `title-small` | 0.875rem | 1.25rem | 500 | `0.0071em` |
| `body-large` | 1rem | 1.5rem | 400 | `0.0313em` |
| `body-medium` | 0.875rem | 1.25rem | 400 | `0.0179em` |
| `body-small` | 0.75rem | 1rem | 400 | `0.0333em` |
| `label-large` | 0.875rem | 1.25rem | 500 | `0.0071em` |
| `label-medium` | 0.75rem | 1rem | 500 | `0.0417em` |
| `label-small` | 0.6875rem | 1rem | 500 | `0.0455em` |

Utility classes: `.ork-display-large` … `.ork-label-small`, one per element.
Never mix one role's size with another's weight.

**Two system-level rules that make Cairo work**, rather than changing the font:

- **Tabular figures** on every number in a column, a total or a counted pair —
  `.ork-numeric`, or `.ork-numeric-pair` when it must also stay LTR inside
  Arabic (`14 / 20` reorders otherwise). Cairo's lining figures are
  proportional and shift column to column without this.
- **12px floor for Latin text** a user must read. `labelSmall` (11px) is fine in
  Arabic and marginal in Latin; use it for glanceable chips only.

## Colour

One seed, generated into a full Material 3 scheme at three contrast levels in
light and dark — 264 contrast pairs, zero failures. Primary is pinned to HCT
tone 29.1 so the published brand colour and the primary action colour are the
same colour.

Above the M3 scheme sits a semantic layer, **one meaning per role and one role
per meaning**: success, warning, danger, info, commerce (anything monetary),
neutral. Two hard rules:

- **Brand colour never signals status.** A paid order is `success`, not teal.
- **Colour is never the only signal.** Every soft semantic container carries a
  container outline *and* an icon, because a tone-90 container on a tone-98
  surface separates by hue alone — invisible to a colour-blind seller and to
  anyone holding a phone in direct sun. There is a greyscale screenshot test.

Dark mode is the same token names under `.orderak-dark`.

## Spacing

4dp base, deliberately gappy: 0, 4, 8, 12, 16, 24, 32, 40, 48, 64. There is no
space5, space7, space9 or space11 — a value off the scale is a mistake.

16dp screen padding and 16dp between blocks on the phone; 8dp inside a group.
**48dp minimum touch target everywhere**, including the public storefront.

## Shape and elevation

Radii 4 / 8 / 12 / 16 / 24 plus full pills. Chips and buttons at 8, cards and
list rows at 12–16, modals at 18–24.

The phone app has **no shadows** — surfaces separate by tone
(`surfaceContainerLowest` → `surfaceContainerHighest`) and 1px outlines. Web
surfaces use exactly five: card, raised-on-hover, storefront, modal, overlay.
Do not add a sixth.

## Motion

Short and unremarkable: a seller is working, not being entertained. 150ms for
hover and colour, 180ms for the sidebar slide, 200ms for switches and drawers.
M3 standard easing curves. Nothing bounces, nothing springs, nothing has an
entrance animation. One keyframe animation exists in the product — the spinner.
`prefers-reduced-motion` zeroes every duration token.

## Interactive states

Material 3 **state layers**: a translucent overlay of the content colour over
the container, where the opacity carries the state. Hover 8%, focus 10%,
pressed 10%, dragged 16%, selected 12%. One set of numbers covers every
component, so nothing invents its own hover colour. `.ork-interactive` applies
them to any element.

- **Focus is always visible** — a 3px ring at 2px offset, applied globally.
  Never `outline: none`. This is the one rule with no exceptions.
- **Disabled** is opacity plus `not-allowed`, never a different colour.
- **There is no press-shrink.** Compose ripple owns press on the phone; the web
  simply drops the hover lift.

## Layout

Three regimes that do not share a grid, because they do not share a device.

| Regime | Rule |
| --- | --- |
| Phone (seller) | one column, 16dp gutters, no breakpoints — one column at every size |
| Storefront (buyer) | one 520px column, centred, 16px padding. Never widen it. |
| Admin (staff) | 268px rail + fluid content capped at 1560px; breakpoints 1240 / 860 / 600 |

Ready-made classes: `.ork-page`, `.ork-grid-metric` (4 → 2 → 1 up),
`.ork-grid-panel` (2 → 1 up).

## Iconography

- **Phone:** `androidx…Icons.Outlined.*` (Material Symbols Outlined). One filled
  exception: the selected bottom-navigation surface. 14dp in chips, 20dp in
  banners, 24dp in navigation.
- **Admin:** `lucide-react`, 16–19px.
- **Storefront:** no icons at all — emoji stand in, so the public page has no
  font dependency to download.
- **Emoji are copy, not iconography.** Business categories, the dashboard
  greeting, share text and the storefront's 🛍️ placeholder. Never an interface
  glyph.

Never substitute a hand-drawn SVG or an emoji for a UI icon.

## Content

Plain, second person, present tense, and it always tells the seller what happens
to *their data*. A shopkeeper's tool, not a SaaS dashboard.

- **"You", never "we"** — except when Orderak is doing the acting.
- **Every failure names the remedy and reassures about data.** "Couldn't refresh
  plan settings. Using the last saved settings." / "Your existing categories are
  unaffected." / "Nothing was lost."
- **Empty states carry the next step, not sympathy.** "No orders yet — tap ➕ and
  log your first chat order."
- **Sentence case** for body, guidance and buttons. UPPERCASE eyebrows in admin
  at .13em tracking: `ADMIN CONTROL CENTER`, `AUDITED ACTION`, `RECORD DETAIL`.
- **Optional is marked, required is not** — "Description (optional)"; admin
  required fields take a trailing " *".
- **Money** is always minor units server-side, always formatted for the locale
  on screen, always prefixed with the currency word: "EGP 480.00".

## Localization

en / ar / fr ship together, and Arabic is the primary market, not a translation
layer. `values-ar/strings.xml` is the largest of the three and the copy is
Egyptian colloquial.

- **No hard-coded direction.** Logical properties only; every layout mirrors.
- Directional icons auto-mirror; brand marks and media controls do not.
- Force LTR on numeric runs (`.ork-numeric-pair`).
- Design for French expansion — it runs ~20% longer than English.

## Accessibility

Every colour pair contrast-validated at generation. Colour is never the only
signal. 48dp minimum target, generator-enforced. Focus always visible.
`prefers-reduced-motion` honoured system-wide.

## Consistency check

Run this against any screen before calling it done.

- Every colour resolves to a token. No literal hex outside the token file.
- Every spacing value is on the scale. No 5, 7, 9, 11.
- Every text element uses one type role — no mixing sizes and weights across roles.
- Latin text a user must read is ≥12px. Numbers in columns, totals and pairs are tabular.
- Radii are from the shape set; shadows are one of the five, and only on web surfaces.
- Every tappable target is ≥48dp, including hit areas around small glyphs.
- Hover, focus, pressed and disabled all exist, and focus is visible.
- No status communicated by colour alone; no brand colour used as status.
- Layout mirrors, and numeric runs are LTR-isolated.
- Motion uses a duration token and survives reduced-motion.
- Empty, loading and error states exist, and each says what to do next.
