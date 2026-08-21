---
status: current
generated: false
owner: backend
last_verified: 2026-08-10
applies_to: [production, staging]
authoritative_for: [api-reference]
---
# Orderak API Notes

> **Status:** Pre-release v1 draft; there are no production clients or users
>
> **Last verified:** 2026-08-10 against `services/backend/src/` and `contracts/openapi/src/`

The Android app should call only the Cloudflare backend.

**Base URL (production):** `https://api.orderak.app`

Other hostnames served by the same Worker:

| Hostname | Purpose |
| -------- | ------- |
| `https://api.orderak.app` | Android app + web API (`/api/v1/*`) |
| `https://orderak.app` | Public marketing landing page (`/`) + store/category/product pages (`/<public_identifier>`) + media (`/media/*`) |
| `https://admin.orderak.app` | Admin dashboard (panel at the root `/`) |

> **Admin access note:** `https://admin.orderak.app/` is the only canonical
> admin URL. There is no embedded `/admin` or localhost fallback. Local Vite
> development is for engineering verification only.

## API Versioning

This repository is still pre-release. `/api/v1/*` is being established as the
first clean Seller/Android production contract; it is not an alias for an older
surface. Admin uses `/api/admin/v1/*`, and external callbacks use
`/api/integrations/v1/*`. Unversioned Seller JSON routes and `/api/v2/*` return
`404` without redirects or compatibility responses.

OpenAPI 3.1.2 under `contracts/openapi/src/` is authoritative. All operations are currently
`x-stability: draft`, so breaking changes are allowed with a changelog entry
until the Release Candidate gate. Once marked `stable`, oasdiff blocks breaking
changes. See the [compatibility contract](../contracts/api-compatibility-contract.md)
and [OpenAPI development guide](../guides/openapi-development.md).

Android sends a fresh opaque `X-Request-ID`; every JSON response returns one.
It is non-authenticating and distinct from `Idempotency-Key`.

Worker-generated `405 Method Not Allowed` responses include the RFC 9110
`Allow` header for the matched resource. Cloudflare rejects `TRACE` before it
reaches the Worker, so that edge-generated response is outside the JSON error
and request-correlation contract.

Public and admin Workers reject oversized bodies before route parsing. JSON is
limited to 256 KiB, multipart/form bodies to 6 MiB, and other request bodies to
512 KiB. Rejected requests return HTTP `413`. Inbound routed email has a
separate 10 MiB MIME cap.

## Public Landing Page (Web)

The public marketing site is served at the root of the public host:

```http
GET /
```

Returns the Orderak landing page (Arabic, RTL) with the product pitch, features,
"how it works" steps, pricing, and a call-to-action. The admin host keeps
serving its panel at `/`, and the API host is unaffected.

## Endpoints

### Generated design system

The public payload is additive: schema-v2 Android builds read `designSystem`,
while older builds continue reading the unchanged 14-token `theme` projection.
`compatibility.firstSchemaV2AndroidVersionCode` is `2`; legacy removal is gated
by the enforced minimum version and its effective date, not adoption percentage.

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/theme` | Public | Active schema-v2 snapshot, revision metadata, assets, and legacy `theme`; ETag plus 60-second CDN revalidation. |
| `GET` | `/api/theme.css` | Public | Stable 60-second lookup redirecting to the active hashed stylesheet. |
| `GET` | `/api/theme/:hash.css` | Public | Immutable CSS colors, RGB channels, OKLCH values, typography, spacing, shapes, constraints, and font declarations. |
| `GET` | `/api/admin/v1/theme` | `theme:view` | Active source/snapshot, defaults, validation, capabilities, and generator-upgrade comparison. |
| `POST` | `/api/admin/v1/theme/preview` | CSRF + `theme:view` | Non-persistent generation; `no-store`; 120/minute with a 20-request burst. |
| `PUT` | `/api/admin/v1/theme` | CSRF + `theme:manage` | Validate, create an unnamed checkpoint, and atomically make it current against `baseRevisionId`; `422` validation or `409 revision_conflict`. |
| `GET` | `/api/admin/v1/theme/revisions` | `theme:view` | Newest-first history. `kind=saved\|checkpoint\|all`, `beforeRevisionId`, default limit 20, maximum 50; rows include `name` and `is_current`. |
| `PATCH` | `/api/admin/v1/theme/revisions/:id` | CSRF + `theme:manage` | Save or rename a checkpoint with a unique 1–80-character Unicode name; generated content and hash do not change. |
| `POST` | `/api/admin/v1/theme/revisions/:id/activate` | CSRF + `theme:manage` | Copy an inactive snapshot into a new higher-ID current checkpoint; five activation attempts/hour. |
| `POST` | `/api/admin/v1/theme/revisions/:id/rollback` | CSRF + owner `theme:rollback` | Compatibility alias for activation. |
| `DELETE` | `/api/admin/v1/theme/revisions/:id` | CSRF + owner `theme:rollback` | Permanently delete an inactive checkpoint; current returns `409 active_revision_cannot_be_deleted`; ten attempts/hour. |

Preview and publish bodies are limited to 64KB and 128 justified overrides.
Override reasons are 12–240 trimmed characters. Required contrast failures
block activation in every mode/contrast variant. Names are optional mutable
metadata and are excluded from content hashes. `theme:manage` implies view;
rollback implies manage/view. Conflicts never permit force overwrite. Deletion
keeps audit metadata but not the removed configuration; a historical hashed CSS
URL returns `404` when no remaining published revision uses its hash.

### Auth and onboarding implementation (rollout-gated, API v1)

The production baseline keeps `ONBOARDING_ENABLED=false` and
`PASSKEY_ENABLED=false`. The legacy `/api/v1/auth/session` and `/api/v1/register`
contracts remain available for rollback. The modern auth implementation uses Firebase Phone OTP for account
creation and recovery, and WebAuthn Passkeys as an independent sign-in method
for returning sellers.

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/auth/phone/complete` | Fresh Firebase ID token + E.164 phone | Existing seller: issue the normal device session. New seller: issue a hash-only, rolling 30-minute onboarding token with a 24-hour absolute lifetime. |
| `POST` | `/api/v1/onboarding/account` | `Authorization: Bearer <onboarding_token>` | Save full name, required private birth year, and private optional email; snapshot the published Terms and Privacy versions shown when the user presses Next. |
| `GET` | `/api/v1/onboarding/slug/check?slug=…` | Onboarding token | Delayed availability check for the existing generated store slug. Android displays the resulting URL as read-only during onboarding. |
| `POST` | `/api/v1/onboarding/complete` | Onboarding token + matching app-generated `device_secret` + `Idempotency-Key` | Atomically create the seller, profile, store identity, organization, owner membership, route, device session, and legal acceptance. |
| `POST` | `/api/v1/auth/passkeys/registration/options` | Seller device headers + recent-auth token | Create discoverable registration options for RP ID `orderak.app`. |
| `POST` | `/api/v1/auth/passkeys/registration/complete` | Seller device headers + recent-auth token | Verify and store the public-key credential. |
| `POST` | `/api/v1/auth/passkeys/authentication/options` | None | Create discoverable authentication options. |
| `POST` | `/api/v1/auth/passkeys/authentication/complete` | Verified WebAuthn response + app-generated `device_secret` | Verify the assertion and issue a normal device session under the same device-limit policy as OTP. |
| `GET` | `/api/v1/auth/passkeys` | Seller device headers | List the seller's Passkeys without returning credential IDs or public keys. |
| `PATCH` | `/api/v1/auth/passkeys/{id}` | Seller device headers + recent-auth token | Rename a Passkey. |
| `DELETE` | `/api/v1/auth/passkeys/{id}` | Seller device headers + recent-auth token | Revoke a Passkey. |
| `POST` | `/api/v1/account/email/verification/resend` | Seller device headers + recent-auth token | Send a non-blocking, single-use email verification link; maximum three resends per hour. |
| `GET` | `/verify-email?token=…` | Single-use token | Verify the private account email. The email is not an account-recovery method in V2. |
| `GET` | `/api/v1/geo/cities?input=الق&language=ar` | Onboarding token; session/IP rate limits | Return at most ten static-catalogue city matches. The Worker derives the country from the verified onboarding session and ignores client country parameters. A blank `input` returns the most populated cities for the phone country. |
| `POST` | `/api/v1/geo/cities/select` | Onboarding token | Verify that `city_id` exists in the active pinned catalogue and belongs to the phone country, then persist its ID, dataset version, and display name in the onboarding session. |
| `GET` | `/api/v1/catalog/business-categories?language=fr` | Source-IP rate limit | Return the active global main-category version in Arabic, English, or French. Country/city parameters have no effect. |
| `GET` | `/api/v1/catalog/business-subcategories?category_id=…&query=…&language=fr` | Source-IP rate limit | Search one active category’s global subcategories; maximum 50 results. Undocumented query parameters are rejected with `400`. |
| `GET` | `/.well-known/assetlinks.json` | None | Serve the release/Play App Signing Digital Asset Links statement configured for the production Android package. |

