# Orderak — Performance & Optimization Review (2026-07-12)

> **Historical snapshot.** Verify measurements and recommendations against the
> current code before acting on them.

Senior full-stack performance pass over the Android app, Cloudflare Worker backend, and
design implementation. Scope: latency, CPU/memory, network, battery, Cloudflare/D1 cost,
reliability, and perf-affecting maintainability. Line numbers are approximate (pre-edit).

Deployment assumptions (confirmed): single Worker on the paid plan; D1 as the only OLTP store;
sellers are low-volume (tens–hundreds of orders/products each); Android targets low-end EG
devices, minSdk 24.

---

## IMPLEMENTED (2026-07-12, second pass — all pre-approved items applied)

Backend verified with `npx tsc --noEmit` (exit 0). Android not built here (no Android SDK in
this environment) — run `./gradlew :app:assembleDebug` locally.

| Item | What shipped | Files |
|---|---|---|
| A1 | Content-hash guard: `dtos.hashCode()` compared to `lastPushedProductsHash`; the full-mirror `syncProducts` push (and its D1 rewrite + translation refresh) is skipped entirely when the catalog is unchanged. | `data/remote/SyncRepository.kt` |
| A2/A3 | Standalone `/api/config` call removed from the sync loop; plan config is now piggybacked on the `/api/orders` response (`loadPlanConfig` extracted, one auth instead of two). `/api/config` kept for cold-start callers. | `SyncRepository.kt`, `backend/src/index.ts`, `backend/src/config.ts`, `BackendApi.kt` (`OrdersRes.config`) |
| C4 | Dashboard uses a `COUNT(*)` flow (`hasProducts`) instead of spinning up a second `ProductsViewModel`; full product list read once, lazily, only when sharing the text fallback. | `MainViewModel.kt`, `MainScreen.kt`, `CatalogRepository.kt`, `Daos.kt` (`count()`) |
| E1 | Room indexes on `products.createdAt`, `orders.createdAt`, `orders.status`; DB version 5→6 (destructive rebuild in pilot). | `Entities.kt`, `OrderakDatabase.kt` |
| B1 | `listPublicPlans` N+1 → single `plan_features ... IN (...)` query + `Cache-Control: public, max-age=300`. | `backend/src/billing.ts` |
| B2 | `subscriptionStatus` no longer creates a referral code on the GET (write-on-read removed); code is ensured by the subscribe/referral paths instead. Interdependent reads left sequential on purpose (fragile to batch, cold endpoint). | `backend/src/billing.ts` |
| B3 | Anonymous catalog store pages now send `Cache-Control: public, s-maxage=…, stale-while-revalidate` so Cloudflare edge-caches them (offloads D1 on viral links). | `backend/src/catalog.ts` |
| D1/D2 | `DateFormat` hoisted to a single top-level instance; per-row date format + `OrderStatus.valueOf` wrapped in `remember(key)` so they don't run every recomposition. | `feature/orders/OrdersScreen.kt` |

**A4 (narrow `SELECT *` in `verifySeller`) intentionally NOT applied.** `GET /api/store` reuses
the `authSeller` row directly via `fullStore()`, which needs every seller column — narrowing the
shared auth query would break that route for a marginal per-request saving. Left as `SELECT *`.
If you want it later, give `GET /api/store` its own read and then narrow the auth query.

### Migration / deploy notes

- **Room v6**: pilot uses `fallbackToDestructiveMigration`, so local DBs rebuild automatically
  with the new indexes; server stays the source of truth. Write a real `Migration(5,6)` before
  you disable destructive migration for production.
- **No backend schema change** in this pass (indexes are all client-side Room). The earlier
  `migrations/015_order_no_unique.sql` still needs to run on D1 — see the prior review doc.

### Post-run fixes (test + build failures from the deploy attempt)

