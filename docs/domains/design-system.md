---
status: current
generated: false
owner: backend
last_verified: 2026-08-21
applies_to: [production, staging]
authoritative_for: [design-system-domain]
---
# Design system domain

How Orderak's visual language is generated, versioned, served, and recovered
when a bad revision ships.

Two separate mechanisms live here and are often confused:

- **The design system** — a generated, versioned Material Color Utilities token
  set. Immutable revisions in D1 are the colour source for the Worker's public
  pages: the landing page, the storefront catalogue (store, category, product)
  and the Terms and Privacy content pages. The admin panel reads the same
  emitted stylesheet. The Android app is not themed from D1: it compiles the
  generated token set into the build (`GeneratedDesignSystem.kt`).
- **The legacy theme module** — `theme.ts`, a 14-token `Theme` type with
  `DEFAULT_THEME`, `mergeTheme` and `isHexColor` helpers, retained as
  compatibility data alongside `design/tokens.json`. It is not the colour source
  for those public pages.

## The design system

`services/backend/src/domains/design/design-system.ts`.

| Constant | Value | Meaning |
| --- | --- | --- |
| `DESIGN_SYSTEM_SCHEMA_VERSION` | `3` | Payload contract version |
| `DESIGN_SYSTEM_GENERATOR_VERSION` | `orderak-mcu-0.3.0+4` | Generator identity, recorded per revision |
| `MAX_PUBLIC_PAYLOAD_BYTES` | 128 KB | Ceiling on what a client may download |
| `MAX_REQUEST_BYTES` | 64 KB | Ceiling on an authoring request |
| `FIRST_SCHEMA_V2_ANDROID_VERSION_CODE` | `2` | First client build that understands v2 |

The source describes intent, not pixels: a seed colour plus `SchemeVariant`,
`ContrastName` (`standard` / `medium` / `high`), `ThemeMode`,
`SurfaceTemperature` (`cool` / `neutral` / `warm`), `FontFamilyId`, `DensityName`,
and a `ShapePreset`. Tokens are derived from that description; colour comes only
from the seeds, so every emitted value has passed contrast validation.

`FontFamilyId` is `cairo` only. Owner decision D-07 (2026-09-28) retired every
other font family, and `generateDesignSystem()` rejects any other value with
`font_not_approved`. Cairo is the single Arabic-first family the system is
built around. `designSystemCss()` and `designSystemFontPreload()` always emit
and preload Cairo, even for a stored revision whose source and snapshot still
name a retired family; those stored revisions keep their persisted source,
snapshot, content hash and legacy projection unchanged.

### Revisions are immutable

`design_system_revisions` stores generated snapshots; `design_system_state` is a
single row pointing at `active_revision_id`.

Publishing writes a **new** revision and moves the pointer. Nothing is edited in
place, so every build that ever shipped can be reconstructed, and a rollback is
just another revision carrying `rollback_of_revision_id`. The history records
that a rollback happened rather than erasing the mistake.

Two guards are worth knowing:

- **A snapshot that fails validation is never served.** The loader throws when
  `snapshot.validation.valid` is false rather than serving a broken theme.