Passkey registration requires `residentKey=required`,
`userVerification=required`, and `attestation=none`. Authentication requires
the UV flag. WebAuthn challenges are random, hash-only in D1, single-use, and
expire after five minutes. The Worker verifies the challenge, RP ID, configured
Android APK origin, and signature. It stores only the credential public key,
internal credential identifier, counter, AAGUID, transports, device type, and
backup state; biometric templates never reach Orderak.

Onboarding is server-authoritative. Android stores a debounced draft locally
and keeps the opaque onboarding token in encrypted preferences, but only a
successful idempotent `/api/v1/onboarding/complete` response establishes an
account and store. The optional private account email lives in
`seller_profiles.email_private`; it is excluded from Store DTOs and public
catalog pages. Public store contact email remains the separate `sellers.email`
field.

Phone completion accepts optional `phone_country_iso`; the Worker validates its
calling code against the Firebase-verified E.164 number before saving it. New
Android onboarding clients submit required `business_category_id`,
`city_catalog_id` (when a catalogue suggestion was selected), and `city_name`.
`business_subcategory_id` is optional for backward compatibility but is not
collected during onboarding. Sellers select or update it later through
authenticated Store Information settings. The legacy category/GeoNames fields
remain accepted for installed older clients and rollback. Neither path changes
store slug generation, eight-character `store_code`, `public_identifier`, or
URL routing.

`POST /api/v1/geo/cities/select` body:

```json
{
  "city_id": 31802,
  "language": "ar"
}
```

Search text and result lists are not persisted. Responses include visible
attribution for the Countries States Cities Database under ODbL-1.0. The
catalogue is stored in the isolated `orderak-geo` D1 database; account and
seller records remain in `orderak-db`.

`POST /api/v1/onboarding/account` accepts:

```json
{
  "full_name": "Ayman Seller",
  "birth_year": 1988,
  "email": "owner@example.com",
  "terms_accepted": true,
  "app_version": "2.0.0"
}
```

`birth_year` is required and must be a JSON integer from `1900` through the
current UTC year. Missing, string, fractional, pre-1900, and future values return
`400 {"error":"invalid_birth_year"}`. It is stored only in the private
onboarding/profile records and is excluded from Store DTOs, public pages,
transactional email variables, telemetry, and public contact data.

### Health Check

```http
GET /health
```

Response:

```json
{
  "ok": true,
  "service": "orderak-worker",
  "aiConfigured": true
}
```

`aiConfigured` is `true` when the `DEEPSEEK_API_KEY` secret is set, `false` otherwise.

### Chat / Order Assistant

**Launch state:** deferred. `AI_ASSISTANT_ENABLED` defaults to `false`. While
disabled, this route returns `503` with
`{"error":"feature_disabled","feature":"ai_assistant"}` before provider use.
Setting a provider key alone does not enable it.

```http
POST /api/v1/chat
Content-Type: application/json
x-orderak-phone: 01012345678
x-orderak-secret: device-uuid-secret
```

**Authenticated** (seller phone + secret headers). The AI proxy is never open to
the public — it costs money and would be abused. Requests are rate-limited to 20
per minute per seller and counted against the plan's `max_ai_requests_per_month`
(free = 20/month; `null` = unlimited).

Request:

```json
{
  "message": "I want chicken and rice"
}
```

Success response (AI configured):

```json
{
  "reply": "Great! One chicken and rice coming up. Anything to drink?",
  "aiConfigured": true
}
```

Provider unavailable, circuit open, missing budget/key, or exhausted budget:

```json
{ "error": "ai_temporarily_unavailable" }
```

This response is HTTP `503` with `Retry-After`. DeepSeek calls time out after
20 seconds, cap output at 512 tokens, and use the shared D1 circuit breaker.

Error responses:

| Status | Body | When |
| ------ | ---- | ---- |
| 401 | `{ "error": "auth" }` | Missing/invalid seller phone + secret |
| 405 | `{ "error": "method" }` | Not a POST |
| 429 | `{ "error": "rate_limited" }` | More than 20 requests/minute |
| 429 | `{ "error": "plan_limit_reached", "limit_key": "max_ai_requests_per_month", "limit": 20 }` | Monthly AI quota exceeded |
| 400 | `{ "error": "Invalid JSON body." }` | Body is not valid JSON |
| 400 | `{ "error": "Message is required." }` | `message` is missing or empty |
| 503 | `{ "error": "ai_temporarily_unavailable" }` + `Retry-After` | Provider timeout/failure, open circuit, missing budget configuration, or monthly budget exhausted |

### Register Seller

```http
POST /api/v1/register
Content-Type: application/json
```

Request:

```json
{
  "phone": "01012345678",
  "secret": "device-uuid-secret",
  "shop_name": "متجري",
  "slug": "my-store",
  "instapay": "01012345678",
  "vfcash": "01012345678",
  "id_token": "<firebase-id-token>"
}
```

**Creating a new store requires `id_token`** — a Firebase ID token for `phone`.
The backend verifies it via Google Identity Toolkit and rejects the request with
`401 auth` if the token is missing or its phone number doesn't match, so nobody
can claim a phone number they didn't pass OTP for. When the store already exists,
`id_token` is ignored and the matching device `secret` authorizes the update.
Before creating a new store, the same phone must have completed
`POST /api/v1/auth/session` with affirmative terms acceptance. This prevents a
client from bypassing the legal-consent step by calling registration directly.
`FIREBASE_WEB_API_KEY` must be set in production. If it is missing, registration
fails closed with `503 firebase_not_configured`; tests may explicitly set
`ALLOW_UNVERIFIED_REGISTRATION=true`. Registration has independent limits of 10
attempts/minute per phone and 100 attempts/minute per source IP.

`slug` and `country_iso` are optional. Rules:

