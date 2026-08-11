# Implementation Report — Scalable, Secure, SEO-Friendly Store URLs

> **Historical implementation record.** Current behavior is defined by the code,
> `docs/api.md`, and `docs/app-plan.md`.

## Summary

Replaced Orderak's public store-URL system with a scalable, secure, SEO-friendly
scheme built on **UUID internal keys** and **immutable public codes**, and made
it future-ready for ERP modules and multi-country expansion.

```text
Store     https://orderak.app/EG-fresh-market-7KX9MP4R
Category  https://orderak.app/EG-fresh-market-7KX9MP4R/c/c-A82KD9
Product   https://orderak.app/EG-fresh-market-7KX9MP4R/p/p-H72LP9
```

Internal IDs and phone numbers never appear in a URL. Public URLs contain only
`country_code`, `slug`, and immutable codes.

---

## 1. What was changed

### Data model (D1 / SQLite) — `migrations/009_uuid_public_urls.sql`

- **UUID primary keys** for `sellers` (the Store entity), `products`, `orders`,
  `order_items`; every seller/product/order **foreign key** in `subscriptions`,
  `coupon_uses`, `referrals`, `payment_events`, `support_tickets`,
  `ad_impressions` remapped to UUIDs. Auxiliary billing/admin **ledger** tables
  keep their own integer PKs (never exposed, not part of store identity).
- New **`categories`** table (`id` UUID, `store_id` UUID FK, immutable
  `category_code`, `name`, `slug`, `sort_order`, timestamps).
- `products` gained `product_code` (immutable), `category_id` (UUID FK), `slug`,
  `description`, `updated_at`.
- `sellers` gained the Store Information fields (`description`, `whatsapp`,
  `email`, `website`, `address`, `logo_url`, `cover_url`, `updated_at`),
  `shop_name` → `store_name`, and every `store_code` **regenerated at 8 chars**.
- `orders` gained `order_no` (human display number) since the UUID id is opaque.
- Migration is **data-preserving** (table-rebuild with FK remap). The rebuilt
  tables intentionally omit DB-level `FOREIGN KEY` **constraints**: D1 enforces
  FKs and a PK-repointing rebuild can't satisfy them mid-migration. The UUID
  *relationships* are fully preserved in the columns; integrity is enforced in
  the app/query layer (every public lookup is scoped by store ownership).
  Verified with `foreign_keys=ON` (mirrors D1): row counts preserved,
  `PRAGMA foreign_key_check` clean.

### Deployment (production)

Applied to the live D1 (`orderak-db`) and deployed: **008 → 009 migrations run**
(4 stores / 3 products / 2 orders preserved, all now UUID-keyed with 8-char
codes), **Worker deployed** to all four custom domains. Live-verified: canonical
store pages with SEO, `/c/<id>` + bare-slug **301 redirects**, product/category
pages with ownership `404`s. A pre-migration backup was exported first.

### Backend (Cloudflare Worker — modular monolith)

- **`identity.ts`** (new) — single source of truth for identity: `newUuid`,
  `newStoreCode(8)`, `uniqueResourceCode` (`c-`/`p-`), `slugify` +
  **`transliterate`** (Arabic → Latin, NFKD accent folding), `buildPublicIdentifier`,
  `findStoreByIdentifier`, `RESERVED_SLUGS`.
- **`public-router.ts`** (new) — parses `/{pid}[/{module}/{code}]` via an
  **extensible resource registry** (`c`, `p`; future modules register one
  handler), validates **ownership**, and 301-redirects legacy `/c/<id>` and bare
  slug/store_code roots to the canonical URL.
- **`catalog.ts`** (new) — `renderStorePage` / `renderCategoryPage` /
  `renderProductPage` with a shared SEO `<head>` (title, description, canonical,
  OG, Twitter, robots) + JSON-LD on product pages. No phone/UUID in the HTML.
- **`api-store.ts`** (new) — `/api/register` (8-char code, onboarding country,
  `store_url`), `GET|PUT /api/store`, `/api/categories` CRUD, `/api/products/sync`
  (returns immutable codes), wired `slug.*` i18n.
- **`media.ts`** (new) — R2 image upload (`POST /api/media/upload`) + cached
  `GET /media/{key}` serving.
