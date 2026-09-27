---
status: draft
generated: false
owner: backend
applies_to: [internal]
---

# Backend inventory and necessity review

**Audience:** internal engineering.
**Scope:** `services/backend`, `contracts/openapi`, `contracts/typescript`, and the
workflows under `.github/workflows`.

Evidence-based inventory of the Orderak Cloudflare Workers backend, plus a
necessity classification for every capability it implements.

**Method.** All files were read with file tools; nothing was modified, created or
built. Production baseline = the top-level `vars`/`secrets` of
`services/backend/wrangler.jsonc` (there is deliberately no `env.production` —
`wrangler.jsonc:1-14`). Staging baseline = its `env.staging` block. Admin Worker
baseline = `services/backend/wrangler.admin.jsonc`.

**Scope read:** `services/backend/**` (131 `.ts`/`.mts`/`.mjs`, 61 `.sql`),
`services/backend/{wrangler.jsonc,wrangler.admin.jsonc,wrangler-types.env,.dev.vars.example}`,
`contracts/openapi/**`, `contracts/typescript/**`, `.github/workflows/**` (20 files),
`tooling/repository/**` where it enforces a backend invariant.

**Verification note.** Anything the audit could not confirm is labelled
`unverified` inline. Runtime facts about *live* Cloudflare state (which secrets are
actually set, whether the `RATE_LIMITER` Durable Object is deployed, which rows
exist in the D1 `feature_flags` table) cannot be established from source and are
marked `unverified` throughout.

---

> **Citations and the fix rounds.** Every `file:line` in this report was taken in
> a read-only pass, before any change was made. The fixes that followed edited
> those same files, so line numbers have shifted and some rows now describe code
> that has moved or gone. Treat the **Verification pass** section below as the
> authoritative record of what was still true when it was acted on, and the
> source itself as the truth about where anything is now. The file paths remain
> correct throughout.

## 1. Top 15 findings