- Every store has a structured **public identifier** used as its URL. The store
  page lives at the **root** of the identifier; categories and products nest
  under it:

  ```text
  Store     /<ISO2>-<slug>-<STORE_CODE>            e.g.  /EG-fresh-market-7KX9MP4R
  Category  /<public_identifier>/c/<category_code> e.g.  /EG-fresh-market-7KX9MP4R/c/c-A82KD9
  Product   /<public_identifier>/p/<product_code>  e.g.  /EG-fresh-market-7KX9MP4R/p/p-H72LP9
  ```

  | Part | Example | Editable | Notes |
  | ---- | ------- | -------- | ----- |
  | `id` (UUID) | `550e8400-…` | ❌ | Internal primary key. **Never** exposed in any URL. |
  | `country_code` (ISO2) | `EG` | rarely | From onboarding `country_iso`, else derived from the phone. |
  | `slug` | `fresh-market` | ✅ | Human-readable, from the store name (transliterated) or a manual pick. |
  | `store_code` | `7KX9MP4R` | ❌ | **Permanent, immutable** 8-char key — the store's real public identity. |
  | `public_identifier` | `EG-fresh-market-7KX9MP4R` | auto | Composed from ISO + slug + store_code. |

- The **`store_code` never changes.** When a seller edits their `store_name` /
  `slug`, the `public_identifier` is **regenerated** (new slug part) but the
  trailing `store_code` (and the internal UUID) stay the same — so **previously
  shared links keep working**.
- **Legacy `/c/<identifier>` store URLs are 301-redirected** to the canonical
  `/<public_identifier>`. A bare `slug` or `store_code` at the root also
  resolves and 301-redirects to the canonical form.
- **Ownership is validated**: a category/product only resolves when it belongs to
  the store named in the URL, otherwise `404`.
- Slugs are normalized to lowercase, `a-z 0-9 -`, min 3 chars (Arabic/accented
  names are transliterated first). Reserved words (`api`, `admin`, `c`, `p`,
  `media`, plus future module keys `offers`/`branches`/… ) are blocked.
- If `slug` is **omitted/blank**, the backend auto-generates a unique one from
  the shop name (adding `-2`, `-3`, ... or a short random suffix on collision),
  so registration never fails on a name clash.
- If the seller **typed** a `slug` that is already taken, the request is rejected
  with `409 slug_taken` plus a few free `suggestions`.
Response (new seller):

```json
{
  "ok": true,
  "store_name": "Fresh Market",
  "slug": "fresh-market",
  "store_code": "7KX9MP4R",
  "country_code": "EG",
  "public_identifier": "EG-fresh-market-7KX9MP4R",
  "store_url": "https://orderak.app/EG-fresh-market-7KX9MP4R"
}
```

### Store Information, Categories, Media (authenticated)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET`  | `/api/v1/store` | Read Store Information (editable fields + read-only identity block). |
| `PUT`  | `/api/v1/store` | Update store_name (regenerates slug/public_identifier, keeps store_code+UUID), slug, description, whatsapp, email, website, address, instapay, vfcash, logo_url, cover_url, and a validated `business_category_id` + `business_subcategory_id` pair. The verified login phone is read-only. |
| `GET`  | `/api/v1/categories` | List the store's categories (`category_code`, name, slug, product_count). |
| `POST` | `/api/v1/categories` | Create a category → returns immutable `category_code` (`c-XXXXXX`). |
| `PUT`  | `/api/v1/categories/{category_code}` | Rename / reorder (code is immutable). |
| `DELETE` | `/api/v1/categories/{category_code}` | Delete (products are un-linked). |
| `GET`  | `/api/v1/products` | Pull the store's full catalog (name, price, stock, codes, images, category). Non-destructive read — used by Android to seed a fresh local database before the first mirror push. |
| `POST` | `/api/v1/products/sync` | Mirror product metadata and explicitly reconcile stock by optimistic revision; returns public codes, UUID mapping, stock, and `stock_version`. |
| `POST` | `/api/v1/media/upload` | Multipart image upload to R2 → `{ url }`. Served publicly at `GET /media/{key}`. |

Auth is via `x-orderak-phone` + `x-orderak-secret` headers. Public URLs and
catalog operations use `public_identifier`, `category_code`, and
`product_code`, never internal UUIDs. The current authenticated order-sync
response still contains internal order and product UUID fields for legacy app
compatibility; they are private transport fields and must never be placed in a
URL, public HTML, analytics event, or support-facing identifier.

| Status | Body | When |
| ------ | ---- | ---- |
| 401 | `{ "error": "auth" }` | Phone + secret missing/mismatch |
| 409 | `{ "error": "slug_taken", "suggestions": ["my-store-2", "my-store-3", "my-store-x7k4"] }` | A **manually chosen** slug is already taken |
| 409 | `{ "error": "phone_change_requires_reverification" }` | A general profile update tried to change the OTP-verified login identity |

### Check Slug Availability

```http
GET /api/v1/slug/check?slug=my-store
```

Public (no auth). Intended for a "pick your link" UI that shows availability as
the seller types. (Not yet called by the Android app — registration currently
sends the chosen slug and the backend resolves collisions server-side.)

Response:

```json
{
  "ok": true,
  "slug": "my-store",
  "valid": true,
  "reserved": false,
  "available": true,
  "suggestions": []
}
```

- `valid` — long enough (≥3) and only allowed characters.
- `reserved` — the slug shadows a system route and can't be used.
- `available` — `valid` **and** not already taken.
- `suggestions` — up to 3 free alternatives, returned only when not available.

### Sync Products

```http
POST /api/v1/products/sync
Content-Type: application/json
```

Request:

```json
{
  "phone": "01012345678",
  "secret": "device-uuid-secret",
  "products": [
    { "app_id": 1, "name": "Pizza", "price": { "amount_minor": 15000, "currency": "EGP" }, "stock": 10, "available": true, "stock_dirty": true, "expected_stock_version": 4 },
    { "app_id": 2, "name": "Burger", "price": { "amount_minor": 8000, "currency": "EGP" }, "stock": 5, "available": true, "stock_dirty": false, "expected_stock_version": 9 }
  ]
}
```

`image_url` must be a public URL returned by `POST /api/v1/media/upload`, not a
local device path. The app uploads each product image once, caches the returned
URL, and sends it here.

Product quota enforcement is growth-aware. If a downgrade leaves a store over
its effective limit, an equal-size mirror update (editing existing products) or
a smaller mirror (deleting products) is accepted. A mirror that increases the
current count is rejected with `409 PLAN_LIMIT_REACHED` until the count is
below the limit. Existing product rows are never deleted by the policy engine.

Existing stock changes only when `stock_dirty=true` and
`expected_stock_version` matches. A stale explicit edit returns `409` with
RFC 9457 `code:"stale_stock"`, conflicted `app_id` values, and current product mappings;
the app rebases and retries. A routine mirror with `stock_dirty=false` cannot
overwrite stock consumed by public orders.

Response:

```json
{
  "ok": true,
  "count": 2,
  "products": [
    { "app_id": 1, "product_code": "p-H72LP9", "remote_uuid": "…", "stock": 10, "stock_version": 5, "category_code": null },
    { "app_id": 2, "product_code": "p-K91QD2", "remote_uuid": "…", "stock": 5, "stock_version": 9, "category_code": "c-A82KD9" }
  ]
}
```

Products not included in the list are **deleted** from the server (mirror sync).

### Fetch Orders

```http
GET /api/v1/orders?since=0
```

Auth is via headers only (credentials are never read from the query string, to
keep secrets out of access logs):

```http
x-orderak-phone: 01012345678
x-orderak-secret: device-uuid-secret
```

