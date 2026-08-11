# Full-Stack Code Review — 2026-07-12

> **Historical snapshot.** Verify every finding against the current code before
> acting on it.

Review of the Android app (architecture layers) and the backend (security & scalability),
with fixes applied directly per your approval. **Nothing here has been compiled or deployed —
run the verification steps at the bottom before shipping.**

## Note on the stated architecture

The project docs describe Ktor + PostgreSQL + JWT on AWS with Retrofit on Android.
The actual repo is a **Cloudflare Worker** (TypeScript, D1, R2, KV) with a hand-rolled
**OkHttp** client on Android. Seller auth is `phone + device-secret` headers; JWT is
admin-panel only. Worth updating README/AGENTS.md so future reviews (and AI tools) don't
chase phantom files like `Application.kt` or `openapi.yaml`.

---

## Fixes applied — Android app

| File | Fix |
|---|---|
| `data/remote/BackendApi.kt` | `apiCall` helper: rethrows `CancellationException` (was swallowed by `runCatching`, breaking structured concurrency); all blocking I/O (`body.string()`, JSON parse) moved to `Dispatchers.IO` (was running on Main from `viewModelScope`); undecodable/blank 4xx now surfaces `http_<code>` instead of silent `ok=false, error=null`; error taxonomy `network` / `http_<code>` / `bad_response` / domain keys; removed pointless `String?` returns and ~80 lines of boilerplate. |
| `feature/main/MainViewModel.kt`, `feature/products/ProductsViewModel.kt` | `resolveCatalogId()` converted callback → suspend (the callback captured the Activity inside `viewModelScope` — leak + share sheet firing after screen death). Deps (`sessionStore`) made private; `AdManager` removed from the VM. |
| `feature/main/MainScreen.kt`, `feature/products/ProductsScreen.kt` | Share actions launch from `rememberCoroutineScope()` (cancelled with the composable). FQ-name imports cleaned; dead `StatCard` condition removed. |
| `core/ads/LocalAdManager.kt` (new), `MainActivity.kt` | `AdManager` now provided via CompositionLocal instead of exposed from the ViewModel. |
| `feature/orders/OrderDetailsViewModel/Screen.kt` | Dead `sessionStore` exposure removed. |
| `data/db/Daos.kt` | New `ProductDao.idByCode()`. |
| `data/remote/SyncRepository.kt` | **Stock bug:** pulled order items stored `productId = 0`, so cancelling a remote order never restored stock (silent inventory leak). Items now resolve the real local product id via `product_code`. Also: orders arriving already-CANCELLED no longer decrement stock; a `Mutex` serializes concurrent syncs; **pull-orders-before-push-products** reorder closes the stale-stock-overwrite window. |
| `data/remote/SyncScheduler.kt` | One-time sync: `REPLACE` → `KEEP` (REPLACE cancelled in-flight syncs mid-cycle, orphaning R2 uploads). |
| `ui/theme/Color.kt`, `ui/theme/Theme.kt` | WCAG AA: white on `BrandGreen #1DAB61` was **2.97:1** (every filled button failed AA). Light `primary` → `BrandGreenA11y #127943` (5.5:1). `onTertiary` set (white-on-orange was 2.1:1), `error` → `#D0333B` (5.0:1), `onSurfaceVariant` wired to `TextMuted` (22 call sites were rendering baseline purple-gray), dark scheme got brand-warm containers + proper light-on-dark error pair. |

## Fixes applied — backend