- `index.ts` slimmed to a thin router; `billing.ts` / `ads.ts` / `payments.ts`
  updated for string (UUID) seller ids — including a fixed self-referral guard
  that silently failed under `Number(uuid)` comparison.
- **Admin**: new read-only **Stores** panel listing store_code, public_identifier,
  country, clickable public URL (copy button), product/category counts, status.

### Android (Kotlin / Compose)

- **`Backend.kt`** — single URL choke point: `storeUrl` / `categoryUrl` /
  `productUrl` (new `/{pid}` scheme).
- **`SessionStore`** — persists `country_code` + all Store Information fields;
  exposes `countryIso` and a single `storeIdentifier` flow that replaced the
  `public_identifier ?: slug` logic duplicated across three ViewModels.
- **Room** — `ProductEntity` gained `productCode`/`remoteUuid`/`categoryId`/
  `categoryCode`; new `CategoryEntity` + `CategoryDao`; DB version bumped
  (destructive migration is the project's pilot-phase policy — server is truth).
- **`BackendApi`** — new DTOs/methods for store, categories, product-code sync,
  and multipart media upload (PUT/DELETE support added).
- **`SyncRepository`** — sends the onboarding country, persists returned product
  codes, pulls orders by `order_no`, reconciles stock by `product_code`.
- **UI** — new **Store Information** screen (editable fields + read-only identity
  block + Copy URL / Share Store), **Categories** management screen (create /
  rename / delete + per-category copy/share), a product→category picker in the
  product editor, and copy-to-clipboard + per-store/category/product sharing.
  Strings added in `ar` / `en` / `fr`.

### Tests

- Backend **Vitest** (27 passing): `identity.spec` (slug/transliteration/codes/
  public_identifier), `store.spec` (register mints UUID + 8-char code, rename
  keeps store_code, category CRUD, sync returns codes), `public-routes.spec`
  (pages render, ownership 404, legacy 301, SEO present, **no phone/UUID leak**).
- Android **JUnit** `BackendUrlTest` for the URL builders.

### Docs

- `docs/api.md` updated (URL scheme, new endpoints, 009 migration, redirects) and
  this report added.

---

## 2. Why

- **UUID PKs + immutable codes** decouple internal identity from public URLs, so
  renames never break shared links and no sequential/internal id is ever guessable
  or exposed (spec §1, §13).
- **Root-level `/{public_identifier}`** with a **resource registry** gives clean,
  SEO-friendly, future-proof routing: new ERP modules plug in without touching the
  router (spec §12, §14).
- **Ownership-validated lookups** prevent cross-store access (spec §12).
- **Transliteration** makes Arabic/French store names produce real slugs instead
  of empty/random ones (spec §4).
- **Modular split** (identity / routing / rendering / store-api / media) follows
  Clean Architecture + SOLID and keeps the Worker a single deployable (spec §16).

---

## 3. Breaking changes

- **Store URL moved** `/c/{pid}` → `/{pid}`; `/c/` now means *category*. Legacy
  links are **301-redirected**, so customers' saved links keep working.
- **All domain PKs/FKs are now UUID strings.** Any external integration reading
  integer ids breaks. The Android app must ship **together** with this backend —
  `/api/products/sync` and `/api/orders` response shapes changed (UUIDs +
  `order_no`, product codes).
- **`shop_name` → `store_name`** in schema/API (register still accepts `shop_name`).
- **`store_code` regenerated to 8 chars** (pre-launch decision — no live shared
  links existed).

---

## 4. Recommended follow-ups

1. **Rename the physical table `sellers` → `stores`** for full naming parity.
   Kept as `sellers` here to avoid destabilizing the security-critical
   auth/billing/admin/referral surface; all new store-facing code uses "store".
2. **Android App Links** to *receive* `orderak.app/{pid}` deep links (the app
   currently produces/shares links; inbound handling is not wired).
3. **`sitemap.xml` / `robots.txt`** generation and per-store custom domains for
   stronger SEO.
4. **Curated-alphabet backfill** for the codes generated inside migration 009
   (it uses hex — valid uppercase-alphanumeric, but new codes minted by the
   Worker use the unambiguous alphabet); harmonize if a single alphabet is desired.
5. **Android build/device verification**: the backend is fully test-verified; the
   Android module is code-complete but should be compiled (`./gradlew
   testDebugUnitTest assembleDebug`) and smoke-tested on a device, since this
   environment has no Android SDK.