`since` is the last `order_no` the app has already stored (the sync cursor).
Responses contain at most 50 orders. Android continues with `next_since` while
`has_more=true`, so bursts larger than one page are not skipped.

Response:

```json
{
  "ok": true,
  "has_more": false,
  "next_since": 1,
  "orders": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "order_no": 1,
      "buyer_phone": "01112345678",
      "buyer_name": "Ahmed",
      "status": "NEW",
      "pay_method": "COD",
      "total": { "amount_minor": 15000, "currency": "EGP" },
      "note": null,
      "created_at": "2026-07-07 12:00:00",
      "items": [
        {
          "product_id": "…uuid…",
          "product_code": "p-H72LP9",
          "product_name": "Pizza",
          "qty": 1,
          "price": { "amount_minor": 15000, "currency": "EGP" }
        }
      ]
    }
  ]
}
```

Each item includes the immutable `product_code` so the app can match the line to
a local product and keep stock in step (`product_code` is `null` for a product
that has since been deleted server-side). The `id` and `product_id` fields are
legacy internal UUIDs returned by this authenticated endpoint only.

## Public Store Pages (Web)

Customers browse and order via SEO-friendly pages (title, description, canonical,
Open Graph, Twitter card; product pages add JSON-LD):

```http
GET /<public_identifier>                       # store page
GET /<public_identifier>/c/<category_code>     # category page
GET /<public_identifier>/p/<product_code>      # product page (shareable)
```

`<public_identifier>` is `<ISO2>-<slug>-<STORE_CODE>` (e.g.
`EG-fresh-market-7KX9MP4R`). Store lookup is **case-insensitive** and resolves in
this order: full `public_identifier` → trailing `store_code` → legacy `slug`, so
**links keep working even after the seller renames the store**. Categories and
products are resolved by their immutable code **and** store ownership (cross-store
access → `404`). Adding a future module (`/offers/<code>`, `/branches/<code>`, …)
only requires registering a handler — the routing shape never changes.

Legacy store URLs (`GET /c/<identifier>`) and bare `slug`/`store_code` roots are
**301-redirected** to the canonical `/<public_identifier>`.

```http
POST /<public_identifier>
Content-Type: application/json
```

Submits an order (items referenced by public `product_code`, never a UUID).

Request:

```json
{
  "items": [
    { "product_code": "p-H72LP9", "qty": 2 },
    { "product_code": "p-K91QD2", "qty": 1 }
  ],
  "buyer_phone": "01012345678",
  "buyer_name": "Ahmed",
  "note": "Street 5, Cairo",
  "pay_method": "COD"
}
```

Response:

```json
{
  "ok": true,
  "order_no": 1,
  "total": { "amount_minor": 23000, "currency": "EGP" },
  "contact_phone": "01012345678",
  "instapay": "01012345678",
  "vfcash": null
}
```

## AI Provider

The backend uses **DeepSeek** via its OpenAI-compatible Chat Completions API
(`https://api.deepseek.com/v1/chat/completions`, model `deepseek-chat`). This is the
first provider; routing to others can be added later.

Activation also requires a positive `AI_MONTHLY_BUDGET_MICRO_USD` and configured
input/output token rates. Usage rows are idempotent and organization-attributed;
alerts fire at 50%, 80%, and 100%, and new calls fail closed at 100%.

### Setting the API key

The key is stored as a **Cloudflare Worker secret** (never a var, never in Git):

```cmd
cd services/backend
npx wrangler secret put DEEPSEEK_API_KEY
```

Paste the key when prompted. For local `wrangler dev`, copy `.dev.vars.example`
to `.dev.vars` and put the key there (`.dev.vars` is git-ignored).

## Setting up D1 Database

See [`docs/guides/setup.md`](../guides/setup.md) for database provisioning and migration
instructions. Always use `npx wrangler d1 migrations apply` — never execute
individual migration files directly.

## Subscriptions, Plans & Billing

**Launch state:** free launch. `BILLING_ENABLED` defaults to `false` and controls
only sale visibility/new acquisition. `GOOGLE_PLAY_LIFECYCLE_ENABLED` separately
controls verification, RTDN, restore, reconciliation, and acknowledgement. While acquisition is
disabled, `/api/v1/plans`, `/api/v1/subscribe`, coupon endpoints, and referral
acquisition/statistics return non-retryable `403` with
`{"error":"feature_disabled","feature":"billing"}`. Subscription status,
cancellation, and signed payment webhook servicing remain available so a future
rollback cannot strand an existing payer. Enabling acquisition requires the
approval and evidence in [ADR-004](../decisions/adr-004-free-launch-billing.md).

While `GOOGLE_PLAY_LIFECYCLE_ENABLED` is disabled, verification, RTDN, and
verification-status routes likewise return non-retryable `403` responses. This
is a deliberate product-policy refusal, not a temporary service outage; clients
must not retry it until the corresponding launch flag changes.
Only `MockGateway` is implemented. `STRIPE_SECRET_KEY` is currently ignored;
paid launch requires a real approved gateway implementation and provider-native
webhook verification.

All money is an **integer amount in the currency's minor unit, plus the
currency**. Never floats, and never a bare integer on the wire:

```json
{ "amount_minor": 15000, "currency": "EGP" }
```

The number of minor units per major unit follows ISO 4217 and is not always 100.
`15000` is `150.00 EGP` but `15.000 KWD` — Kuwait, Bahrain and Oman use a
thousandth. Read the exponent from the currency (`Intl.NumberFormat` on the web
and in Workers, `java.util.Currency` on Android); never divide by a constant.

See [ADR-009](../decisions/adr-009-minor-units-with-explicit-currency.md).

### List Plans (public)

```http
GET /api/v1/plans
```

Returns the active plans with their feature lists:

```json
{
  "ok": true,
  "plans": [
    {
      "id": "free",
      "name": "Free",
      "price_minor": 0,
      "currency": "EGP",
      "interval": "monthly",
      "ads_enabled": 1,
      "features": [
        { "feature_key": "orders", "name": "Order taking", "description": "...", "enabled": 1 }
      ]
    },
    { "id": "starter", "name": "Starter", "price_minor": 9900, "ads_enabled": 0, "features": [] },
    { "id": "professional", "name": "Professional", "price_minor": 24900, "ads_enabled": 0, "features": [] }
  ]
}
```

### Subscribe to a Plan

```http
POST /api/v1/subscribe
Content-Type: application/json
x-idempotency-key: <unique-key-per-attempt>
```

```json
{
  "phone": "01012345678",
  "secret": "device-uuid-secret",
  "plan_id": "starter",
  "coupon_code": "WELCOME20"
}
```

- The **Free** plan activates instantly and indefinitely, no payment.
- Paid-plan acquisition is blocked while `BILLING_ENABLED=false`. In an
  approved non-production billing test, the only implemented gateway is
  `MockGateway`; setting `STRIPE_SECRET_KEY` does not select Stripe. A coupon,
  when valid in that test flow, reduces the simulated amount.
- Send an `x-idempotency-key` header so repeated taps don't double-charge.

Response (paid plan):

```json
{
  "ok": true,
  "status": "pending",
  "checkout_url": "https://pay.example/checkout/cs_test_123",
  "amount_minor": 7920,
  "discount_minor": 1980
}
```

### Subscription Status

```http
GET /api/v1/subscription/status
x-orderak-phone: 01012345678
x-orderak-secret: device-uuid-secret
```

