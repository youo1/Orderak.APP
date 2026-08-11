# Orderak Repository Review — 2026-07-11

> **Historical snapshot.** Findings describe the repository on 11 July 2026 and
> may have been resolved. See `docs/archive/history/repo-review-fixes-2026-07-12.md` and the current
> code before acting on them.

Full-repo review: Android app, backend Worker, integration, security, docs, build readiness.
No code was changed. Line numbers are from the current working tree.

---

## Critical

### C1. `POST /api/register` lets anyone claim any phone number (account takeover)

- **Where:** `backend/src/api-store.ts:135–198` (`handleRegister`), route wired at `api-store.ts:83`.
- **What:** Registration only requires a `phone` + client-invented `secret`. There is no Firebase ID-token check, no OTP tie-in, and no rate limit. The Firebase verification path exists only for `/api/auth/session` (`api-store.ts:505–520`).
- **Why it matters:** An attacker can pre-register a victim's phone. When the real owner later signs in via OTP, `restoreSession` finds an existing seller whose secret doesn't match, treats the owner's phone as a "new device", and blocks them on the Free plan (`api-store.ts:539–545`) — the attacker owns the store and its public catalog identity. `docs/app-plan.md:87–89` acknowledges this gap but calls it a launch decision; it should be treated as a blocker.
- **Fix:** Require a verified Firebase `id_token` in `/api/register` (same Identity Toolkit lookup as `restoreFirebaseSession`, phone must match), or only allow register from a session already established via `/api/auth/session`. Add `checkRateLimit` (exists in `shared.ts:234`) per IP/phone.

### C2. `POST /api/chat` is an unauthenticated open AI proxy

