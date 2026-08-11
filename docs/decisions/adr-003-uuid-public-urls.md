# ADR-003: UUID primary keys with immutable public codes

**Status:** accepted

**Date:** 2026-07-10

**Supersedes:** none (this documents the migration from integer PKs in 009)

## Context

Orderak's original schema used integer autoincrement primary keys for sellers,
products, and orders. These keys leaked into public URLs (`/c/42` for a store),
which created several problems:

- **Security**: sequential IDs are guessable. A competitor or scraper can
  enumerate stores, products, and orders.
- **SEO**: numeric URLs convey no information. Search engines prefer
  descriptive, keyword-rich URLs.
- **Stability**: if a store renames, should the URL change? If yes, shared
  links break. If no, the slug in the URL becomes stale.
- **Future-proofing**: adding modules (offers, branches, etc.) requires a
  routing scheme that doesn't conflict with existing paths.

Alternatives evaluated:

1. **Keep integer PKs, use slugs only**: `/my-store` works for one store but
   collisions are hard to resolve at scale.
2. **Hash-based IDs** (e.g. NanoID): non-guessable but still opaque — no
   human-readable component.
3. **UUID PKs + immutable codes + mutable slugs**: internal UUIDs never
   appear in URLs; public-facing codes are permanent; slugs are human-friendly
   and can change.

## Decision

We will use:

- **UUID primary keys** internally for sellers, products, orders, and
  categories. They are never exposed in public URLs or HTML. The authenticated
  order-sync response still carries legacy `id` and `product_id` UUID fields;
  new public/client identity must use the immutable codes, and removing those
  legacy transport fields requires a versioned API migration.
- **Immutable public codes**: `store_code` (8 chars), `product_code`
  (`p-XXXXXX`), `category_code` (`c-XXXXXX`). These are the real public
  identity for each entity — they never change.
- **Mutable slugs**: human-readable, editable, and appended to store URLs
  for SEO. Changing a slug regenerates the `public_identifier` but the
  `store_code` stays the same, so previously shared links keep working via
  the code fallback.
- **Composite public identifier**: `{ISO2}-{slug}-{store_code}` (e.g.
  `EG-fresh-market-7KX9MP4R`). Store lookup resolves in this order:
  full identifier → `store_code` → legacy slug.

## Consequences

### Positive

- **No internal ID leak**: UUIDs are never exposed in any public surface.
  Public codes and server-side scoping make simple sequential enumeration
  materially harder, but rate limiting and authorization are still required.
- **Link stability**: shared links survive store renames because `store_code`
  never changes.
- **SEO**: URLs contain keywords (slug, country) and product codes are short
  and stable for product pages.
- **Extensible routing**: categories (`/c/`), products (`/p/`), and future
  modules register into a resource registry without changing the URL scheme.
- **Legacy compatibility**: old `/c/<id>` and bare slug URLs are 301-redirected
  to the canonical form.

### Negative

- **Migration complexity**: migration `009_uuid_public_urls.sql` had to
  rebuild every core table with UUID PKs and remap foreign keys across
  billing, referrals, ads, and support tables.
- **No DB-level foreign keys**: D1 enforces foreign keys, and a PK-repointing
  rebuild can't satisfy them mid-migration. Integrity is enforced in the
  application layer (every query scoped by store ownership).
- **Dual identity**: each entity has both a UUID (internal) and a code
  (public). Code must be generated on insert and never updated.

### Migration history

- Migration `008_store_codes` added `store_code`, `country_code`, and
  `public_identifier` to sellers with 6-char codes.
- Migration `009_uuid_public_urls` converted all PKs to UUIDs, added
  `categories`, `product_code`, `category_code`, regenerated `store_code`
  at 8 chars, and remapped all foreign keys.
- The full implementation record is retained in the unpublished repository
  history.

## Alternatives considered

| Alternative | Rejected because |
|------------|-----------------|
| Integer PKs only | Predictable, no SEO value, no link stability |
| Slug-only identifiers | Collision-prone at scale; no fallback for renames |
| Hash-based IDs (NanoID) | Opaque; no human-readable component for SEO |