```json
{
  "ok": true,
  "plan_id": "starter",
  "status": "active",
  "ads_enabled": false,
  "current_period_end": "2026-08-07 00:00:00",
  "referral_code": "AY3K9Q"
}
```

### Cancel Subscription

```http
POST /api/v1/cancel
Content-Type: application/json
```

```json
{ "phone": "01012345678", "secret": "device-uuid-secret" }
```

Cancels at the payment gateway and reverts the seller to the Free plan.

### Payment Webhook

```http
POST /api/v1/webhooks/payment
```

Called by the payment gateway. Verified using `PAYMENT_WEBHOOK_SECRET`. Updates
subscription status to `active` / `past_due` / `canceled`, and — on the first
successful paid payment of a referred seller — qualifies the referrer's
commission.

**Idempotency:** gateways retry webhooks, so the same event may arrive several
times. When the event carries a unique `eventId`, the backend records it in the
`webhook_events` table and **skips replays** (returns `{ ok: true, idempotent:
true }`). This prevents double-crediting referrals or duplicate status updates.

## Coupons

### Validate a Coupon

```http
POST /api/v1/coupons/validate
Content-Type: application/json
```

```json
{ "code": "WELCOME20", "plan_id": "starter" }
```

```json
{
  "ok": true,
  "valid": true,
  "discount_type": "percentage",
  "value": 20,
  "original_minor": 9900,
  "discount_minor": 1980,
  "final_minor": 7920
}
```

`/api/v1/coupons/apply` is the same validation but records the intended use for a
seller. Coupon endpoints are **rate-limited** per phone.

## Referral / Affiliate Program

Every seller gets a unique `referral_code` on first subscription lookup.

### Apply a Referral Code

```http
POST /api/v1/referral/apply
Content-Type: application/json
```

```json
{ "phone": "01012345678", "secret": "device-uuid-secret", "code": "AY3K9Q" }
```

The referred seller gets the configured bonus (discount/trial). The referrer's
commission is credited after the referred seller's **first paid payment**.

### Referral Stats

```http
GET /api/v1/referral/stats
x-orderak-phone: 01012345678
x-orderak-secret: device-uuid-secret
```

```json
{
  "ok": true,
  "referral_code": "AY3K9Q",
  "total_referred": 3,
  "qualified": 1,
  "pending_commission_minor": 5000,
  "paid_commission_minor": 0
}
```

## Ads (Android app)

### Get Active Ad

```http
GET /api/v1/ads/active
x-orderak-phone: 01012345678
x-orderak-secret: device-uuid-secret
```

Returns an ad **only for Free-plan sellers**. Paid plans get an empty payload.

```json
{
  "ok": true,
  "ad": {
    "id": 4,
    "type": "banner",
    "image_url": "https://cdn.example/ad.png",
    "click_url": "https://example.com",
    "frequency": 1
  }
}
```

Paid plan response: `{ "ok": true, "ad": null }`.

### Track Impression / Click

```http
POST /api/v1/ads/track
Content-Type: application/json
```

```json
{ "ad_id": 4, "kind": "impression" }
```

`kind` is `"impression"` or `"click"`.

## Admin Panel & API

A tiny web dashboard is served on its own hostname:

```text
https://admin.orderak.app
```