| # | Finding | Evidence |
|---|---|---|
| 1 | **Two thirds of the admin surface is internal project-management tooling, not product.** 45 of ~183 admin route registrations are roadmap/tasks/screens/endpoints/prompts/design-assets/releases/bugs/project-docs CRUD over eight tables created by one migration, and the product's AI system prompt is read from that same tooling schema. | `admin-project.ts:35-161`, `migrations/010_project_admin.sql`, `migrations/011-016,048,049` (app_screens), `public-worker.ts:901` reads `ai_prompts` |
| 2 | **The `app_screens` cluster cost 7 migrations, 598 lines of admin routes, a 91-line manifest and 3 admin/UX tooling verifiers — for a screen tracker the Android repo could own as a file.** | `migrations/011,013,014,015_seed,016,048,049`; `app-screen-manifest.ts:1-91`; `admin-project.ts:262`; `tooling/repository/verify-screen-manifest.mjs` |
| 3 | **Billing is not merely off — it is unreachable by product policy and its only gateway is a mock.** `BILLING_ACQUISITION_ROUTES` holds 7 paths, all `403 feature_disabled`; `getGateway()` unconditionally returns `MockGateway`; `STRIPE_SECRET_KEY` is declared in the type and read nowhere (a commented line remains). | `billing.ts:43-51`, `:183-184`, `payments.ts:143-146`, `env.d.ts:50`, `payments.ts:144` |
| 4 | **The AI assistant cannot work even if its two gates are flipped.** `AI_MONTHLY_BUDGET_MICRO_USD="0"` and the two `DEEPSEEK_*_MICRO_USD_PER_MILLION` rates are unset and in no `secrets.required` list, so `budgetConfiguration()` throws `ai_budget_not_configured` before any call. | `wrangler.jsonc:36,70`, `deepseek.ts:52-58`, `env.d.ts:63-64` |
| 5 | **Production runs the legacy plan path while staging runs the v2 entitlement engine — a two-system divergence held only by test.** `wrangler.jsonc:37` `false` vs `:212` `true`; the doc still claims both are `false`. | `entitlements.ts:553-554`, `plan-limits.ts:28`, `docs/domains/entitlements.md:14` vs `wrangler.jsonc:212` |
| 6 | **Account deletion (the repository's only P0) is structurally inert in production.** `FIREBASE_PROJECT_ID=""` in production, so the Firebase Admin identity deletion short-circuits; and gateway cancellation only runs `if (env.BILLING_ENABLED === "true")`, which is `false`. | `wrangler.jsonc:85`, `deletion.ts:554`, `deletion.ts:155`, `docs/domains/identity.md:135-138` |
| 7 | **Dead code with no caller at all, in four separate subsystems.** `loadBrandingConfig`→`loadTheme`, `effectiveAppVersionPolicy` (a private duplicate does the work), `isEntitlementEnabled`, `entitlementDenied`, `customerKeyFor`, `newStoreCode` (test-only), `RateLimiter.reset`. | `theme.ts:110,149`; `admin-control-plane.ts:248` vs `config.ts:326`; `entitlements.ts:683,715`; `phone.ts:147`; `identity.ts:78`; `rate-limiter.ts:197` |
| 8 | **Two D1 tables are provably dead and two more are src-unreferenced.** `items` is called dead by a migration's own comment; `content_pages` was superseded by `content_page_versions` in migration 012; `geo_city_names`/`geo_city_search` are referenced only by scripts and tests. | `migrations/044:30-33`, `migrations/001:53`, `migrations/003:82`, `migrations/012`, `migrations/033:135,146`, `public-router.ts:156` (stale comment) |
| 9 | **The rate limiter is two implementations in one function, and the fast one is the undeployed one.** The Durable Object path is chosen when `RATE_LIMITER` exists; the code's own comment says the binding "has never been deployed to production", so production is expected to be on the D1 fallback. | `shared.ts:667-699`, `rate-limiter.ts:70-72`, `wrangler.jsonc:98-105` |
| 10 | **~18 credentials are read in code but required by no `secrets.required` list**, so nothing fails a deploy when they are missing; the only thing keeping them unreachable is that their features are flag-off. Nine-plus are Google Play / Firebase service-account / WebAuthn values. | `env.d.ts:56-71`, `google-play.ts:182-238`, `deletion.ts:554`, `auth-v2.ts:230,1077-1090`, `wrangler.jsonc:161-170`, `wrangler.admin.jsonc:126-139` |
| 11 | **`/api/v1/account/email/verification/resend` is gated on `ONBOARDING_ENABLED`,** so production (flag `false`) cannot resend a verification email for an already-registered seller. One flag, two unrelated capabilities. | `auth-v2.ts:166-167`, `wrangler.jsonc:42` |
| 12 | **Two independent implementations of the feature-flag rule** (`evaluateFlag` in the admin simulator, `effectiveFeature` on the seller path) with separate bucketing helpers and a 30 s cache in only one of them. | `admin-control-plane.ts:191-214`, `config.ts:441-479`, `:398-412` |
| 13 | **Tenant write fencing costs every credentialed non-GET request two D1 reads** (`resolveTenantContextForStore` → `requireTenantWrite`) for an organization model that currently has exactly one organization per store. Ship-ready for sharding, paid for now. | `public-worker.ts:398-406`, `tenant-routing.ts:91-148`, `migrations/024`, `migrations/032` |
| 14 | **`/api/admin/v1/exports/:id/file` is the only admin read with no RBAC permission** — it is authorized by `owner \|\| requested_by === admin.sub` alone, and it runs as a wildcard middleware ahead of every RBAC-gated sub-app. | `admin.ts:67-71`, `admin-control-plane.ts:852-863` |
| 15 | **`GENERATED` bindings are 41 % of `src/`.** `src/generated/*-env.d.ts` is 15,540 lines against ~22,366 lines of hand-written source; `wrangler types --check` runs in CI as a drift gate on both Workers. | `src/generated/public-worker-env.d.ts` (15,461 lines), `src/generated/admin-worker-env.d.ts`, `package.json:27-28`, `backend-ci.yml` |

---

## 2. Routing surface

Two deployables. `orderak-worker` (`wrangler.jsonc:21-22`) serves the storefront,
the seller JSON API and integrations; `orderak-admin-worker`
(`wrangler.admin.jsonc:16-17`) serves `/api/admin/v1/*` only and advertises no
route, preview URL or `workers.dev` endpoint.

Counts: **61 seller paths** in `contracts/openapi/src/seller-v1.json`, **134 admin
paths** in `admin-v1.json`, **2 integration paths** in `integrations-v1.json`.
The registration tables below enumerate **93 route registrations on the public
Worker** (including the 11 storefront registrations) and **183 on the admin
Worker** — a path served under several methods counts once per registration.

### 2.1 `orderak-worker` — top level (`src/entrypoints/public-worker.ts`)

Auth shorthand: **seller creds** = `x-orderak-phone` + `x-orderak-secret` headers
(never query strings) → `readCreds` (`shared.ts:560`) + `authSeller`
(`shared.ts:351`); **none** = public.

| Method | Path | Registered at | Auth | Gate / notes |
|---|---|---|---|---|
| use | `*` | `public-worker.ts:238` | — | stamps `x-request-id` after `next()` so it is never baked into an edge-cached body |
| use | `*` | `public-worker.ts:266` | — | CORS `Access-Control-Allow-Origin` from the allowlist, after `next()` |
| use | `*` | `public-worker.ts:283` | — | `www.orderak.app` → 301 canonical; on `api.orderak.app`, any non-API path → 404 (`isApiSurface` `:200-205`) |
| OPTIONS | `*` | `public-worker.ts:302` | none | preflight; allowlist widens to localhost when `DEPLOYMENT_ENVIRONMENT !== "production"` (`shared.ts:79`) |
| GET | `/.well-known/assetlinks.json` | `public-worker.ts:304` | none | handler `auth-v2.ts:229`; 503 `asset_links_not_configured` without `ANDROID_RELEASE_SHA256_CERT_FINGERPRINTS` (`auth-v2.ts:230-235`) |
| use | `*` | `public-worker.ts:307` | token in link | `handleEmailVerification` runs before every other route (`auth-v2.ts:190`) |
| GET | `/health` | `public-worker.ts:313` | none | reports `AI_ASSISTANT_ENABLED` and `DEEPSEEK_API_KEY` presence |
| use | `/api/v1/*` | `public-worker.ts:322` | — | validates `x-orderak-platform`, `x-orderak-app-version`, `x-request-id`, `x-orderak-version-code` (`:61-84`) |
| GET | `/api/v1/theme` | `public-worker.ts:331` | none | edge-cached; ETag = content hash (`admin-theme.ts:406-440`) |
| GET | `/api/theme.css` | `public-worker.ts:333` | none | 302 to hashed URL when no hash given (`admin-theme.ts:455-462`) |
| GET | `/api/theme/:file` | `public-worker.ts:335` | none | file must match `^[a-f0-9]{64}\.css$` (`:336`) |
| GET | `/media/*` | `public-worker.ts:342` | none | `serveMedia` (`media.ts:84`), immutable cache |
| ALL | `/api/integrations/v1/*` | `public-worker.ts:347` | per-integration | Google Play handler, then billing handler, else 404 |
| use | `/api/v1/*` | `public-worker.ts:359` | none yet | **pre-auth fan-out, order is behaviour**: auth-v2 → geo → business-taxonomy → phone-change |
| use | `/api/v1/*` | `public-worker.ts:375` | seller creds | records device metadata (`:383-390`); suspension fence 403 `account_restricted` (`:393`), bypass only for `/account/status` and `/account/deletion-request` (`:391-397`); tenant write fence for non-GET (`:398-406`) |
| use | `/api/v1/*` | `public-worker.ts:419` | seller creds | version-gate refusal on writes only (403 `client_version_refused`, `config.ts:248-270`) |
| ALL | `/api/v1/*` | `public-worker.ts:428` | seller creds | delegate chain: seller-operations → google-play → billing → ads → config → store routes → legacy `handleApi` |
| GET | `/` | `public-worker.ts:451` | none | landing page (`landing.ts`), language-aware cache |
| ALL | `/` | `public-worker.ts:461` | none | 404 |
| ALL | `*` | `public-worker.ts:464` | none | public storefront (`handlePublicRoutes`) |
| — | error handler | `public-worker.ts:477` | — | logs then 500 `{error:"server"}` |
| POST | `/api/v1/chat` | `public-worker.ts:585` | seller creds | `AI_ASSISTANT_ENABLED === "true"` **and** `settings.ai_enabled`; 20/min; ≤2000 chars; `max_ai_requests_per_month` |
| POST | `/api/v1/orders` | `public-worker.ts:664` | seller creds | manual order; requires idempotency key `^[A-Za-z0-9._:-]{8,100}$` (`:682`) |
| GET | `/api/v1/orders` | `public-worker.ts:733` | seller creds | cursor on per-store `order_no`, 50/page; piggybacks `loadClientConfig` (`:790`) |
| PATCH | `/api/v1/orders/{order_no}/status` | `public-worker.ts:801` | seller creds | transition table `:851-861`; conditional UPDATE `:879-885`; stock release via trigger `trg_orders_release_stock_on_cancel` (migration 046) |

**Non-HTTP surfaces on this Worker:** `email()` inbound (`:510` → `inbound.ts:54`);
`scheduled()` (`:520`) dispatches four crons — `17 2 * * *` → `retention` +
`media-reclaim`, `32 2 * * *` → `play-account-hash-backfill`, `47 2 * * *` →
`google-play`, `2 3 * * *` → `deletions`; `queue()` (`:539`) consumes
`orderak-email` and `orderak-email-dlq` and acks unknown queues
(`classifyPublicQueue` `:97-101`).

### 2.2 Storefront and public pages (`src/entrypoints/public-router.ts`)

| Method | Path | Registered at | Auth | Notes |
|---|---|---|---|---|
| ALL | `/delete-account` | `public-router.ts:238` | none | GET renders form, POST writes `deletion_requests`; 5/hour per IP (`:89`); honeypot field (`:93`) |
| GET | `/terms` | `public-router.ts:241` | none | `content_page_versions` where `status='published'` (`:162`) |
| GET | `/privacy` | `public-router.ts:242` | none | as above |
| ALL | `/terms`, `/privacy` | `public-router.ts:243-244` | none | 404 for non-GET |
| ALL | `/c/:identifier` | `public-router.ts:257` | none | legacy 301 → `/{public_identifier}` |
| ALL | `/c/:identifier/*` | `public-router.ts:261` | none | same handler |
| ALL | `/c` | `public-router.ts:262` | none | 404 |
| ALL | `/{pid}` | `public-router.ts:277` | none (public) | GET renders store, POST takes an order (`:283` → `catalog.ts`); canonicalises aliases with 301 (`:288`); visibility gate `store.status==='active'` + `storeCapabilityEnabled(...,'catalog.public',true)` (`:270-273`) |
| ALL | `/{pid}/{module}/{code}` | `public-router.ts:293` | none | `RESOURCE_REGISTRY` has exactly two entries: `c` → category, `p` → product (`:147-151`) |
| ALL | `*` | `public-router.ts:305` | none | localised 404 |

### 2.3 Seller API — pre-auth fan-out (runs before credentials are read)

| Method | Path | Matched at | Auth | Gate (production baseline) |
|---|---|---|---|---|
| POST | `/api/v1/auth/phone/complete` | `auth-v2.ts:115` | Firebase ID token + `device_secret` | `ONBOARDING_ENABLED` (`:116`) — **OFF in production → 503** |
| POST | `/api/v1/onboarding/account` | `auth-v2.ts:120` | onboarding bearer | `ONBOARDING_ENABLED` (`:121`) — OFF |
| POST | `/api/v1/onboarding/complete` | `auth-v2.ts:125` | onboarding bearer + device secret | `ONBOARDING_ENABLED` (`:126`) — OFF |
| GET | `/api/v1/onboarding/slug/check` | `auth-v2.ts:130` | onboarding bearer | `ONBOARDING_ENABLED` (`:131`) — OFF |
| POST | `/api/v1/auth/passkeys/registration/options` | `auth-v2.ts:135` | seller creds + `x-orderak-recent-auth` | `PASSKEY_ENABLED` (`:136`) — OFF |
| POST | `/api/v1/auth/passkeys/registration/complete` | `auth-v2.ts:140` | seller creds + recent-auth | `PASSKEY_ENABLED` (`:141`) — OFF |
| POST | `/api/v1/auth/passkeys/authentication/options` | `auth-v2.ts:145` | none (anonymous, per-IP limited) | `PASSKEY_ENABLED` (`:146`) — OFF |
| POST | `/api/v1/auth/passkeys/authentication/complete` | `auth-v2.ts:150` | WebAuthn assertion + `device_secret` | `PASSKEY_ENABLED` (`:151`) — OFF |
| GET | `/api/v1/auth/passkeys` | `auth-v2.ts:155` | seller creds | `PASSKEY_ENABLED` (`:156`) — OFF |
| PATCH, DELETE | `/api/v1/auth/passkeys/{id}` | `auth-v2.ts:160` | seller creds + recent-auth | `PASSKEY_ENABLED` (`:162`) — OFF |
| POST | `/api/v1/account/email/verification/resend` | `auth-v2.ts:166` | seller creds + recent-auth | `ONBOARDING_ENABLED` (`:167`) — OFF; **serves existing accounts** |
| GET | `/verify-email` | `auth-v2.ts:195` | single-use token in query | none; **unreachable on `api.orderak.app`** — the host fence at `public-worker.ts:295-297` 404s it before the `:307` interceptor |
| POST | `/api/v1/auth/phone-change/challenges` | `phone-change.ts:20` (branch `:55`) | seller creds + fresh Firebase proof | `PHONE_CHANGE_ENABLED` (`:23`) — **ON**; applies `versionGateRefusal` itself (`:52`) |
| POST | `/api/v1/auth/phone-change/complete` | `phone-change.ts:21` (branch `:26`) | seller creds + challenge + fresh proof | `PHONE_CHANGE_ENABLED` (`:23`) — ON |
| GET | `/api/v1/geo/cities` | `geo.ts:23` | onboarding bearer | `STATIC_CITY_CATALOG_ENABLED` (`:33`) — ON; reads `orderak_geo` |
| POST | `/api/v1/geo/cities/select` | `geo.ts:26` | onboarding bearer | `STATIC_CITY_CATALOG_ENABLED` (`:83`) — ON |
| GET | `/api/v1/catalog/business-categories` | `business-taxonomy.ts:27` / dispatch `:46` | none | `BUSINESS_TAXONOMY_ENABLED` (`:32`) — ON |
| GET | `/api/v1/catalog/business-subcategories` | `business-taxonomy.ts:28` / dispatch `:49` | none | `BUSINESS_TAXONOMY_ENABLED` (`:32`) — ON |

### 2.4 Seller API — authenticated chains

| Method | Path | Matched at | Auth | Entitlement / gate |
|---|---|---|---|---|
| POST | `/api/v1/auth/session` | `api-store.ts:242` | Firebase `id_token` + `phone` + `device_secret` | `FIREBASE_WEB_API_KEY` else 503 (`:1419`); `AUTH_IDENTITY_ENABLED` gates the same-phone recovery branch (`:1437,1456`) |
| POST | `/api/v1/auth/logout` | `api-store.ts:245` | seller creds | none |
| GET | `/api/v1/slug/check` | `api-store.ts:250` | none | none |
| POST | `/api/v1/register` | `api-store.ts:267` | phone+secret, or Firebase + fresh `auth_time` for a new store (`:465-505`) | `ALLOW_UNVERIFIED_REGISTRATION` only when `FIREBASE_WEB_API_KEY` is absent (`:458`) — fail-closed |
| GET | `/api/v1/store` | `api-store.ts:333-334` | seller creds | none |
| PUT | `/api/v1/store` | `api-store.ts:335` | seller creds | tenant write fence (`:291-304`) |
| GET | `/api/v1/categories` | `api-store.ts:340-341` | seller creds | none |
| POST | `/api/v1/categories` | `api-store.ts:342` | seller creds | `max_categories` enforced inside the INSERT (`:825,841-862`) |
| PUT, DELETE | `/api/v1/categories/{code}` | `api-store.ts:345` | seller creds | none |
| GET | `/api/v1/products` | `api-store.ts:353` | seller creds | none |
| POST | `/api/v1/products` | `api-store.ts:354` | seller creds | `max_products` (`:1057-1080`) |
| PATCH | `/api/v1/products/{code}/stock` | `api-store.ts:362` | seller creds | compare-and-set on `expected_stock_version` (`:1338-1386`) |
| PUT | `/api/v1/products/{code}` | `api-store.ts:369` | seller creds | `max_products` with delta 0 (`:1302`) |
| DELETE | `/api/v1/products/{code}` | `api-store.ts:370` | seller creds | none |
| POST | `/api/v1/media/upload` | `api-store.ts:375` | seller creds | 60/hour per store (`:379`); signature sniffing, SVG excluded (`media.ts:14,24-34,77`) |
| POST | `/api/v1/account/deletion-request` | `api-store.ts:306` | seller creds | writes/updates `deletion_requests`; **GET here is shadowed** by `seller-operations.ts:88` |
| GET | `/api/v1/account/status` | `seller-operations.ts:11` / `:84` | seller creds | none; whitelisted while restricted |
| GET | `/api/v1/account/deletion-request` | `seller-operations.ts:12` / `:88` | seller creds | none; whitelisted while restricted |
| GET, POST | `/api/v1/support/tickets` | `seller-operations.ts:13` / `:96,:105` | seller creds | none |
| GET, POST | `/api/v1/support/tickets/{digits}` | `seller-operations.ts:13` / `:120` | seller creds | none; closed ticket refuses a reply with 409 (`:134`) |
| GET | `/api/v1/announcements` | `seller-operations.ts:14` / `:147` | seller creds | plan-targeted query (`:155`) |
| POST | `/api/v1/announcements/{digits}/read` | `seller-operations.ts:15` / `:166` | seller creds | visibility re-checked before the receipt (`:174-183`) |
| GET | `/api/v1/catalog/translations` | `seller-operations.ts:16` / `:190` | seller creds | none |
| PUT, DELETE | `/api/v1/catalog/translations/{code}/{ar\|en}` | `seller-operations.ts:17` / `:206` | seller creds | none |
| GET | `/api/v1/devices` | `seller-operations.ts:18` / `:241` | seller creds | none; synthesises the primary device from `sellers` (`:246-256`) |
| DELETE | `/api/v1/devices/{digits}` | `seller-operations.ts:19` / `:263` | seller creds | primary device cannot be revoked (`:266`) |
| GET | `/api/v1/customers` | `customers.ts:236,239` | seller creds | none |
| GET | `/api/v1/customers/{key}` | `customers.ts:244` / `:247` | seller creds | none |
| PATCH | `/api/v1/customers/{key}` | `customers.ts:244` / `:252` | seller creds | **entitlement** `customers_crm.editable_customer_profiles` (`:174`, key `entitlements.ts:688`) — in production this resolves through the legacy snapshot |
| POST | `/api/v1/subscribe` | `billing.ts:189` | seller creds | acquisition gate → **403** (`:183-184`) |
| GET | `/api/v1/subscription/status` | `billing.ts:194` | seller creds | **deliberately ungated** |
| POST | `/api/v1/cancel` | `billing.ts:199` | seller creds | acquisition gate → 403 |
| POST | `/api/v1/coupons/validate` | `billing.ts:204` | none (creds only key the rate limit) | acquisition gate → 403 |
| POST | `/api/v1/coupons/apply` | `billing.ts:209` | seller creds | acquisition gate → 403 |
| POST | `/api/v1/referral/apply` | `billing.ts:214` | seller creds | acquisition gate → 403 |
| GET | `/api/v1/referral/stats` | `billing.ts:219` | seller creds | acquisition gate → 403 |
| GET | `/api/v1/plans` | `billing.ts:229` | none | **deliberately ungated**, public, `max-age=300` (`:263`) |
| GET | `/api/v1/ads/active` | `ads.ts:20` | optional seller creds | `plans.ads_enabled` or `free` plan (`:75`); 404 `ad_not_eligible` |
| POST | `/api/v1/ads/track` | `ads.ts:25` | seller creds | idempotent on `event_key`; 120/hour (`:143`) |
| GET | `/api/v1/config` | `config.ts:278` (dispatched `public-worker.ts:441`) | seller creds | `ENTITLEMENTS_ENABLED` selects engine (`:64`) |
| GET | `/api/v1/entitlements` | `config.ts:284` | seller creds | engine selection only; ETag excludes `server_time` (`:305-313`) |
| GET | `/api/v1/billing/catalog` | `google-play.ts:1063` | none | **not** lifecycle-gated; returns `billing_enabled:false`, `products: []` |
| POST | `/api/v1/billing/google/verify` | `google-play.ts:1084` | seller creds | `GOOGLE_PLAY_LIFECYCLE_ENABLED` (`:1085`) **and** `acquisitionEnabled` (`:1097`) — both OFF → 403 |
| GET | `/api/v1/billing/verifications/{id}` | `google-play.ts:1134` | seller creds + ownership | `GOOGLE_PLAY_LIFECYCLE_ENABLED` (`:1136`) — OFF → 403 |
| POST | `/api/integrations/v1/payment` | `billing.ts:224` | HMAC-SHA256 over raw body (`payments.ts:59-71,108`) | inside the acquisition set → 403; signature required only when `DEPLOYMENT_ENVIRONMENT ∈ {production,staging}` (`billing.ts:760-764`) |
| POST | `/api/integrations/v1/google-play/rtdn` | `google-play.ts:1145` | Pub/Sub OIDC bearer JWT (`:932-963`) | `GOOGLE_PLAY_LIFECYCLE_ENABLED` (`:966`) — OFF → 403 |

Ordering note: `public-worker.ts:428-447` runs seller-operations **before**
google-play, billing, ads, config and store routes; the pre-auth fan-out at `:359`
runs before credentials at `:375`. Registration order is behaviour, not style.

### 2.5 Admin Worker

| Method | Path | Registered at | Auth | Permission |
|---|---|---|---|---|
| GET | `/health`, `/api/admin/v1/health` | `admin-worker.ts:65-66` | none | — |
| ALL | `/api/admin/v1/*` | `admin-worker.ts:68` | delegated to `admin.ts:122-125` | per-route |
| ALL | `*` | `admin-worker.ts:74` | none | 404 |
| POST | `/api/admin/v1/auth/invitation/accept` | `admin.ts:31` | **none** — invite token only | none; the only unauthenticated admin POST and the only auth-family route with **no rate limit** |
| use | `*` | `admin.ts:39-62` | admin session cookie `__Host-orderak_admin_session` (`admin-auth.ts:217-233`); 8 h absolute / 15 min idle (`:27-37`) | posture gate: 403 `mfa_enrollment_required`, 428 `recovery_codes_acknowledgement_required`, 428 `password_change_required`; skipped for the local bearer path (`admin.ts:43-45`) |
| use | `*` (CSRF) | `admin.ts:55` → `admin-auth.ts:261-278` | Origin/Referer + `x-csrf-token` | — |
| use | `*` (export file) | `admin.ts:67-71` | cookie | **no `gate()`**; authorized by `owner \|\| requested_by === admin.sub` (`admin-control-plane.ts:860`) |
| GET | `/api/admin/v1/exports/{id}/file` | `admin-control-plane.ts:852` | cookie + one-use download token (`:799-863`) | none (see finding 14) |

Auth mechanisms, precisely: session cookie + TOTP posture + CSRF (above); a local
HS256 bearer that requires `LOCAL_ADMIN_ENABLED==="true"` **and**
`ADMIN_JWT_SECRET` (`admin-auth.ts:220-222`) — set in no environment, therefore
inert (`env.d.ts:27-38`, `wrangler.admin.jsonc:98-103`); break-glass
`x-admin-key` constant-time against `ADMIN_API_KEY` **and** an IP allowlist that
denies everything when empty (`admin-auth.ts:157-183`) — so `auth/bootstrap`
(`:393`) and `auth/password/reset` (`:634`) are closed on production; RFC-6238
TOTP with ±1 step (`auth.ts:246`); MFA challenges storing only a sha256 with
`attempts<5` (`admin-auth.ts:48-89`).

RBAC: roles `owner | finance | support | readonly` (`auth.ts:271,413`);
`ROLE_PERMISSIONS` at `auth.ts:277-363`; implication rules at `auth.ts:372-383`
(`theme:rollback → theme:manage → theme:view`; `project:view` grants nine
`INTERNAL_READ_RESOURCES`). **25 permission strings are granted to no non-owner
role** — `ads:manage`, `plans:manage`, `plans:publish`, `settings:view|manage`,
`operations:run`, `capabilities:manage`, `flags:manage`, `versions:manage`,
`admins:*`, `security:*`, `content:manage`, `theme:manage|rollback`, and the nine
project `*:manage` — so most of the admin surface is single-operator in practice.
`analytics:view` and `errors:view` are declared but no route requires them
(`/api/admin/v1/errors` uses `audit:view`, `admin.ts:105`).

Admin registrations by file (each row is one Hono registration):

| File | Registrations | What it covers |
|---|---|---|
| `entrypoints/admin-worker.ts` | 3 | health ×2, catch-all; plus cron `* * * * *` (`:106-107`) and `*/15 * * * *` (`:102`) and four queue consumers |
| `domains/admin/admin.ts` | 22 | invitation accept; stats, stores; plans ×3; coupons ×3; affiliate ×2; referrals ×2 (payouts); ads ×3; audit, errors; terminal 404 (`:111`) |
| `domains/admin/admin-auth.ts` (`${A}`) | 12 | bootstrap, login, mfa, enroll, recovery, me, logout, password, password/reset, recovery-codes, recovery-codes/acknowledge, `/auth/*` 404 (`:350`) |
| `domains/admin/admin-theme.ts` (`${TB}`) | 9 | GET/PUT theme, preview, revisions list, patch, delete, activate\|rollback, two terminators (`:227-228`) |
| `domains/admin/admin-control-plane.ts` (`${B}`) | 38 | dashboard, capabilities, store-controls ×2, flags ×4, app-versions ×2, buyers, buyer-restrictions ×2, buyer-privacy ×3, access ×6, security ×4, action-authorizations, support-macros ×3, content-configs ×3, exports ×3, export file |
| `domains/admin/admin-entitlements.ts` (`${B}`) | 13 | plan-catalog, drafts, revisions patch/validate/impact/publish/archive, overrides, test-lab ×2 (staging-only `:391-395`), paid3-approval, storefront-locales ×2 |
| `domains/admin/admin-operations.ts` (`${B}`) | 25 | runtime-config ×2, subscriptions, billing health/verifications ×3/retry, identity readiness/backfill, stores ×2, deletion-requests ×2, support tickets ×4, announcements ×3, product-translations ×2, device revoke, jobs ×2 |
| `domains/admin/admin-project.ts` (`${B}`) | 45 | overview, roadmap ×4, tasks ×4, screens ×5, endpoints ×4, prompts ×4, design-assets ×4, releases ×4, bugs ×4, project-docs ×4, settings ×2, content-pages ×4 |
| `integrations/email/adminRoutes.ts` (`${B}`) | 16 | email-events, inbound-emails ×3, email-templates ×7, template-key guard, three terminators (`:188-190`) |

### 2.6 Non-HTTP surfaces

| Kind | Name | Where | Gate |
|---|---|---|---|
| cron `17 2 * * *` | `retention` | `public-worker.ts:522` | — |
| cron `17 2 * * *` | `media-reclaim` | `public-worker.ts:529` | `MEDIA_RECLAIM_ENABLED` (`media-reclaim.ts:139`) — OFF → dry run only |
| cron `32 2 * * *` | `play-account-hash-backfill` | `public-worker.ts:531` | — |
| cron `47 2 * * *` | `google-play` reconcile | `public-worker.ts:533` | — |
| cron `2 3 * * *` | `deletions` | `public-worker.ts:535` | `BILLING_ENABLED` for the gateway-cancel step (`deletion.ts:155`) |
| cron `* * * * *` (admin) | `dispatchPendingPlayJobs`, `sweepUndispatchedEmails` | `admin-worker.ts:106-107` | — |
| cron `*/15 * * * *` (admin) | `archiveAuditBatch` | `admin-worker.ts:102` | audit signing key must resolve (`admin-control-plane.ts:979`) |
| email | inbound routing | `public-worker.ts:510` → `inbound.ts:54` | — |
| queue `orderak-email` + `-dlq` | transactional email | `public-worker.ts:539`; producers `emailQueue.ts:104`, `emailService.ts:129` | — |
| queue `orderak-play-billing` + `-dlq` | Play verification | consumer `admin-worker.ts:134`; producer `google-play.ts:773-791` | — |
| queue `orderak-admin-exports` + `-dlq` | CSV exports | consumer `admin-worker.ts:167`; producer `admin-control-plane.ts:625-629` | — |
| Durable Object `RateLimiter` | rate limiting | `public-worker.ts:54`, `wrangler.jsonc:98-105` | falls back to D1 when the binding is absent (`shared.ts:667-699`) |
| R2 `orderak_media` | media upload/serve/reclaim | `media.ts:86,127`, `media-reclaim.ts:57,177`, `deletion.ts:170-176` | — |
| R2 `orderak_audit` | audit archives + export CSVs | `admin-control-plane.ts:665-1001` | admin Worker only |

---

## 3. D1 schema

**Totals: 61 migration files in `migrations/`, 1 in `geo-migrations/` (62 total),
6,572 lines of SQL, 114 tables (111 + 3), `migrations.lock` carrying 62 sha256
entries. Highest-numbered migration: `059_stock_movements_product_code_not_null.sql`.**
Numbering is contiguous 001–059 with two deliberate exceptions:
`015_order_no_unique.sql` + `015_seed_app_screens.sql` (duplicate prefix) and
`039_add_private_birth_year.sql` + `039b_repair_email_schema_drift.sql` (letter
suffix). Both duplicate prefixes are hardcoded as accepted history in
`scripts/verify-migrations.mjs:91-128`.

Two **forward-repair** migrations exist because applied history drifted from the
repository: `039b_repair_email_schema_drift.sql` (004 was recorded applied while
its email tables were absent in production) and
`041_restore_referential_integrity.sql:15-21` (015's unique index was missing in
production). Both are evidence that the migration record alone was not trusted.

### 3.1 Migration groups

| # | File | Creates / alters | Purpose |
|---|---|---|---|
| 001 | `001_init.sql` | sellers, products, orders, order_items, **items** | Core schema. `items` is dead (see §3.3) |
| 002 | `002_billing.sql` | plans, plan_features, subscriptions, coupons, coupon_uses, affiliate_settings, referrals, ads, ad_impressions, rate_limits | Billing, coupons, affiliate/referral, ads, legacy rate limits |
| 003 | `003_admin.sql` | admin_users, admin_sessions, admin_audit, settings, content_pages, announcements, support_tickets, support_messages, payment_events | Admin RBAC/2FA, CMS, support |
| 004–005 | `004_email.sql`, `005_inbound_email.sql` | email_templates, email_template_translations, email_template_history, email_events; inbound_emails | Email templates + delivery + inbox |
| 006 | `006_hardening.sql` | webhook_events, error_logs | Webhook idempotency ledger, error log |
| 007–009 | `007_fix_phone_slugs.sql`, `008_store_codes.sql`, `009_uuid_public_urls.sql` | categories; full rebuild of sellers/products/orders/subscriptions/coupons/referrals/payment_events/support_tickets/ad_impressions | Store identity → UUID PKs + immutable public codes/URLs |
| 010 | `010_project_admin.sql` | roadmap_items, project_tasks, api_endpoints, **ai_prompts**, design_assets, releases, bugs, project_docs | Internal project tooling **in the product database** |
| 011–016 | app screen cluster | app_screens (+ statuses, source, seed, parent tree) | Android screen tracker |
| 012 | `012_legal_versions.sql` | content_page_versions (backfilled from content_pages) | Versioned CMS/legal history; supersedes `content_pages` |
| 017, 020 | `017_product_translations.sql`, `020_product_translation_lifecycle.sql` | product_translations (+ provenance/review lifecycle) | Cached AI translations + review state |
| 018–019 | `018_seller_devices.sql`, `019_multi_device_plan_feature.sql` | seller_devices; plan_features seed | Multi-device auth + paid feature |
| 021–023 | legal | legal_acceptances; deletion_requests; publish legal v2 | Acceptance evidence, deletion intake, legal publication |
| 024–025 | `024_versioned_entitlements.sql`, `025_entitlement_catalog_seed.sql` | organizations, organization_stores, organization_members, subscription_plans, plan_revisions, entitlement_definitions, plan_revision_entitlements, organization_subscriptions, organization_entitlement_overrides, entitlement_usage_counters, entitlement_usage_reservations, organization_plan_approvals, play_product_mappings, play_purchases, play_billing_events, plan_change_notices, storefront_locale_definitions, organization_storefront_locales | The v2 entitlement/billing foundation (18 tables in one migration) |
| 026 | `026_order_integrity.sql` | orders, sellers, products; trigger `trg_order_items_claim_stock`; unique `idx_orders_store_idempotency` | Order idempotency + stock claim |
| 027 | `027_operations_coverage.sql` | announcement_reads, operational_job_runs | Seller operations coverage |
| 028 | `028_admin_control_plane.sql` | admin_recovery_codes, admin_invitations, admin_action_authorizations, security_alerts, capability_definitions, feature_flags, feature_flag_rules, app_version_policies, store_capability_overrides, buyer_restrictions, buyer_privacy_requests, support_macros, content_configs, admin_exports, admin_audit_exports | Admin control plane (15 tables) |
| 029–031 | `029`, `030_play_billing_reliability.sql`, `031_play_verification_leases.sql` | billing_verification_heads, play_verification_jobs, provider_circuit_state, ai_provider_usage_events, ai_budget_alerts; generation triggers; lease indexes | Play reliability, provider circuits, AI budget ledger |
| 032 | `032_stable_identity_and_routing.sql` | seller_auth_identities, identity_migration_issues, organization_routing, phone_change_challenges | Stable identity + tenant routing |
| 033 | `033_auth_onboarding_v2.sql` | onboarding_sessions, seller_profiles, passkey_credentials, webauthn_challenges, recent_auth_proofs, email_verification_tokens, geo_cities, geo_city_names, geo_city_search (FTS5); trigger `trg_email_verification_applied` | Auth/onboarding v2 + the legacy GeoNames city stack |
| 034, 038, 047, 049 | legal/data corrections | content_page_versions publications; entitlement status corrections; SettingsRoute removal | Publication + drift correction |
| 035–036 | `035_design_system_revisions.sql`, `036_design_system_revision_management.sql` | design_system_revisions, design_system_state (rebuilt in 036 with backups) | Versioned design system |
| 037 | `037_places_and_business_taxonomy.sql` | business_taxonomy_versions, business_categories, business_subcategories, business_taxonomy_search (FTS5) | Business taxonomy v1 |
| 039 | `039_add_private_birth_year.sql`, `039b_repair_email_schema_drift.sql` | onboarding_sessions, seller_profiles; repairs 004 drift | Private birth year + schema repair |
| 040 | `040_cloudflare_scalability_hardening.sql` | admin_auth_challenges, outbound_email_jobs, operational_leases | Scalability/retention hardening |
| 041 | `041_restore_referential_integrity.sql` | rebuilds categories/products/orders/order_items; recreates the stock trigger | Restore FKs/CHECKs lost in 009 |
| 042–043 | `042_email_outbox.sql`, `043_audit_signing_key_version.sql` | outbound_email_jobs; admin_audit_exports | Durable email outbox; audit key versioning |
| 044 | `044_money_minor_units_with_currency.sql` | renames price/amount columns across 9 tables, adds `currency` | ADR-009 |
| 045–046 | `045_unique_referral_code.sql`, `046_order_status_transitions.sql` | unique partial referral index; trigger `trg_orders_release_stock_on_cancel` | Referral integrity; status + stock release |
| 047–051 | corrections + product/order features | entitlement status; app screen surface/transitions; SettingsRoute removal; catalog baseline version; manual order origin | Drift correction + small features |
| 052 | `052_stock_movements.sql` | stock_movements; recreates both stock triggers | Append-only stock ledger |
| 053–059 | product/order/customer features | customers; play_product_mappings rebuild per package; media_objects; subscription idempotency; product discounts (2 triggers); product client_request_id; stock_movements rebuild | Recent feature migrations; five tables rebuilt by drop+rename since 009 |

### 3.2 Schema hotspots

| Cluster | Migrations | Tables | Why it matters |
|---|---|---|---|
| v2 entitlements | 024, 025, 030, 047 | 18 + 5 | 18 tables created in a single migration; production answers from the legacy tables instead |
| Admin control plane | 028, 029, 040, 043 | 18 | Most of it is reachable only by the `owner` role |
| Project tooling + screens | 010, 011, 013, 014, 015 ×2, 016, 048, 049 | 9 | Internal trackers living in the product database |
| Design system | 035, 036 | 2 (+2 backup tables dropped) | 036 is a destructive rebuild of 035's own tables eight migrations later |
| Email | 004, 005, 039b, 040, 042 | 6 | One of them (039b) exists only to repair 004's drift |

### 3.3 Tables with no reachable reader

| Table | Created by | Finding |
|---|---|---|
| `items` | `001_init.sql:53` | No `FROM`/`INTO`/`UPDATE items` anywhere in `src/`. Migration `044:30-33` states it outright: "`items` is a dead table. No query in services/backend/src reads or writes it; `products` superseded it." Its column was still renamed by 044 for consistency |
| `content_pages` | `003_admin.sql:82` | Only a stale comment references it (`public-router.ts:156`); all queries read `content_page_versions` (`:162,:178`). Superseded by 012 |
| `geo_city_names` | `033_auth_onboarding_v2.sql:135` | No reference in `src/`; only `scripts/import-geonames.mjs:80`, `scripts/d1-search-index-rebuild.sql:48`, `test/helpers.ts` |
| `geo_city_search` | `033:146` | No reference in `src/`; only scripts and tests. The newer `city_catalog*` set (geo-migrations/001) is what `geo.ts:103-157` reads |

Eight more tables are *live but misplaced*: `roadmap_items`, `project_tasks`,
`api_endpoints`, `ai_prompts`, `design_assets`, `releases`, `bugs`, `project_docs`
(all `010_project_admin.sql`) exist only to serve the internal admin project
screens — except `ai_prompts`, which the **production** AI chat route reads for
its system prompt (`public-worker.ts:898-906`). Internal tooling schema and a
product runtime dependency share one migration.

### 3.4 What CI enforces on migrations

`scripts/verify-migrations.mjs` (329 lines, run by `backend-ci.yml` and the deploy
workflows) enforces: filenames match `^(\d{3,})([a-z]?)_([a-z0-9_]+)\.sql$` (`:96`);
no duplicate numeric prefix outside the hardcoded `ACCEPTED_HISTORY` (`:91-128`);
**applied migrations are immutable** — every file's sha256 must match
`migrations.lock` (`:287-341`, regenerated only via
`--update-lock` `:317`); destructive DDL (`RENAME COLUMN`, `DROP COLUMN`,
`DROP TABLE`, `RENAME TO`) requires a `-- rollout: expand-contract <reason>`
marker (`:135-172`, with `ACCEPTED_UNMARKED` = 009, 036, 041, 044); and a
`CREATE TABLE IF NOT EXISTS` followed by an unguarded `INSERT … SELECT` backfill
is rejected (`:184-229`). The lock format is plain sha256sum specifically so
gitleaks' generic-api-key rule does not fire on filenames containing "key"
(`:271-286`).

---

## 4. Feature flags, runtime controls and environment variables

**13 deploy-time feature flags, 2 D1 runtime controls, 11 distinct non-flag
config vars, 1 database-driven flag system (`feature_flags` +
`feature_flag_rules`).**

### 4.1 Deploy-time flags (public Worker)

Production = top-level `vars` (`wrangler.jsonc:32-86`); staging = `env.staging.vars`
(`:194-254`).

| Flag | Prod | Staging | Gates | Evidence |
|---|---|---|---|---|
| `BILLING_ENABLED` | `false` | `false` | Acquisition (7 paths) `billing.ts:184`; Play `google-play.ts:140`; gateway cancel in deletion `deletion.ts:155`; admin readout `admin-operations.ts:46`; `env_gate` of the `billing` flag `config.ts:454-455` | `wrangler.jsonc:34`, `:196` |
| `GOOGLE_PLAY_LIFECYCLE_ENABLED` | `false` | `false` | Play verify/verifications/RTDN `google-play.ts:136,966,1085,1136`; job enqueue `:791` | `:35`, `:197` |
| `AI_ASSISTANT_ENABLED` | `false` | `false` | `deepseek.ts:40`; chat route `public-worker.ts:316,587` | `:36`, `:198` |
| `ENTITLEMENTS_ENABLED` | `false` | **`true`** | Engine selection `entitlements.ts:553`; limits `plan-limits.ts:28`; device cap `seller-session.ts:66`; order quota `catalog.ts:721,801`; category/product limits `api-store.ts:841,1061`; config projection `config.ts:64`; AI reservation `public-worker.ts:616` | `:37`, `:212` |
| `AUTH_IDENTITY_ENABLED` | `true` | `true` | `identity.ts:193`; `api-store.ts:1437,1456`. **`false` on the admin Worker** (`wrangler.admin.jsonc:50,196`) | `:38`, `:213` |
| `ONBOARDING_ENABLED` | `false` | `true` | 4 onboarding/auth-v2 routes + email-verification resend `auth-v2.ts:116-167`; response capability flags `:299,339,421,601,652` | `:42`, `:214` |
| `PASSKEY_ENABLED` | `false` | `true` | All 6 passkey routes `auth-v2.ts:136-162` | `:43`, `:215` |
| `PHONE_CHANGE_ENABLED` | `true` | `true` | `phone-change.ts:23`. **`false` on the admin Worker** (`wrangler.admin.jsonc:51,197`) | `:44`, `:216` |
| `STATIC_CITY_CATALOG_ENABLED` | `true` | `true` | `geo.ts:33,83` | `:45`, `:217` |
| `BUSINESS_TAXONOMY_ENABLED` | `true` | `true` | `business-taxonomy.ts:32`; onboarding category validation `auth-v2.ts:1214` | `:46`, `:218` |
| `MEDIA_RECLAIM_ENABLED` | `false` | `false` | R2 deletion in the nightly sweep `media-reclaim.ts:139` (otherwise dry run `:151`) | `:47-56`, `:219-221` |
| `TURNSTILE_ENABLED` | `false` | `false` | Storefront order challenge `turnstile.ts:50`; **fails closed** without a secret (`:78-84`) | `:57-68`, `:225` |
| `LOCAL_JWT_VERIFICATION` | `false` | `true` | Firebase→local JWT fallback `api-store.ts:185-187`; Play Pub/Sub `google-play.ts:938` | `:84`, `:252` |

### 4.2 Non-flag configuration vars

| Var | Prod | Staging | Gates | Evidence |
|---|---|---|---|---|
| `DEPLOYMENT_ENVIRONMENT` | `production` | `staging` | Fail-closed non-prod guard `shared.ts:79`; edge cache enable `public-worker.ts:143`; mock gateway allowance `billing.ts:62`; webhook signature requirement `billing.ts:760`; staging-only admin routes `admin-entitlements.ts:392` | `:33`, `:195` |
| `PUBLIC_SITE_URL` | `https://orderak.app` | `https://staging.orderak.app` | Every public link: `identity.ts:33-35,146`, `media-reclaim.ts:89` | `:78-83`, `:245` |
| `GOOGLE_PLAY_PACKAGE_NAME` | `app.orderak.seller` | `app.orderak.seller.staging` | Play API package + product mapping `google-play.ts:210,373,1006,1070` | `:71`, `:236` |
| `ANDROID_APP_PACKAGE_NAME` | `app.orderak.seller` | `app.orderak.seller.staging` | `assetlinks.json` `auth-v2.ts:225` | `:72-77`, `:241` |
| `TURNSTILE_SITE_KEY` | `""` | `""` | Widget site key `turnstile.ts:55` | `:69`, `:226` |
| `AI_MONTHLY_BUDGET_MICRO_USD` | `"0"` | `"0"` | `0` ⇒ `ai_budget_not_configured` thrown `deepseek.ts:52-58` | `:70`, `:227` |
| `FIREBASE_PROJECT_ID` | `""` | Firebase project orderak-staging (not a Cloudflare resource) | Firebase Admin deletion `deletion.ts:554,592`; ID-token verify `api-store.ts:186`. **Empty in production ⇒ that path is inert**; absent from `wrangler.admin.jsonc` entirely (`deletion.ts:540-551`) | `:85`, `:253` |
| `WEBAUTHN_RP_ID` | **absent** | `staging.orderak.app` | Only the literal staging string is honoured, everything else → `orderak.app` (`auth-v2.ts:1089-1090`) — production rides a hardcoded constant | `:251` |
| `ADMIN_ORIGIN` | `https://admin.orderak.app` | `https://admin.staging.orderak.app` | CSRF origin check `admin-auth.ts:266` | `wrangler.admin.jsonc:30,167` |
| `ADMIN_TOTP_KEY_CURRENT` | `"2"` | `"2"` | TOTP key version `admin-auth.ts:186-192` | `:44`, `:172` |
| `ADMIN_AUDIT_KEY_CURRENT` | `"2"` | `"2"` | Audit signing version `admin-control-plane.ts:891-898` | `:45`, `:178` |

Flags **absent** from the admin Worker (a difference per environment that makes
"is this feature on" have two answers): `ONBOARDING_ENABLED`, `PASSKEY_ENABLED`,
`STATIC_CITY_CATALOG_ENABLED`, `BUSINESS_TAXONOMY_ENABLED`,
`MEDIA_RECLAIM_ENABLED`, `TURNSTILE_*`, `ANDROID_APP_PACKAGE_NAME`,
`LOCAL_JWT_VERIFICATION`, `FIREBASE_PROJECT_ID`, `WEBAUTHN_RP_ID`.

### 4.3 D1 runtime controls

Reader `runtime-config.ts:2-10`: `SELECT value_json FROM settings WHERE key=?`,
`JSON.parse(...) === true`, any error or missing row → the caller's fallback. The
stated contract (`runtime-config.ts:1`) is that **admin controls may only narrow
deployment configuration, never enable it** — every call site is
`deployFlag === "true" && control`, and no other key is ever passed to it.

| Key | Default | Gates | Read at | Written at |
|---|---|---|---|---|
| `ai_enabled` | `true` | chat `public-worker.ts:587`; second independent read `deepseek.ts:39-45`; admin readout `admin-operations.ts:42,45` | `public-worker.ts:587`, `deepseek.ts:41` | `PATCH /api/admin/v1/runtime-config` (`admin-operations.ts:57-60`, `settings:manage`); also the generic `PUT /api/admin/v1/settings/:key` (`admin-project.ts:149-150`) |
| `billing_enabled` | `true` | acquisition `billing.ts:184`; Play `google-play.ts:139-145`; client paywall signal `config.ts:437-438` | `billing.ts:184`, `config.ts:437` | as above |

Adjacent database-driven controls that are **not** `runtimeControlEnabled` keys:
`settings.theme_colors` (`design-system.ts:683`); `feature_flags` /
`feature_flag_rules` / `store_capability_overrides` with a 30 s isolate cache
(`config.ts:398-412,451-476`) and an `env_gate` column that names a wrangler var
(`config.ts:454-455`; which gate strings exist is DB data — `unverified`);
`app_version_policies` (`config.ts:326-330,342`); `plans` columns
(`config.ts:106-152`, `shared.ts:491-497`); `affiliate_settings`
(`billing.ts:145-148`). `settings` accepts arbitrary keys from any admin with
`settings:manage` (`admin-project.ts:149-150,561`), while only two keys are
consumed — nothing constrains key names.

### 4.4 Local / dev-only variables

| Name | Set where | Effect |
|---|---|---|
| `LOCAL_ADMIN_ENABLED` | never in either wrangler file; injected as `--var LOCAL_ADMIN_ENABLED:true` by `package.json:11-13` | Opens the local bearer/JWT admin path `admin-auth.ts:134,138,158,220,263`; skips the posture gate `admin.ts:43-45` |
| `ADMIN_JWT_SECRET` | `wrangler-types.env:3`, `.dev.vars.example:10` | Read only under `LOCAL_ADMIN_ENABLED` (`admin-auth.ts:220-221`); inert on deployed Workers |
| `ADMIN_BREAK_GLASS_IP_ALLOWLIST` | not on production (`wrangler.admin.jsonc:102-103`) | Unset ⇒ every break-glass request denied (`admin-auth.ts:160-167`) |
| `ALLOW_UNVERIFIED_REGISTRATION` | never set | `api-store.ts:458` — fail-closed |
| `STRIPE_SECRET_KEY` | nowhere | Declared `env.d.ts:50`; read nowhere; only a commented line remains (`payments.ts:144`) |

`process.env` / `import.meta.env`: **zero matches** in `services/backend/src`.

---

## 5. Third-party integrations, bindings and secrets

### 5.1 Integrations

| Integration | Code | Binding / secret | Production state |
|---|---|---|---|
| **Firebase** (Auth phone OTP) | `api-store.ts:166-212`, `platform/auth/local-jwt.ts` | `FIREBASE_WEB_API_KEY` (required, both envs), optional `FIREBASE_PROJECT_ID` | Live: `FIREBASE_WEB_API_KEY` required; local JWT verification off |
| **Firebase Admin** (identity deletion) | `deletion.ts:540-600` | `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_EMAIL`, `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` | **Inert**: project id is `""` and both service-account values are in no required list |
| **DeepSeek** (AI chat) | `integrations/ai/deepseek.ts` | `DEEPSEEK_API_KEY` (required), `DEEPSEEK_INPUT/OUTPUT_MICRO_USD_PER_MILLION`, `AI_MONTHLY_BUDGET_MICRO_USD` | `DEEPSEEK_API_KEY` required, but the feature is double-gated off **and** would throw `ai_budget_not_configured` (`deepseek.ts:52-58`) |
| **Google Play** (billing/RTDN) | `integrations/google-play/google-play.ts` (1,193 lines) | `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL/_PRIVATE_KEY`, `GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY`, `GOOGLE_PLAY_PUBSUB_AUDIENCE`, `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL` | All five in **no** `secrets.required` list; feature off; only `GOOGLE_PLAY_LIFECYCLE_ENABLED=false` keeps it unreachable |
| **Cloudflare Email Sending** | `email/providers/cloudflare.ts`, `send_email` binding `EMAIL` | `EMAIL_FROM`, `FORWARD_TO` | `FORWARD_TO` required in production; `EMAIL_FROM` optional (falls back to `DEFAULT_FROM`) |
| **Cloudflare Email Routing (inbound)** | `email/inbound.ts`, Worker `email()` | — | Live |
| **Cloudflare Turnstile** | `platform/http/turnstile.ts` | `TURNSTILE_SITE_KEY` (var), `TURNSTILE_SECRET` | Off; secret deliberately not required (`env.d.ts:73-83`) |
| **Cloudflare R2** | `orderak_media` (both Workers), `orderak_audit` (admin) | — | Live (media); audit archives live |
| **Cloudflare Queues** | `orderak-email(+dlq)`, `orderak-play-billing(+dlq)`, `orderak-admin-exports(+dlq)` | — | Email live; Play queues exist but no producer runs; export queue live |
| **Cloudflare Durable Objects** | `RateLimiter` (`rate-limiter.ts`) | `RATE_LIMITER` | Present in both `wrangler.jsonc` blocks; **the code's own comment says the binding has never been deployed to production** (`rate-limiter.ts:70-72`) — deployment state `unverified` |
| **Cloudflare D1** | `orderak_db` (both Workers, same ids per env), `orderak_geo` | — | Live; geo read replication must be enabled via dashboard/API, not wrangler (`wrangler.jsonc:117-120`) |
| **Geo data** (GeoNames, CSC) | `scripts/import-geonames.mjs`, `import-csc-cities.mjs`, `geo-migrations/001_csc_city_catalog.sql` | — | Two parallel city datasets exist in D1 (`geo_cities*` legacy + `city_catalog*` current) |
| **Sentry** | `withSentry` in both Workers | `SENTRY_DSN` (required, both envs both Workers) | Live; traces sample rate 0.1/0.05 (`wrangler.jsonc:26-30`) |
| **Postmark / Resend / other email providers** | — | — | **None.** `providers/` contains only `cloudflare.ts` (`CloudflareEmailProvider` + `NoopProvider`) |
| **Stripe / Paymob / Fawry** | — | — | **None implemented.** Only `MockGateway` (`payments.ts:143-146`) |

### 5.2 Secrets

Required lists — public production (`wrangler.jsonc:161-170`): `BUYER_PRIVACY_PEPPER`,
`DEEPSEEK_API_KEY`, `FIREBASE_WEB_API_KEY`, `FORWARD_TO`, `PAYMENT_WEBHOOK_SECRET`,
`SENTRY_DSN`. Public staging (`:187-193`): 3 of those. Admin production
(`wrangler.admin.jsonc:126-139`) and staging (`:151-164`): the **identical** 10 —
`ADMIN_API_KEY`, `ADMIN_AUDIT_KEY_V2`, `ADMIN_AUDIT_SIGNING_KEY`,
`ADMIN_EXPORT_SIGNING_KEY`, `ADMIN_RECOVERY_PEPPER`, `ADMIN_SESSION_PEPPER`,
`ADMIN_TOTP_KEY_V1`, `ADMIN_TOTP_KEY_V2`, `BUYER_PRIVACY_PEPPER`, `SENTRY_DSN`.

**14 distinct required secret names; 34 names declared in `OrderakSecrets`
(`env.d.ts:11-84`) plus `ADMIN_API_KEY` and `SENTRY_DSN` = 36 secret-shaped names.**
Every required name has a read site. **No** required name is unread.

Read in code but in **no** required list (so a missing value is caught at runtime,
not deploy time):

| Secret | Read at | Consequence when unset |
|---|---|---|
| `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL` / `_PRIVATE_KEY` | `google-play.ts:182,188,196` | Play auth throws |
| `GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY` | `google-play.ts:237-238` | `google_play_encryption_key_missing` |
| `GOOGLE_PLAY_PUBSUB_AUDIENCE` / `_SERVICE_ACCOUNT_EMAIL` | `google-play.ts:934-962` | RTDN verification returns false |
| `FIREBASE_SERVICE_ACCOUNT_EMAIL` / `_PRIVATE_KEY` | `deletion.ts:554,561,569` | Firebase deletion disabled |
| `DEEPSEEK_INPUT/OUTPUT_MICRO_USD_PER_MILLION` | `deepseek.ts:53-54` | `ai_budget_not_configured` |
| `TURNSTILE_SECRET` | `turnstile.ts:77` | fails closed |
| `WEBAUTHN_ANDROID_ORIGINS`, `WEBAUTHN_WEB_ORIGIN`, `WEBAUTHN_RP_ID`, `ANDROID_RELEASE_SHA256_CERT_FINGERPRINTS` | `auth-v2.ts:230,1077,1084,1089` | passkey ceremonies and Asset Links refused |
| `EMAIL_FROM`, `ALLOW_UNVERIFIED_REGISTRATION`, `ADMIN_BREAK_GLASS_IP_ALLOWLIST`, `ADMIN_JWT_SECRET` | `emailQueue.ts:134`, `api-store.ts:458`, `admin-auth.ts:160,134-138,220` | all fail closed |
| `STRIPE_SECRET_KEY` | nowhere (`payments.ts:144` commented out) | **declared and unread — removable** |

## 6. What is not wired up, reachable, or needed

### 6.1 Registered but permanently unreachable in the checked-in production baseline

| Surface | Routes | Why unreachable |
|---|---|---|
| Coupons + referrals | `/api/v1/coupons/validate`, `/apply`, `/api/v1/referral/apply`, `/stats` | `BILLING_ENABLED=false` + `settings.billing_enabled` (`billing.ts:183-184`) → 403 |
| Subscribe / cancel / payment webhook | `/api/v1/subscribe`, `/api/v1/cancel`, `/api/integrations/v1/payment` | same gate |
| Google Play lifecycle | `/api/v1/billing/google/verify`, `/api/v1/billing/verifications/{id}`, `/api/integrations/v1/google-play/rtdn` | `GOOGLE_PLAY_LIFECYCLE_ENABLED=false` → 403 |
| AI chat | `/api/v1/chat` | `AI_ASSISTANT_ENABLED=false` (`public-worker.ts:587`) **and** `AI_MONTHLY_BUDGET_MICRO_USD="0"` would refuse anyway |
| Onboarding v2 | `/api/v1/auth/phone/complete`, `/api/v1/onboarding/{account,complete,slug/check}` | `ONBOARDING_ENABLED=false` → 503 |
| Email verification resend | `/api/v1/account/email/verification/resend` | `ONBOARDING_ENABLED=false` although it serves existing accounts |
| Passkeys (all six, including sign-in) | `/api/v1/auth/passkeys/*` | `PASSKEY_ENABLED=false` → 503 |
| Media reclaim | nightly job | `MEDIA_RECLAIM_ENABLED=false` → dry run only (`media-reclaim.ts:139-151`) |
| Turnstile challenge | storefront order path | `TURNSTILE_ENABLED=false`, site key `""` |
| Break-glass admin auth | `POST /api/admin/v1/auth/bootstrap`, `/auth/password/reset` | `ADMIN_BREAK_GLASS_IP_ALLOWLIST` unset ⇒ deny all (`admin-auth.ts:160-167`) |
| Local admin bearer | all admin routes, alternate path | `LOCAL_ADMIN_ENABLED` set in no environment |
| `/verify-email` on API hosts | `auth-v2.ts:195` | Host fence at `public-worker.ts:295-297` 404s it before the interceptor at `:307` |
| `GET /api/v1/account/deletion-request` in `api-store.ts:307` | — | Shadowed by `seller-operations.ts:88` (registered earlier at `public-worker.ts:432` vs `:444`); the `"GET"` in its `Allow` list is unreachable |

### 6.2 Code with no caller

| Symbol | Definition | Status |
|---|---|---|
| `loadBrandingConfig` | `design/theme.ts:149` | No caller anywhere in the repo |
| `loadTheme` | `design/theme.ts:110` | Only caller is the dead `loadBrandingConfig` ⇒ unreachable |
| `effectiveAppVersionPolicy` | `admin-control-plane.ts:248` | No caller; a **private duplicate** `effectiveVersionPolicy` (`config.ts:326`) does the work. `docs/domains/admin-control-plane.md:101` still names the dead one as the reader |
| `isEntitlementEnabled` | `entitlements.ts:683` | Zero references |
| `entitlementDenied` | `entitlements.ts:715` | Zero references (`entitlementLimitReached` `:782` and `limitReached` `plan-limits.ts:69` are what routes use) |
| `customerKeyFor` | `identity/phone.ts:147` | Zero references |
| `newStoreCode` | `identity/identity.ts:78` | Test-only (`test/identity.spec.ts:6,42`); production uses `uniqueStoreCode` |
| `RateLimiter.reset()` | `rate-limiter.ts:197` | No caller in `src/` |
| `mergeTheme`, `DEFAULT_THEME`, `THEME_KEYS`, `isHexColor` | `design/theme.ts:39-101` | Used only by `test/theme.spec.ts` |
| `invalidateFeatureFlagCache` | `config.ts:410` | Test-only (`test/helpers.ts:137`) |
| `MAX_PUBLIC_PAYLOAD_BYTES` | `design-system.ts:21` | Test-only |
| `contrastRatio`, `LEGACY_DEFAULT_THEME`, `detectImageType`, `evaluateFlag`, `verifyAuditArchives`, `createSecurityAlert`, `classifyAdminQueue`, `genCode` | as cited | Exported, only ever called inside their own module — narrowing the export surface is safe |

### 6.3 Misleading names and duplicated concerns

| Pair | Reality |
|---|---|
| `identity/auth.ts` (413 lines) vs `identity/auth-v2.ts` (1,361 lines) | `auth.ts` contains **no seller-auth routes at all**: it is the shared crypto + admin JWT + TOTP + RBAC module (`keyedHash`, `encryptSecret`, `hashPassword`, `signJwt`, `verifyTotp`, `ROLE_PERMISSIONS`). It is imported by `admin-auth.ts`, `config.ts`, `shared.ts`, `catalog.ts` — a domain module that `platform/` depends on. `auth-v2.ts` is the *seller* auth surface. The names suggest a v1/v2 pair; they are unrelated |
| `identity/identity.ts` (413 lines) vs `identity/auth.ts` | `identity.ts` is store identity + Firebase-identity join (`syncVerifiedFirebaseIdentity`, `findStoreByIdentifier`), not auth |
| `commerce/entitlements.ts` (919 lines) vs `commerce/legacy-entitlements.ts` (127 lines) | `legacy-entitlements.ts` holds **no logic** — it is a constant catalogue (`LEGACY_FEATURE_ENTITLEMENTS:58`, `LEGACY_LIMIT_KEYS:133`). It is the *live* answer in production; the file name says otherwise |
| `domains/design/theme.ts` + `domains/design/design-system.ts` + `domains/admin/admin-theme.ts` + `domains/design/app-screen-manifest.ts` | Three theme systems: an 8-key `Theme` (`theme.ts:39`) whose loader is dead; an MCU-based generator with revisions (`design-system.ts` 925 lines, migrations 035/036); and the admin theme app (467 lines). Plus a 91-line Android screen manifest used only by the admin project screen |
| `evaluateFlag` (`admin-control-plane.ts:191-214`) vs `effectiveFeature` (`config.ts:441-479`) | Two implementations of the same flag rule with separate bucketing helpers; only one has the 30 s cache |
| `checkRateLimit` (`shared.ts:667-699`) | Two implementations inside one function: Durable Object, then D1 fallback |
| `legacyProjection` in `design-system.ts:592` vs `legacyProjection` in `config.ts:175` | Two different functions with the same name in different domains (design vs entitlements) |

### 6.4 TODOs

Four markers exist in the whole of `src/`, all in `deletion.ts` — entries 228, 232
(`product_variants`, `product_media`), 401 (`seller_bank_accounts`), 469. Zero
`FIXME`/`HACK`/`XXX`/`WIP`. All 30 `@deprecated` hits are inside the generated
bindings file.

### 6.5 Stale claims (documentation drift)

| Claim | Reality |
|---|---|
| `docs/domains/entitlements.md:14` — "`ENTITLEMENTS_ENABLED` is `false` in production and staging" | Staging is `"true"` (`wrangler.jsonc:212`) |
| `docs/domains/admin-control-plane.md:101` names `effectiveAppVersionPolicy` as the version-policy reader | That export has no caller; `config.ts:326` does the work |
| `deletion.ts:5` comment advertises `POST /api/admin/v1/process-deletions` | The real trigger is `POST /api/admin/v1/operations/jobs/:key{retention\|deletions\|google-play}/run` (`admin-operations.ts:464`) |
| `wrangler.admin.jsonc:10-12` — production deploys "FROZEN as of 2026-08-24" | `wrangler.jsonc:11-13` and `production-deploy.yml:51-58` say they are re-enabled via the `PRODUCTION_DEPLOYS_ENABLED` repository variable |
| `public-router.ts:156` — "from the content_pages table" | The queries read `content_page_versions` (`:162,:178`) |
| `docs/architecture/data-classification.md:95` and `retention-matrix.md:116` classify `content_pages` as live | No runtime query touches it |
| `rate-limiter.ts:70-72` — the `RATE_LIMITER` binding "has never been deployed to production" | `wrangler.jsonc:98-105` declares it for production. Which is true on the live Worker is `unverified` |

---

## 7. Capability necessity classification

Every capability is classified as exactly one of KEEP / KEEP-BUT-SIMPLIFY / FIX /
DEFER / DELETE, with evidence, purpose, users, cost and a one-line recommendation.

| Capability | Class | Evidence | Why it exists / who uses it | Cost | Recommendation |
|---|---|---|---|---|---|
| Seller phone+secret auth (`authSeller`, `seller_devices`, register, session restore, logout) | **KEEP** | `shared.ts:351-430,560-572`; `api-store.ts:242-269,1418+`; migration 018 | Every installed Android build; the primary credential today | ~200 lines core + PBKDF2 rehash migration path; `seller_devices` table | Ship as is |
| Firebase phone OTP identity | **KEEP** | `api-store.ts:166-212`; `local-jwt.ts`; migrations 032 | Primary sign-in; the backend never sees the code | 1 required secret; two verification paths (`LOCAL_JWT_VERIFICATION`) | Ship as is |
| Onboarding registration v2 (`/onboarding/*`, `onboarding_sessions`) | **FIX** | `auth-v2.ts:115-175,314+`; migration 033; `ONBOARDING_ENABLED=false` in production (`wrangler.jsonc:42`) | The intended replacement sign-up flow; resumable draft | ~250 lines in auth-v2 + a 1:1 table; also gates an unrelated resend route (`auth-v2.ts:166`) | Untangle `ONBOARDING_ENABLED` from email-verification resend before either ships |
| Passkeys (WebAuthn, 6 routes) | **DEFER** | `auth-v2.ts:135-162,689-1000`; `@simplewebauthn/server`; migration 033; `PASSKEY_ENABLED=false` prod | Release-planned passwordless sign-in; staging-tested | ~450 lines; 4 WebAuthn vars in no required list; Asset Links dependency; Android ceremony tests; a release checklist in `docs/product/production-auth-plan.md` | Keep behind the flag; stop treating it as a supported capability until Play signing lands |
| Product catalog sync (products CRUD, stock adjust, `client_request_id`) | **KEEP** | `api-store.ts:353-372`; migrations 052,058,059 | The seller's core loop; Android syncs against it | ~700 lines in api-store; 3 stock triggers; plan-limit branches | Ship as is |
| Public storefront + city geo | **KEEP** | `public-router.ts:277-303`; `catalog.ts` (993 lines); `geo.ts`; `orderak_geo` D1; geo-migrations/001 | The buyer-facing product and the SEO surface; money path | Second D1 database, FTS5 indexes, 15,540-line generated bindings for it, two parallel city datasets | Collapse `geo_cities*` onto `city_catalog*` and drop the legacy stack |
| Orders (create/list/status advance, idempotency, stock ledger) | **KEEP** | `public-worker.ts:664-887`; `catalog.ts:createOrder`; migrations 026,046,051,052,056 | Both the storefront path and manual orders; the monthly plan meter | ~350 lines; 2 triggers; a duplicated transition table that mirrors `OrderStatus.kt` | Ship as is; the duplicated transition table is deliberate and documented |
| Customers CRM | **KEEP** | `customers.ts` (265 lines); `seller-operations.ts:20-24`; migration 053 | Newest seller-facing resource; editable profiles | 1 table, 1 migration, 2 routes; PATCH gated on an entitlement that production answers from the legacy path | Ship; confirm the entitlement gate behaves identically on both engines |
| Support tickets + messages | **KEEP** | `seller-operations.ts:96-145`; `admin-operations.ts:318-368`; migration 003 | Seller↔support thread; admin assignment | 2 tables, 4+5 routes, no gate | Ship as is |
| Announcements + read receipts | **KEEP** | `seller-operations.ts:147-188`; `admin-operations.ts:370-395`; migration 027 | Plan-targeted seller comms; dashboard unread count | 2 tables, 3+2 routes | Ship as is |
| Catalog translation review (seller + admin) | **KEEP-BUT-SIMPLIFY** | `seller-operations.ts:190-239`; `admin-operations.ts:410-443`; `product-translations.ts`; migrations 017,020 | Lets a seller review AI-generated translations and fall back to authored text | 2 write paths over one table, a CROSS JOIN query with a computed status (`:193-204`), provenance columns | Pick one review authority (seller) and make the admin route read-only |
| Devices + passkey management | **KEEP** | `seller-operations.ts:241-271`; `admin-operations.ts:444-452`; migration 018 | Device cap enforcement and lost-device recovery | Device list synthesises the primary row from `sellers` (`:246-256`) — two sources of truth for "devices" | Make `seller_devices` hold every device including the primary |
| Account deletion | **FIX** | `deletion.ts` (635 lines); `public-router.ts:82-116`; migrations 022,027,028; `deletion.ts:155,554` | Google Play requires a published deletion URL; repository's only P0 (`docs/index.md`, ISS-013) | 635 lines, 2 intake paths + 1 cron + admin verify/retry; external Firebase + gateway calls that cannot be verified from the repo; both external steps are inert in production | Set `FIREBASE_PROJECT_ID` or delete the Firebase branch; make the gateway-cancel step not depend on `BILLING_ENABLED` |
| Phone change | **KEEP** | `phone-change.ts`; migration 032; `PHONE_CHANGE_ENABLED=true` | Lets a seller keep their account when the number changes | 1 table, 2 routes, applies the version gate itself (`:52`) | Ship as is |
| Billing: subscriptions, legacy plans, coupons, referrals, mock gateway | **DEFER** | `billing.ts` (846 lines); `plans.ts`; `payments.ts` (146 lines, mock only); `admin.ts:84-98,158-215`; migrations 002,044,045,056 | Free-launch policy is the product; paid acquisition is administratively closed | 846 + 146 + 104 lines; ~10 tables; 7 gated routes; a `MockGateway` that cannot take money; `STRIPE_SECRET_KEY` declared and unread | Freeze as DEFER: no new work, delete the commented Stripe line, and delete the code outright if the paid launch slips a quarter |
| Entitlements v2 engine (versioned revisions, usage reservations) | **KEEP-BUT-SIMPLIFY** | `entitlements.ts` (919 lines); `plan-limits.ts`; migrations 024,025,030,047; `docs/domains/entitlements.md:43-88` | Org-scoped, versioned, metered limits — the correct long-term model | 18 tables created in one migration; two complete plan systems in the schema; `resolveEntitlementsForClient` has a documented second fallback to the legacy shape (`entitlements.ts:553-561,636`) | Pick one engine and delete the other's fallback; today production and staging disagree |
| `legacy-entitlements.ts` constant catalogue | **KEEP** | `legacy-entitlements.ts:58-133`; imported by `entitlements.ts:8` and `config.ts:14,91` | It is the code path that actually answers in production | 127 lines of constants | Keep while the legacy path lives; it is not the duplication — `entitlements.ts` is |
| Coupons / referrals / affiliates | **DEFER** | `billing.ts:43-51,204-224`; `admin.ts:88-98,208-215`; tables `coupons`, `coupon_uses`, `referrals`, `affiliate_settings` | Monetisation and acquisition; useless while purchase is closed | 4 tables; 6 gated routes + 8 admin routes; `docs/domains/growth.md:95-97` states no referral can currently qualify | Keep behind `BILLING_ENABLED`; no further work until a payment gateway exists |
| Payouts / commissions | **DEFER** | `admin.ts:96-98,214-215`; `affiliate_settings.min_payout_minor` (migration 044) | Marks a referral commission paid | 1 admin write path with no ledger and no payment integration (`markReferralPaid` only flips `status='paid'`) | Delete when referrals go, or build the ledger before it can be used |
| Ads / campaigns | **KEEP** | `ads.ts` (134 lines); `admin.ts:100-102,217-248`; `docs/domains/growth.md:40-64` | Free sellers see ads — the model that pays for free accounts; explicitly **not** behind `BILLING_ENABLED` | 2 tables, 2 seller routes + 3 admin routes, `plans.ads_enabled` | Ship as is |
| Email — transactional + outbox + templates + inbound | **KEEP** | `integrations/email/*` (9 files); migrations 004,005,039b,040,042; consumer `public-worker.ts:539` | Auth mail, verification links, support copies, inbox | ~1,900 lines across 9 files; 6 tables; a queue + DLQ + outbox + sweep + admin template editor; one migration (039b) exists only to repair schema drift | Keep; remove 039b's condition by asserting the schema in CI |
| Exports / CSV to R2 | **KEEP-BUT-SIMPLIFY** | `admin-control-plane.ts:612-880`; `r2-csv-writer.ts`; `admin-worker.ts:154-167`; queues `orderak-admin-exports(+dlq)` | Admin data export with signature + one-use download token | 1 PRIVATE generation path with a queue **and** an inline fallback (`:625-629`), a signed archive, a download cookie, and the only admin route with no RBAC permission | Add `export:view` to the file route; drop the inline fallback |
| Admin RBAC + TOTP + sessions + recovery | **KEEP** | `identity/auth.ts:271-413`; `admin-auth.ts` (670 lines); migrations 003,028,029,043 | Protects the money and the control plane | ~1,100 lines; 2 versioned TOTP keys + 2 audit keys + 2 peppers, all required in both environments; ~70 permission strings of which 25 are owner-only | Keep; collapse the owner-only permission strings into a smaller explicit set |
| Admin control plane (flags, app versions, buyers, security, content, macros) | **KEEP-BUT-SIMPLIFY** | `admin-control-plane.ts` (1,040 lines); 38 registrations; migration 028 | The operating surface for the platform | 1,040 lines + 15 tables + 4 export queue/idempotency concepts; flags also have a seller-side cache and a separate simulator implementation | Delete the simulator's duplicate evaluator; move buyers/privacy to a single read model |
| Admin project tooling (roadmap/tasks/screens/endpoints/prompts/design-assets/releases/bugs/docs) | **DELETE** | `admin-project.ts:35-144` (45 registrations, 598 lines); `migrations/010_project_admin.sql`; 8 tables; `app-screen-manifest.ts` + 7 app_screen migrations | Internal engineering tracking; the repo already has `docs/` and GitHub for this | 598 lines of routes + 9 tables + a manifest + 3 verifiers + CI gates; and it makes `ai_prompts` (a **product** runtime dependency, `public-worker.ts:901`) live in a tooling schema | Delete the trackers from the product database; move `ai_prompts` to its own small table or a config var |
| Design system + theme builder + revisions | **KEEP-BUT-SIMPLIFY** | `design-system.ts` (925 lines); `admin-theme.ts` (467 lines); `theme.ts` (157 lines, loader dead); migrations 035,036; 4 npm scripts; 3 test files | One source of truth for Android + storefront + web tokens | 1,549 lines of generator+admin, 2 tables, a destructive rebuild migration (036), 6 font files, fixture/benchmark/seed scripts | Fix the version-gate note in `theme.ts:16-17`; collapse it to the legacy projection only and delete `theme.ts` |
| AI assistant chat | **DEFER** | `deepseek.ts` (200 lines); `public-worker.ts:585-649`; `provider-circuit.ts`; tables `ai_provider_usage_events`, `ai_budget_alerts`, `ai_prompts`; `ADMIN` readout `admin-operations.ts:45` | First milestone of the original product plan; currently the least-reachable feature | 200 lines + circuit breaker + 2 tables + 1 required secret + budget config that is zero | Set the budget and rates or delete the route; today it is three values away from working and priced at zero |
| Provider circuit breaker | **KEEP-BUT-SIMPLIFY** | `provider-circuit.ts` (138 lines); consumers `deepseek.ts:136`, `google-play.ts:150` | Absorbs provider outages without hammering them | 138 lines + a shared D1 state row; both consumers are flag-off in production | Keep; it is small and correct, but it currently protects nothing that runs |
| Rate limiting (Durable Object + D1 fallback) | **KEEP-BUT-SIMPLIFY** | `rate-limiter.ts` (202 lines); `shared.ts:629-699`; DO binding `wrangler.jsonc:98-105`; migration 002 | Protects login, register, chat, media upload, deletion intake, theme preview | Two implementations behind one function; a DO class that must be exported from the Worker entrypoint (`public-worker.ts:54`); a legacy `rate_limits` table kept alive only for the fallback | Confirm whether the DO is deployed; if yes delete the D1 path, if no delete the DO |
| Observability / measurement | **KEEP** | `measurement.ts`; `shared.ts:507` `logError`; `operational_jobs.ts`; `error_logs`, `operational_job_runs`; Sentry in both Workers | Error triage and cron health | 2 tables, 1 required secret, buffered latency samples flushed in `finally` | Extend `runObservedJob` to the three admin-Worker cron jobs, which currently bypass it |
| Provider/app version governance | **KEEP** | `config.ts:248-342`; `app_version_policies`; `BLOCKING_VERSION_STATUSES:342`; enforced `public-worker.ts:419-426` | Kill switch for broken client builds; enforced on writes only | 1 table + a middleware + the dead `effectiveAppVersionPolicy` duplicate | Delete the dead export; keep the enforcement |
| Staging subscription test lab | **KEEP** | `admin-entitlements.ts:42-45,391-473`; guarded by `DEPLOYMENT_ENVIRONMENT === "staging"` | Lets staff rehearse plan changes without touching production | 2 routes, ≤24 h overrides tagged `[TEST_LAB:` | Keep; it is cheap and correctly fenced |
| Tenant routing / shard-ready organizations | **KEEP-BUT-SIMPLIFY** | `tenant-routing.ts` (148 lines); `identity.ts:310-320`; migrations 024,032; middleware `public-worker.ts:398-406` + `api-store.ts:291-304` | Pre-builds the organization/shard model so a future shard move does not require a rewrite | Every credentialed non-GET pays 2 D1 reads to fence a tenant that is 1:1 with the store today; the fence is also re-implemented per module (`api-store.ts:291-295` enumerates paths by hand) | Keep the model; compute the fence once in middleware instead of in each module |
| Media / R2 storage | **KEEP** | `media.ts`; `api-store.ts:375-383`; migration 055 | Product photos on the storefront | Signature sniffing, 5 MB cap, 60/hour, `media_objects` provenance | Ship as is |
| Media reclaim sweep | **DEFER** | `media-reclaim.ts`; `MEDIA_RECLAIM_ENABLED=false`; cron `public-worker.ts:529` | Reclaims orphaned R2 objects | Runs every night to produce a dry-run log; `media_objects` table exists to make it safe | Keep off; either flip it after a watched dry run or stop running the job nightly |
| Jobs / queues / DLQ | **KEEP-BUT-SIMPLIFY** | `emailQueue.ts`, `google-play.ts` dispatchers, `admin-control-plane.ts` exports; `admin-worker.ts:98-175`; `operational_leases` | Decouples email, Play verification and exports from the request path | 3 queue families × (queue + DLQ) = 6 queues; lease tables; Play's queue has no producer while the flag is off; admin cron work is invisible to the jobs readout | Delete the Play queues' consumers while the flag is off, and route admin cron through `runObservedJob` |
| Turnstile bot challenge | **DEFER** | `turnstile.ts`; `TURNSTILE_ENABLED=false`; `TURNSTILE_SITE_KEY=""` | Guards the one unauthenticated write path (storefront orders) | 113 lines + 2 vars + 1 optional secret + CSP origin | Keep off until a widget exists; today it is a control with no configuration anywhere |
| i18n / localization (ar/en/fr) | **KEEP** | `i18n.ts` (140 lines); 3 message files; `content_page_versions`; `storefront_locale_definitions` | Storefront and API responses in the buyer's language; versioned architecture contract | 3 message files + locale columns + a fallback ordering rule | Ship as is |
| Legal versions + acceptances | **KEEP** | migrations 012,021,023,034,038; `legal_acceptances`; `public-router.ts:159-228` | Evidence that a seller accepted a specific policy version | 4 publication migrations and a table; `content_pages` is the dead predecessor | Keep; drop `content_pages` |
| Retention sweep (17 rules) | **KEEP** | `retention.ts`; `CLEANUP_RULES`; cron `public-worker.ts:522`; `docs/governance/retention-matrix.md:149` | Deletes or de-identifies technical records within 30 days | 17 rules, batched 1,000 × 10 per run; the code is the authority and the matrix must agree | Ship as is |
| Money helpers (minor units + currency) | **KEEP** | `money.ts`; ADR-009; migration 044 | One wire shape for every amount | 160 lines; a 9-table column rename behind it | Ship as is |
| Public contract registry | **KEEP** | `src/contracts/registry.ts` (135 lines); consumed by `contracts/openapi/scripts/extract-response-schemas.mts:22` | Keeps `/api/v1/orders` response shapes truthful in the OpenAPI spec | 135 lines in `src/`, imported only by a build script | Ship as is |

---

### 7.1 Executed 2026-09-26 — dead code removed

The removal candidates below were proposals. These are the ones that needed no
schema change, no route change and no approval, were confirmed to have zero
references anywhere in the repository, and have now been deleted:

| Deleted | Was at | Why it was safe |
| --- | --- | --- |
| `loadBrandingConfig` and the `loadTheme` wrapper it called, plus `BrandingConfig`, `BRAND_ASSETS`, `sha256Short` and the branding cache with its TTL | `domains/design/theme.ts` | One reference in the whole repository: the wrapper called by the dead function. `/api/v1/theme` is what clients read, and it caches inside the design-system loader. `invalidateThemeCache` stays — `admin-project.ts:563` calls it — with the branding line removed. |
| `effectiveAppVersionPolicy` | `domains/admin/admin-control-plane.ts:248` | Zero references. A second implementation of a resolve that `platform/config/config.ts` already performs, which is exactly the kind of duplicate this review flagged. |
| `isEntitlementEnabled` | `domains/commerce/entitlements.ts:683` | Zero references. `entitlementAllows` is the live gate, and it resolves through the same function the client gates on. |
| `entitlementDenied` | `domains/commerce/entitlements.ts:715` | Zero references. The live refusal path builds its own response. |

68 lines removed across three files, with no behaviour change: backend suite
476 tests passed, the architecture map and the deployment map both verify.

Not executed, and still proposals: everything needing a migration or a route
change — the admin project tooling and its nine tables, the four unreferenced D1
tables, the Play Billing queues while their flag is off, and one of each of the
duplicated pairs (rate limiter, entitlements engine, legacy plan path). Those are
schema and deployment changes, and they are still awaiting an explicit decision.

**Settled since, in [`../backend-deletions.md`](../backend-deletions.md):**
`items` and `content_pages` are retired by
`migrations/060_retire_dead_tables.sql`, renamed rather than dropped so the change
is reversible without a restore. `geo_city_names` and `geo_city_search` are
**refused** — this inventory called them src-unreferenced, which is true, but
three maintenance scripts still read them, and retiring a table out from under a
recovery tool is how a bad night gets worse. The nine internal-project tables are
**refused too**: the DELETE verdict rested on what those tables exist *for*, while
ten live panel sections read them, so retiring them is a product decision rather
than an engineering one.

## 8. Cost ledger

Line counts are `(Get-Content file).Count` (true line counts, not
`Measure-Object -Line`, which undercounts by ~5 %). "Files" = hand-written
`.ts`/`.mts`/`.mjs`/`.sql` only.

### 8.1 Backend source by folder

| Folder | Files | Lines | Share of `src/` |
|---|---|---|---|
| `src/generated/` (wrangler typegen) | 2 | **15,540** | 41.0 % |
| `src/domains/admin/` | 8 | 4,061 | 10.7 % |
| `src/domains/identity/` | 8 | 3,448 | 9.1 % |
| `src/platform/` | 18 | 3,063 | 8.1 % |
| `src/integrations/` | 11 | 2,810 | 7.4 % |
| `src/domains/commerce/` | 7 | 2,388 | 6.3 % |
| `src/domains/stores/` | 1 | 1,494 | 3.9 % |
| `src/domains/catalog/` | 4 | 1,458 | 3.8 % |
| `src/entrypoints/` | 3 | 1,401 | 3.7 % |
| `src/domains/design/` | 3 | 1,176 | 3.1 % |
| `src/domains/operations/` | 2 | 282 | 0.7 % |
| `src/domains/customers/` | 1 | 265 | 0.7 % |
| `src/landing.ts` | 1 | 233 | 0.6 % |
| `src/env.d.ts` | 1 | 152 | 0.4 % |
| `src/contracts/registry.ts` | 1 | 135 | 0.4 % |
| **`src/` total** | **71** | **37,906** | 100 % |
| — of which hand-written | 69 | **22,366** | 59.0 % |

### 8.2 Supporting material

| Area | Files | Lines | Notes |
|---|---|---|---|
| `test/` | 58 | 10,331 | 44 vitest specs + `helpers.ts` (550 lines) + 2 smoke scripts; ~46 % of hand-written source |
| `migrations/` | 61 | 6,572 | 114 tables, 62 lock entries |
| `geo-migrations/` | 1 | 46 | 3 tables in a second D1 database |
| `scripts/` | 25 | 4,141 | Import, verify, seed, benchmark, reconcile — 13 are CI or operator gates |
| `assets/` | 30 files | — | Fonts (8 woff2), brand SVGs/PNGs, `_headers`, PWA manifest |
| `contracts/openapi/src/` | 4 JSON | 60,593 | `seller-v1.json` 19,931 / `admin-v1.json` 40,146 / `integrations-v1.json` 516 / `common.json` |
| `contracts/openapi/scripts/` | 17 | — | Inventory, coverage, sharding, portal build, live fuzz |
| `contracts/typescript/admin.ts` | 1 | 104 | Shared admin contract types |
| `.github/workflows/` | 20 | — | 4 run backend tests; 2 deploy; 1 nightly live contract; 1 D1 backup; 1 restore drill; 1 infra drift |

### 8.3 Counts at a glance

| Measure | Count |
|---|---|
| Migrations | **62** (61 in `migrations/`, 1 in `geo-migrations/`); highest = `059` |
| D1 tables after all migrations | **114** (111 + 3 geo); 4 with no reachable reader, 8 live-but-misplaced internal tables |
| Deploy-time feature flags | **13** (all string-compared to `"true"`) |
| D1 runtime controls actually consumed | **2** (`ai_enabled`, `billing_enabled`) |
| Non-flag config vars | **11** distinct names across the two Workers (`wrangler.jsonc:32-86` + `wrangler.admin.jsonc:28-60`) |
| Admin-only var differences per environment | **10** flags/vars present on one Worker but not the other |
| Secret names | **36** declared/documented; **14** required at deploy time; **18** read but not required; **1** (`STRIPE_SECRET_KEY`) declared and never read |
| HTTP route registrations | **93** on the public Worker (61 seller spec paths + 2 integration paths, incl. 11 storefront) + **183** on the admin Worker (134 admin spec paths) = **276** |
| Admin RBAC permission strings | ~**70** required by routes; **25** granted to no non-role owner; **2** declared and never required |
| Queue families | **3** × (queue + DLQ) = 6 queues |
| Cron triggers | **4** on the public Worker + **2** on the admin Worker |
| Durable Object classes | **1** (`RateLimiter`) |
| R2 buckets | **2** (`orderak-media`, `orderak-admin-audit`) |
| Third-party live in production | **6** (Firebase Auth, Cloudflare Email Sending, Email Routing, R2, D1, Sentry); **5 more integrated but flag-off** (DeepSeek, Google Play, Turnstile, Play queues, the rate-limiter DO) |
| TODO/FIXME markers in `src/` | **4**, all in `deletion.ts` |
| Symbols with no caller | **≥8** (plus 8 export-only-inside-module) |

### 8.4 Where the complexity actually lives

1. **The admin plane is the largest hand-written subsystem** — 4,061 lines of
   routes across 8 files, of which 598 lines (14.7 %) and 9 tables serve internal
   project tracking.
2. **Generated bindings outweigh all domain code except admin** — 15,540 lines of
   `src/generated/` against 4,061 for the next-largest folder.
3. **`api-store.ts` is a 1,494-line single file** holding auth session restore,
   registration, store identity, category CRUD, product CRUD, stock and media
   upload — the largest hand-written file in the backend by 133 lines over
   `auth-v2.ts`.
4. **`identity/` (3,448 lines) contains three unrelated concerns** under
   authentication-sounding names: shared crypto + admin JWT/RBAC (`auth.ts`),
   seller auth v2 + passkeys (`auth-v2.ts`), and store identity
   (`identity.ts`).
5. **Two complete plan systems** — `plans`/`plan_features`/`subscriptions` and the
   18-table v2 catalogue — both live in the schema, with a runtime switch and a
   second silent fallback inside the v2 engine.
6. **The migration count is dominated by correction, not construction**: of 62
   files, 2 exist purely to repair drift (039b, 041), 5 rebuild tables by
   drop+rename (009, 041, 054, 059, and 036's rebuild of 035), and 7 touch one
   admin screen tracker.

---

## 9. Product risks

### 9.1 Dead but deployed routes

- 7 acquisition paths, 3 Play lifecycle paths, `/api/v1/chat`, 4 onboarding paths
  and 6 passkey paths are **deployed and publicly resolvable** while unable to
  serve a request (see §6.1). Each returns a distinct refusal (`403
  feature_disabled`, `403`, `503 feature_disabled`) that clients must not retry.
  Depended on by `tooling/repository/verify-billing-gate.mjs`, which asserts the
  acquisition list against the code.
- `/verify-email` is served only on website hosts, so an email link built on the
  API host 404s before the token is read (`public-worker.ts:295-297` vs `:307`).
- `GET /api/v1/account/deletion-request` exists in two handlers; only the later
  one answers.

### 9.2 Features documented as implemented with no reachable path

- `effectiveAppVersionPolicy` is documented as the app-version-policy reader
  (`docs/domains/admin-control-plane.md:101`) and has no caller.
- `docs/domains/entitlements.md:14` states the v2 engine is off in both
  environments; staging has it on.
- `content_pages` is presented as live data in two governance documents
  (`docs/architecture/data-classification.md:95`,
  `docs/governance/retention-matrix.md:116`) and has no runtime reader.
- Android payout fields are documented as seller-managed
  (`docs/ux/screen-contracts.md:347-348`, `docs/user-guide/getting-started.md:87`)
  and are stored on `sellers`; whether the Android client still writes them is
  `unverified` from the backend alone.

### 9.3 Secrets that could be reduced

| Reduction | Why it is safe | Evidence |
|---|---|---|
| Delete `STRIPE_SECRET_KEY` from `env.d.ts` | Read nowhere; only a commented line | `env.d.ts:50`, `payments.ts:144` |
| Remove `ADMIN_API_KEY` and `ADMIN_JWT_SECRET` from the **public** Worker | No admin route is mounted there and nothing on that Worker reads either | `wrangler.jsonc:153-160` |
| Do not require both `ADMIN_TOTP_KEY_V1` and `_V2` (and both audit keys) in both environments after the enrolled ciphertext is re-keyed | Version 1 exists only because one enrolled admin's ciphertext and the pre-043 archives record it | `wrangler.admin.jsonc:31-45,126-139` |
| Promote the 9 Play/Firebase/DeepSeek service-account and rate values into `secrets.required` **before** their flags flip | They fail closed today, so nothing proves they exist | §5.2 |
| Pick one of `WEBAUTHN_RP_ID` / the hardcoded production RP constant | Production currently rides a literal in code (`auth-v2.ts:1089-1090`) | same |

### 9.4 D1 tables that appear unused

`items` (dead by a migration's own admission), `content_pages` (superseded by
`content_page_versions`), `geo_city_names` and `geo_city_search` (src-unreferenced
legacy GeoNames stack) — see §3.3. Dropping them is blocked by the
rollout-safe-migration rule (`verify-migrations.mjs:135-172` requires an
expand-contract marker for `DROP TABLE`), which is the right guard: the deletion
should be one deliberate, marked migration.

### 9.5 Structural risks worth naming

- **Cross-Worker flag divergence**: `AUTH_IDENTITY_ENABLED` and
  `PHONE_CHANGE_ENABLED` are `true` on the public Worker and `false` on the admin
  Worker in the same environment, so "is this on in production" has two answers.
- **Only one enrolled administrator.** 25 permission strings are granted to no
  non-owner role, and break-glass is closed in production — so a lost TOTP device
  and a lost password is an unrecoverable state by design. Recovery depends on the
  single owner session still being valid.
- **`settings` is a generic key-value store** any `settings:manage` admin can
  write (`admin-project.ts:149-150`), while two keys drive runtime behaviour; a
  typo writes a key nothing reads and silently does nothing.
- **The AI system prompt is stored in the project-tooling table** `ai_prompts`
  (`public-worker.ts:901`), so deleting the tooling schema would silently revert
  the assistant to its fallback constant.
- **Test surface vs. reachable surface is inverted**: 10,331 lines of tests cover
  a flag-off majority (billing, Play, entitlements v2, passkeys), while the
  production path (legacy limits, storefront orders, media) is proportionally
  thinner.