- **The activation write is conditional.** Seeding uses
  `UPDATE ... WHERE id = 1 AND active_revision_id IS NULL`, so two concurrent
  seeds cannot both claim the initial pointer — the same
  constraint-as-arbiter pattern used by
  [order numbers](./orders.md#order-numbers-and-the-race-that-shaped-them) and
  [entitlement counters](./entitlements.md#usage-reservation).

### Serving

`activeCache` holds the active revision in the Worker isolate with an expiry,
and the loader keeps the previous value as `lastKnownGood`. A failed refresh
falls back to the last good revision instead of failing the request — a
transient D1 problem must not unstyle the app.

`FIRST_SCHEMA_V2_ANDROID_VERSION_CODE` gates by client build, so older
installations keep receiving a payload they can parse.

The generated revision reaches its consumers by different routes, and only the
generated values can be declared authoritative in a stylesheet:

- **Android** compiles the token set into the build and keeps the generated map
  as its offline fallback. A published revision reaches the device only through
  a client build that understands it, which is what the version gate is for.
- **The Worker public pages** — landing, store, category, product, terms and
  privacy — read the active revision's standard-light roles directly through
  `pageThemeFromSnapshot()`: `primary` from `primary`, `primary_strong` from
  `onPrimaryContainer`, `primary_soft` from `primaryContainer`, `canvas` from
  `background`, `surface` from `surface`, `ink` from `onSurface`, `muted` from
  `onSurfaceVariant`, and `danger` from `error`. They do not read
  `revision.legacyTheme` and they have no dark-mode styling.
- **The admin panel** loads the revision as a live stylesheet from
  `/api/theme.css`, by way of the edge Worker's `/theme.css`. That stylesheet is
  unlayered and therefore outranks the flattened snapshot checked in beside the
  app; the snapshot is imported into the `@layer orderak-fallback` cascade layer
  so it can only ever fill gaps. Authority by stylesheet order is not authority —
  the bundler appends the application stylesheet last, which silently inverted
  this until `tooling/repository/verify-theme-authority.mjs` was added.

When a bad revision does reach production, use the
[design system recovery runbook](../runbooks/design-system-recovery.md), and
`pnpm run design-system:recovery-sql` in `services/backend` to generate the
statements.

## The legacy theme module

`services/backend/src/domains/design/theme.ts` is much smaller and unrelated in
mechanism. Its `Theme` type is the colour shape the public page renderers accept;
`pageThemeFromSnapshot()` produces a value of that shape from a generated
snapshot. `DEFAULT_THEME`, `mergeTheme` and `isHexColor` have no caller among
those pages — `mergeTheme` and `isHexColor` are retained compatibility helpers
for the persisted `theme_colors` setting, and `DEFAULT_THEME` is their compiled
fallback. `invalidateThemeCache()` is called by `admin-project.ts` after a
`theme_colors` save; it drops the cached generated revision by way of
`invalidateDesignSystemCache()`. Such a save changes nothing the public pages
render: they read the active revision's snapshot, and the `theme_colors`
setting is read only once, to seed the first revision when none exists.

The public `/api/v1/theme` response's `theme` field is **not** this module. It is
the `LegacyTheme` projection from `design-system.ts`, read from the stored
`legacy_projection_json` and exposed as `revision.legacyTheme` for older Android
builds. It is compatibility data; the generated `designSystem` field is the
current payload.

## The app screen manifest

`app-screen-manifest.ts` is a hand-maintained tree of the Android app's screens:
`name`, `description`, `android_route`, `sort_order`, and `parent_route`
forming the hierarchy Splash → Sign In → Shop Setup → Dashboard → tabs.

It is **generated from `navigation/Routes.kt`, `OrderakNavHost.kt` and the
MainScreen tabs, but committed by hand**, and it feeds the `app_screens` table
that the admin panel syncs against. Route keys are screen identities — renaming
one silently breaks that mapping. Change a route in the Android app and this
manifest in the same commit.

## Boundaries

- **Token data itself** lives in `design/design-system.default.json` at the
  repository root, outside `docs/`. `design/tokens.json` is retained
  compatibility data, not the active source.
- **How Android renders the tokens** is a platform concern; the Compose theme
  adapter is in
  `apps/seller-android/app/src/main/java/app/orderak/seller/core/ui/theme`.
- **Which locales and fonts are permitted** is the
  [localization architecture](../architecture/localization-architecture.md).
  Cairo is the only approved design-system font family.
- **Publishing a revision** is an administrator operation in
  `domains/admin/admin-theme.ts`, part of the admin control plane.

## Related

- [Design system recovery runbook](../runbooks/design-system-recovery.md)
- [Localization architecture](../architecture/localization-architecture.md)
- [Architecture overview](../architecture/overview.md)