(For local development it's also reachable at `http://localhost:8787/admin`.)

## Android App Config Endpoint

```http
GET /api/v1/config
x-orderak-phone: <phone>
x-orderak-secret: <secret>
```

Returns the seller's current plan limits and feature flags:

```json
{
  "ok": true,
  "plan_id": "starter",
  "plan_name": "Starter",
  "ads_enabled": false,
  "limits": {
    "max_categories": 20,
    "max_products": 200,
    "max_orders_per_month": 500,
    "max_ai_requests_per_month": 200,
    "max_team_members": 1
  },
  "features": {
    "custom_domain": false,
    "analytics": true,
    "priority_support": false,
    "ai_assistant": true,
    "multi_device": true
  }
}
```

## Public Legal Pages

```http
GET /terms
GET /privacy
```

Serves the active content page for the requested slug, in the user's preferred
language (ar/en). Falls back to the other language if the preferred one has no
active version. If no active version exists in either language, returns 404.

### Admin authentication (multi-admin + RBAC + 2FA)

The panel uses **email + password login with optional TOTP 2FA**. The Worker
stores the signed session in an `HttpOnly`, `SameSite=Strict` cookie; browser
JavaScript cannot read or persist the session token.

Setup secrets:

```cmd
cd services/backend
npx wrangler secret put ADMIN_JWT_SECRET   # signs admin session tokens
npx wrangler secret put ADMIN_API_KEY      # one-time owner bootstrap key
```

Create the first owner (one-time, guarded by `ADMIN_API_KEY` via `x-admin-key`):

```http
POST /api/admin/v1/auth/bootstrap
x-admin-key: <ADMIN_API_KEY>
{ "email": "you@orderak.app", "password": "at-least-8-chars", "name": "Owner" }
```

Login flow:

- `POST /api/admin/v1/auth/login` `{email,password}` sets the HttpOnly session cookie, or returns
  `{mfa_required:true, mfa_token}` if 2FA is enabled.
- `POST /api/admin/v1/auth/mfa` `{mfa_token, code}` sets the session cookie.
- `GET /api/admin/v1/auth/me` → current admin + `permissions[]`.
- `POST /api/admin/v1/auth/logout`.
- 2FA enrollment: `POST /api/admin/v1/auth/totp/setup` → `{secret, otpauth_uri}` (show
  as QR), then `POST /api/admin/v1/auth/totp/verify` `{code}` to enable.

Password management:

- `POST /api/admin/v1/auth/password` `{current_password, new_password}` — a logged-in
  admin changes their **own** password. Requires the current password; a wrong
  one returns `403` (not `401`, so the panel shows the error instead of logging
  the user out). Available in the panel under **Settings → Change your password**.
- `POST /api/admin/v1/auth/password/reset` — **break-glass recovery** guarded by
  `x-admin-key: <ADMIN_API_KEY>` (the same key as bootstrap). Resets any admin's
  password by email without a manual database write:

  ```http
  POST /api/admin/v1/auth/password/reset
  x-admin-key: <ADMIN_API_KEY>
  { "email": "you@orderak.app", "new_password": "at-least-8-chars", "clear_totp": false }
  ```

  Pass `"clear_totp": true` to also disable 2FA when the authenticator is lost.
  Returns `404` if no admin has that email, `401` on a bad key.

**Roles (RBAC):** `owner` (all), `finance` (billing/coupons/payouts/plans),
`support` (sellers/support/announcements/content), `readonly` (view-only). Each
`/api/admin/v1/*` route checks a `<resource>:<action>` permission. `x-admin-key`
is accepted only by the break-glass endpoints (`bootstrap` and
`password/reset`), never as a normal session.

**i18n:** every endpoint accepts `?lang=ar|en` or an `x-lang` header; JSON error
responses include a localized `message` alongside the machine `error` code.

All admin API routes live under `/api/admin/v1/*` and require a valid session.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/api/admin/v1/auth/bootstrap` | Create the first owner (break-glass key) |
| POST | `/api/admin/v1/auth/login` | Email + password (may require MFA) |
| POST | `/api/admin/v1/auth/mfa` | Complete TOTP 2FA step |
| GET | `/api/admin/v1/auth/me` | Current admin + permissions |
| POST | `/api/admin/v1/auth/password` | Change your own password (needs current) |
| POST | `/api/admin/v1/auth/password/reset` | Break-glass reset by email (admin key) |
| GET / PUT | `/api/admin/v1/theme` | Read / update project-wide design tokens |
| POST | `/api/admin/v1/auth/totp/setup` and `/totp/verify` | Enroll and verify 2FA |
| GET | `/api/admin/v1/audit` | Recent audited admin actions |
| GET | `/api/admin/v1/errors` | Recent server-side errors |
| GET | `/api/admin/v1/stats` | Dashboard: active subscriptions, revenue, payouts |
| GET | `/api/admin/v1/stores` | Paginated seller/store list |
| GET / POST | `/api/admin/v1/plans` | List or create/update a plan and features |
| DELETE | `/api/admin/v1/plans/:id` | Disable a plan |
| GET / POST | `/api/admin/v1/coupons` | List or create/update a coupon |
| DELETE | `/api/admin/v1/coupons/:code` | Disable a coupon |
| GET / POST | `/api/admin/v1/affiliate` | Read or update affiliate settings |
| GET | `/api/admin/v1/referrals` | List referrals |
| POST | `/api/admin/v1/referrals/:id/pay` | Mark a commission paid |
| GET / POST | `/api/admin/v1/ads` | List or create/update an ad |
| DELETE | `/api/admin/v1/ads/:id` | Delete an ad |
| GET | `/api/admin/v1/overview` | Project-admin summary |
| GET / POST; PUT / DELETE by ID | `/api/admin/v1/roadmap`, `/api/admin/v1/tasks`, `/api/admin/v1/screens`, `/api/admin/v1/endpoints`, `/api/admin/v1/prompts`, `/api/admin/v1/design-assets`, `/api/admin/v1/releases`, `/api/admin/v1/bugs`, `/api/admin/v1/project-docs` | Manage project-admin records under resource-specific RBAC |
| POST | `/api/admin/v1/screens/sync` | Synchronize the compiled screen manifest |
| GET; PUT by key | `/api/admin/v1/settings` | Read or update project settings |
| GET / POST; PUT or activate by slug/language | `/api/admin/v1/content-pages` | Manage versioned Terms and Privacy content |
| GET | `/api/admin/v1/email-templates` | List templates and override state |
| GET / POST | `/api/admin/v1/email-templates/:key[/action]` | Read, edit, enable, preview, test, or inspect template history |
| GET | `/api/admin/v1/email-events?limit=50` | Recent application send attempts |
| GET | `/api/admin/v1/inbound-emails[/:id]` | List or read received messages |
| POST | `/api/admin/v1/inbound-emails/:id/read` | Mark a received message read |

**Theme (design tokens):** all project colors live in a 14-token WCAG AA
contrast-verified schema (`primary`, `primary_strong`, `primary_soft`,
`primary_tint`, `canvas`, `surface`, `ink`, `muted`, `line`, `danger`,
`danger_soft`, `warning`, `warning_soft`, `accent` — defaults in
`services/backend/src/domains/design/theme.ts`, mirrored in `design/tokens.json` and Android
`core/ui/theme/Color.kt`). Every text/icon-usable token passes ≥4.5:1 against
its assigned surface. The admin panel's
**Theme** tab edits them in one click; overrides persist in the `settings`
table (`theme_colors`) and immediately restyle the landing page, store
catalog pages, legal pages, and the panel itself. Clients (e.g. the Android
app) can read the live tokens from the public endpoint:

```http
GET /api/v1/theme
→ { "ok": true, "version": "<hash>", "theme": { "primary": "#1DAB61", ... },
    "assets": { "logo": "https://orderak.app/static/orderak-logo.svg", ... } }
```

The response is versioned for cheap polling: the `ETag` header is a content
hash of the config, so clients that send `If-None-Match` receive a bodyless
`304` when nothing changed (plus `Cache-Control: max-age=300`). The Android
app's `BrandingRepository` uses this: compiled defaults render instantly,
the last config is cached in DataStore, refreshes happen asynchronously and
apply silently, and brand assets re-download only when their content changes.

Reads require the `emails:view` permission, writes require `emails:manage`

(owner has both). Templates are edited per language (`ar` / `en`); an admin edit
is stored as an **override** in D1, and until one exists the code **seed** is
used — so email works before any edit and edits never need a redeploy.

## Transactional Email (Cloudflare Email Sending)

Outbound transactional email (password resets, order confirmations, login
alerts, invoices) is sent via **Cloudflare Email Sending** using the Workers
`send_email` binding (`env.EMAIL.send({...})`), wrapped by
`services/backend/src/integrations/email/providers/cloudflare.ts`. Mail is sent from `no-reply@orderak.app`
with `reply-to: support@orderak.app`.

Cloudflare reports delivery, defer, bounce, failure, rejection, and complaint
events in **Email Service → Observability**. Email Sending also supports
programmatic lifecycle event subscriptions; Orderak has not configured a
consumer for them. Orderak's `email_events` table therefore records application
send attempts (`sent`, `failed`, or `skipped_disabled`), not authoritative final
delivery state.

Requirements: Workers **Paid** plan and the `orderak.app` domain onboarded once
under **Compute → Email Service → Email Sending** (auto-adds SPF/DKIM/DMARC).
See `docs/guides/setup.md` → *Backend: Transactional Email*.

## Billing Secrets

| Secret | Purpose |
| ------ | ------- |
| `ADMIN_API_KEY` | Authorizes one-time creation of the first admin owner |
| `PAYMENT_WEBHOOK_SECRET` | Verifies incoming payment webhooks |
| `STRIPE_SECRET_KEY` | Reserved; currently ignored because no Stripe gateway is implemented |

Set each with `npx wrangler secret put <NAME>`. For local dev, add them to
`.dev.vars`.

## Database Migration Notes

Schema changes are documented in
[`docs/guides/database-migrations.md`](../guides/database-migrations.md)
with the exact SQL for every migration.

See [`docs/guides/setup.md`](../guides/setup.md) for how to apply migrations.

Selected highlights:

| Migration | What it added |
|-----------|--------------|
| 001 | Core schema: sellers, products, orders, order_items |
| 002 | Billing: plans, subscriptions, coupons, referrals, ads |
| 003 | Admin RBAC, 2FA, i18n, announcements, support tickets |
| 004 | Email templates, translations, history, events |
| 005 | Inbound email storage (Cloudflare Email Routing) |
| 006 | Webhook idempotency + error logging |
| 008 | Store codes, country codes, public identifiers |
| 009 | UUID PKs, immutable codes, categories, Store Information |
| 017 | Product translations cache |
| 020 | Translation lifecycle metadata (provenance, status, review) |

The historical UUID migration change log is retained in the unpublished
repository history.

## `POST /api/v1/auth/session`

Called after Firebase Phone OTP succeeds.

```json
{
  "id_token": "<firebase-id-token>",
  "phone": "+201001234567",
  "device_secret": "<random-device-secret>",
  "terms_accepted": true,
  "marketing_consent": false,
  "app_version": "1.0.0"
}
```

`terms_accepted` must be `true`; marketing consent is independent and optional.
After Firebase verification, the Worker snapshots the currently published
Terms and Privacy versions into the append-only `legal_acceptances` table,
including locale, source, app version, marketing choice, and timestamp. If no
published legal versions exist, it returns `503 legal_not_configured`; a missing
affirmative acceptance returns `400 legal_acceptance_required`.

The Worker verifies the Firebase ID token and requires its phone number to match
the requested phone. It returns
`exists:false` for a new seller, or `exists:true` plus the existing store and
authorizes the current device. Phone number alone is never enough to recover a
store: the Firebase OTP must succeed first. Returning to an already-authorized
device works on every plan. On a single-device plan, verified OTP recovery
replaces the previous device credential and logs all previous devices out; this
supports reinstall and phone-replacement recovery without enabling concurrent
devices. When `multi_device_enabled` is active, the verified device is added and
existing device credentials remain valid.
Plan changes are evaluated on every authenticated backend request, so disabling
multi-device access immediately blocks additional device credentials. Android
also refreshes `/api/v1/config` whenever foreground/manual/periodic sync runs.
The endpoint has independent limits of 10 attempts/minute per phone and 100
attempts/minute per source IP. Authentication failures never return raw Firebase
errors or tokens.

## Public catalog checkout

`POST /{public_identifier}` accepts buyer details and
`items:[{product_code,qty}]`. Clients send a stable `idempotency-key` header
(8–100 safe characters) for every logical checkout attempt. Reusing it returns
the original order; it never decrements stock twice.

A checkout accepts at most 50 line items, and every `product_code` may appear
only once. Larger carts or duplicate product codes return `400` before any
stock or order mutation.

The D1 order insert, all item inserts, and trigger-driven stock claims execute
as one batch. If any requested quantity is unavailable, the whole batch rolls
back and returns `409 {"error":"stock_changed"}`. Quantities are never silently
clamped. Only COD and payment methods actually configured by the seller are
accepted. The storefront builds confirmation content with DOM text nodes; store
payment values are never assigned to `innerHTML`.

## `POST /api/v1/account/deletion-request`

Authenticated with `x-orderak-phone` and `x-orderak-secret`. Creates or upgrades
the seller's deletion request to `verified`, records `android_authenticated` as
the source, and sets a deadline 90 days from the request. Returns:

```json
{ "ok": true, "request_id": "<uuid>", "deadline_days": 90 }
```

The public alternative is `GET/POST https://orderak.app/delete-account`. A
public request remains `pending` until support verifies control of the exact
Firebase phone identity. The daily scheduled handler processes verified requests
only after their deadline. External billing, R2 verification, and Firebase Admin
deletion must all succeed before the atomic D1 cleanup records completion;
failures leave the request open for a safe retry. Fulfilment and required Worker
secrets are documented in the account-deletion runbook.

## Automatic Catalog Language

The seller's Android language does not determine a buyer's catalog language.
Public pages resolve the buyer's `Accept-Language` header independently and
normalize it to the supported public locales (`ar` or `en`). Regional variants
such as `ar-EG` resolve to `ar`; quality weights are honored. Unsupported
languages fall back to the platform default.

Product translations are generated after seller synchronization only when the
cached source text is stale or missing. Storefront requests read D1 and fall back
to seller-authored content, so they never wait for or directly pay for an AI call.
Cached rows include source-locale/version provenance, provider/model metadata,
and a translation lifecycle status (`pending`, `machine`, `reviewed`, or
`rejected`) so future human overrides can be audited without changing the public
storefront response shape.

Public store, category, and product pages choose Arabic or English from the
request `Accept-Language` header and return `Content-Language` plus
`Vary: Accept-Language`. Product sync keeps the seller-authored text as the
source of truth and refreshes cached rows in `product_translations` through the
backend AI provider. A missing, failed, or stale translation always falls back
to the original product name and description.

## Security Rule

AI provider keys must stay on the backend. Never send them to Android, never
commit them to Git, and always use `wrangler secret` (not `vars`) in production.

## Versioned plans and entitlements (CHG-004)

The v2 policy engine is organization-scoped and backend-authoritative. It is
available only when `ENTITLEMENTS_ENABLED=true`; production remains false
until the governed rollout is approved.

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/v1/entitlements` | Seller headers | Typed effective snapshot for all 242 catalog rows, usage, remaining quota, active revision, and pending renewal revision. `?projection=android-v1` returns implemented rows only. |
| `GET /api/v1/billing/catalog` | Public | Active Play product/base-plan mappings; empty while billing is disabled |
| `POST /api/v1/billing/google/verify` | Seller headers | Run or durably enqueue authoritative verification; commit entitlement before acknowledgement |
| `GET /api/v1/billing/verifications/{id}` | Seller headers | Poll a seller-owned asynchronous verification by its canonical UUID; never returns a purchase token |
| `POST /api/integrations/v1/google-play/rtdn` | Google Pub/Sub OIDC | Atomically persist deduplicated RTDN + outbox job, then re-query Google asynchronously |
| `GET /api/admin/v1/billing/verifications` | `subscriptions:view` | Inspect sanitized verification/outbox/DLQ state |
| `POST /api/admin/v1/billing/verifications/{id}/retry` | `subscriptions:manage` + fresh action authorization | Requeue a dead-lettered job with a required reason and audit evidence |
| `GET /api/admin/v1/plan-catalog` | `plans:view` | Plans, revisions, definitions, and comparison values |
| `POST /api/admin/v1/plans/{id}/drafts` | `plans:draft` | Copy the current immutable revision into a draft |
| `PATCH /api/admin/v1/plan-revisions/{id}` | `plans:draft`, `If-Match` | Update implemented, admin-configurable entitlement values |
| `POST /api/admin/v1/plan-revisions/{id}/validate` | `plans:draft` | Validate types, completeness, unlimited support, and tier monotonicity |
| `GET /api/admin/v1/plan-revisions/{id}/impact` | `plans:view` | Preview subscribers, restrictive limits, and notice requirement |
| `POST /api/admin/v1/plan-revisions/{id}/publish` | owner / `plans:publish` | Publish an immutable revision and schedule restrictive paid changes at renewal |
| `POST /api/admin/v1/organizations/{id}/entitlement-overrides` | `subscriptions:manage` | Add a reasoned, audited organization override |
| `POST /api/admin/v1/test-lab/organizations/{id}/plan` | `subscriptions:manage`, Staging only | Mirror a plan's implemented configurable entitlements for a test organization; requires a reason and expiry within 24 hours |
| `DELETE /api/admin/v1/test-lab/organizations/{id}/plan` | `subscriptions:manage`, Staging only | Revoke every active Test Lab override for the organization and audit the reset |
| `POST /api/admin/v1/organizations/{id}/paid3-approval` | owner / `plans:publish` | Approve Paid 3 only after all custom-required values are set |
| `POST /api/admin/v1/organizations/{id}/storefront-locales` | `subscriptions:manage` | Enable an implemented, non-core storefront locale for Paid 3 |

`GET /api/v1/config` remains as a compatibility projection. Enforcement errors
use RFC 9457 `code: "plan_limit_reached"` and add the stable v1
`code: "PLAN_LIMIT_REACHED"`, entitlement key, limit, usage, remaining value,
reset time, plan revision, upgrade targets, and request ID.

Entitlement snapshots use `schema_version: 1` and a strong `ETag` derived from
the effective revision, subscription lifecycle, pending revision, and all
client-visible entitlement values including usage. Authenticated clients send
`If-None-Match`; unchanged snapshots return a bodyless `304`. Responses use
`Cache-Control: private, max-age=0, must-revalidate` and
`Vary: x-orderak-phone`. The `android-v1` projection excludes planned catalog
rows, fails closed for absent flags, and is regression-tested to remain below
10 KB.

Google Play states map as follows: active and grace grant the paid revision;
canceled grants it only until expiry; pending, on-hold, paused, expired, and
revoked resolve to Free. Client purchase objects never grant access locally.

The Test Lab routes fail closed as `404` unless
`DEPLOYMENT_ENVIRONMENT=staging`. Applying a plan revokes prior Test Lab
overrides for the same organization, writes expiring entitlement overrides
tagged with the simulated plan, and records an admin audit event. It never
changes the subscription record, acknowledges a Play purchase, or enables
Production billing.

A successful direct verification keeps its existing `200` response. A
retryable Play failure or open circuit returns HTTP `202`:

```json
{
  "ok": false,
  "pending": true,
  "status": "verification_pending",
  "verification_id": "<uuid>",
  "retry_after_seconds": 15
}
```

Polling returns the same pending fields, a succeeded purchase status plus fresh
entitlements, or `verification_failed` with a stable sanitized terminal error.
Android persists only the verification ID/retry time and polls through unique,
network-constrained WorkManager. The raw token is never persisted on-device.

All sources use one generation-guarded verification path. Queue payloads are
`{"version":1,"jobId":"..."}` only. RTDN `messageId` deduplicates the
notification, while purchase-token hashes identify subscription entities and
are not lifecycle event idempotency keys. Daily reconciliation enqueues the
least-recently-verified purchases instead of writing access directly.

Claims use a 120-second lease acquired by atomic `UPDATE … RETURNING`. Active
duplicates are acknowledged no-ops; expired claims are reclaimed. Every job
state transition requires the current claim token. `GET
/api/admin/v1/billing/health` returns duration p50/p95/max, over-lease count, and
reclaim totals. DLQ retry is idempotent and returns the existing child job when
repeated.

## Stable identity and phone-change API

`AUTH_IDENTITY_ENABLED` controls identity-table reads; dual-write and legacy
seller projections continue on both sides of cutover. `GET
/api/admin/v1/identity/readiness` reports active sellers missing identities,
unresolved sanitized migration issues, and organizations missing routes. `POST
/api/admin/v1/identity/backfill` runs a bounded idempotent identity/routing batch.
If the identity rollout is enabled prematurely for a legacy seller with no active identity,
session restore fails closed with `identity_not_ready` (503); disable the flag,
resolve/backfill the sanitized issue, and repeat readiness checks.

Phone change defaults to `PHONE_CHANGE_ENABLED=false` and then returns
`phone_change_disabled` (503).

| Endpoint | Proof | Stable errors |
|---|---|---|
| `POST /api/v1/auth/phone-change/challenges` | Current phone/device credential, `new_phone`, and a Firebase `id_token` with current-phone proof no older than five minutes | `phone_change_disabled`, `current_proof_mismatch`, `new_phone_mismatch`, `phone_already_used` |
| `POST /api/v1/auth/phone-change/complete` | Current credential, `challenge_id`, bearer `challenge_token`, fresh new-phone `id_token`, and `replacement_device_secret` | `invalid_challenge`, `expired_challenge`, `replayed_challenge`, `new_phone_mismatch`, `phone_already_used` |

Completion preserves seller/organization/routing/Play/purchase/subscription/job
IDs, supersedes the old identity, changes compatibility fields, rotates the
primary secret, and revokes every other device.

Tenant-owned seller/public writes resolve the organization's current route.
While a route is fenced they return HTTP 503 with
`{"error":"tenant_write_fenced","retryable":true}` and `Retry-After: 30`.

**Seller device secrets** are stored **hashed** (PBKDF2) in D1, never in
plaintext. Any legacy plaintext secret is transparently re-hashed on the
seller's next authenticated request, so no re-registration is needed.

## Operations coverage (2026-07-20)

Authenticated Android requests continue to use `x-orderak-phone` and
`x-orderak-secret`. New app versions also send the optional opaque installation
metadata headers `x-orderak-device-id`, `x-orderak-device-label`,
`x-orderak-platform`, and `x-orderak-app-version`. Legacy credentials remain
valid during migration.

| Seller endpoint | Purpose |
| --- | --- |
| `GET /api/v1/account/status` | Stable active/suspended/banned status |
| `GET /api/v1/account/deletion-request` | Latest deletion request lifecycle |
| `GET/POST /api/v1/support/tickets` | List or create seller-scoped tickets |
| `GET/POST /api/v1/support/tickets/{id}` | Read or reply to a scoped ticket thread |
| `GET /api/v1/announcements` | Active plan-targeted announcement feed |
| `POST /api/v1/announcements/{id}/read` | Record seller read state |
| `GET /api/v1/catalog/translations?lang=ar\|en` | Product translation lifecycle list |
| `PUT /api/v1/catalog/translations/{product_code}/{lang}` | Save seller-authored reviewed content |
| `DELETE /api/v1/catalog/translations/{product_code}/{lang}` | Reject a translation and use authored fallback |
| `GET /api/v1/devices` | Primary and additional device metadata |
| `DELETE /api/v1/devices/{row_id}` | Revoke an additional credential |
| `GET /api/v1/ads/active` | Authenticated, scheduled, localized first-party campaigns |
| `POST /api/v1/ads/track` | Eligible active-campaign impression/click event with optional retry-safe `event_key` |

The canonical admin API now includes seller detail/status, subscription list,
deletion verification/retry, support assignment/replies, announcements,
translation review, device revocation, observed job runs/manual owner retry,
and `GET/PATCH /api/admin/v1/runtime-config`. Runtime controls can narrow the
deployment gates; they cannot enable AI or billing when the corresponding
environment gate is off.

## Admin Control Center API (2026-07-21)

The public Android/API Worker does not mount `/admin` or `/api/admin/v1/*`.
`admin.orderak.app` is a React Pages application behind a stateless custom-host
adapter. The same-origin Pages Function proxies `/api/admin/v1/*` to the private
`orderak-admin-worker` through a service binding. The adapter has no privileged
binding, and the admin Worker has no route, preview URL, or `workers.dev`
endpoint.

Admin authentication uses opaque D1 sessions. `POST /api/admin/v1/auth/login`
starts password verification and then mandatory TOTP enrollment or challenge;
`POST /api/admin/v1/auth/enroll`, `/mfa`, and `/recovery` complete the corresponding
flow. `GET /api/admin/v1/auth/me` returns the shared administrator contract and the
per-session CSRF token. Mutations require the session cookie, CSRF token, and an
exact allowed Origin/Referer. Account-security changes and sensitive exports
add fresh password/TOTP authorization through
`POST /api/admin/v1/action-authorizations`.

Initial enrollment returns ten one-use recovery codes. The UI records
acknowledgement through `POST /api/admin/v1/auth/recovery-codes/acknowledge`;
non-auth admin endpoints remain locked until that acknowledgement and the
one-time password replacement are complete.

The control-plane domains include dashboard health, sellers/stores, store-
scoped buyers and privacy requests, support, deletion trust, subscriptions,
plans/revisions/entitlements, coupons, affiliate/payouts, first-party ads,
exports, feature flags and simulation, app-version policies, capabilities,
runtime state, announcements, translations, email/templates/events/inbox,
content/legal/macros, jobs, audit/errors/security/access, settings/theme, and
engineering manifests/assets. `GET /api/admin/v1/capabilities` is the authoritative
registry of `enforced`, `display_only`, and `planned` controls.

`GET /api/v1/config`, `/api/v1/entitlements`, and authenticated sync responses now
include `governance`. Android sends `x-orderak-version-code`; the response
contains the effective version policy and governed feature decisions. Runtime
precedence is environment gate, emergency version rule, account/trust state,
plan entitlement, store override, country/app-version targeting, stable HMAC
percentage bucket, then global default.
