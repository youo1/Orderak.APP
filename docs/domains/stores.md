---
status: current
generated: false
owner: backend
last_verified: 2026-08-21
applies_to: [production, staging]
authoritative_for: [stores-domain]
---
# Stores domain

How a store is named, addressed publicly, and found again after it is renamed.

The account behind the store is the [identity domain](./identity.md). Both live
in the `sellers` table; see
[One table, two meanings](./identity.md#one-table-two-meanings).

## Three identifiers, three jobs

A store carries three names, and confusing them is the most common mistake in
this area.

| Field | Mutable | Purpose |
| --- | --- | --- |
| `id` | Never | UUID primary key. Internal joins only; never shown to a buyer. |
| `store_code` | Never | Eight random characters. The stable half of the public address. |
| `slug` | **Yes** | Human-readable, seller-editable. The pretty half. |
| `public_identifier` | Recomputed | `{COUNTRY}-{slug}-{STORE_CODE}` — what a buyer sees. |

`buildPublicIdentifier(countryIso, slug, storeCode)` in
`services/backend/src/domains/identity/identity.ts` composes it, and
`storeUrl()` renders `https://orderak.app/{public_identifier}`.

The point of the arrangement: **a seller may rename their store without the old
link dying.** The slug changes, the store code does not, and resolution can
still find the store by its trailing code. Renaming is a product feature, not a
migration. The reasoning behind UUID-based public URLs is in
[ADR-003](../decisions/adr-003-uuid-public-urls.md).

### Store codes avoid ambiguous characters

`CODE_ALPHABET` is `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no `I`, `O`, `0` or
`1`. Codes get read aloud, written on receipts, and typed from memory, so the
characters that are confusable in those conditions are simply absent. Default
length is 8, and `uniqueStoreCode` retries until it finds a free one.

The same alphabet backs `newResourceCode("c" | "p")`, which produces
`c-XXXXXX` for categories and `p-XXXXXX` for products at length 6.

## Slugs

`slugify` lowercases, strips punctuation and joins on hyphens.
**`transliterate` maps Arabic to Latin first**, using an explicit character map
covering the Arabic alphabet plus Arabic-Indic digits `٠`–`٩`. A store named
`مطعم الشام` becomes a usable ASCII slug rather than a percent-encoded URL.
This is a first-class requirement, not a fallback — Arabic is the primary
language of the seller base.

`RESERVED_SLUGS` blocks 24 values that would collide with routes or conventions:
`api`, `admin`, `adminx`, `c`, `p`, `s`, `health`, `www`, `app`, `orderak`,
`static`, `assets`, `favicon`, `robots`, `sitemap`, `media`, `offers`,
`branches`, `tables`, `events`, `coupons`, `services`. Note that `c`, `p` and
`s` are reserved because they prefix resource codes.

`uniqueSlug` resolves collisions, `slugIsFree` accepts an `exceptStoreId` so a
store does not collide with itself on save, and `slugSuggestions` offers
alternatives when the requested one is taken.

Migration `007_fix_phone_slugs.sql` cleared legacy slugs made only of seven or
more digits — early accounts had phone numbers as public URLs.

## Resolution

`findStoreByIdentifier` tries three things in order, all `COLLATE NOCASE`:

1. Exact `public_identifier`.
2. The segment after the last `-`, matched against `store_code`. This is what
   keeps old links working after a rename.
3. `slug` or `store_code` matched directly.

Step 2 is the whole design paying off. A shared link containing a stale slug
still lands on the right store because the code at the end never changed.

## The public projection

`STORE_PUBLIC_COLUMNS` is an explicit column list, not `SELECT *`:

```text
id, store_code, country_code, store_name, slug, public_identifier, phone,
whatsapp, instapay, vfcash, description, email, website, address, logo_url,
cover_url
```

Every public store read goes through it. An allowlist means a column added to
`sellers` for internal use is **not** published by accident — the failure mode
of `SELECT *` on a table that also holds account state. Adding a column here is
a deliberate act; see the
[data classification](../architecture/data-classification.md) before doing it.

## Country

`countryIsoFromPhone` derives a country from the verified phone number: Egypt is
matched first on `201`/`010`/`011`/`012`/`015`, then twelve MENA dialling codes
(SA, AE, KW, QA, BH, OM, JO, LB, IQ, SY, YE, PS). Anything else returns `XX`,
and `normalizeCountryIso` coerces malformed input to `XX` rather than guessing.

This is Egypt-first with the region already modelled — matching the
Egypt-first, MENA-next posture in the
[architecture overview](../architecture/overview.md#market-portability).
**Recognising a country here does not make Orderak available there**; market
activation is a separate, governed decision.

## Public store pages

Public store, category and product pages are served by the public Worker at
`orderak.app/{public_identifier}` and resource paths under it. The route
handling is in `services/backend/src/domains/stores/api-store.ts` and the
landing page in `services/backend/src/landing.ts`.

Store creation lives here too: `api-store.ts` allocates the UUID, the store
code and the slug, then calls into identity to create the organization shell
atomically.

Store-count limits are checked **organization-wide**, not per store — the usage
query in `api-store.ts` counts stores across `organization_stores` for the
owning organization. A submitted mirror does not increase that usage.

## Boundaries

- **Products, categories and translations** are the catalog domain, not yet
  documented.
- **The account, its phone and its devices** are [identity](./identity.md).
- **Store-count entitlements** are [entitlements](./entitlements.md); this
  domain performs the count, that domain sets the limit.
- **Theme and branding** are the design-system domain, not yet documented.

## Related

- [ADR-003 — UUID public URLs](../decisions/adr-003-uuid-public-urls.md)
- [Identity domain](./identity.md)
- [Data classification](../architecture/data-classification.md)
- [Glossary](../reference/glossary.md) — `store_code`, `public_identifier`, `slug`
- [API reference](../reference/api.md)