| File | Fix | Severity |
|---|---|---|
| `src/payments.ts` | **Webhook signature enforcement.** `/api/webhooks/payment` is public and `MockGateway.parseWebhook` trusted the raw JSON — anyone knowing/guessing a `gateway_sub_id` could flip subscription statuses (free paid plans). When `PAYMENT_WEBHOOK_SECRET` is set, an HMAC-SHA256 hex signature over the raw body (constant-time compare) is now required. Unset (dev/tests) keeps old behavior. **Set this secret in prod.** | CRITICAL |
| `src/catalog.ts` | **Stored XSS.** `website` was rendered into `href` with only HTML-escaping — a stored `javascript:` URL executes on the public store page. New `safeHttpUrl()` guard on `website`/`logo_url`/`cover_url` at render. | HIGH |
| `src/api-store.ts` | Same XSS at the source: `PUT /api/store` now validates URL fields (http/https only; scheme-less input gets `https://` prefixed; explicit other schemes → 400 `invalid_url`). Also: media uploads capped at 60/hour/store (was: unlimited 5 MB files). | HIGH |
| `src/admin-auth.ts` | Admin login rate limit (15 / 5 min per IP+email — also bounds PBKDF2 CPU abuse); MFA challenge burns after 5 wrong TOTP codes (6-digit space + no cap = brute-forceable inside the 5-min window). | HIGH |
| `src/catalog.ts` | Public order submission rate limit (5/min per IP per store) — was an unauthenticated write that decrements stock. | MEDIUM |
| `src/billing.ts` | Subscription idempotency lookup scoped to `seller_id` (client-supplied keys are attacker-choosable; unscoped lookup leaked other sellers' subscription rows). | MEDIUM |
| `src/media.ts` | `X-Content-Type-Options: nosniff` on served uploads. | LOW |
| Earlier today | Device secrets: PBKDF2 → `sha256$` (random UUIDs don't need stretching; removes ~10-40 ms CPU from *every* authenticated request; transparent upgrade on login). Failed-auth throttle (20/5 min per phone). Registration fails closed without `FIREBASE_WEB_API_KEY` (tests opt in via `ALLOW_UNVERIFIED_REGISTRATION` in `vitest.config.mts`). `/api/auth/session` rate limit. `/api/orders` N+1 → single `IN` query. Chat message capped at 2000 chars. | — |

## API contract check (backend ⇄ Android)

Verified field-by-field: `RegisterRes`, `StoreRes`/`StoreDto`, `CategoriesRes` (incl. `product_count`),
`ProductsSyncRes`/`ProductCodeDto`, `OrdersRes`/`RemoteOrder`/`RemoteItem`, `ChatRes`, `MediaRes`,
`RestoreSessionRes`, `ConfigRes`/`ConfigLimits`/`ConfigFeatures`. **All match.** Android's
`ignoreUnknownKeys` covers backend-only extras (`current_period_end`, `store_name` in identity block).
The orders N+1 fix strips the internal `order_id` from item rows, so the shape is unchanged.

## Good things worth keeping

Constant-time comparisons throughout; transparent hash upgrades; creds in headers not query
strings; JWT verified before parsing; correct TOTP (RFC-6238); internal UUIDs never exposed;
order pricing is server-authoritative (client can't set prices); money as integer piasters;
webhook event dedup; admin session cookie HttpOnly+SameSite=Strict; dummy-hash on missing
login user (timing); Arabic-first localization with correct RTL/AutoMirrored handling; zero
hardcoded colors/sizes outside the theme.

## Second pass (same day) — deferred items now FIXED

All items below were applied after your pre-approval (former open items 2-9):

| # | Fix | Files |
|---|---|---|
| 2 | `order_no` race: unique index `(store_id, order_no)` + one recompute-and-retry around the atomic batch. **Migration 015 will fail loudly if the live DB already has duplicates** — the file header contains the query to find and renumber them. | `migrations/015_order_no_unique.sql`, `src/catalog.ts` |
| 3 | Coupon `max_uses` race: atomic claim (`UPDATE ... WHERE used_count < max_uses`, checked via `meta.changes`) **before** charging, rolled back if the gateway throws. | `src/billing.ts` |
| 4 | Remote theme contrast clamp: `withRemote` now rejects any token that would drop below 4.5:1 against its fixed on-color (interaction roles) or make ink unreadable on bg/card — falls back to compiled accessible defaults. | `ui/theme/Theme.kt` |
| 5 | Web tokens updated: `primary #127943`, `primary_dark #0E5F35`, `danger #D0333B`. **Check the admin Theme tab** — a saved `theme_colors` override in the settings table still wins over these defaults. | `backend/src/theme.ts` |
| 6 | Product images: sampled decode to ≤1280 px + JPEG q85 before upload (memory-flat, saves data); falls back to raw bytes if decode fails. | `data/remote/SyncRepository.kt` |
| 7 | TOTP re-enrollment now requires the current code (`403 totp_required`); first-time enrollment unchanged. | `src/admin-auth.ts` |
| 8 | `rate_limits` GC: ~2% of new-window inserts also purge windows older than 7 days. | `src/shared.ts` |
| 9 | Device secret excluded from cloud backup and device transfer (`fullBackupContent` + `dataExtractionRules`); a restored app re-authenticates via OTP. Full Keystore encryption still optional hardening. | `AndroidManifest.xml`, `res/xml/backup_rules.xml`, `res/xml/data_extraction_rules.xml` |

## Stage 7 — cross-cutting holistic review

1. **Data models ⇄ API**: verified field-by-field (table above) — all match.
2. **Auth end-to-end**: OTP (Firebase) proves phone ownership at registration/restore; the
   random device secret is the per-request credential (hashed at rest, header-transported over
   TLS, now excluded from backups, throttled on failure). Sound design for this product.
   **Fixed a real defect**: `FirebaseAuthRepository.onVerificationCompleted` only resumed the
   coroutine on token-fetch *success* — auto-verified sign-ins could hang the auth screen
   forever on a flaky token fetch. All branches resume now.
3. **Error-format alignment**: backend returns `{error: "key"}` plus sometimes a localized
   `message` (e.g. slug_taken). The app only decodes `error` and maps keys itself — workable,
   but you're re-localizing what the server already localized. Recommendation (not applied):
   add optional `message` to the DTOs and prefer it in UI snackbars.
4. **Loading/failure surfacing gap** (recommendation, needs a design decision): background
   sync failures are invisible to the seller — `syncNow()` returns false into WorkManager and
   the dashboard keeps showing stale local data with no "last synced / sync failed" indicator.
   Consider persisting a `lastSyncAt`/`lastSyncError` in DataStore and a subtle dashboard chip.
5. **Architecture vs product goals**: offline-first Room + mirror-push fits a single-device
   seller well. The one structural risk remains open item 1 below.

## Open items (need your decision)

1. **Product mirror sync is last-writer-wins across devices** (multi-device is a paid
   feature). Needs server-authoritative stock + deletion tombstones. Design change worth its
   own session — the pull-before-push reorder already narrows the window.
2. Backend `message` fields in app DTOs + sync-status UI (recommendations in Stage 7 above).

## Verify before shipping

```bash
# Backend (sandbox couldn't run these — file mount served truncated copies)
cd backend && npx tsc --noEmit && npm test

# Android
./gradlew :app:compileDebugKotlin        # or a full assembleDebug
```

Then: set `PAYMENT_WEBHOOK_SECRET` (webhooks now verify it), confirm `FIREBASE_WEB_API_KEY`
is set in prod (registration now fails closed without it), and eyeball light/dark screens —
buttons are a slightly deeper green (the AA fix).
