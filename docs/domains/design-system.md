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
  set that styles the Android app. Immutable revisions in D1.
- **The store theme** — a small set of seller-chosen colours that style that
  seller's public pages. Mutable, cached, per-installation.

## The design system

`services/backend/src/domains/design/design-system.ts`.

| Constant | Value | Meaning |
| --- | --- | --- |
| `DESIGN_SYSTEM_SCHEMA_VERSION` | `2` | Payload contract version |
| `DESIGN_SYSTEM_GENERATOR_VERSION` | `orderak-mcu-0.3.0+3` | Generator identity, recorded per revision |
| `MAX_PUBLIC_PAYLOAD_BYTES` | 128 KB | Ceiling on what a client may download |
| `MAX_REQUEST_BYTES` | 64 KB | Ceiling on an authoring request |
| `MAX_OVERRIDES` | 128 | Ceiling on manual role overrides |
| `FIRST_SCHEMA_V2_ANDROID_VERSION_CODE` | `2` | First client build that understands v2 |

The source describes intent, not pixels: a seed colour plus `SchemeVariant`,
`ContrastName` (`standard` / `medium` / `high`), `ThemeMode`,
`SurfaceTemperature` (`cool` / `neutral` / `warm`), `FontFamilyId` (`cairo`,
`tajawal`, `noto-arabic`), `DensityName`, and a `ShapePreset`. Tokens are
derived from that description; `RoleOverride` entries patch individual roles
afterwards, capped at 128.

All three font families are Arabic-first. That is the design constraint the
whole system is built around, not a localisation afterthought.

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

When a bad revision does reach production, use the
[design system recovery runbook](../runbooks/design-system-recovery.md), and
`pnpm run design-system:recovery-sql` in `services/backend` to generate the
statements.

## The store theme

`services/backend/src/domains/design/theme.ts` is much smaller and unrelated in
mechanism. `DEFAULT_THEME` plus saved overrides, merged by `mergeTheme`, with
`isHexColor` validating every value. It is cached at module level for about 60
seconds — Workers isolates keep that between requests — and `invalidateThemeCache()`
drops it after a save so the next render picks up new colours.

Cache invalidation is explicit rather than time-only because a seller who
changes their brand colour expects to see it immediately.

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

- **Token data itself** lives in `design/tokens.json` and
  `design/design-system.default.json` at the repository root, outside `docs/`.
- **How Android renders the tokens** is a platform concern; the Compose theme
  adapter is in
  `apps/seller-android/app/src/main/java/app/orderak/seller/core/ui/theme`.
- **Which locales and fonts are permitted** is the
  [localization architecture](../architecture/localization-architecture.md).
- **Publishing a revision** is an administrator operation in
  `domains/admin/admin-theme.ts`, part of the admin control plane.

## Related

- [Design system recovery runbook](../runbooks/design-system-recovery.md)
- [Localization architecture](../architecture/localization-architecture.md)
- [Architecture overview](../architecture/overview.md)
