# Orderak Review — Fixes Applied + Manual Tasks (2026-07-12)

> **Historical change record.** This file records fixes made on 12 July 2026;
> current behavior is defined by the code and maintained documentation.

Follow-up to `docs/archive/history/repo-review-2026-07-11.md`. All findings from that report were
addressed in code, except items that only you can do (secrets, Firebase console,
git history, local machine builds) — those are listed at the bottom.

---

## What was changed in code

### Backend (`backend/src/`)

- **C1 — register account-takeover closed.** `api-store.ts`: new `verifyFirebasePhone()` helper; `handleRegister` now requires a verified Firebase `id_token` (phone must match) to create a **new** store, keeps device-secret auth for existing stores, and is rate-limited (10/min/phone). `restoreFirebaseSession` refactored to reuse the helper.
- **C2 — chat locked down.** `index.ts`: `/api/chat` now requires seller auth (phone+secret headers), rejects non-POST, is rate-limited (20/min), and enforces the plan's monthly AI quota. `plan-limits.ts`: added `max_ai_requests_per_month` (free = 20).
- **H1 — `/api/items` removed** (was unauthenticated test CRUD on the prod DB).
- **L4 — `/api/orders?since=` NaN clamp** (`Number(...) || 0`); chat method-guarded.

### Android (`android-app/`)

- **H2 — product images now upload.** New `ProductEntity.imageUrl` (R2 URL) + DB version 4→5; `SyncRepository.uploadPendingProductImages()` uploads each local image once via `/api/media/upload` and sends the returned URL as `image_url` (was sending the local device path → broken catalog images). `ProductEditViewModel` preserves the URL and resets it when the image changes.
- **H3 — unlimited plans no longer capped at 20.** `Entitlements.getProductLimit()` treats `null` limit as unlimited, only defaulting to 20 when no config has loaded.
- **M2 — structured 4xx errors surfaced.** `BackendApi.bodyOrThrow()` returns 4xx JSON bodies so `slug_taken` / `plan_limit_reached` / `plan_feature_unavailable` decode instead of collapsing to a generic error.
- **M3 — pulled order status** now uses the server value (`o.status`), not hardcoded `"NEW"`.
- **M1 — dead Firebase Bearer auth removed.** Deleted `AuthInterceptor.kt`, removed it from `NetworkModule`, and dropped the unused `jwt_token` storage.
- **C1 app side** — `RegisterReq.id_token` added; `SyncRepository` sends a fresh Firebase token on register.
- **Chat wiring** — `BackendApi.chat(phone, secret, message)`; `MainViewModel` passes credentials.

### Build & deps (`android-app/`)

- **H4 —** Gradle wrapper `9.6.0 → 8.11.1` (matches AGP 8.7.3); removed the `*checkClasspath*`-disabling hack in `app/build.gradle.kts`; removed the hardcoded `org.gradle.java.home` (JDK now via the daemon-JVM criteria).
- **L3 —** removed the unused `firebase-firestore` dependency.
- **M5 —** `BillingManager` documented as unwired scaffolding (it's injected nowhere, so no Play connection is ever opened).
- **L5 —** fixed a mojibake comment in `SyncRepository`.

### Docs

- `docs/api.md`: chat auth + errors, register `id_token` + `ok:true`, products-sync response/`image_url` rule, removed `/api/items`, corrected the slug-check claim.
- `docs/app-plan.md`: corrected the auth-model and billing paragraphs.
- `docs/setup.md`: added Firebase Android setup (`google-services.json`) + a note that `d1 migrations apply` is the canonical path.
- `AGENTS.md`: added DeepSeek/Firebase to the "never in the app" key list.

> **Note on verification:** the Linux shell in this session served stale cached
> copies of just-edited files, so `tsc` / Gradle could not be run here against the
> real content. Every edit was reviewed against the actual files, but please run
> the local builds below to confirm.

---

## Tasks that require YOU (manual)

1. **Set `FIREBASE_WEB_API_KEY` on the Worker — REQUIRED for the C1 fix.**
   `cd backend && npx wrangler secret put FIREBASE_WEB_API_KEY`
   Add the same to `backend/.dev.vars` for local dev. Without it, new-store
   registration falls back to trust-on-first-use and the takeover hole stays open
   in that environment.

2. **Add `google-services.json`** at `android-app/app/` (Firebase console → add
   Android app `app.orderak.seller` → enable Phone auth → download; add your debug
   SHA-1/SHA-256). The Android build fails without it. Steps are in `docs/setup.md`.

3. **Build & test locally** (couldn't run in this session):
   - Backend: `cd backend && npx tsc --noEmit && npm test`
   - Android: `cd android-app && ./gradlew :app:assembleDebug && ./gradlew :app:testDebugUnitTest`
   - First Android run re-downloads Gradle 8.11.1 (wrapper changed). If Studio
     forces a newer AGP that needs Gradle 9, the alternative is to upgrade AGP
     instead of downgrading Gradle — pick one, don't re-add the disabled-task hack.

4. **Re-apply migrations to your local D1 (it's drifted).** The dev log showed
   `no such column: store_code` and `no such table: roadmap_items`:
   `cd backend && npx wrangler d1 migrations apply orderak-db --local`
   (and `--remote` for production). Reset the local D1 first if drift persists.

5. **Git hygiene** (run in your real repo — I couldn't safely do git writes here):
   - `git rm --cached -r .wrangler` then commit — this un-tracks
     `.wrangler/cache/wrangler-account.json` (your CF account id + email). Root
     `.gitignore` already ignores `.wrangler/`.
   - Delete the stale root `static/` folder (byte-for-byte duplicate of
     `backend/assets/static/`) and stray `/.wrangler-dev*.log`, `backend/dist/`.
   - `backend/backups/*.sql` may contain customer data — already git-ignored;
     consider moving it out of the repo folder.

6. **Heads-up: local app data resets once.** The Room DB version bump (4→5, via
   `fallbackToDestructiveMigration`) wipes local app data on next install/update.
   That's expected in pilot — the backend keeps the source of truth — but tell any
   testers so they re-sync.

7. **Decide on the AI assistant screen.** `/api/chat` is now secure, but no screen
   calls `MainViewModel.testAiChat`. Either build the assistant UI or leave it
   deferred (it's harmless dead code).

8. **Before enabling paid plans via Google Play:** implement server-side purchase
   validation (Play purchase token → backend → `subscriptions` row) and only then
   wire `BillingManager`. Today entitlements come solely from `/api/config`.

9. **Optional — WhatsApp OTP.** `FirebaseAuthRepository.sendOtp` intentionally
   fails the WhatsApp channel to force SMS. Wire a real WhatsApp Cloud API via the
   backend if you want that channel.

10. **Optional — city search proxy (M4).** `LocationClient` calls Nominatim
    directly, which conflicts with the "app calls only the backend" rule. Either
    proxy it through a small Worker route or document the exception. No secret is
    exposed, so this is low priority.