- **Where:** `backend/src/index.ts:137–159`.
- **What:** No auth, no rate limit, no method check. Anyone on the internet can burn your DeepSeek credits. Also, `max_ai_requests_per_month` exists in plans and `/api/config` (`config.ts:51`) but is never enforced anywhere (`plan-limits.ts` doesn't include it).
- **Why it matters:** Direct cost exposure + abuse vector on a public custom domain.
- **Fix:** Require `authSeller` (phone+secret headers) like `/api/orders`, enforce `max_ai_requests_per_month` with a usage counter, add `checkRateLimit`, and reject non-POST.

---

## High

### H1. `/api/items` unauthenticated test CRUD is live in production routing

- **Where:** `backend/src/index.ts:162–190`; documented as "for testing" in `docs/api.md:307–327`.
- **What:** Anyone can insert rows into `items` and read them. It shares the production D1 database.
- **Fix:** Delete the route (and `items` table usage), or gate it behind admin auth. Update `docs/api.md`.

### H2. Product images are never uploaded — local device paths sent as `image_url`

- **Where:** `android-app/.../data/remote/SyncRepository.kt:89` (`image_url = it.imagePath`); images are local files (`ProductsScreen.kt:115–117` renders `File(p.imagePath)`); backend stores and renders the value verbatim (`backend/src/api-store.ts:456`, `backend/src/catalog.ts:125`).
- **What:** `imagePath` is an app-private filesystem path (e.g. `/data/user/0/app.orderak.seller/...`). The public catalog emits `<img src="/data/user/0/...">` → broken images for every product. Only the store logo/cover flow uses `/api/media/upload` (`StoreInfoScreen.kt:143`).
- **Fix:** During product sync, upload new/changed images via `POST /api/media/upload` (kind=`product`), store the returned `url` (persist alongside `imagePath`), and send that as `image_url`. Backend could also defensively reject non-`https://` `image_url` values.

### H3. Unlimited plans capped at 20 products in the app UI

- **Where:** `android-app/.../data/auth/Entitlements.kt:56–58` (`getProductLimit(): _config.value?.limits?.max_products ?: 20`), consumed at `ProductsViewModel.kt:29`.
- **What:** Backend sends `max_products: null` to mean "unlimited" (`config.ts:64–66`). Kotlin's `?: 20` turns null (unlimited) into a 20-product cap, blocking paying sellers client-side. (Backend enforcement is correct — `api-store.ts:425–426` skips the check when limit is null.)
- **Fix:** Distinguish "no config yet" from "null = unlimited": e.g. `val l = _config.value?.limits; return if (l == null) 20 else l.max_products ?: Int.MAX_VALUE`.

### H4. Unsupported Gradle/AGP toolchain combination, patched with hacks

- **Where:** `android-app/gradle/wrapper/gradle-wrapper.properties:3` (Gradle 9.6.0) + `gradle/libs.versions.toml:2` (AGP 8.7.3, Kotlin 2.1.0). Self-documented workaround at `app/build.gradle.kts:114–119` disables every `*check*Classpath*` task to dodge an AGP/Gradle fingerprinting error.
- **What:** AGP 8.7 is not supported on Gradle 9.x; the disabled-task workaround silently turns off build verification and can break on any minor update.
- **Also:** `gradle.properties:5` hardcodes `org.gradle.java.home=C:/Program Files/Android/Android Studio/jbr` — build fails on any machine/CI where Studio isn't at that path (and conflicts with the `gradle-daemon-jvm.properties` toolchain=21 mechanism already present).
- **Fix:** Either pin the wrapper to Gradle 8.11.x (AGP 8.7-supported) or upgrade AGP/Kotlin to a Gradle-9-compatible pair; then delete the `tasks.configureEach` hack and the hardcoded `org.gradle.java.home`.

### H5. Fresh clone cannot build the Android app — `google-services.json` undocumented

- **Where:** `app/build.gradle.kts:9` applies `com.google.gms.google-services`, which hard-fails without `app/google-services.json`. The file is gitignored (`android-app/.gitignore:9`, root `.gitignore:39`) — correct — but `docs/setup.md` never mentions Firebase Android setup or obtaining this file.
- **Fix:** Add a setup step: create the Firebase project / download `google-services.json` for package `app.orderak.seller` into `android-app/app/`. Same for `local.properties` (auto-generated by Studio, but worth one line).

---

## Medium

### M1. Firebase ID token sent as `Authorization: Bearer` on every request, never used

- **Where:** `AuthInterceptor.kt:23–24` attaches the token saved at login (`AuthViewModel.kt:150`). No backend route validates a seller Bearer token (seller auth is header phone+secret everywhere; `Authorization` is only used by admin JWT routes).
- **Why it matters:** Dead auth path that confuses the model ("JWT" naming in `SessionStore` is misleading — it's a Firebase ID token that expires after ~1 hour, so it's stale on almost every request anyway). Slight unnecessary token exposure.
- **Fix:** Remove the interceptor (and `jwt_token` storage), or move to real backend session tokens. Pick one auth model.

### M2. Structured 4xx error bodies are lost in the app

- **Where:** `BackendApi.kt:185–189` — `bodyOrThrow()` throws `IOException` on any non-2xx, so JSON like `{"error":"plan_feature_unavailable","feature_key":"multi_device"}` (403, `api-store.ts:539–545`), `slug_taken` + suggestions (409), and `plan_limit_reached` (409, `plan-limits.ts:20–27`) all collapse into a generic failure (`AuthViewModel` shows `AuthError.GENERIC`; sync just returns false).
- **Fix:** In `bodyOrThrow`, return the body for 4xx responses so DTOs (which already have `error` fields) decode; branch UI on `error` codes (e.g. show an upgrade prompt for `plan_feature_unavailable`).

### M3. Pulled order status hardcoded to "NEW"

- **Where:** `SyncRepository.kt:120` (`status = "NEW"`), while the backend sends the real `status` (`index.ts:202`) and the DTO carries it (`BackendApi.kt:137`).
- **Fix:** `status = o.status`.

### M4. Android calls third-party APIs directly (AGENTS.md rule conflict)

- **Where:** `core/location/LocationClient.kt:36` (Nominatim geocoding) and `core/ui/OsmMapView.kt` (OSM tile servers via osmdroid).
- **What:** Root `AGENTS.md:17` says the app calls only the Cloudflare backend. No secrets are involved, but it's a policy conflict, ties the app to third-party rate limits (Nominatim requires an identifying User-Agent + has a 1 req/s policy), and can't be monitored server-side.
- **Fix:** Either proxy city search through a small backend route, or document the exception explicitly in AGENTS.md/app-plan.md.

### M5. Two disconnected billing systems

- **Where:** `data/auth/BillingManager.kt` (Google Play Billing; Hilt singleton, starts a Play connection) vs backend `billing.ts` subscriptions (`/api/subscribe`, mock gateway).
- **What:** `BillingManager.isSubscribed` is consumed nowhere (only `EntitlementManager.updateFromBackend` drives entitlements), Play purchases are never validated server-side and never create a backend subscription. `app-plan.md:90` defers server-side validation, but as written a Play purchase changes nothing at all.
- **Fix:** Until Play Billing is wired end-to-end (purchase → backend validation → subscription row), remove or feature-flag `BillingManager` so the dead connection isn't shipped.

### M6. Docs drift

- `docs/api.md:205` claims `/api/slug/check` powers the app's "pick your link" UI — no Kotlin code calls it (only `SyncRepository` register passes a cached slug). Missing feature or stale doc.
- `docs/app-plan.md:87–89` ("backend does not yet verify the Firebase ID token") contradicts `app-plan.md:77–78` and the implemented `/api/auth/session` verification (`api-store.ts:505+`). The remaining true gap is `/api/register` (see C1) — say that instead.
- `docs/api.md:163–174` register response example omits the `ok: true` field the backend actually returns (`api-store.ts:198`) and that `RegisterRes` relies on.
- Root `AGENTS.md:15` lists OpenAI/Claude/Gemini keys but not DeepSeek — the provider actually in use.

### M7. Migration guidance conflicts; local dev DB is drifted

- **Where:** `docs/setup.md:33–37` correctly says use `wrangler d1 migrations apply`, but `setup.md:64–68, 177–181, 245–249` also instruct raw `d1 execute --file=migrations/002/004/005_*.sql` — double-applying and bypassing the migrations ledger.
- **Evidence of drift:** `.wrangler-dev-error.log` shows local runtime errors `no such column: store_code` and `no such table: roadmap_items` — the local D1 misses migrations 008+/010.
- **Fix:** Standardize on `npx wrangler d1 migrations apply orderak-db --local|--remote` only; delete the `d1 execute` sections; re-apply locally.

---

## Low

### L1. `.wrangler/cache/` files tracked in git

- `git ls-files` shows `.wrangler/cache/cf.json` and `.wrangler/cache/wrangler-account.json` are committed (root `.gitignore:7` was added after the fact). `wrangler-account.json` exposes the Cloudflare account ID and account email. Not secrets, but shouldn't be in history. Fix: `git rm --cached -r .wrangler/`.

### L2. Stale/duplicate files & unclear ownership

- Root `static/` duplicates `backend/assets/static/` byte-for-byte (logos/favicons). The Worker serves `backend/assets/` (`wrangler.jsonc:45–48`); root `static/` looks stale — delete or document.
- `backend/dist/` is an old build artifact (untracked, `dist` gitignored) — safe to delete.
- Root `.wrangler/`, `.wrangler-dev.log`, `.wrangler-dev-error.log` indicate wrangler was run from the repo root once; keep runs in `backend/` (root `.gitignore:6–8` already anticipates this).
- `backend/backups/*.sql` may contain customer data — gitignored correctly (`backend/.gitignore:171`); consider moving out of the repo folder entirely.

### L3. Unused dependencies in the Android app

- `firebase-firestore` (`app/build.gradle.kts:101`) — no Firestore usage anywhere; the stale `// TODO(Firebase...)` comment at line 96 sits above already-added deps. `crashlytics` mentioned in the TODO was never added (decide either way). Removing Firestore trims APK size and avoids implying direct app→database access.

### L4. Minor backend hygiene

- `/api/chat` accepts any HTTP method (`index.ts:137` has no method check) — GET returns a confusing 400.
- CORS is `Access-Control-Allow-Origin: *` with all custom auth headers (`shared.ts:8–16`) — acceptable for a public API, but consider restricting on `admin.orderak.app`.
- `GET /api/orders?since=abc` → `NaN` comparison silently returns zero orders (`index.ts:197`); clamp with `Number(...) || 0`.

### L5. Minor app hygiene

- Mojibake `�` in comment `SyncRepository.kt:33` (file encoding slip).
- `SessionStore` key/property named `JWT_TOKEN`/`jwtToken` stores a Firebase ID token (naming, ties to M1).
- `MainViewModel.testAiChat` (`MainViewModel.kt:62–76`) has loading/error state, but no screen calls it — matches app-plan "known gap"; either ship the assistant screen or remove the dead state.

---

## What's in good shape

Seller secrets hashed at rest with PBKDF2 + legacy transparent upgrade (`shared.ts:59–96`); constant-time comparisons; credentials in headers not query strings; no API keys anywhere in the Android app or git (checked tracked files, `.dev.vars` contains local placeholders only and is gitignored); media upload validates type/size and namespaces by store; internal UUIDs never exposed; backend `tsc --noEmit` passes clean; strings fully translated across ar/en/fr (182/182/182) so the strict i18n lint gate passes; docs are unusually thorough for a project at this stage.

---

## Integration checklist (Android ↔ backend)

| Contract point | Status |
| --- | --- |
| Base URL `https://api.orderak.app` (`Backend.kt:5`) matches `wrangler.jsonc` route | ✅ |
| `POST /api/register` — req/res shapes match (`shop_name` accepted via alias) | ✅ shape / ❌ security (C1) |
| `POST /api/auth/session` — shapes match, Firebase verified | ✅ (403 handling ❌, M2) |
| `GET/PUT /api/store`, `GET/POST/PUT/DELETE /api/categories` — shapes match | ✅ |
| `POST /api/products/sync` — shapes match; `image_url` semantics broken | ❌ (H2) |
| `GET /api/orders?since=` — cursor `order_no`, headers auth | ✅ (status ignored, M3) |
| `POST /api/chat` — shapes match | ✅ shape / ❌ auth (C2) |
| `GET /api/config` — null = unlimited | ❌ app maps null→20 (H3) |
| `GET /api/slug/check` — implemented backend-side | ❌ never called by app (M6) |
| `GET /api/theme` — ETag/304 client implemented (`BrandingRepository.kt`) | ✅ |
| 4xx structured errors (`slug_taken`, `plan_limit_reached`, `plan_feature_unavailable`) | ❌ app discards bodies (M2) |
| Loading states (Auth, AI test, sync via WorkManager) | ✅ present |
| Billing: Play purchases → backend subscription | ❌ not connected (M5) |

---

## Recommended next steps (in order)

1. **Lock down the backend (C1, C2, H1):** require Firebase ID token on `/api/register`; add seller auth + rate limit + monthly AI quota to `/api/chat`; remove `/api/items`. Update `docs/api.md`. Small, contained changes.
2. **Fix the product-image pipeline (H2):** upload product images in `SyncRepository` via `/api/media/upload`, persist the remote URL, send it as `image_url`. Verify a public store page renders images.
3. **Fix the plan-limit mapping (H3) and error decoding (M2):** two small Kotlin changes; add `status = o.status` (M3) while in the file.
4. **Stabilize the build (H4, H5):** pin Gradle 8.11.x (or upgrade AGP), delete the classpath-task hack and hardcoded `java.home`, run `gradlew :app:assembleDebug` clean on a second machine; document `google-services.json` in `docs/setup.md`.
5. **Clean the auth story (M1) and billing dead code (M5):** remove the unused Bearer interceptor + Firestore dep; feature-flag `BillingManager` until server-side validation exists.
6. **Docs pass (M6, M7):** fix migration instructions, slug-check claim, app-plan auth paragraph, AGENTS.md DeepSeek mention; re-apply local migrations.
7. **Repo hygiene (L1–L2):** `git rm --cached -r .wrangler/`, delete root `static/` duplicate and stale logs/dist.

I can implement any of these on your approval — items 1–3 are the highest-value fixes.