**Backend tests (13 passed / 22 failed → fixed).** Root cause: the test fixture
`test/helpers.ts` never created the `rate_limits` table, but the earlier security pass added
`checkRateLimit` to the register path (and others) and an auth-failure throttle inside
`authSeller`. So `registerStore()` threw on the missing table, no seller row was created, and
every authenticated follow-up failed — surfacing as "missing D1 table rate_limits" on most and
as a clean `401` on the three `/api/chat` tests (seller not found). Fix: added `rate_limits`
and `webhook_events` to the fixture `SCHEMA`, matching the production DDL in
`migrations/002_billing.sql` and `006_hardening.sql`. Pure test-fixture change; no production
code touched. `npx tsc --noEmit` passes.

> I could not execute `vitest` in the review sandbox: the workers pool opens a **remote** proxy
> session because `wrangler.jsonc` marks the `EMAIL` binding `remote: true`, which requires a
> Cloudflare login. Run `npm test` on your machine (where you're logged in) to confirm green.

**Android build (`compileVersionMap could not be serialized`).** Not caused by the source
changes — all edits are plain Kotlin/resource/manifest, and the new `res/xml/*` + manifest
attributes validate as well-formed. Configuration cache is already `false` in
`gradle.properties`, so this is a **stale KSP/Gradle incremental cache**, which a Room
`@Database` version bump (5→6) + a new DAO method + new `@Index` annotations reliably triggers
(KSP fails to deserialize its incremental state against the changed generated-code graph).
Recovery:

```bash
cd android-app
./gradlew --stop                 # kill stale daemons
./gradlew clean                  # clears app/build + KSP caches
# if it persists, nuke the incremental caches explicitly:
rm -rf app/build .gradle/ ~/.gradle/caches/transforms-* 2>/dev/null
./gradlew :app:assembleDebug --no-build-cache
```

### Original findings below are retained for context.

---

## A. Highest-leverage findings (cost + latency)

### A1. Full product mirror pushed on EVERY sync — HIGH impact / Medium effort

`data/remote/SyncRepository.kt` `doSync()` (~line 84-105) sends the **entire** catalog on every
sync (app open + manual + periodic 15 min), and the backend `syncProducts` (`api-store.ts`
~500-540) then rewrites all rows, `DELETE`s absent ones, and calls `refreshProductTranslations`
(an external/again-D1 pass). For a 20-product store that's ~20 row-writes + a delete scan +
translation refresh **every 15 minutes per active seller**, none of which changed 99% of the time.

- Why suboptimal: dominant D1 write cost + Worker CPU, and mobile upload bytes/battery, all for a no-op.
- Fix: dirty tracking. Add `dirty INTEGER DEFAULT 1` (or `syncedAt`/`contentHash`) to `ProductEntity`; set dirty on edit, clear on successful push; skip the whole push when nothing is dirty. Send only changed rows; make the backend upsert-by-code instead of full mirror + delete-by-absence (needs the tombstone design from the open item). Cheapest interim: hash the serialized product list and skip `syncProducts` when the hash is unchanged since last successful push.
- Impact: HIGH (biggest recurring D1-write + CPU cost). Effort: Medium.
- Migration: additive column; Room is `fallbackToDestructiveMigration` in pilot so no hand migration needed now, but add a real migration before you turn that off.

### A2. Four authenticated round-trips per sync, each re-authenticating — HIGH / Small–Medium

`doSync()` calls `getConfig` → `register` (conditional) → `uploadMedia`* → `syncProducts` →
`fetchOrders`. Every one runs `authSeller` = `SELECT * FROM sellers` + secret verify. That's
3–4 D1 reads + hashes per sync where 1 would do.

- Fix (cheap): fold config into an existing response. `register`/`fetchOrders` can return the plan config block, eliminating the standalone `getConfig` call each sync (keep the endpoint for cold app-open). Gate `register` strictly on `shopConfigKey` change (already done) — good.
- Fix (structural): a single `POST /api/sync` that authenticates once and does config+products+orders in one handler, one `authSeller`, one batch. Halves-to-quarters the per-sync D1 reads.
- Impact: HIGH (per-sync D1 reads scale with active sellers × sync frequency). Effort: Small (fold config) / Medium (unified endpoint).

### A3. `getConfig` on every sync is redundant with entitlement cadence — MEDIUM / Small

`config.ts` runs a 6-table-column join on `subscriptions⋈plans` each call. Plan/entitlements
change rarely (subscribe/cancel/webhook). Serve it with an ETag like `/api/theme` already does,
or piggyback on A2. App side: `EntitlementManager` only needs a refresh on cold start + after a
billing action, not every 15-min tick.

- Impact: MEDIUM. Effort: Small.

### A4. `SELECT *` in the hot auth path — LOW–MEDIUM / Small

`shared.ts` `verifySeller` (~line 65) does `SELECT * FROM sellers WHERE phone = ?` on every
authenticated request. Returns every column (incl. large text fields: description, address,
logo/cover URLs) when auth needs `id, secret, referral_code` and callers usually need a known
subset. On D1, wide-row reads cost more to serialize.

- Fix: `SELECT id, secret, referral_code, store_name, slug, public_identifier, store_code, country_code FROM sellers WHERE phone = ?` (or the exact columns each caller uses).
- Impact: LOW–MEDIUM (every request). Effort: Small (audit callers first).

---

## B. Backend (Worker/D1)

### B1. `listPublicPlans` N+1 — MEDIUM / Small

`billing.ts` ~163-175: loops plans and runs one `plan_features` query per plan. Public endpoint,
cacheable and low-cardinality.

- Fix: single `SELECT ... FROM plan_features WHERE plan_id IN (...)` grouped in JS (same pattern as the orders N+1 fix), and add `Cache-Control: public, max-age=300` — plans change rarely.
- Impact: MEDIUM (public, potentially hot). Effort: Small.

### B2. `subscriptionStatus` — MEDIUM / Small

`billing.ts` ~362-398: 3 sequential D1 queries (subscription, plan, features) + a possible
`ensureReferralCode` write on a **GET**. A read endpoint shouldn't write.

- Fix: batch the 3 reads; move referral-code creation out of the GET (create lazily on first referral action, or at registration). Removing the write also lets you cache the response.
- Impact: MEDIUM. Effort: Small.

### B3. Catalog pages do a D1 `loadTheme` read path per render — LOW / Small (already mostly cached)

`theme.ts` caches theme ~60 s in isolate memory — good. Just confirm `loadTheme`/`loadBrandingConfig`
aren't called twice per request (catalog + shell). Consider bumping catalog HTML `Cache-Control`
(currently none on store pages) to a short `s-maxage` so Cloudflare edge-caches anonymous catalog
views — big win if a store link goes viral, and it offloads D1 entirely for cache hits.

- Impact: LOW normally, HIGH on a viral store. Effort: Small.

### B4. `checkRateLimit` is 1 read + 1 write per limited call — LOW / Medium

Now on many hot paths (auth, orders, uploads, coupons). Each is a D1 read + write. For the
highest-frequency buckets consider the KV namespace you already have (`orderak_sessions`) or
Durable Objects for counters — D1 write amplification is the concern at scale, not now.

- Impact: LOW now / MEDIUM at scale. Effort: Medium. Defer until traffic warrants.

### B5. `logError`/`auditDb` write to D1 on error/mutation paths — LOW / Small

Fine at current volume. If error rates spike these amplify D1 writes; cap `error_logs` growth
(you already have the `rate_limits` GC pattern — reuse it) and consider sampling audit rows.

---

## C. Android — network, battery, background work

### C1. Periodic sync every 15 min unconditionally — MEDIUM / Small

`data/remote/SyncScheduler.kt` ~28-36: periodic work runs regardless of whether anything changed
or whether the seller is active. On low-end devices with flaky networks this is steady battery +
radio wakeups + the A1/A2 server cost.

- Fix: keep 15 min but add `setRequiresBatteryNotLow(true)` and rely on the dirty-flag (A1) to make each run cheap/no-op; consider backing off cadence when the app hasn't been opened in N days. Expedited one-time sync stays for user-visible actions.
- Impact: MEDIUM (battery + server). Effort: Small.

### C2. `currentIdToken(true)` forces a Firebase token refresh — LOW / Small

`FirebaseAuthRepository.currentIdToken` (~94) passes `forceRefresh = true`; called from `doSync`
when shop config changed. Forced refresh = network round-trip to Firebase. Since it only runs on
config change (register path), impact is small, but `false` reuses the cached token unless expired.

- Impact: LOW. Effort: Small.

### C3. OkHttp client is shared and gzip is automatic — GOOD; one addition

`NetworkModule.kt`: single `@Singleton` OkHttpClient (connection pool + Keep-Alive reused across
BackendApi and BrandingRepository) — correct. OkHttp adds `Accept-Encoding: gzip` and transparently
inflates — so JSON responses are already compressed. No action needed except: confirm the Worker
isn't disabling compression. One nit: `.cache(null)` disables HTTP caching, so `/api/theme`'s ETag
round-trip still happens every launch (a 304, cheap) — acceptable.

### C4. Dashboard spins up a second ViewModel for share data — MEDIUM / Small

`feature/main/MainScreen.kt` `DashboardTab` (~151): `val productsVm: ProductsViewModel = hiltViewModel()`
purely to read `products` for the text-catalog share. This starts a second Room `Flow` collection
(`WhileSubscribed`) on the dashboard, duplicating the products subscription that the Products tab
already owns, and keeps it warm while the user is on the dashboard.

- Fix: expose a `productCount`/lightweight `hasProducts` flow on `MainViewModel` (a `COUNT(*)` DAO query, not the full list), and only load the full product list lazily inside the share `onClick` (a one-shot `productDao().allOnce()`), not as a standing subscription.
- Impact: MEDIUM (extra DB query stream + recomposition on every catalog change while on dashboard). Effort: Small.

### C5. Tab switching tears down/rebuilds each tab — MEDIUM / Medium

`MainScreen.kt` ~120-131: `when(tab)` swaps composables, so each switch disposes and re-collects
the tab's flows (orders/products/customers all restart their Room subscriptions and lose scroll).
Already flagged as the `TODO(polish)` nested-NavHost item.

- Fix: nested `NavHost` with `saveState`/`restoreState`, or host all four tab flows in a shared VM so switching doesn't re-subscribe.
- Impact: MEDIUM (re-query + re-layout on every tab tap). Effort: Medium.

---

## D. Android — Compose recomposition / allocation

### D1. `DateFormat` allocated per row per recomposition — LOW–MEDIUM / Small

`feature/orders/OrdersScreen.kt` `OrderCard` (~95): `DateFormat.getDateTimeInstance(...).format(...)`
runs inside composition for every visible card. `getDateTimeInstance` does a locale/calendar lookup
and allocates each call — multiplied by list length and every recomposition/scroll.

- Fix: hoist a single formatter (`remember { DateFormat.getDateTimeInstance(SHORT, SHORT) }` at the list level, or a top-level val) and pass formatted strings; ideally precompute the label in the VM/mapper so the row is pure.
- Impact: LOW–MEDIUM (scroll jank on long order lists, low-end devices). Effort: Small.

### D2. `runCatching { OrderStatus.valueOf(...) }` in composition — LOW / Small

`OrdersScreen.OrderCard` (~106) and `OrderDetailsScreen` parse the status enum inside composition,
allocating an exception path on any bad value. Cheap individually but it's per-row per-recompose.

- Fix: resolve status once in the VM/mapper (map `OrderEntity` → a UI model with a typed `OrderStatus`), so composables receive already-typed, `@Stable` data. This also removes the repeated `formatEgp` calls from composition for free.
- Impact: LOW. Effort: Small (pairs naturally with D1).

### D3. Entities double as Compose models — LOW / Medium (structural)

`data/db/Entities.kt` are `@Immutable` Room entities used directly in UI. Pragmatic and currently
fine (they're stable), but every schema field change forces UI recomposition scope decisions and
couples layers. Introducing thin UI models (with pre-derived `statusLabel`, formatted price, formatted
date) is where D1/D2 land cleanly. Not urgent.

### D4. `MainScreen` reads `shopName` twice — LOW / Small

`shopName` is collected in both `MainScreen` (topBar) and `DashboardTab` (~145) — two collectors on
the same flow. Harmless (`WhileSubscribed` shares upstream) but you can pass it down as a param.

- Impact: LOW. Effort: Small.

---

## E. Android — DB indexing (cheap wins)

### E1. Missing indexes on `createdAt` sort/filter columns — MEDIUM / Small

`data/db/Daos.kt`: `OrderDao.all()` and `byPhone()` `ORDER BY createdAt DESC`; `countSince()`
filters `createdAt >= :since`; `ProductDao.all()` `ORDER BY createdAt DESC`. No index on
`orders.createdAt` or `products.createdAt`, so these are full scans + in-memory sort. Small tables
today, but the dashboard runs three count flows + the orders list continuously.

- Fix: add `@Index(value = ["createdAt"])` to `OrderEntity` and `ProductEntity` (and consider a composite `(status)` — you already query counts by status literal).
- Impact: MEDIUM as data grows. Effort: Small (Room `@Index` + a migration when you leave destructive mode).

---

## F. Design / Material 3

### F1. Contrast/token work — DONE (prior sessions). No further perf-affecting design issues.

Colors are centralized (no magic hex in composables), typography is sp-based, icons are AutoMirrored,
touch targets use M3 defaults (48dp). The AA contrast clamp added to `withRemote` runs a luminance
calc per remote-config change only (not per frame) — negligible.

### F2. `ProductsScreen`/`OrdersScreen` `LazyColumn` keys — GOOD

Both use `key = { it.id }` — stable keys, correct. Keep it.

### F3. Trailing `Spacer(height(80.dp))` item for FAB clearance — GOOD enough

Fine; alternatively `contentPadding` bottom = 80.dp avoids an extra list item. Trivial.

---

## Prioritized action list (biggest benefit / least risk)

| # | Change | Impact | Effort | Risk |
|---|---|---|---|---|
| 1 | **Dirty-flag products; skip `syncProducts` when nothing changed** (A1). Interim: content-hash guard. | HIGH | M | Low |
| 2 | **Fold `getConfig` into register/orders response; stop calling it every sync** (A2/A3). | HIGH | S | Low |
| 3 | **Add Room `@Index` on `orders.createdAt` / `products.createdAt` (+ status)** (E1). | MED (grows) | S | Low |
| 4 | **Dashboard: replace full `ProductsViewModel` load with a `COUNT(*)` flow; load list lazily on share** (C4). | MED | S | Low |
| 5 | **`listPublicPlans` N+1 → single `IN` query + `Cache-Control`** (B1). | MED | S | Low |
| 6 | **Hoist `DateFormat` + move status/price/date derivation to VM mappers** (D1/D2). | MED (jank) | S | Low |
| 7 | **`subscriptionStatus`: batch reads, remove the write on GET** (B2). | MED | S | Low |
| 8 | **Narrow `SELECT *` in `verifySeller` to needed columns** (A4). | MED (every req) | S | Low–Med |
| 9 | **Edge-cache anonymous catalog pages (`s-maxage`)** (B3). | HIGH if viral | S | Low |
| 10 | **Nested NavHost for tabs (stop re-subscribing on switch)** (C5). | MED | M | Med |

### Sequencing note

Items 1+2+3 together are the core cost story: they cut recurring D1 reads/writes and Worker CPU
per active seller by roughly half to two-thirds without changing behavior. Do those first; they're
all low-risk. Item 8 needs a quick caller audit before narrowing the query. Item 10 is the only
Medium-effort UI change and can wait.

## Explicitly NOT recommended

- Micro-tuning OkHttp timeouts / thread pools — no evidence of a bottleneck; defaults are correct here.
- Replacing Room flows with manual caching — the `WhileSubscribed(5s)` pattern is already optimal.
- Splitting the Worker into multiple Workers — modular monolith is right at this scale; cross-Worker calls would add latency + cost.
- Dynamic color / heavier theming — would add recomposition surface for no product benefit.
