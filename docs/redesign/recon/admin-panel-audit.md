# Orderak Admin Panel — Complete Audit

**Surface:** `admin.orderak.app` — React + TypeScript SPA (the "backend panel" / Control Center).
**Code:** `apps/admin-web/` (frontend), `services/backend/src/entrypoints/admin-worker.ts` + `services/backend/src/domains/admin/**` (backend).
**Audit method:** static read-only inspection with `read`/`grep`/`glob` plus read-only PowerShell inspection of committed build artifacts. Nothing was built, run, modified, created or deleted except this file.
**Working tree at audit time:** branch `main`, HEAD `db1e1ff` (2026-09-25), `apps/admin-web` clean.

**Verification legend used throughout:** every claim carries a `file:line` citation. Claims that rest on inference rather than a read file are marked **unverified**. Claims derived from the committed `apps/admin-web/dist/` build output are marked *(from `dist/`)*.

---

## 0. Executive summary

| Dimension | Finding |
|---|---|
| Routes | **43 route elements / 43 distinct paths** (`App.tsx:52-71`): 13 hand-written + 30 generated from a 41-entry config array + 1 catch-all. |
| Backend admin surface | **167 route registrations** expanding to **174 distinct method+path patterns** across 8 files (plus 3 non-route catch-alls). |
| Frontend↔backend | Frontend references **~84 distinct admin path templates** in **57 `api(...)` call sites**; **38 backend admin routes have no frontend reference at all**. |
| Architecture | Clean and small (≈2,680 lines TS/TSX, 38 components). One dense-file "generic resource page" carries 30 of 43 routes. |
| Framework | React 19.2, react-router-dom 7.18, TanStack Query 5.102, Tailwind 4.3 (build-only), Radix primitives (used by exactly one page), Vite 8 + Rolldown, Cloudflare Workers Static Assets. |
| Biggest architectural problem | **Two parallel design systems.** shadcn/Radix components in `src/shared/ui/*.tsx` are imported by *one* file (`ThemeBuilderPage.tsx`); every other page uses hand-rolled `.button`/`.panel`/`.field` CSS. |
| Biggest architectural problem #2 | **Two parallel token sources for the same names.** A committed 528-line token bundle (`src/orderak-tokens.css`) wins the cascade over the runtime `/theme.css` that the Theme Builder publishes. |
| Biggest UX problem | **13 native `window.confirm()` dialogs, 1 typed confirmation, zero 403/forbidden state.** Permission gaps mean operators fill in password+TOTP and *then* get refused. |
| Testing | 19 unit tests (Vitest) + 6 Playwright tests. **Playwright is invoked by no CI workflow**, its last recorded run **failed** on a path bug that is still on disk, and it never re-ran since. |
| Rewrite vs incremental | **Incremental redesign, not a rewrite.** Justification in §8. |

---

> **Citations and the fix rounds.** Every `file:line` in this report was taken in
> a read-only pass, before any change was made. The fixes that followed edited
> those same files, so line numbers have shifted and some rows now describe code
> that has moved or gone. Treat the **Verification pass** section below as the
> authoritative record of what was still true when it was acted on, and the
> source itself as the truth about where anything is now. The file paths remain
> correct throughout.

## 1. App shell and architecture

### 1.1 Stack and versions

Source: `apps/admin-web/package.json:22-56`.

| Concern | Choice | Version | Note |
|---|---|---|---|
| Framework | React + React DOM | `^19.2.8` | `main.tsx:44` renders in `StrictMode` |
| Router | react-router-dom | `7.18.2` (pinned) | `BrowserRouter` + `<Routes>`/`<Route>`; no data-router / loaders (`main.tsx:46`, `App.tsx:52`) |
| Server state | `@tanstack/react-query` | `^5.102.3` | Client configured once at `main.tsx:35` (`staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: false`) |
| Client state | none | — | React context for auth only (`auth-context.tsx:31`); everything else is `useState` inside pages. **No Redux/Zustand/Jotai.** |
| Forms | none | — | No react-hook-form, no Formik, no zod. Every form is uncontrolled-but-controlled `useState` + manual `disabled` predicates (`ActionDialog.tsx:25`, `PlansPage.tsx:83`). |
| Validation | none (client) | — | Backend-validated only; client-side checks are ad-hoc length/regex predicates (`AccountSecurityGate.tsx:16-17`, `ResourcePage.tsx:95`) |
| Styling | Tailwind v4 CSS-first + one 377-line hand-written stylesheet | `tailwindcss ^4.3.3` | `index.css:1` `@import "tailwindcss"`; `index.css:4-13` `@theme inline` maps ~7 token names. **Tailwind utility classes appear in only 11 of 32 `.tsx` files — all in `src/shared/ui/`.** The other 21 files use semantic classes from `index.css`. |
| Component library | shadcn-style Radix wrappers (11 files) + `lucide-react ^1.34.0` | — | `components.json:1-18` is the shadcn config, but its aliases (`@/components/ui`, `@/lib/utils`) do **not** match the actual layout (`@/shared/ui`, `@/shared/lib/utils`) — drift. |
| Charts / data grid / rich text | none | — | No table library; `DataTable` is hand-rolled (§3.2) |
| Error monitoring | `@sentry/react ^10.71.0` | — | `main.tsx:29-33`; Session Replay deliberately disabled with a written PII rationale (`main.tsx:13-28`) |
| Color math | `@material/material-color-utilities 0.3.0` | — | HCT editing in the Theme Builder only |
| TypeScript | `~6.0.2` | — | `tsconfig.app.json`: **no `"strict": true`**, `noUnusedLocals: false`, `noUnusedParameters: false` |
| Lint | `oxlint ^1.80.0` | — | `.oxlintrc.json:5-6` configures exactly two rules (`react/rules-of-hooks`, `react/only-export-components`). No jsx-a11y, no CSS/stylelint, no i18n rule. |
| Test | `vitest ^4.1.11` (jsdom), `@playwright/test ^1.62.1` | — | No coverage provider, no thresholds (`vitest.config.ts`, 9 lines) |

**Stale dependency traces (verified, low impact):** `node_modules/@refinedev/{core,react-router,devtools-internal,devtools-shared}` exist on disk and `.vite/deps/@refinedev_core.js` is a cached optimize artifact, but **`refinedev` appears in neither `apps/admin-web/package.json` nor the root `package.json`, and in no file under `src/`**. A Refine-based rewrite was evidently attempted and abandoned; the e2e failure artifacts even quote a deleted spec comment about "the Refine install plan's non-goal against conflating a 401 with a 403". Treat as dead weight to remove, not as architecture.

### 1.2 Composition root

`src/app/main.tsx:43-53` — strict, flat provider stack:

```text
StrictMode
└── QueryClientProvider (single client, main.tsx:35)
    └── BrowserRouter
        └── AuthProvider
            └── App
```

`src/app/App.tsx:47-72` then does auth gating **outside** the router:

- `auth.loading` → inline splash, not a component (`App.tsx:49`)
- `!auth.admin || loginState === 'recovery-codes'` → `<LoginScreen />` (`App.tsx:50`)
- `admin.mustChangePassword` → `<AccountSecurityGate />` (`App.tsx:51`)
- otherwise → `<Routes>` inside a single `<Route element={<AppShell />}>` layout route (`App.tsx:52`)

Consequence: there is **no routing at all while unauthenticated**; the four login states (`credentials`, `mfa`, `enroll`, `recovery-codes`) are branches of one component (`LoginScreen.tsx:21-62`), keyed off `loginState` in context (`auth-context.tsx:44`).

`void sectionById;` at `App.tsx:80` is a dead statement (the import is otherwise unused).

### 1.3 Routing model — config-driven with a hand-maintained exclusion list

This is the single most important structural fact about the panel.

- `src/app/config/sections.ts:21-68` declares **41 sections** as data: `{id, path, label, description, group, permission, endpoint?, resultKeys?, icon}`.
- `src/app/App.tsx:53-68` hand-writes **13 routes** for sections that need bespoke UI.
- `src/app/App.tsx:69` generates the remaining **30 routes** by *excluding* an 11-element id list from the same array:

```tsx
{sections.filter(section => !['dashboard','stores','support','deletions','runtime','jobs',
 'security','admins','plans','theme','billing-verifications'].includes(section.id))
 .map(section => <Route key={section.id} path={section.path.slice(1)}
   element={<Permission permission={section.permission}>
     <ResourcePage section={section} />{section.id === 'flags' && <FlagSimulator />}
   </Permission>} />)}
```

The exclusion list is a **string literal that must be kept in sync with `sections.ts` and with the hand-written routes by hand**. Adding a bespoke page without adding its id here produces two routes for the same path; removing one silently drops a route. This is the highest-leverage refactor target in the shell.

### 1.4 Route-level authorization

`App.tsx:74-78`:

```tsx
function Permission({ permission, children }) {
  const auth = useAuth();
  if (!auth.can(permission)) return <Navigate to="/" replace />;
  return children;
}
```

- `auth.can` (`auth-context.tsx:137-140`) is **membership-only**: `permissions.includes('*') || permissions.includes(permission)`. The comment at `auth-context.tsx:128-136` documents that this used to re-derive implication rules client-side and got them wrong; the fix was to let the server send the fully expanded set (`permissionsForRole`, `services/backend/src/domains/identity/auth.ts:399-411`).
- A denial is a **silent redirect to `/`**. There is **no 403 / not-authorized route anywhere in the app** (verified by grep for `403`/`forbidden` in `src/**`: no matches outside e2e artifacts).

### 1.5 Data fetching

Two incompatible idioms coexist:

| Idiom | Where | Count |
|---|---|---|
| TanStack Query (`useQuery`/`useMutation`) | `DashboardPage`, `StoresPage`, `SupportPage`, `OperationsPages`, `PlansPage`, `BillingVerificationsPage`, `RuntimePage`, `ResourcePage`, `ActionDialog`, `FlagSimulator` | **14 `useQuery` + 26 `useMutation`** |
| Raw `api()` + `useState` + `useCallback` loaders | `ThemeBuilderPage` (581 lines, 8 call sites), `auth-context` (5), `AccountSecurityGate` (1) | 14 |

`ThemeBuilderPage` in particular re-implements debouncing (`:200-212`), aborting (`:199,211`), a 409 conflict refetch (`:230-233`), and cache invalidation-by-reload (`:168-182`) — all of which `useQuery`/`useMutation` provide. It also holds **13 `useState` calls** in the page component alone (`:152-164`).

`api()` itself (`src/shared/api/client.ts:17-39`) is a thin `fetch` wrapper with: JSON content-type inference, CSRF header injection from a module-level variable (`:7-15`, `:20-22`), `credentials: 'same-origin'`, typed `ApiError` extraction from RFC-7807-ish bodies, and a global `orderak:unauthorized` event dispatch on 401 (`:30`) which `auth-context.tsx:60-61` listens for to clear the session.

Query-key hygiene is inconsistent: keys are ad-hoc strings (`['stores']`, `['resource', section.id]`, `['plan-catalog']`, `['billing-health']`), and `ResourcePage` invalidates `['resource', 'translations']` / `['resource', 'content']` / `['resource', 'privacy']` by literal id (`ResourcePage.tsx:72,78,93`) — strings that must match the section ids in `sections.ts` but are not derived from them.

### 1.6 Styling and theming

Three layers, in cascade order:

1. **`/theme.css`** — a runtime stylesheet served from `api.orderak.app` and proxied by the admin edge Worker (`apps/admin-web/src/edge/worker.ts:21-51`), linked in `index.html:6`. Generated by `designSystemCss()` (`services/backend/src/domains/design/design-system.ts:838-875`).
2. **`src/orderak-tokens.css`** (528 lines) — a *committed* generated snapshot imported by `index.css:2`. Header claims "DO NOT EDIT BY HAND … generated … on 2026-09-04 … 296 tokens" (`orderak-tokens.css:1-17`).
3. **`src/index.css`** (377 lines) — Tailwind import, `@theme inline` bridge, and the hand-written component stylesheet that every page actually uses.

> **Cascade defect (high severity, static analysis of `dist/`).** In the committed build output, the theme link is injected first and the app stylesheet last: `dist/index.html:6` = `<link id="orderak-theme-stylesheet" href="/theme.css">`, `dist/index.html:15` = `<link rel="stylesheet" href="/assets/admin-C4OMn6BC.css">`. Both files declare the same custom properties at the same `:root` specificity (`orderak-tokens.css:50-66` vs `design-system.ts:842-848`), so **the bundled snapshot wins and the published theme is overridden for every name the bundle defines** — which, per its own header, is essentially all 296 of them.
>
> The defect is invisible to the person who triggers it: `ThemeBuilderPage.tsx:339-343` (`applySnapshotToAdmin`) writes the new M3 colours as **inline styles on `document.documentElement`** immediately after a successful apply, and inline styles beat every stylesheet rule. So the publishing administrator's own tab restyles; every other administrator, and that same administrator after a reload, does not. **Runtime behaviour not observed — marked unverified; the cascade order is read directly from the committed artifact.**

### 1.7 Build and deploy

| Concern | Fact | Cite |
|---|---|---|
| Build | `tsc -b && vite build` | `package.json:8` |
| Bundler | Vite 8 + Rolldown + `@vitejs/plugin-react` + `@tailwindcss/vite` | `vite.config.ts:2-10` |
| Aliases | `@` → `./src` | `vite.config.ts:27-31` |
| Multi-entry | `index.html` **and** `theme-preview.html` | `vite.config.ts:41-45` |
| Manual chunks | `react-vendor`, `data-vendor` (`@tanstack`), `ui-vendor` (`@radix-ui`); everything else falls through | `vite.config.ts:61-67` |
| Lazy routes | 13 `lazyNamed(...)`/`lazy(...)` imports; login, gate, shell, dashboard, `ResourcePage` eager | `App.tsx:12-45` |
| Sentry plugin | only when `SENTRY_AUTH_TOKEN` set; deletes sourcemaps after upload | `vite.config.ts:14-25` |
| Dev proxy | `/api` → `http://localhost:8787` | `vite.config.ts:32-39` |
| Hosting | **Cloudflare Workers Static Assets**, `not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*","/theme.css","/theme-preview","/theme-preview.html"]` | `wrangler.edge.jsonc:34-39` |
| Custom domain | `admin.orderak.app` (production base env, no `env.production`) | `wrangler.edge.jsonc:21-26`; staging variant `wrangler.edge.staging.jsonc` |
| API routing | `ADMIN_WORKER` **service binding** to `orderak-admin-worker`; no cross-zone fetch | `wrangler.edge.jsonc:31-33`, `src/edge/worker.ts:17-19` |
| Host confinement | non-canonical hostname → 404 | `src/edge/worker.ts:15`; tested `src/tests/edge-worker.test.ts:65-69` |
| Security headers | `public/_headers:1-9`: strict CSP, `frame-ancestors 'none'`, COOP/CORP, Permissions-Policy, HSTS, `no-referrer`, `nosniff` | also `src/edge/worker.ts:3-10` |
| CSP sentry allowlist | `connect-src` includes `*.ingest{"",".us",".de"}.sentry.io` | `public/_headers:2` |
| Sentry replay | excluded **by policy**, with a PII rationale naming seller/buyer phone numbers and ticket bodies | `main.tsx:13-28` |
| Deploy scripts | `deploy:staging` (default `deploy`), `deploy:production` | `package.json:11-15` |
| Production freeze | fail-closed on repo variable `PRODUCTION_DEPLOYS_ENABLED` | `.github/workflows/production-deploy.yml:41-58` |

### 1.8 Bundle structure *(from `dist/`)*

| Chunk | Raw size | Loaded |
|---|---|---|
| `admin-DooBU5aT.js` (entry) | 365 KB | eager |
| `react-vendor-CnWdoFZJ.js` | 220 KB | eager (modulepreload) |
| `data-vendor-DpUNzKA6.js` | 43 KB | eager (modulepreload) |
| `admin-C4OMn6BC.css` | 68 KB | eager |
| `ui-vendor-QDxXnx2i.js` (Radix) | 107 KB | lazy — only ThemeBuilder |
| `ThemeBuilderPage-BVi6y7BT.js` | 100 KB | lazy |
| `OperationsPages` / `PlansPage` / `StoresPage` / `BillingVerificationsPage` / `SupportPage` / `RuntimePage` / `ResourcePage` / `FlagSimulator` | 13.6 / 13.4 / 5.5 / 5.6 / 4.5 / 2.3 / 1.6 / 1.5 KB | lazy |
| 12 × `.woff2` (Cairo / Tajawal / Noto Sans Arabic) | ≈330 KB | on demand |
| **Initial JS+CSS** | **≈696 KB raw** | gates `verify-worker-budget.mjs` (≤1024 KB gzip for the edge Worker) |

**Stale artifacts note:** `dist/assets/AuditPage-CI_1sPN1.js` and `dist/assets/TasksPage-DhLipuA6.js` exist with the same build timestamp as everything else, but **no such source module exists** and **no reference to either name is present in `admin-DooBU5aT.js`** → dead chunks from a superseded source revision. *(from `dist/`)*

---

## 2. Full route / page inventory

**43 route elements. 43 distinct paths. 41 config sections. 13 hand-written routes + 30 generated + 1 catch-all.**

### 2.1 Hand-written routes (13) + catch-all

| # | Path | Component file | Purpose | Backend calls | UI gate (`App.tsx`) | Server permission enforced | States present |
|---|---|---|---|---|---|---|---|
| 1 | `/` | `features/dashboard/DashboardPage.tsx` (35 L) | Live platform health: 4 metric cards + attention queue + subscription snapshot + truth banner | `GET /api/admin/v1/control-plane/dashboard` (`:11`, 60 s poll) | `dashboard:view` (`App.tsx:53`, no wrapper) | `dashboard:view` (`admin-control-plane.ts:38`) | loading, error, live; **no empty state** |
| 2 | `/stores` | `features/stores/StoresPage.tsx` `StoresPage` (`:12-16`) | Seller list | `GET /api/admin/v1/stores` (`:14`) | `sellers:view` (`App.tsx:54`) | `sellers:view` (`admin.ts:82`) | loading, error, empty, table |
| 3 | `/stores/:id` | `features/stores/StoresPage.tsx` `StoreDetailPage` (`:18-40`) | Store profile + subscription + device sessions + danger zone + latest deletion | `GET /stores/{id}`, `PATCH /stores/{id}`, `DELETE /stores/{id}/devices/{row_id}` (`:24-26`) | `sellers:view`; danger zone additionally `sellers:manage` (`:37`) | `sellers:view` + nested `subscriptions:view`/`deletions:view`/`devices:view`; `sellers:manage`; **`devices:manage`** (`admin-operations.ts:221,235,246-247,273,448`) | loading, error, empty (no subscription), **device revoke unguarded** |
| 4 | `/support` | `features/support/SupportPage.tsx` `SupportPage` (`:12-16`) | Ticket queue | `GET /api/admin/v1/support/tickets` (`:14`) | `support:view` (`App.tsx:56`) | `support:view` (`admin-operations.ts:320`) | loading, error, empty, table |
| 5 | `/support/:id` | `features/support/SupportPage.tsx` `TicketDetailPage` (`:18-36`) | Threaded conversation + reply + status/priority workflow | `GET/PATCH/POST /support/tickets/{id}` (`:25-27`) | `support:view`; reply box additionally `support:manage` (`:33`) | `support:view` / `support:manage` (`admin-operations.ts:331,341,355`) | loading, error, empty ("No messages yet"), raw JSON ticket dump |
| 6 | `/deletions` | `features/operations/OperationsPages.tsx` `DeletionsPage` (`:11-22`) | Deletion/trust verification, deadline, safe retry | `GET /deletion-requests`, `POST /deletion-requests/{id}/{verify\|retry}` (`:15-16`) | `deletions:view` (`App.tsx:58`) | `deletions:view` / **`deletions:manage`** (`admin-operations.ts:287,298`) | loading, error, empty, modal; **verify/retry buttons not permission-gated** |
| 7 | `/governance/runtime` | `features/governance/RuntimePage.tsx` (18 L) | Typed runtime controls with deployment gates | `GET/PATCH /api/admin/v1/runtime-config` (`:13,16`) | `settings:view` (`App.tsx:59`) | `settings:view` / `settings:manage` (`admin-operations.ts:41,54`) | loading, error, `display_only` (switch replaced by badge), **PATCH body hardcodes only `ai_enabled` + `billing_enabled`** while rendering *every* control (`:16` vs `:17`) |
| 8 | `/system/jobs` | `features/operations/OperationsPages.tsx` `JobsPage` (`:24-30`) | Scheduled job run history + owner retries | `GET /operations/jobs`, `POST /operations/jobs/{key}/run` (`:27-28`) | `operations:view`; run buttons `operations:run` (`:29`) | `operations:view` / `operations:run` (`admin-operations.ts:457,466`) | loading, error, empty; **no progress/streaming for a run** |
| 9 | `/system/security` | `features/operations/OperationsPages.tsx` `SecurityPage` (`:32-54`) | MFA posture, admin sessions, alerts, archive integrity | `GET /security` + `GET /access/sessions`, `PATCH /security/alerts/{id}`, `DELETE /access/sessions/{id}` (`:37,40,41`) | `security:view` (`App.tsx:61`) | `security:view` / **`security:manage`** / `admins:manage` (`admin-control-plane.ts:75,77,73`) | loading, error, empty; **alert acknowledge/resolve not permission-gated**; `audit_archives` counted but never listed; `POST /security/audit-archives/verify` has no UI affordance |
| 10 | `/system/access` | `features/operations/OperationsPages.tsx` `AdminAccessPage` (`:56-75`) | Admin roster, 24-h invitations, access lifecycle | `GET /access/admins` + `GET /access/invitations`, `POST /access/invitations`, `POST /access/invitations/{id}/revoke`, `POST /action-authorizations`, `PATCH /access/admins/{id}` (`:63-69`) | `admins:view`; mutations `admins:manage` (`:71,72`) | `admins:view` / `admins:manage` + step-up `admin.access_change` (`admin-control-plane.ts:64-73,389`) | loading, error, empty, one-time secret reveal, step-up modal, typed… **no, plain `confirm`** (`:73`) |
| 11 | `/commerce/plans` | `features/commerce/PlansPage.tsx` (102 L) | Immutable plan revisions: draft → validate → impact → publish; entitlement matrix; overrides | `GET /plan-catalog`, `POST /plans/{id}/drafts`, `PATCH /plan-revisions/{id}` (+`If-Match`), `POST .../validate`, `GET .../impact`, `POST .../publish`, `POST /organizations/{id}/entitlement-overrides`, `POST/DELETE /test-lab/organizations/{id}/plan` (`:15-73`) | `plans:view`; draft `plans:draft` (`:81,83`); publish `plans:publish` (`:84`); override/test-lab `subscriptions:manage` (`:87,100`) | `plans:view`/`plans:draft`/`plans:publish`/`subscriptions:manage` (`admin-entitlements.ts:21,24,27,30,35,40,43,45,48,59`) | loading, error, validation JSON dump, staging-only gate via `window.location.hostname` (`:26-27`), `display_only`/`planned` definitions shown but filtered out of the editor (`:77`) |
| 12 | `/commerce/billing-verifications` | `features/commerce/BillingVerificationsPage.tsx` (186 L) | Play purchase-verification queue, lease health, audited requeues | `GET /billing/verifications[?status]` + `GET /billing/health`, `POST /action-authorizations`, `POST /billing/verifications/{id}/retry` (`:48-53,63-77`) | `subscriptions:view` (route); requeue `subscriptions:manage` (`:87`) | `subscriptions:view` / `subscriptions:manage` + step-up `billing.verification_retry` — **and `authorizeAction` hard-requires `role === "owner"`** (`admin-control-plane.ts:492`) | loading, error, empty, status filter, explicit "only a dead-lettered job can be requeued" explanation (`:157`), raw JSON health dump |
| 13 | `/system/theme` | `features/theme/ThemeBuilderPage.tsx` (581 L) | Design-system editor: seeds/HCT, typography, spacing/shapes, generated roles, revision history, isolated live preview | `GET /theme`, `POST /theme/preview`, `PUT /theme`, `GET /theme/revisions`, `PATCH/DELETE /theme/revisions/{id}`, `POST /theme/revisions/{id}/activate` (`:169,202,221,231,376,424,446,468`) | `theme:view` (route, `App.tsx:68`); apply/save `theme:manage` (`:166,299`); delete `theme:rollback` (`:299`) | `theme:view`/`theme:manage`/`theme:rollback` (`admin-theme.ts:101,150,195,207,218`) | **the richest state model in the app**: loading (`:243`), inline status alert (`:256`), generator-upgrade diff (`:257`), unsaved-edit recovery with 7-day expiry (`:258,185-191`), validation panel (`:301,325-330`), 409 conflict + rebase/discard (`:311-314,230-241`), typed deletion confirmation (`:539-540`), beforeunload guard (`:193-196`) |
| — | `*` | — | Redirect to `/` | — | — | — | `App.tsx:70` |

### 2.2 Generated routes (30) — all `<ResourcePage>` (+ `FlagSimulator` on `flags`)

Files: `src/app/config/sections.ts` (config), `src/features/resources/ResourcePage.tsx` (147 L, one component for all 30).

| # | Path | Section id | Nav group | Config perm | Endpoint (`sections.ts`) | `resultKeys` | Server perm | Extra detail actions in `ResourcePage` (`:27`) | States |
|---|---|---|---|---|---|---|---|---|---|
| 14 | `/buyers` | `buyers` | Accounts | `buyers:view` | `/buyers` | `items` | `buyers:view` | — | L/E/empty |
| 15 | `/buyers/privacy` | `privacy` | Accounts | `buyers:view` | `/buyer-privacy` | `items` | `buyers:view` | `PrivacyActions` (`:83-96`) | + status machine + re-enter phone |
| 16 | `/commerce/subscriptions` | `subscriptions` | Commerce | `subscriptions:view` | `/subscriptions` | `subscriptions` | `subscriptions:view` | + `BillingLeaseHealth` panel (`:25,40-68`, 60 s poll) | + p50/p95/max/reclaims |
| 17 | `/commerce/coupons` | `coupons` | Commerce | `coupons:view` | `/coupons` | `coupons` | `coupons:view` | — | L/E/empty |
| 18 | `/commerce/affiliate` | `affiliate` | Commerce | `affiliate:view` | `/referrals` | `referrals` | **`payouts:view`** | — | L/E/empty |
| 19 | `/commerce/ads` | `ads` | Commerce | `ads:view` | `/ads` | `ads` | `ads:view` | — | L/E/empty |
| 20 | `/commerce/exports` | `exports` | Commerce | `export:view` | `/exports` | `items` | `export:view` | `ExportDownload` (`:98-121`) + step-up modal | + download-once / fresh-auth |
| 21 | `/governance/flags` | `flags` | Governance | `flags:view` | `/flags` | `items`,`rules` | `flags:view` | + `FlagSimulator` (`App.tsx:69`) | 2 tables + simulator |
| 22 | `/governance/versions` | `versions` | Governance | `versions:view` | `/app-versions` | `items` | `versions:view` | — | L/E/empty |
| 23 | `/governance/capabilities` | `capabilities` | Governance | `capabilities:view` | `/capabilities` | `items`,`store_controls` | `capabilities:view` | — | 2 tables; **`planned`/`display_only` rows are not visually blocked** |
| 24 | `/communication/announcements` | `announcements` | Communication | `announcements:view` | `/announcements` | `announcements` | `announcements:view` | — | L/E/empty |
| 25 | `/communication/translations` | `translations` | Communication | `translations:view` | `/product-translations` | `translations` | `translations:view` | `TranslationActions` (`:70-74`) | + approve/reject |
| 26 | `/communication/emails` | `emails` | Communication | `emails:view` | `/email-templates` | `templates` | `emails:view` | — | L/E/empty |
| 27 | `/communication/email-events` | `email-events` | Communication | `emails:view` | `/email-events` | `events` | `emails:view` | — | L/E/empty |
| 28 | `/communication/inbox` | `inbox` | Communication | `emails:view` | `/inbound-emails` | `emails`,`messages` | `emails:view` | — | L/E/empty; **read-on-GET server behaviour has no UI signal** |
| 29 | `/communication/support-macros` | `macros` | Communication | `support:view` | `/support-macros` | `items` | `support:view` | — | L/E/empty |
| 30 | `/communication/content` | `content` | Communication | `content:view` | `/content-configs` | `items` | `content:view` | `ContentActions` (`:76-81`) | + publish draft |
| 31 | `/system/audit` | `audit` | System | `audit:view` | `/audit` | `audit` | `audit:view` | — | L/E/empty |
| 32 | `/system/errors` | `errors` | System | **`errors:view`** | `/errors` | `errors` | **`audit:view`** | — | **perm mismatch** (`admin.ts:105`) |
| 33 | `/system/settings` | `settings` | System | `settings:view` | `/settings` | `settings` | `settings:view` | — | L/E/empty |
| 34 | `/internal/roadmap` | `roadmap` | Engineering | `roadmap:view` | `/roadmap` | `items`,`roadmap` | `roadmap:view` | — | L/E/empty |
| 35 | `/internal/tasks` | `tasks` | Engineering | `tasks:view` | `/tasks` | `items`,`tasks` | `tasks:view` | — | L/E/empty |
| 36 | `/internal/releases` | `releases` | Engineering | `releases:view` | `/releases` | `items`,`releases` | `releases:view` | — | L/E/empty |
| 37 | `/internal/bugs` | `bugs` | Engineering | `bugs:view` | `/bugs` | `bugs` | `bugs:view` | — | L/E/empty |
| 38 | `/internal/manifests` | `manifests` | Engineering | `screens:view` | `/screens` | `items`,`screens` | `screens:view` | — | L/E/empty; `POST /screens/sync` unreachable from UI |
| 39 | `/internal/prompts` | `prompts` | Engineering | `prompts:view` | `/prompts` | `items`,`prompts` | `prompts:view` | — | L/E/empty |
| 40 | `/internal/docs` | `docs` | Engineering | `docs:view` | `/project-docs` | `items`,`docs` | `docs:view` | — | L/E/empty |
| 41 | `/internal/design` | `design` | Engineering | `design:view` | `/design-assets` | `assets` | `design:view` | — | L/E/empty |
| 42 | `/internal/locales` | `locales` | Engineering | **`plans:view`** | `/storefront-locales` | `locales` | `plans:view` | — | L/E/empty; **an "Engineering" item gated on a commerce permission** |
| 43 | `/internal/endpoints` | `tags` | Engineering | `endpoints:view` | `/endpoints` | `items`,`endpoints` | `endpoints:view` | — | L/E/empty |

**All 30 share one state model**: `LoadingState` / `ErrorState(retry)` / `DataTable` (whose own empty state is "No matching records") / `DetailPanel` drawer. **None of them has a forbidden state, a saved-view state, or a write path beyond the one generic `ActionDialog`.**

### 2.3 Mapping to the documented workspace waves

`docs/product/app-plan.md:501-504` names three waves; **no page is assigned to a wave anywhere in the docs** (`grep -i wave` over `docs/**` → one hit, that sentence). The grouping below is therefore an inference, cross-checked against the code's own nav groups:

| Wave (`app-plan.md:502-504`) | Nav groups | Section ids | Routes |
|---|---|---|---|
| **1 — "account and trust operations"** | Accounts | `stores`, `buyers`, `privacy`, `support`, `deletions` | 6 (incl. `/stores/:id`, `/support/:id`) |
| **2 — "plan, entitlement, rollout, commerce, buyer privacy, and exports governance"** | Commerce + Governance | `subscriptions`, `plans`, `coupons`, `affiliate`, `ads`, `exports`, `billing-verifications`, `flags`, `versions`, `capabilities`, `runtime` | 12 |
| **3 — "communication, content, jobs, security, settings, manifests, prompts, bugs, releases, docs, and design assets"** | Communication + System + Engineering | `announcements`, `translations`, `emails`, `email-events`, `inbox`, `macros`, `content`, `jobs`, `audit`, `errors`, `security`, `admins`, `settings`, `theme`, `roadmap`, `tasks`, `releases`, `bugs`, `manifests`, `prompts`, `docs`, `design`, `locales`, `tags` | 24 |
| *(unassigned)* | Overview | `dashboard` | 1 |

**Wave 3 is twice the size of waves 1+2 combined** and it is exactly where the generic `ResourcePage` degenerates: it contains the entire Engineering group (10 sections) that shares a single table-plus-drawer shape.

### 2.4 Routes that exist in neither registry — and the registry divergence

Two **parallel, unsynchronised** route registries exist:

| Registry | Entries | Cite |
|---|---|---|
| `apps/admin-web/src/app/config/sections.ts` | **41** | `:22-68` |
| `contracts/typescript/admin.ts` `ADMIN_SECTIONS` | **40** | `:65-106` |

Divergences (verified by comparison):

- `billing-verifications` is present in `sections.ts:30` and **absent from `ADMIN_SECTIONS`**.
- Labels differ for six entries: `Deletion & Trust` vs `Deletion & trust`; `Runtime config` vs `Runtime configuration`; `Inbound inbox` vs `Inbox`; `Errors` vs `Error log`; `Security` vs `Admin security`; `Admin access` vs `Administrators`; `Settings & theme` vs `Settings`; `Docs & design` vs `Documentation`.
- Domain names differ: `sections.ts` uses `Engineering`; `admin.ts` uses `Internal`.

Nothing asserts the two registries agree. Only *internal* integrity is tested: `apps/admin-web/src/tests/sections.test.ts:5-15` (41 unique ids/paths + a hardcoded 39-id presence list) and `services/backend/test/admin-panel-coverage.spec.ts:6-11` (40-id presence list, unique paths, `:` in every permission). **Both presence lists are stale relative to their own registries**: the frontend list enumerates 39 of 41 ids (omits `dashboard` and `billing-verifications`), the backend list 40 of 40 — which means the backend test would *pass* if `billing-verifications` were deleted from `ADMIN_SECTIONS`.

---

## 3. Component inventory and duplication

### 3.1 Full component inventory (38 components across 32 `.tsx` files, 2,057 lines)

| File | Lines | Components | Role |
|---|---|---|---|
| `app/main.tsx` | 53 | — | Bootstrap, Sentry, QueryClient, providers |
| `app/App.tsx` | 80 | `App`, `Permission`, `lazyNamed` | Auth gating + routing |
| `app/layout/AppShell.tsx` | 88 | `AppShell`, `CommandPalette` | Chrome: sidebar, topbar, palette, Suspense boundary |
| `features/auth/auth-context.tsx` | 150 | `AuthProvider`, `useAuth`, `applySession` | Session/permission context |
| `features/auth/LoginScreen.tsx` | 70 | `LoginScreen`, `AuthFrame`, `Field`, `ErrorText` | 4 login states |
| `features/auth/AccountSecurityGate.tsx` | 26 | `AccountSecurityGate` | Forced password change |
| `features/dashboard/DashboardPage.tsx` | 35 | `DashboardPage`, `MetricCard`, `Attention` | Overview |
| `features/stores/StoresPage.tsx` | 40 | `StoresPage`, `StoreDetailPage` | Stores list + detail |
| `features/support/SupportPage.tsx` | 36 | `SupportPage`, `TicketDetailPage` | Support queue + thread |
| `features/operations/OperationsPages.tsx` | 75 | `DeletionsPage`, `JobsPage`, `SecurityPage`, `SecurityMetric`, `AdminAccessPage` | 4 unrelated pages in one file |
| `features/commerce/PlansPage.tsx` | 102 | `PlansPage` | Plan revision workspace |
| `features/commerce/BillingVerificationsPage.tsx` | 186 | `BillingVerificationsPage` | Play verification queue |
| `features/governance/RuntimePage.tsx` | 18 | `RuntimePage` | Runtime controls |
| `features/governance/FlagSimulator.tsx` | 10 | `FlagSimulator` | Flag evaluation |
| `features/resources/ResourcePage.tsx` | 147 | `ResourcePage`, `BillingLeaseHealth`, `TranslationActions`, `ContentActions`, `PrivacyActions`, `ExportDownload`, `rowsFromPayload` | **The generic page for 30 routes** |
| `features/theme/ThemeBuilderPage.tsx` | 581 | 16 components incl. `HctControls`, `SeedEditor`, `PreviewFrame`, `GeneratorUpgradeDiff`, `ValidationPanel`, `TokenTable`, `DiffBlock`, `RevisionHistory`, `HistoryGroup`, `RevisionRow`, `FieldSelect`, `RoleEditor` | Design-system editor; **28% of all frontend component code in one file** |
| `shared/ui/Page.tsx` | 13 | `PageHeader`, `LoadingState`, `ErrorState`, `DetailPanel` | **The real page primitives** |
| `shared/ui/DataTable.tsx` | 72 | `DataTable`, `StatusBadge`, `renderValue`, `humanize` | **The only table** |
| `shared/ui/ActionDialog.tsx` | 44 | `ActionDialog`, `FormField`, `serialize` | **The only generic form** |
| `shared/ui/{button,card,dialog,input,label,select,slider,switch,tabs,badge,alert}.tsx` | 5–28 each (153 total) | 22 exports | **shadcn/Radix kit — imported by exactly one file** |

### 3.2 Data tables — one hand-rolled implementation, no library

`shared/ui/DataTable.tsx` (72 lines) is the entire data-grid capability of the panel.

| Capability | Present? | Detail |
|---|---|---|
| Column definition | Implicit — derived from `Object.keys(rows[0])` (`:13`), reordered by a `preferred` string array and **hard-truncated to 7 columns** (`:14`) | No column metadata, no per-column type/renderer/formatter |
| Sorting | **No** | No sort state, no `<th>` handlers, no `aria-sort` |
| Column filtering | **No** | Only a whole-row substring filter |
| Global filter | Yes — `JSON.stringify(row).toLowerCase().includes(query)` (`:16`) | Serialises every row on every keystroke; matches hidden/sensitive field values; no debounce |
| Pagination | Client-side only, `pageSize = 25` hardcoded (`:17`) | Clamped page (`:24`, with a good comment explaining the past-the-end bug it fixed) |
| Server pagination / cursor | **No** | Every list is fetched whole. `listAudit`/`listErrors`/`listStores` server-side cap at 100/100/100 rows (`admin.ts:128,134,150`) and the UI can never reach past them |
| Row selection / bulk actions | **No** | `onSelect` opens a drawer; there are **no checkboxes and no bulk operations anywhere in the panel** |
| Column visibility / resize / reorder | **No** | — |
| Sticky header | **No** (only inside the ThemeBuilder diff table, `index.css:63`) | — |
| Empty state | Yes | "No matching records" (`:30`) — but it is rendered **for both** "no data" and "no filter match", so a genuinely empty section looks filtered |
| Loading state | **No** | The table has none; callers render `LoadingState` above it |
| Error state | **No** | Same as loading — the caller owns it |
| Row-level actions | **No** | All affordances live in the drawer, not on the row |
| Sensitive-field redaction | Yes | Regex on key names (`:7,13`): `password`, `secret`, `token`, `cipher`, `raw_json`, `details_json`, `phone_hash`, `credential` |
| Keyboard navigation | **No** | Rows are `<tr onClick>` (`:31`), not focusable, not reachable by keyboard |
| Accessibility | Partial | `th` semantics, named pagination buttons, filter input — asserted by `src/tests/accessibility.test.tsx:6-12`. **No `scope`, no `aria-sort`, no `caption`, no live region, no `aria-busy`.** |

**Per-page `preferred` column lists total 9 in `ResourcePage.tsx:137-147` plus 8 inline at call sites** (`StoresPage.tsx:15,36`, `SupportPage.tsx:15`, `OperationsPages.tsx:19,29,49,72`, `BillingVerificationsPage.tsx:136`) — **17 hardcoded column-order arrays with no shared vocabulary**. When a backend field is renamed, the column silently disappears from `preferred` and reappears at the end of the row (because `:14` filters `preferred` against actual keys).

### 3.3 Forms and validation

There is **no form abstraction**. The three patterns are:

1. **`ActionDialog`** (`shared/ui/ActionDialog.tsx:7-27`) — one generic modal driven by a declarative `ActionConfig` (`app/config/actions.ts:1-2`). Handles: field rendering for 6 field types (`:31`), required-field predicate (`:25`), string→JSON coercion for two magic field names (`:34-43`), one-time step-up inline for sensitive exports (`:13,19-22`), and `confirm()` (`:26`). **22 action configs** exist (`actions.ts:5-54`), each an inline 1–8 line object.
2. **Inline `useState` per field** — `PlansPage.tsx` has 6 such objects (`:16-25`), `AdminAccessPage` 2 (`:59,62`), `BillingVerificationsPage` 1 (`:41`), `TicketDetailPage` 3 (`:22-24`), `PrivacyActions` 4 (`:86-89`), `ExportDownload` 2 (`:100-101`).
3. **`LoginScreen`/`AccountSecurityGate`** — plain `useState` per field with a hand-written `submit()` wrapper (`LoginScreen.tsx:15-19`).

**Validation inventory (all of it):**

| Rule | Location |
|---|---|
| `required` on an action field | `ActionDialog.tsx:25` |
| password ≥ 12 chars | `AccountSecurityGate.tsx:16`, `ActionDialog.tsx:25`, `ResourcePage.tsx:120`, `BillingVerificationsPage.tsx:180`, `OperationsPages.tsx:73` |
| 6-digit TOTP regex | `ActionDialog.tsx:25`, `ResourcePage.tsx:120`, `OperationsPages.tsx:73`, `BillingVerificationsPage.tsx:180` |
| reason ≥ 5 chars | `StoresPage.tsx:37`, `OperationsPages.tsx:20`, `BillingVerificationsPage.tsx:180` |
| reason ≥ 8 chars | `PlansPage.tsx:94` |
| phone ≥ 7 digits | `ResourcePage.tsx:95` |
| name 1–80 chars | `ThemeBuilderPage.tsx:529` |
| hex `^#[0-9A-F]{6}$` | `ThemeBuilderPage.tsx:54,56` |
| typed delete confirmation match | `ThemeBuilderPage.tsx:540` |
| `if-match` optimistic concurrency | `PlansPage.tsx:47` |

**No field-level error display exists anywhere.** Every mutation error surfaces as one `<p className="error-text">` at the bottom of a modal or panel (`ResourcePage.tsx:73,80,95,120`; `ActionDialog.tsx:26`; `PlansPage.tsx:84`). Server-side `field_errors` is typed in the contract (`contracts/typescript/admin.ts:42`) and **never read** by any client code.

### 3.4 Modals, drawers and confirmations

| Pattern | Count | Implementation | Cite |
|---|---|---|---|
| Native `window.confirm()` | **13** | Destructive or audited actions | `BillingVerificationsPage.tsx:181`; `PlansPage.tsx:84,95`; `OperationsPages.tsx:20,29,49,72,73`; `ResourcePage.tsx:73,80`; `StoresPage.tsx:36,37`; `ActionDialog.tsx:26` |
| Radix `Dialog` (shadcn) | 5 | **Only in `ThemeBuilderPage`** | `ThemeBuilderPage.tsx:307,311,518,532` |
| Hand-rolled `.modal-backdrop > section.modal` | 5 | `ResourcePage.tsx:95,120`; `OperationsPages.tsx:20,50,73` | — |
| Hand-rolled `.drawer-backdrop > aside.drawer` | 1 | `DetailPanel`, `shared/ui/Page.tsx:12` | — |
| Typed confirmation | **1** | ThemeBuilder permanent revision delete | `ThemeBuilderPage.tsx:539-540` |

So: **the only component library in the repo implements modals correctly (Radix focus trap, portal, escape, `aria-modal`), and 5 of the 6 hand-rolled modals do not use it.** The 13 `confirm()` calls are the highest-frequency interaction in the panel and are entirely unstyleable, unlocalisable, un-auditable and untestable by role.

### 3.5 Page shells — 8 distinct shells

| # | Shell | Where | Used by |
|---|---|---|---|
| 1 | **Standard page** — `.page` + `<PageHeader>` | `shared/ui/Page.tsx:4-6` | 12 of 13 bespoke pages + 30 generic + TicketDetail + StoreDetail |
| 2 | **Generic resource page** — `PageHeader` + N × `.resource-group` + `DataTable` + optional `DetailPanel` | `ResourcePage.tsx:14-30` | 30 routes |
| 3 | **Detail page** — `.back-link` + `PageHeader` + `.detail-grid`/`.ticket-layout` | `StoresPage.tsx:31-39`, `SupportPage.tsx:31-34` | 2 |
| 4 | **Auth shell** — `.auth-page` + `.auth-card` + `AuthFrame` | `LoginScreen.tsx:65-67` | 4 login states |
| 5 | **Auth shell, duplicated** — `.auth-page` + `.auth-card wide`, *no* `AuthFrame`, hand-rolled | `AccountSecurityGate.tsx:25` | 1 |
| 6 | **Theme-builder shell** — `.page theme-builder-page` + hand-written `.page-header`/`.page-actions` + 2-column grid + sticky preview | `ThemeBuilderPage.tsx:247-306` | 1 |
| 7 | **App shell** — sidebar + topbar + `<main className="page">` + Suspense | `AppShell.tsx:61-81` | all authenticated routes |
| 8 | **Preview document** — separate HTML entry, own `<style>`, own CSP, postMessage protocol | `theme-preview.html`, `features/theme/preview/preview.ts` (80 L), `preview.css` (50 L) | the Theme Builder iframe |

Shells 4 and 5 are literal duplicates of the same markup (`AuthFrame` vs the inline copy in `AccountSecurityGate.tsx:25`), differing only in card width. Shells 1, 3 and 6 all re-implement the same header layout; shell 6 does it **without** using `PageHeader`, so its `<h1>` typography and action layout are defined twice (`index.css:109` and `index.css:94`).

### 3.6 Duplication summary a design system must unify

| Duplicated concern | Instances | Where |
|---|---|---|
| Page header markup | 3 | `Page.tsx:5`, `ThemeBuilderPage.tsx:248-255`, `LoginScreen.tsx:66` (as `AuthFrame`) |
| Button styling | 2 parallel systems | `.button/.button.primary/.button.danger` (`index.css:179-185`, ~40 call sites) vs `buttonVariants` cva (`shared/ui/button.tsx:5-19`, 1 file) |
| Panel/card container | 2 | `.panel` (`index.css:217`, ~30 call sites) vs `<Card>` (`shared/ui/card.tsx`) |
| Modal | 3 | Radix `Dialog`, `.modal-backdrop`, `confirm()` |
| Text input | 2 | `.field input` (`index.css:192-195`) vs `<Input>` (`shared/ui/input.tsx`) |
| Select | 2 | raw `<select>` (`~20` sites) vs Radix `<Select>` (`select.tsx`) |
| Toggle | 2 | `.switch` CSS (`index.css:330-334`) vs Radix `<Switch>` (`switch.tsx`) |
| Tab bar | 2 | `.plan-selector`/`.button-row` ad-hoc vs Radix `<Tabs>` (`tabs.tsx`) |
| Key/value list | 3 | `DetailPanel` `<dl>` (`Page.tsx:12`), `.key-values` (`StoresPage.tsx:34,35`), `.snapshot` (`DashboardPage.tsx:29`) |
| Empty state | 4 wordings | "No matching records" (`DataTable.tsx:30`), "No messages yet" (`SupportPage.tsx:32`), "No subscription record" (`StoresPage.tsx:35`), "This request has reached a terminal state." (`ResourcePage.tsx:94`) |
| Status badge tone map | 1 good table + 1 bad heuristic | `TONES` (`DataTable.tsx:45-56`) vs `renderValue` regex `/status\|state\|severity\|active\|implementation/i` (`:65`) which re-classifies any column whose *name* matches |
| Spinner | 2 | `.ork-spinner` (`orderak-tokens.css:384`) used at `App.tsx:49`, `AppShell.tsx:78`, `Page.tsx:8` — consistent; but `ThemeBuilderPage.tsx:243` uses a bare `<p>Loading design system…</p>` instead |

---

## 4. Backend contract coupling

### 4.1 The Worker surface

`services/backend/src/entrypoints/admin-worker.ts` is a Hono app that: applies `enforceRequestBodyLimit` **outside** Hono (`:90-94`), and `harden()`s every response including 404/500 (`:35-52`). Routing is delegated: `app.all("/api/admin/v1/*")` → `handleAdminRoutes` (`admin-worker.ts:68-71` → `admin.ts:122-125`).

`services/backend/src/domains/admin/admin.ts` is the root app: it mounts `authApp` **before** the identity middleware (`:36`), then runs identity + MFA/recovery-ack/password posture + mutation validation middleware (`:39-62`), then an export-file pre-handler (`:67-71`), then seven domain sub-apps (`:75-79`, `:108-109`).

| File | Lines | Route registrations | Mounted at |
|---|---|---|---|
| `admin.ts` | 248 | **18** | root |
| `admin-auth.ts` | 670 | **11** | `admin.ts:36` (pre-middleware) |
| `admin-control-plane.ts` | 1,040 | **37** | `admin.ts:75` |
| `admin-entitlements.ts` | 533 | **12** | `admin.ts:76` |
| `admin-theme.ts` | 467 | **7** | `admin.ts:78` |
| `admin-operations.ts` | 485 | **24** | `admin.ts:79` |
| `admin-project.ts` | 598 | **45** | `admin.ts:108` |
| `integrations/email/adminRoutes.ts` | — | **11** | `admin.ts:109` |
| `entrypoints/admin-worker.ts` | 179 | **2** (`/health`, `/api/admin/v1/health`) | entrypoint |
| **Total** | **≈4,300** | **167 registrations** | — |

**174 distinct method+path patterns** once Hono parameter alternation is expanded (`{activate|rollback}` ×2, `{verify|retry}` ×2, `{retention|deletions|google-play}` ×3, `{ar|en}` ×2, `on(["GET","POST"])` ×2, `on(["PATCH","DELETE"])` ×2 → +7). Method mix: **59 GET, 67 POST, 12 PUT, 9 PATCH, 18 DELETE**. *(Registered-by-inspection; not exercised at runtime → route precedence **unverified**.)*

### 4.2 RBAC model

| Element | Location |
|---|---|
| `AdminRole = "owner" \| "finance" \| "support" \| "readonly"` | `services/backend/src/domains/identity/auth.ts:271` |
| `ROLE_PERMISSIONS` table | `auth.ts:277-363` |
| `hasPermission` / `permissionsForRole` | `auth.ts:372-383` / `:399-411` |
| Implications: `*`→all; `resource:*` wildcard; `theme:rollback`⇒`theme:manage`⇒`theme:view`; `project:view`⇒`<res>:view` for 9 internal resources | `auth.ts:369,377-383,405-409` |
| Route gate helper | `services/backend/src/domains/admin/admin-auth.ts:312-315` |
| Per-request gate closure on Hono context | `admin.ts:60`; typed `admin-context.ts:15` |
| **57 distinct permission string literals** are enforced at route level | count over the 8 files |

Gates are **inline string literals on every route** (e.g. `c.get("gate")("sellers:view") ?? listStores(...)`, `admin.ts:82`). There is **no permission table in the database and no per-admin grant** — authorization is role-derived per request.

A backend test guards this deliberately: `services/backend/test/admin-permission-coverage.spec.ts:28-140` reads all admin route sources as text, extracts every gate string, and fails unless each gate is passable by a non-owner role **or** listed with a written reason in `OWNER_ONLY` (`:43-91`). It also has a tripwire: `gates.size > 40` fails (`:96`). **Any redesign that adds, removes or renames a route gate must update that list.**

**De-facto owner-only gates** (enforced by routes, held by no non-owner role): `plans:manage`, `plans:publish`, `capabilities:manage`, `flags:manage`, `versions:manage`, `admins:view`, `admins:manage`, `security:view`, `security:manage`, `content:manage`, `settings:view`, `settings:manage`, `theme:manage`, `theme:rollback`, `operations:run`, `ads:manage`, and all nine internal `*:manage`.

### 4.3 Step-up (fresh authorization)

| Aspect | Fact | Cite |
|---|---|---|
| Mint | `POST /api/admin/v1/action-authorizations` | `admin-control-plane.ts:80` |
| Gate | `security:manage` **and a hard `admin.role !== "owner"` → 403 `owner_required`** | `admin-control-plane.ts:492` |
| Input | `{action, entity_id, payload_hash, password, totp_code}` | `:493-496` |
| Proof | active admin row + decryptable TOTP secret + `verifyPassword` **and** `verifyTotp` | `admin-auth.ts:318-322` |
| Binding stored | `admin_id`, `action`, `entity_id`, `payload_hash = sha256Hex(payload_hash ?? "none")`, `verified_at`, `expires_at = now + 5 min` | `admin-control-plane.ts:500-503` |
| Spend | one atomic `UPDATE … RETURNING` matching id + admin + action + entity + payload hash + `consumed_at IS NULL` + not expired → **single-use, non-replayable** | `:548-554` |
| Header | `x-admin-action-authorization` | `:543` |
| Supported actions (**exhaustive**) | `billing.verification_retry` (`admin-operations.ts:204`); `export.sensitive` on export *request*, entity = export type, payload `"export-request"` (`admin-control-plane.ts:621`); `export.sensitive` on export *download*, entity = export id, payload `"export-download"` (`:797`); `admin.access_change`, payload `<role>:<active>` (`:389`) | — |
| Server allowlist of action names | **None** — any string is minted and stored; only those four pairs are ever consumed | `:494,502` |

### 4.4 Endpoint coupling — used / unused

**Frontend side:** ~84 distinct admin path templates across `apps/admin-web/src/**` (81 matched literally; `plan-revisions/` further expands to 4 method+path pairs), in **57 `api(...)` call sites across 12 files** plus **22 declarative action endpoints** in `app/config/actions.ts`.

**Backend admin routes with NO frontend reference (38):**

| Route(s) | Cite |
|---|---|
| `GET /health` | `admin-worker.ts:65` (also unreachable through the edge Worker, which proxies only `/api/admin/v1/` — `src/edge/worker.ts:17`) |
| `GET /stats` | `admin.ts:81` (dashboard uses `/control-plane/dashboard`) |
| `GET /overview` | `admin-project.ts:35` |
| `GET/POST /plans`, `DELETE /plans/:id` — the **legacy v1 plan CRUD** | `admin.ts:84-86` (the governed `plan-catalog` + revisions surface replaced it; the coexistence is explicitly called out at `admin-permission-coverage.spec.ts:19-23`) |
| `GET /affiliate` (read) | `admin.ts:93` (only the POST is configured) |
| `DELETE /coupons/:code` | `admin.ts:90` |
| `POST /referrals/:id/pay` | `admin.ts:97` |
| `DELETE /ads/:id` | `admin.ts:102` |
| `GET /store-controls` (read) | `admin-control-plane.ts:42` (only POST configured) |
| `DELETE /flag-rules/:id` | `:49` |
| `POST /buyer-restrictions/:id/revoke` | `:57` |
| `POST /security/audit-archives/verify` | `:78` |
| `DELETE /support-macros/:id` | `:84` |
| `PATCH /announcements/:id`, `DELETE /announcements/:id` | `admin-operations.ts:390` |
| `GET /billing/verifications/:jobId` | `:167` |
| `GET /identity/readiness`, `POST /identity/backfill` | `:180,186` |
| `POST /auth/bootstrap`, `POST /auth/password/reset`, `POST /auth/recovery-codes` | `admin-auth.ts:337,345,346` |
| `GET /email-templates/:key`, `POST /:key/enabled`, `GET /:key/history`, `POST /:key/preview`, `POST /:key/test` | `integrations/email/adminRoutes.ts:115,137,149,156,171` |
| `GET /inbound-emails/:id`, `POST /:id/read` | `:79,90` |
| `POST /organizations/:id/paid3-approval` | `admin-entitlements.ts:47` |
| `POST /plan-revisions/:id/archive` | `:36` |
| `POST /plan-revisions/:id/impact` (POST arm) | `:32-33` |
| 18 × `PUT/DELETE /{resource}/:id` for roadmap, tasks, screens, endpoints, prompts, design-assets, releases, bugs, project-docs | `admin-project.ts:39,44,51,56,63,68,75,80,87,92,99,104,111,116,123,128,135,140` |
| `POST /screens/sync` | `admin-project.ts:146` |
| `POST /content-pages`, `PUT /content-pages/:slug/:lang`, `POST /content-pages/:slug[/:lang]/activate` — **a whole second content system** | `admin-project.ts:154,160,155,158` (the UI uses `content-configs` instead, `sections.ts:48`) |
| `GET /exports/:id/file` | `admin-control-plane.ts:851` — the actual CSV attachment; **not registered as a Hono route at all** (served by the middleware pre-handler, `admin.ts:67-71`), reached only by navigating to the `download_url` the JSON response supplies (`ResourcePage.tsx:110-117`) |
| `POST /theme/revisions/:id/rollback` (compat alias) | `admin-theme.ts:214` (UI calls `/activate`) |
| `POST /auth/invitation/accept` | `admin.ts:31` — intentionally public, no UI (invitation links are emailed) |

**Admin endpoints the panel calls that are not in the Worker: none found.** All 84 frontend path templates map to a registered route.

**Admin capability that exists only as raw API with no UI:**

| Capability | Route | Impact |
|---|---|---|
| Identity readiness + bounded backfill | `GET /identity/readiness`, `POST /identity/backfill` (`admin-operations.ts:180,186`) | An operator cannot see or fix sellers missing identity/routing without a terminal |
| Audit-archive integrity verification | `POST /security/audit-archives/verify` (`admin-control-plane.ts:78`) | `SecurityPage` counts `audit_archives` (`OperationsPages.tsx:47`) but cannot trigger verification |
| Android screen-manifest sync | `POST /screens/sync` (`admin-project.ts:146`) | The `manifests` section is read-only despite a sync mutation existing |
| Paid-3 approval | `POST /organizations/:id/paid3-approval` (`admin-entitlements.ts:47`) | Required before Paid 3 can be used; no UI |
| Per-organization storefront-locale enablement | `POST /organizations/:id/storefront-locales` (`admin-entitlements.ts:58`) | `PlansPage` shows locales as *capability* only via the `locales` section; the org-scoped grant has no UI |
| Entitlement revision archive | `POST /plan-revisions/:id/archive` (`admin-entitlements.ts:36`) | No UI |
| Email template preview / test-send / enable / history | `adminRoutes.ts:115,137,149,156,171` | `emails` section only lists + creates translations; **`POST /:key/test` sends a real email and has no UI** |
| Inbound message read + mark-read | `admin-operations`… `adminRoutes.ts:79,90` | `inbox` section lists; the read-on-GET behaviour (`:79`) marks messages read as a side effect of listing, with no UI signal |
| Full CRUD on 9 internal resources | `admin-project.ts` 18 PUT/DELETE routes | `ResourcePage` only creates |
| Revoking a buyer restriction / ad / coupon / flag rule / support macro | 5 DELETE/revoke routes | The panel creates but can never undo |

### 4.5 Documented ↔ implemented drift (backend)

| Documented | Reality | Cite |
|---|---|---|
| `POST /auth/totp/setup`, `POST /auth/totp/verify` | **Do not exist.** Enrollment is `POST /auth/enroll` with an enrollment token; the secret/otpauth URI comes back from `/auth/login` | docs `docs/reference/api.md:978-979,1020`; code `admin-auth.ts:340,473-487` |
| `password/reset` accepts `clear_totp` | Handler ignores it, requires `incident_id`, always clears TOTP | docs `api.md:994-997`; code `admin-auth.ts:633-651` |
| Password minimum 8 chars | `MIN_PASSWORD_LEN = 12` | docs `api.md:968`; code `admin-auth.ts:26` |
| `ADMIN_JWT_SECRET` signs admin sessions | Sessions are opaque D1 tokens hashed with `ADMIN_SESSION_PEPPER` | docs `api.md:959`; code `admin-auth.ts:133-135,220-221` |
| Admin reachable at `localhost:8787/admin` | The admin Worker serves no `/admin` path | docs `api.md:903`; code `admin-worker.ts:65-74` |
| `GET /theme` "read/update project-wide design tokens" (14-token map) | Returns a design-system **revision** object | docs `api.md:1019,1045-1054`; code `admin-theme.ts:99-126` |
| ~40 Worker routes are documented only by *domain name*, never by path | — | docs `api.md:1426-1433` vs the route table in §4.1 |

**OpenAPI:** `contracts/openapi/src/admin-v1.json` (1.34 MB) has **134 paths / 176 operations**; all have a matching Worker route by manual path mapping (the 176-vs-174 delta is the three alternation params split into separate spec operations, +6 spec ops for 3 Worker routes). **Route-level parity verified by inspection only — `contracts/openapi/scripts/route-coverage.mjs` was not run → unverified.**

### 4.6 UI ↔ server permission mismatches (all verified in code)

| # | UI gate | Server gate | Consequence | Cite |
|---|---|---|---|---|
| 1 | `errors:view` (`sections.ts:52`) | `audit:view` (`admin.ts:105`) | `finance` holds `audit:view` but not `errors:view` → **the API would serve the Errors page while the UI hides it** | both |
| 2 | `affiliate:view` (`sections.ts:33`) | `payouts:view` (`admin.ts:96`) | Benign today (owner/finance/readonly hold both) but the two names are coupled by accident | both |
| 3 | `plans:view` on the Engineering "Storefront locales" section (`sections.ts:66`) | `plans:view` (`admin-entitlements.ts:50`) | Consistent, but a commerce permission guards an Engineering nav item — confusing for operators and for RBAC review | both |
| 4 | **unguarded** device revoke (`StoresPage.tsx:36`) | `devices:manage` (`admin-operations.ts:448`) | `readonly`/`finance` open a store, click a device row, confirm the native dialog, then get **403** | both |
| 5 | **unguarded** deletion verify/retry (`OperationsPages.tsx:20`) | `deletions:manage` (`admin-operations.ts:298`) | `readonly` sees working-looking buttons that always 403 | both |
| 6 | **unguarded** security alert acknowledge/resolve (`OperationsPages.tsx:50`) | `security:manage` (`admin-control-plane.ts:77`) | Benign today (only owner holds `security:view`) but unguarded | both |
| 7 | **unguarded** translation approve/reject (`ResourcePage.tsx:73`) | `translations:manage` (`admin-operations.ts:430`) | `readonly` gets 403 after a `confirm()` | both |
| 8 | **unguarded** content publish (`ResourcePage.tsx:80`) | `content:manage` (`admin-control-plane.ts:90`) | `finance`/`support`/`readonly` get 403 after a `confirm()` | both |
| 9 | **unguarded** buyer-privacy transitions (`ResourcePage.tsx:95`) | `buyers:manage` (`admin-control-plane.ts:62`) | `finance`/`readonly` get 403 after filling in an evidence note | both |
| 10 | `subscriptions:manage` enables the billing requeue form (`BillingVerificationsPage.tsx:87,178`) | `subscriptions:manage` **and owner-only step-up mint** (`admin-control-plane.ts:492`) | **`finance` satisfies the UI gate, fills reason + password + TOTP, and only then gets `owner_required`** | both |
| 11 | `export:manage` shows "Request export"/sensitive download (`actions.ts:23`, `ResourcePage.tsx:107`) | same owner-only step-up mint | **`finance` can be refused after entering a fresh password and TOTP** | both |
| 12 | `theme:view` opens the full editor; apply disabled when `!theme:manage` (`ThemeBuilderPage.tsx:166,253`) | `theme:view` is held by **all four roles**, `theme:manage` by owner only | **3 of 4 roles land on a 581-line editor whose primary action is a permanently disabled button with no explanation** | both |

---

## 5. UX quality observations

### 5.1 Navigation

| Fact | Detail | Cite |
|---|---|---|
| Structure | Fixed sidebar (268px) + sticky topbar (64px) + centred content (max 1560px) | `index.css:140,165,173`; `orderak-tokens.css:494-495` |
| Sidebar width | `--orderak-sidebar-width: 268px` — matches the documented contract exactly | `orderak-tokens.css:494`; `docs/product/app-plan.md:109`; `docs/domains/design-system-reference.md:146` |
| Top-bar hide control | Implemented exactly as documented: toggle fully hides the rail, per-admin `localStorage` key `orderak:admin-sidebar:<adminId>`, `< 860 px` switches the same control to an overlay drawer, desktop preference preserved | `AppShell.tsx:12-17,32-34,36-45,47-57,58,61-66,73`; doc `app-plan.md:108-112` |
| Groups | 7 groups (Overview, Accounts, Commerce, Governance, Communication, System, Engineering) rendered as uppercase `.nav-group > p` headings | `AppShell.tsx:69`; `index.css:151` |
| Items | **Up to 41 nav links** for a fully-privileged admin, at 37px each ≈ 1,517px of link column — the rail scrolls (`index.css:150`) on every laptop | `AppShell.tsx:69` |
| Active state | `NavLink` `a.active` with a 3px inset primary bar | `index.css:154` |
| Command palette | `Ctrl/⌘+K` opens a **section-level** search only (label + description + group). It does **not** search records — no store, ticket, buyer, order or admin can be found from it | `AppShell.tsx:24-26,68,84-87` |
| Breadcrumb | Two levels only: `Admin / <current section>` | `AppShell.tsx:73` |
| Deep links | Dashboard metric cards link into 4 sections; the attention list into 3 more | `DashboardPage.tsx:19-22,25-27` |
| Bell + profile | **Both navigate to `/system/security`** — the bell is not an alerts inbox and the profile button is not a menu (no sign-out there; sign-out lives in the sidebar footer) | `AppShell.tsx:73` vs `:70` |
| Mobile | `< 860px`: sidebar becomes an overlay drawer with a backdrop; `.profile-button span` hidden; grids collapse to 1 column; `.inline-form` stacks | `index.css:348-360`; `AppShell.tsx:12,37` |
| Reduced motion | Honoured — transitions zeroed | `index.css:361-363`; `orderak-tokens.css:388-396` |
| RTL | **Not supported.** Shell uses physical properties throughout (`margin-left`, `inset: 0 auto 0 0`, `text-align: left`, `box-shadow: inset -1px 0`); `index.html:2` has no `dir`. The token layer provides logical-property classes (`.ork-page`, `orderak-tokens.css:513-515`) that the shell does not use | `index.css:140,154,162,166,169,206,247,273,299,314,327`; `docs/domains/design-system-reference.md:189` |
| i18n | **Absent.** No `i18n`/`useTranslation`/catalogue; all UI strings are English literals. `.env.example` declares only `VITE_SENTRY_DSN` | `AppShell.tsx:67-73`; `sections.ts:22-67`; `docs/domains/design-system-reference.md:185-187` |

### 5.2 Density

- The **standard page** is airy: 32px/34px page padding, 24px header margin, 20px panel padding, 14px card radius (`index.css:173-176,217,205`).
- The **generic resource table** is dense: 42px header, 49px rows, 0.65rem header text, 0.76rem body text, 7 columns max (`index.css:247-248`; `DataTable.tsx:14`).
- Mixed within the same screen: `ResourcePage` renders a 118px-tall metric-class header, then a 58px table toolbar, then a dense grid — and the Theme Builder has its own dense rules (`index.css:24-99`, 76 lines of builder-specific CSS).
- **0.62rem (≈10px) text** appears in the nav group heading and `kbd` (`index.css:149,151`), below the design-system's own stated **12px floor for Latin text** (`orderak-tokens.css:288`; `docs/domains/design-system-reference.md:76-77`).

### 5.3 Table usability

Covered fully in §3.2. Operator-visible consequences: no sorting, no column filters, no bulk actions, no server pagination, no column choice, no keyboard access to rows, and an empty state that cannot distinguish "no data" from "filtered to nothing". The global filter serialises every row to JSON on each keystroke (`DataTable.tsx:16`) — on the audit or errors sections, which the server caps at 100 rows, this is fine; on `sections` with no server cap it would not be.

### 5.4 Destructive-action safety

| Control | Mechanism | Verdict |
|---|---|---|
| 13 destructive/audited actions | native `window.confirm()` | Weak: no plain-language consequence, no typed confirmation, not auditable as a UI decision, unstyleable, unlocalisable |
| Delete a design-system revision | Typed confirmation (`Type <name> to confirm`) + Radix dialog + "This cannot be undone" alert | **The gold standard in the repo** (`ThemeBuilderPage.tsx:532-541`) |
| Sensitive export download | Fresh owner password + TOTP, bound to the export id, consumed once | Strong (`ResourcePage.tsx:98-121`) |
| Billing verification requeue | Reason + password + TOTP, entity-bound | Strong (`BillingVerificationsPage.tsx:141-184`) |
| Admin access change | Password + TOTP, entity-bound | Strong (`OperationsPages.tsx:66-73`) |
| Seller suspend/ban | Reason ≥ 5 chars + `confirm()` | Medium (`StoresPage.tsx:37`) |
| Plan revision publish | `confirm()` + validate/assess gate + `auth.can('plans:publish')` | Medium (`PlansPage.tsx:84`) |
| Audit trail visibility | Every mutation is server-audited, but **the panel never shows the audit entry it just created**, and the audit section is a flat table with no entity deep-link | `sections.ts:51`; `ResourcePage.tsx:26` |
| Post-action feedback | `onSuccess` closes the modal and invalidates the query. **No toast, no success banner, no undo.** The only success message in the panel is the Theme Builder's `setMessage` alert | `ActionDialog.tsx:24`; `ThemeBuilderPage.tsx:256` |

### 5.5 Permission-awareness vs server authority

The panel's stated contract is *"Navigation is permission-aware while Worker RBAC remains authoritative"* (`docs/product/app-plan.md:482`). In practice:

- **Navigation is** permission-aware: `sections.filter(s => auth.can(s.permission))` (`AppShell.tsx:20`) and a route guard that redirects (`App.tsx:74-78`).
- **Server authority is real**: every route re-checks (`admin-permission-coverage.spec.ts` guarantees it).
- **In-page controls are not.** 6 in-page mutations are unguarded (§4.6 rows 4–9) and 3 more are gated on a permission that is insufficient for the server's owner-only step-up (§4.6 rows 10–12).
- **There is no forbidden state.** A 403 that *does* happen renders through the same `ErrorState` "Could not load this section" (`Page.tsx:9`) used for network errors, so an operator cannot distinguish "you may not" from "it is broken" from "the backend is down". The removed e2e test quoted in `test-results/` artifacts shows this was a known design intent ("A 403 (RBAC-denied) must show an in-place error without ending the session") — but the *message* was never differentiated.

### 5.6 `planned` / `display_only` discoverability

| Surface | Treatment |
|---|---|
| `StatusBadge` tone map | `display_only`, `planned` → **warning** tone; `enforced`/`available` → positive (`DataTable.tsx:53-55`) |
| `RuntimePage` | The strongest treatment in the panel: a `display only` badge replaces the switch and the panel explains *why* ("Deployment hard gate is off. The panel cannot enable this capability.") — `RuntimePage.tsx:17` |
| `PlansPage` | `display_only`/`planned` definitions are **filtered out of the editable dropdown** (`:77`) and only a truth banner explains the rule (`:79`) |
| `ResourcePage` + capabilities | The `capabilities` table can include `implementation_status`, `risk`, `runtime_consumer`, `enforcement_binding` columns (`:145`) — **but there is no per-row disabling and no explanatory text.** An operator selects a `planned` capability row, opens "Set store control" (`actions.ts:8`), fills a reason, and gets `409 capability_not_enforced` (`admin-control-plane.ts:136`) |
| Dashboard | A truth banner (`DashboardPage.tsx:30`) plus a link to the registry |
| `docs` claim | *"Controls marked `planned` or `display_only` cannot be mutated."* (`docs/product/app-plan.md:505-506`) — enforced server-side, **not reflected in the UI's capability table** |

### 5.7 Mobile / responsive

| Regime | Behaviour |
|---|---|
| `> 1120px` | Full 4-up metric grid, 2-column dashboard/detail grids, ticket layout with a 330px sidebar |
| `860–1120px` | Metric grid 2-up, `.form-grid.compact` 2-up, "Secure session" label hidden (`index.css:343-347`) |
| `≤ 860px` | Sidebar → overlay drawer with backdrop; workspace full width; page padding 24/18; profile label hidden; `.dashboard-grid`/`.detail-grid`/`.ticket-layout` → 1 column; `.page-header` stacks; `.inline-form` stacks to a column (`index.css:348-360`) |
| `≤ 580px` | All grids 1 column; topbar padding 14px; breadcrumb link+separator hidden; table toolbar stacks and the search box goes full width; recovery grid and one-time secret stack (`index.css:364-377`) |
| **Not responsive at all** | The **pagination controls and column count**. `DataTable` always renders up to 7 columns inside `.table-scroll` (`overflow-x: auto`, `index.css:245`) — a 7-column table on a 360px phone is a horizontal scroll with no scroll affordance, no reduced-column mode, and no card fallback |
| **Not responsive at all (2)** | The Theme Builder's 2-column layout uses its own breakpoints (1180px/720px — `index.css:87,92`) that contradict the shell's (1120/860/580), so the builder reflows on a different schedule than the page around it |
| Breakpoint inconsistency | Documented set is **1240 / 860 / 600** (`orderak-tokens.css:483-485`); `index.css` uses **1120 / 860 / 580**; the Theme Builder uses **1180 / 720**. The documented 1240/600 values only appear in `orderak-tokens.css:517-527` guarding `.ork-page`/`.ork-grid-*` classes **that no `.tsx` file uses** |

### 5.8 Loading / error / empty / long-running states

| State | Where it exists | Where it does not |
|---|---|---|
| Loading | `LoadingState` card (`Page.tsx:8`) on every query page; `.ork-spinner` in the shell Suspense boundary (`AppShell.tsx:78`) and splash (`App.tsx:49`) | `ThemeBuilderPage` uses a bare `<p>Loading design system…</p>` (`:243`); `DataTable` itself has no loading state |
| Error | `ErrorState` with a working "Try again" (`Page.tsx:9`); mutation errors as `.error-text` | **No distinction between 403, 404, 409, 422, 500 and network failure.** `ApiError` carries `status`, `code` and `details` (`client.ts:1-5`) and callers read only `.message` — except the two Theme Builder branches that read `status === 422`/`409` (`ThemeBuilderPage.tsx:205,230`) |
| Empty | `DataTable` "No matching records"; "No messages yet"; "No subscription record"; "This request has reached a terminal state."; "No matching section" (palette) | No section-level empty state with a primary action ("no stores yet → onboard one"); the table's empty state doubles for "filtered empty" |
| Forbidden | **Nowhere** | See §5.5 |
| Long-running progress | **Nowhere.** | `JobsPage` POSTs a run and invalidates the runs list (`OperationsPages.tsx:28`) — a synchronous `runRetentionCleanup`/`processDeletionRequests`/`reconcileGooglePlayPurchases` (`admin-operations.ts:464-484`) blocks with only a `disabled` button and no spinner; the only feedback is `run.error` |
| Export progress | Exports section shows `status`/`downloaded_at` columns (`ResourcePage.tsx:102,119`) | **Never polls** — the queue is asynchronous (`admin-worker.ts:159-177`) and the operator must hit Refresh manually |
| Billing queue progress | `BillingLeaseHealth` polls every 60 s (`ResourcePage.tsx:44`) | The only polled long-running surface besides the dashboard; no progress bar, only a percentile snapshot |
| Toast / notification layer | `role="alert"` on login errors only (`LoginScreen.tsx:70`) | **No toast, snackbar, or `aria-live` region anywhere else in the panel** |
| Optimistic UI | Nothing | No optimistic mutation anywhere |
| Error boundary | Nothing | **None** — no `ErrorBoundary`, no `Sentry.ErrorBoundary`. A render throw is a blank console page |

### 5.9 Specific interaction defects

| # | Defect | Cite |
|---|---|---|
| 1 | `RuntimePage` renders **every** runtime control but PATCHes only `{ai_enabled, billing_enabled}` — if the server ever returns a third control with `admin_enabled !== null`, its switch is a lie | `RuntimePage.tsx:16` vs `:17` |
| 2 | `DataTable` re-classifies any column whose **name** matches `/status\|state\|severity\|active\|implementation/i` as a status badge (`:65`), so a boolean column named `active` renders "active"/"inactive" and a column named `implementation_notes` would render a badge | `DataTable.tsx:65` |
| 3 | The device-revoke affordance is a **row click** (`StoresPage.tsx:36`) — the row is a data table row, not a button, and clicking anywhere on it opens a `confirm()` | `StoresPage.tsx:36` |
| 4 | `privacy` transitions re-use `.button primary` for `verified`/`in_progress`/`completed` and `.button danger` only for `rejected` (`ResourcePage.tsx:95`) — the visually "safe" button moves a customer data request forward with no typed confirmation | `ResourcePage.tsx:95` |
| 5 | The generic `ActionDialog` `confirm` text is a **static string per action** (`actions.ts:5,8,44`), not derived from the values being submitted — "Apply this buyer restriction?" is identical whether the scope is a store or the whole platform | `actions.ts:5-7` |
| 6 | The command palette cannot search records (§5.1) but its placeholder says *"Search stores, settings, support, security…"* (`AppShell.tsx:87`) — it promises store search and delivers section search | `AppShell.tsx:87` |
| 7 | `SupportPage` renders the **raw ticket JSON** in a sidebar `<pre>` (`:34`) next to a composed conversation view; `SecurityPage`, `DeletionsPage`, `BillingVerificationsPage`, `PlansPage` and `ResourcePage`'s drawer all do the same. Raw JSON is the primary detail view across the panel | `SupportPage.tsx:34` |
| 8 | `StoreDetailPage` renders `Object.entries(subscription).slice(0, 10)` (`:35`) — a subscription with more than 10 fields silently loses the rest | `StoresPage.tsx:35` |
| 9 | `LoginScreen` pre-fills the email with `owner@orderak.app` (`:7`) — a real production account identity shipped in the bundle | `LoginScreen.tsx:7` |
| 10 | `PlansPage` gate-tests on `window.location.hostname` string equality (`:26-27`) | fragile environment detection inside a render path |
| 11 | `ResourcePage` `rowsFromPayload` (`:123-135`) guesses the shape of **41 different API responses** with a key list plus two fallbacks, and stringifies nested objects into cells (`DataTable.tsx:67`) | the single largest source of "the table shows something odd" |

---

## 6. Design-system usage

### 6.1 What the design system is

| Artifact | Size | Role | Cite |
|---|---|---|---|
| `design/tokens.json` | 17 lines / 901 B | The **legacy 14-token projection** | `design/README.md:26-27` |
| `design/design-system.default.json` | 4,372 lines / 134 KB | The **canonical compiled offline fallback**: `{$comment, source, snapshot, legacyProjection}` | `design/README.md:24-25` |
| `apps/admin-web/src/orderak-tokens.css` | 528 lines / 31.5 KB | A **committed flattened snapshot** ("296 tokens") imported by `index.css:2` | `orderak-tokens.css:1-17` |
| Runtime `/theme.css` | generated | What the Theme Builder actually publishes | `design-system.ts:838-875` |

`design/design-system.default.json` contents: `schemaVersion 2`, `generatorVersion "orderak-mcu-0.3.0+3"`, `contentHash 11e20c99…`, `source.colors.primary #014D4E` (HCT hue 198.1, chroma 28.7), **49 M3 scheme roles × 6 (3 contrasts × 2 modes) = 294**, **20 extended semantic roles × 6 = 120**, **15 type roles**, **10 spacing tokens** (`0,4,8,12,16,24,32,40,48,64`), **5 shape radii** (`4,8,12,16,24`), `components.minimumTouchTargetDp 48`, and `validation {valid: true, contrast: 264 pairs, errors: [], warnings: []}`.

### 6.2 Is there a build path from the generator to the admin app? — **No.**

- The generator writes exactly three files: `design/design-system.default.json` and two Kotlin files (`services/backend/scripts/generate-design-system-fixture.ts:9-11,26-27,269-271`). **Nothing writes into `apps/admin-web`.**
- `orderak-tokens.css` claims to be generated from "the Orderak Design System project (tokens/*.css)" (`:2-3`) — **that source does not exist in the repository** (`glob tokens/**` → no files), and no repo script writes the file. **Unverified provenance.**
- The live path is runtime, not build: `index.html:6` links `/theme.css` → edge proxy (`src/edge/worker.ts:21-51`) → `${THEME_ORIGIN}/api/theme.css` → `publicDesignSystemCss()` (`admin-theme.ts:444-466`) → `designSystemCss()` (`design-system.ts:838-875`).
- After a publish, `ThemeBuilderPage.tsx:342` fires `orderak:theme-published` and `main.tsx:37-41` re-points the link at `/theme.css?v=<contentHash>`.
- **No CI guard, no `tooling/` script and no lint rule references the admin stylesheets.** The repo's only colour guard is Android-scoped (`tooling/repository/verify-no-hardcoded-colors.mjs:26,38-41`) — even though its own rationale (`:12-15`) names the admin panel's "34 of its 51 distinct colours" as the motivating example.

### 6.3 How much of the admin actually consumes the snapshot — measured

**`src/index.css` (377 lines):**

| Metric | Count |
|---|---|
| Literal hex colours | **1** (`:6`, `var(--orderak-on-primary, #fff)`) |
| `rgb()/rgba()/hsl()` literals | **0** |
| `var(--…)` references | **272** |
| ↳ `--orderak-*` (generated names) | 51 |
| ↳ `--md-sys-color-*` (generated M3 roles) | 45 |
| ↳ **unprefixed legacy aliases** (`--ink`, `--muted`, `--line`, `--surface`, `--canvas`, `--primary`, `--danger`, `--warning`, `--accent`) | **182** |
| Literal `font-size` values | **63** across **21 distinct sizes** |
| Literal `border-radius` values | **47** across **15 distinct radii** |
| Literal px inside padding/margin/gap | **186** |

**Generated scale tokens actually consumed by `index.css` (exhaustive, 21 uses):**

`--orderak-duration-medium` ×5, `--orderak-motion-drawer` ×4, `--orderak-hover-surface` ×3, `--orderak-shape-full` ×3, `--orderak-scrim` ×2, `--orderak-motion-fast` ×2, `--orderak-shadow-overlay` ×2, `--orderak-shadow-card` ×1, `--orderak-duration-long` ×1, `--orderak-numeric-tabular` ×1, `--orderak-hover-border` ×1, `--orderak-focus-ring` ×1, `--orderak-focus-ring-offset` ×1, `--orderak-focus-field-ring` ×1, `--orderak-shadow-raised` ×1, `--orderak-hover-lift` ×1.

**Generated scale tokens consumed by any `.ts`/`.tsx` file: ZERO.** (grep for `--orderak-space*`, `--orderak-shape-*`, `--orderak-type-*`, `--orderak-duration*`, `--orderak-motion*`, `--orderak-state*` across `src/**/*.{ts,tsx}` → no matches outside `orderak-tokens.css` and `index.css`.)

**Conclusion — the design system is half-consumed:**

| Layer | Consumed? |
|---|---|
| **Colour** | **Yes, effectively.** No hardcoded colours in TSX at all; `index.css` has exactly one hex fallback. Colour discipline is genuinely good. |
| **Motion, state layers, elevation, focus, scrim, tabular numerals** | **Yes** — 21 generated uses in `index.css`, including the design system's "no exceptions" focus ring (`index.css:106`) |
| **Spacing** | **No.** `--orderak-space0…16` is used **zero times**. 186 hardcoded px values. The token file's own rule (`orderak-tokens.css:311-312`: *"a value that is not on the scale is a mistake"*) is violated throughout. |
| **Shape / radii** | **No.** `--orderak-shape-full` is used 3×; the five generated radii are used **zero times**. 15 hand-picked radii instead (14px ×9, 9px ×9, 10px ×6, 8px ×6, 12px ×5, 11px ×2, 7px ×2, 13px, 15px, 18px, 24px, 5px, 50% ×3) — only 8/12/16/24 are on the scale and they are all written as literals. |
| **Typography** | **No.** No `--orderak-type-*` reference anywhere. 21 distinct hardcoded `font-size` values; none is a generated type-role size. `h1` uses a bespoke `clamp(1.65rem, 2vw, 2.15rem)` (`index.css:109`) rather than `headlineMedium`/`displaySmall`; nav uses `.82rem`, tables `.76rem`, headers `.65rem` — approximating `bodyMedium`/`labelSmall` by eye. Two values (`.62rem` ≈ 10px) are **below the system's own 12px Latin floor**. |
| **Layout tokens** | **Partially, and inconsistently.** `--orderak-sidebar-width` and `--orderak-topbar-height` are used (`index.css:140,165`); the 1560px content cap and the 34px gutter are **hardcoded** (`index.css:173`) instead of `--orderak-container-admin`/`--orderak-gutter-admin`; the documented breakpoints (1240/600) are replaced by 1120/580. |
| **Dark scheme** | The permanently dark rail relies on `.orderak-dark` (`AppShell.tsx:66`, `index.css:129-139`), which exists **only in the committed bundle** (`orderak-tokens.css:170-231`) — the live `/theme.css` emits `@media(prefers-color-scheme:dark)` and `[data-orderak-theme="dark"]` and **never emits `.orderak-dark`** (`design-system.ts:862-871`). So the rail's dark scheme can never be changed by a published revision. |

**Header/runtime mismatch:** the committed bundle's own comment block (`orderak-tokens.css:124-132`) still instructs the reader to "Delete the retired `:root` block from `apps/admin-web/src/index.css`" — that block was already deleted (no `#006A62`, no `Inter` in `index.css`). The install instructions at `:9-14` are stale.

---

## 7. Testing and quality gates

### 7.1 Unit tests — 6 files, 19 `it()` blocks

Run by `pnpm test` = `vitest run` (`package.json:18`); include glob `src/**/*.test.{ts,tsx}` (`vitest.config.ts:8`); jsdom; **no coverage provider and no thresholds configured**.

| File | Tests | What it locks down |
|---|---|---|
| `src/tests/sections.test.ts` | 2 | 41 unique ids + unique paths + every permission contains `:`; a hardcoded 39-id presence list (`:12`) |
| `src/tests/data-table.test.tsx` | 5 | `StatusBadge` tone: `inactive` → `negative` and **not** `positive` (regression for the substring-matching bug); known positives stay positive; unknown → `neutral` + underscore humanisation; `format.date` returns `—` for unparseable/empty/null and formats both SQLite and ISO shapes |
| `src/tests/accessibility.test.tsx` | 2 | `DataTable` renders a semantic `columnheader` named `Store Name`, the `Filter these results` placeholder, and named `Previous/Next page` buttons; `StatusBadge` exposes text, not colour alone |
| `src/tests/theme-delivery.test.ts` | 2 | `index.html` loads `/theme.css` **before** `main.tsx`; `theme-preview.html` CSP is `connect-src 'none'` / `frame-ancestors 'self'` with no `/api/v1/`; `public/_headers` has a `/theme-preview*` `no-store` + `SAMEORIGIN` block |
| `src/tests/theme-utils.test.ts` | 3 | Recovery key format `orderak:theme-recovery:<adminId>:<revisionId>`; 7-day window boundaries; `patchChanged` rebases only locally-changed paths |
| `src/tests/edge-worker.test.ts` | 5 | `/theme.css` proxy: good stylesheet cached `public, max-age=60`; upstream 502 → `no-store` + `text/css` + **never the error body**; upstream `set-cookie` stripped; non-canonical host → 404; admin API responses hardened |

**Coverage gap:** zero tests for the auth context, the route guard, `ActionDialog`, `ResourcePage`, `AppShell` navigation, `auth-context`'s 401 handling, or any of the 8 bespoke pages. The `App.tsx:69` exclusion list and the two-registry divergence (§2.4) are untested.

### 7.2 End-to-end tests — 6 Playwright tests, **orphaned**

`apps/admin-web/e2e/admin-workflows.spec.ts` (256 lines). Config: `playwright.config.ts` — `testDir: './e2e'`, single `chromium`/Desktop Chrome project, `baseURL http://127.0.0.1:4174`, **`retries: 0`**, `trace: 'retain-on-failure'`, `reporter: [['list']]` (no HTML report), `webServer.command: 'npm run dev -- --host 127.0.0.1 --port 4174'` (npm in a pnpm workspace), `reuseExistingServer: true`.

**No live backend is needed**: `auth/me`, `login`, `mfa`, `control-plane/dashboard`, and every page endpoint are intercepted with `page.route` and answered from inline fixtures (`:5-32`), including a synthetic session carrying `csrf_token: 'csrf-e2e-token'` (`:16-24`).

| # | Test | Asserts | Cite |
|---|---|---|---|
| 1 | password and TOTP establish the protected admin session | Login → MFA → Dashboard → "Truthful control policy is active" | `:34-54` |
| 2 | permission-aware navigation hides and rejects unavailable modules | `readonly` + 2 permissions: Stores link visible, `Plans & limits` absent, `/commerce/plans` redirects to `/` | `:56-67` |
| 3 | desktop navigation can be hidden, restored, and remembered without changing the mobile drawer | `#admin-navigation` `aria-expanded`, `aria-hidden`, `localStorage['orderak:admin-sidebar:1']`, `.workspace { margin-left: 0 }` computed CSS, reload persistence, 700px drawer | `:69-93` |
| 4 | support agent opens a ticket and sends an audited CSRF-protected reply | reply body + `x-csrf-token` header equals the stubbed value | `:95-117` |
| 5 | theme manager previews and applies an immutable generated checkpoint | iframe preview content, hex edit, apply dialog, `{baseRevisionId:1}` + CSRF | `:119-172` |
| 6 | revision history groups current, saved, and recent checkpoints with managed actions | three group headings, save-name PATCH, activate POST, typed delete | `:174-256` |

**Last recorded run: FAILED.** `apps/admin-web/test-results/.last-run.json` = `{"status":"failed","failedTests":[...two ids...]}`, with exactly two artifact directories, both for the two theme tests. The captured error in both is:

```text
Error: ENOENT: no such file or directory,
open 'C:\Users\ayman\Documents\ORDERAK.APP\apps\design\design-system.default.json'
```

Cause: the tests load the design-system artifact with `resolve(process.cwd(), '..', 'design', 'design-system.default.json')` (`:120`, `:175`). With the cwd a `pnpm test:e2e` run produces (`apps/admin-web`), `..` is `apps/`, not the repo root. **The off-by-one is still on disk at both lines** — the fix is `'..', '..'`.

**Two further facts about these artifacts:**

- They are **stale relative to the committed spec**: the `error-context.md` source dumps reference a 363-line spec (a ~+107-line offset) containing an **audit-log 403/401 test**, a **`tasks: create, edit, and delete a record through the Refine data provider`** test and a **`translations: approving a row refetches the Refine-backed list`** test — none of which exist in the committed 256-line file. The run was made against an uncommitted revision. **Whether the committed 6 tests currently pass cannot be established from the repo**: the two theme tests are provably broken by the path bug; the other four are **unverified**.
- `test-results/**` is untracked and gitignored (`apps/admin-web/.gitignore:16-17`).

**Playwright is invoked by no workflow.** `apps/admin-web/package.json:20` declares `test:e2e`, and grep across `.github/**` finds no `playwright`, no `test:e2e`, and no `npx playwright` — the only repo-wide references are the config, the spec, and a comment in `src/tests/edge-worker.test.ts:3` explaining *why* the edge Worker is unit-tested instead ("Playwright cannot reach any of this: playwright.config.ts points at the Vite dev server, which never runs src/edge/worker.ts").

### 7.3 CI jobs that touch the admin

| Workflow:job | Trigger | Admin-relevant command | Blocking |
|---|---|---|---|
| `staging-deploy.yml:59 validate` | push to `staging` **with `apps/admin-web/**` in the path filter** (`:43`) + dispatch | `apps/admin-web`: `pnpm install --frozen-lockfile && pnpm test && pnpm run lint && pnpm run build && pnpm run cf-types:check && npx wrangler deploy --config wrangler.edge.staging.jsonc --dry-run` (`:92-100`) | Yes — `deploy` `needs: validate` (`:103`) |
| `staging-deploy.yml:102 deploy` | after validate | `pnpm run deploy:staging` (edge Worker) + smoke `curl https://admin.staging.orderak.app/` | Path-filtered deploy gate |
| `production-deploy.yml:29 deploy` | `workflow_dispatch` only | Freeze gate on `PRODUCTION_DEPLOYS_ENABLED` (`:41-58`); typed confirmation; Staging provenance; SHA == `origin/main`; **`apps/admin-web`: `pnpm test`, `lint`, `build`, `cf-types:check`, `wrangler deploy --config wrangler.edge.jsonc --env="" --dry-run`** (`:170-178`); then `pnpm run deploy:production` | **Production is frozen** |
| `backend-ci.yml:116 worker-budget` | PR | **`pnpm --filter @orderak/admin-web run build`** (`:137`) → `node tooling/repository/verify-worker-budget.mjs` (`:140`) | Not blocking on `develop`; gates `staging`/`main` (`docs/guides/staging-production-workflow.md:267-270`) |
| `backend-ci.yml:26 test` | PR | Root `node tooling/repository/verify-deployment-map.mjs` (`:110`) — asserts `apps/admin-web` exists, both `wrangler.edge*.jsonc` keep their worker names/hostnames/`assets.directory === "./dist"`, and that `staging-deploy.yml` still names `apps/admin-web` | Yes |
| `docs-ci.yml:18 lint-and-links` | PR | `verify-deployment-map.mjs` (`:50`), `verify-doc-claims.mjs` (`:62` — every backticked repo path in docs must exist), markdown lint, mkdocs strict build | Yes |
| `openapi-ci.yml:21 specification` | PR, **path filter excludes `apps/admin-web/**`** (`:4-10`) | Validates `contracts/openapi/src/admin-v1.json` + oasdiff | Yes, but a frontend-only PR skips it |
| `open-source-security.yml:32,92` | PR/push/cron | Semgrep `p/default --error` and Trivy HIGH/CRITICAL over `apps/**` | Yes |
| `supply-chain.yml:39,70` | PR/push/cron | `pnpm audit --audit-level high` + SBOM across all workspace packages (motivated at `:4-8` by admin-web never having been audited) | Yes on `staging`/`main` |
| `security-scan.yml:29,70` | PR/push | gitleaks (blocking) + dependency-review (non-blocking) | Mixed |

**`pnpm test:e2e` appears in no workflow.** CI never runs the browser suite.

### 7.4 What a redesign is forced to update

| Must update | Because | Cite |
|---|---|---|
| `apps/admin-web/src/app/config/sections.ts` | The single source of 41 paths/labels/permissions/endpoints | `:22-68` |
| `apps/admin-web/src/app/App.tsx:53-70` | Hand-written routes **and the 11-id exclusion string** at `:69` | `:53-70` |
| `apps/admin-web/src/tests/sections.test.ts:12` | Hardcoded 39-id list | `:12` |
| `contracts/typescript/admin.ts:65-106` (`ADMIN_SECTIONS`, 40 entries) | Duplicate registry consumed by backend tests; must be re-synced or unified | `:65-106` |
| `services/backend/test/admin-panel-coverage.spec.ts:6` | Hardcoded 40-id list, unique paths, `:` in permissions | `:6-11` |
| `services/backend/test/admin-permission-coverage.spec.ts:43-91,96` | Every route gate must be reachable by a non-owner **or listed**; `gates.size > 40` tripwire | `:43-101` |
| `apps/admin-web/src/app/config/actions.ts:5-54` | 22 action configs (endpoint + permission + fields) | `:5-54` |
| `apps/admin-web/e2e/admin-workflows.spec.ts` | 6 tests pinned to headings, labels, `#admin-navigation`, `.workspace` computed CSS, `localStorage` keys, iframe title, tab names, and `Run your store with confidence` in the preview | `:45-93,111-114,160-254` |
| `apps/admin-web/src/tests/data-table.test.tsx`, `accessibility.test.tsx` | `.status` class names and `positive/negative/warning/neutral` tones; `Filter these results` placeholder; `Previous/Next page` labels; `Store Name` humanisation | `data-table.test.tsx:14-28`; `accessibility.test.tsx:8-11` |
| `apps/admin-web/src/tests/theme-delivery.test.ts` | `/theme.css` must remain before `main.tsx` in `index.html`; preview CSP strings; `_headers` block | `:7-22` |
| `apps/admin-web/src/tests/theme-utils.test.ts` | `orderak:theme-recovery:<admin>:<revision>` key format | `:6` |
| `apps/admin-web/src/tests/edge-worker.test.ts` | Canonical-host 404, `max-age=60` theme caching, hardening headers | `:26-77` |
| `tooling/repository/verify-deployment-map.mjs:47,231-239,332` | Directory existence, both `wrangler.edge*.jsonc` keys, and the literal `apps/admin-web` string in `staging-deploy.yml` | same |
| `tooling/repository/verify-worker-budget.mjs:56-71,138-155` | `dist/` must exist; edge Worker gzip ≤1024 KiB, startup ≤250 ms active CPU — **a heavier redesign can break this** | same |
| `tooling/repository/verify-doc-claims.mjs:201-215` | Every backticked repo path in `docs/**` must exist → **any doc written by this redesign must not name files that do not exist** | same |
| `apps/admin-web/src/edge/worker.ts` / `wrangler.edge*.jsonc` | Only if routing, headers or assets change | — |
| `docs/reference/api.md`, `docs/product/app-plan.md`, `docs/architecture/overview.md`, `docs/architecture/security-model.md`, `docs/domains/design-system.md` | Per `AGENTS.md` rules, these must stay in sync | `AGENTS.md` |
| `.github/workflows/*` | Only if the admin's build/lint/test commands change | — |

---

## 8. Scale metrics

| Metric | Value |
|---|---|
| `apps/admin-web/src` — `.tsx` files / lines | 32 / **2,057** |
| `apps/admin-web/src` — `.ts` files / lines | 14 / **≈610** |
| **Total TS/TSX lines** | **≈2,670** |
| CSS lines (`index.css` 377 + `orderak-tokens.css` 528 + `preview.css` 50) | **955** |
| Font binaries | 12 `.woff2`, ≈330 KB |
| Components | **38** (incl. 3 context/hook exports) |
| Route elements / distinct paths | **43 / 43** |
| Config sections (frontend registry) | **41** |
| Config sections (contract registry) | **40** |
| Nav groups / nav links (full privileges) | 7 / 41 |
| Endpoint declarations in config | **62** (41 section endpoints + 22 action endpoints; one overlap) |
| `api(...)` call sites | **57** across 12 files |
| Distinct admin path templates referenced | **≈84** (one appears only in a unit test) |
| `useQuery` / `useMutation` | 14 / 26 |
| `useState` calls in `src/**` | ≈90 (13 of them in `ThemeBuilderPage` alone) |
| Backend admin route registrations / distinct patterns | **167 / 174** |
| Backend admin code lines | ≈4,300 across 8 files |
| Backend permission string literals enforced | **57** |
| Step-up action names consumed | **4** pairs / **3** names |
| Native `confirm()` calls | **13** |
| Typed confirmations | **1** |
| Hand-rolled modals / drawers | 5 / 1 |
| Radix dialogs | 5 (one file) |
| Distinct `preferred` column arrays | **17** |
| Hand-written `<pre>{JSON.stringify(...)}</pre>` blocks | **10** |
| shadcn/Radix component files | 11 (153 lines) used by **1 of 32** `.tsx` files |

### Real functionality vs boilerplate

| Category | Approx. lines | Share | Note |
|---|---|---|---|
| Genuine domain UI (Dashboards, Stores, Support, Deletions, Jobs, Security, AdminAccess, Plans, BillingVerifications, Runtime, FlagSimulator, ThemeBuilder) | ≈1,100 | **41%** | Of which **581 lines (22% of the whole app) are the Theme Builder alone** |
| Generic resource machinery (`config/sections.ts` + `config/actions.ts` + `ResourcePage.tsx`) | ≈272 | **10%** | This 272 lines serves **30 of 43 routes** — the highest-leverage code in the repo |
| Shell + auth + routing (`main.tsx`, `App.tsx`, `AppShell.tsx`, auth feature) | ≈437 | **16%** | |
| Shared primitives (`shared/ui/Page.tsx`, `DataTable.tsx`, `ActionDialog.tsx`, `client.ts`) | **203** | **8%** | These 203 lines are the entire reusable design surface |
| shadcn/Radix kit (dead for 21 of 22 consumers) | 153 | 6% | |
| Theme preview sub-app | 130 | 5% | |
| Tests | ≈209 | 8% | |
| CSS | 955 | — | 377 hand-written rules + 528 generated tokens + 50 preview |

**Effective reuse ratio:** 203 lines of shared UI primitives (7.6% of the source) carry 100% of the panel's real screens. **~72% of the source is page-level code with no shared abstraction between pages.**

**Reusable-functionality estimate:** roughly **45–55%** of the panel is genuine domain functionality (each of the 13 bespoke routes plus the theme editor). The remaining **45–55% is presentation boilerplate that a design system should absorb** — 17 column arrays, 13 `confirm()` calls, 5 hand-rolled modals, 10 raw-JSON blocks, 8 page shells, 21 hardcoded font sizes and 15 hand-picked radii.

---

## 9. Top 20 redesign opportunities, ordered by operator impact

Ordered by *how much worse an operator's day is because of it*. Each row: the problem, the evidence, and the redesign target.

| # | Impact | Problem | Evidence | Redesign target |
|---|---|---|---|---|
| 1 | **Critical** | **A 403 is indistinguishable from an outage.** `ApiError` carries `status`/`code`/`details`; every caller renders the same "Could not load this section" card and there is no forbidden route at all. | `Page.tsx:9`; `client.ts:1-5,28-37`; no 403 route in `App.tsx` | One `<SectionState>` primitive with distinct `loading / empty / forbidden / error / partial` variants + a real `/forbidden` route retaining navigation |
| 2 | **Critical** | **Three paths let an operator satisfy the UI's permission gate and then be refused by an owner-only step-up** — after typing a password and a TOTP code. | `BillingVerificationsPage.tsx:87,178-182`; `ResourcePage.tsx:107-120`; `actions.ts:23` vs `admin-control-plane.ts:492` | Model step-up capability as a first-class permission (`stepup:export_sensitive`, `stepup:billing_retry`) surfaced in `auth.permissions`, and disable-with-reason the control when absent |
| 3 | **Critical** | **Six in-page mutations are unguarded**, so operator roles meet 403s after confirming a native dialog. | `StoresPage.tsx:36`; `OperationsPages.tsx:20,50`; `ResourcePage.tsx:73,80,95` vs the server gates in §4.6 | A single `<Guarded action="…">` wrapper; make *every* mutating control declare its permission in the same config object as its endpoint |
| 4 | **Critical** | **No long-running-operation feedback.** Job runs, export generation and queue drains are asynchronous; the UI shows a disabled button then a static table. | `OperationsPages.tsx:28-29`; `admin-worker.ts:159-177`; `ResourcePage.tsx:44` (the only poll in the app) | An async-operation contract: optimistic row insertion + optimistic status column + polling/`refetchInterval` on any non-terminal status + a job-progress affordance |
| 5 | **High** | **The table cannot be worked with**: no sorting, no column filters, no bulk actions, no column choice, no server pagination, no keyboard row access, and a single empty state that conflates "no data" with "filtered to nothing". | `DataTable.tsx:13-33`; §3.2 | Replace with a real grid: typed column definitions, server-side query model (sort/filter/page in the URL), column chooser, bulk-selection + bulk-action bar, per-row action menu |
| 6 | **High** | **Raw JSON is the detail view.** 10 `<pre>` dumps stand in for structured detail across the panel, including the ticket sidebar and every drawer for un-`preferred` fields. | `SupportPage.tsx:34`; `OperationsPages.tsx:20,50`; `BillingVerificationsPage.tsx:129,151`; `PlansPage.tsx:84`; `Page.tsx:12`; `DataTable.tsx:67` | Per-domain detail schemas: typed field descriptors with a renderer registry (money/date/status/phone/link/JSON-collapsed), and an explicit "raw payload" disclosure for debugging |
| 7 | **High** | **Destructive actions are 13 native `confirm()` dialogs** with static text that does not name the entity or the consequence; the one good pattern (typed confirmation) exists once. | `BillingVerificationsPage.tsx:181`; `PlansPage.tsx:84,95`; `OperationsPages.tsx:20,29,49,72,73`; `ResourcePage.tsx:73,80`; `StoresPage.tsx:36,37`; `ActionDialog.tsx:26` vs `ThemeBuilderPage.tsx:539-540` | One `<ConfirmAction>` component with tiers (plain / typed-entity-name / step-up) and a server-derived impact summary shown before submission |
| 8 | **High** | **The published theme is overridden by the committed token bundle**, so `Apply as current` restyles only the administrator who clicked it. | `dist/index.html:6` vs `:15`; `orderak-tokens.css:50-66` vs `design-system.ts:842-848`; `ThemeBuilderPage.tsx:339-343` | Delete `orderak-tokens.css` from the bundle (or scope it to a clearly-lower layer), make `/theme.css` the single source, and add a guard that fails when the two define the same custom property |
| 9 | **High** | **41 flat nav links in 7 groups**, with no favourites, recents, or record-level search — and a palette that promises "Search stores, settings, support, security…" but searches section names only. | `AppShell.tsx:20,69,87`; `index.css:150` | Two-tier IA (a small pinned workspace + collapsible domains), a palette that hits records (`/stores?q=`, `/support?q=`), and a "recent" list per administrator |
| 10 | **High** | **No mobile table strategy.** 7 columns in a horizontal scroller on a 360px viewport; the shell's own breakpoints (1120/580) contradict the documented set (1240/600) and the Theme Builder's (1180/720). | `DataTable.tsx:14`; `index.css:245,343,364,87,92`; `orderak-tokens.css:483-485` | A single breakpoint token set consumed by everything + an explicit narrow-table mode (priority columns + expandable row detail) |
| 11 | **Medium-High** | **Two parallel design systems.** The Radix/shadcn kit (proper focus traps, portals, `aria-modal`) is imported by one page; 21 other files use hand-rolled `.button`/`.panel`/`.field`, and 5 of 6 modals are hand-rolled. | `ThemeBuilderPage.tsx:6-16` (only importer); `index.css:179-201,272-292`; `components.json` aliases do not match `@/shared/ui` | Pick one. Recommended: promote `shared/ui/*` to the real kit, extend it with `DataTable`/`PageHeader`/`ConfirmAction`/`SectionState`, delete the duplicate `.button`/`.field`/`.modal` CSS, and fix `components.json` |
| 12 | **Medium-High** | **Type and geometry scales are unused.** 21 hardcoded font sizes (two below the system's own 12px floor) and 15 hand-picked radii; zero `--orderak-space*`, `--orderak-shape-*` or `--orderak-type-*` references. | §6.3 | Move to `--orderak-type-*` role classes (`.ork-title-small` etc.), the 10-step spacing scale and the 5 radii; add a lint/stylelint rule that fails on literal `font-size`/`border-radius`/`padding` outside the token file |
| 13 | **Medium-High** | **`ResourcePage` serves 30 routes with a 147-line shape-guessing heuristic** and 17 hardcoded column arrays; per-section detail actions are dispatched by a nested ternary on section id. | `ResourcePage.tsx:20,27,123-135,137-147`; `App.tsx:69` | Replace the config array + heuristic with a typed per-section descriptor (endpoint, schema, columns, row actions, detail renderer) so each section is a small declarative object rather than a runtime guess |
| 14 | **Medium** | **`planned`/`display_only` are visible but not actionable-explained.** The capabilities table has no per-row disabling, so an operator fills a reason and gets a 409. | `ResourcePage.tsx:145`; `actions.ts:8` vs `admin-control-plane.ts:136`; `docs/product/app-plan.md:505-506` | Row-level capability state that disables the action **and states the reason inline** (the RuntimePage pattern, `RuntimePage.tsx:17`, generalised) |
| 15 | **Medium** | **No success/notification layer.** Actions close a modal and invalidate a query; nothing confirms what happened, and the audit entry the operator just created is never shown. | `ActionDialog.tsx:24`; no aria-live region anywhere | A single toast/`aria-live` region + a "last action" affordance that deep-links to its audit row |

| 16 | **Medium** | **`ThemeBuilderPage` is 581 lines / 16 components / 13 `useState` / no react-query**, re-implementing debounce, abort, conflict and invalidation. It is also the page 3 of 4 roles can only look at. | `ThemeBuilderPage.tsx:150-316`; `:166,253` | Split into a hook (`useDesignSystemDraft`) + presentational panels; convert to `useQuery`/`useMutation`; show a read-only variant with an explicit "you lack `theme:manage`" banner instead of a disabled primary button |
| 17 | **Medium** | **Two unsynchronised route registries** (41 vs 40 entries) with divergent labels/domains and stale test presence-lists; the frontend's route table is an 11-id string literal. | `sections.ts:22-68` vs `contracts/typescript/admin.ts:65-106`; `App.tsx:69`; `sections.test.ts:12`; `admin-panel-coverage.spec.ts:6` | One registry in `@orderak/contracts-typescript`, imported by both sides, with a route-shape field (`bespoke` \| `resource`) replacing the exclusion string, and a test asserting frontend and contract entries are identical |
| 18 | **Medium** | **No i18n and no RTL**, despite the design system declaring Arabic the primary market and logical properties only. The shell is physically LTR-pinned. | `index.css:140,154,162,169,206,247,273,299,314,327`; `index.html:2`; `docs/domains/design-system-reference.md:185-191` | Introduce a message catalogue + `dir` handling **before** the redesign hardens any more physical CSS; convert shell rules to logical properties |
| 19 | **Medium** | **38 backend admin routes have no UI**, including several whose only path is a terminal: identity readiness/backfill, audit-archive verification, screen-manifest sync, Paid-3 approval, email template test-send, and every delete/revoke on the resources the panel can only create. | §4.4 | Either build the missing UIs (readiness, archive verification, sync, delete/revoke) or delete the routes and document the terminal workflow — do not leave them as silent capability gaps |
| 20 | **Medium** | **No error boundary and no optimistic UI**; a render throw is a blank console. | no `ErrorBoundary` in `src/**` | `Sentry.ErrorBoundary` per route + an inline retry, and optimistic mutations for low-risk writes (status, assignment, preference) |

### Verification pass — what the fix rounds found

Each row below was re-read against the source before acting on it.

| Finding | Outcome |
| --- | --- |
| No forbidden state: a 403 renders as "Could not load this section" | **Confirmed.** One shared `ErrorState` served twelve call sites across nine pages, so a page the operator's role excludes looked exactly like a page that had failed to load — retry button included, and retrying cannot change a 403. Fixed inside that one component: a refusal says so and offers nothing to press. Three tests added in `src/tests/page-states.test.tsx`. |
| Three paths make an operator satisfy the UI gate, enter a password + TOTP, and only then get refused | **Confirmed, and the server rule is narrower than this document said.** `POST /api/admin/v1/action-authorizations` is gated on `security:manage` **and** then refuses any role but `owner` with `owner_required` (`admin-control-plane.ts:80,492`). All **four** call sites now share one rule and one request shape: `src/shared/api/step-up.ts` exports `stepUpAvailable(permission, role)` and `useStepUp()`, and each screen asks it before drawing a password field. Where the answer is no, the credentials are not collected at all and the reason is stated instead. Four unit tests pin the rule, including that a role with the permission but not the owner scope is refused (`src/tests/step-up.test.ts`). Before: an operator typed a password and a fresh TOTP code into three screens and was then told `owner_required`. |
| The published theme is overridden by the committed token bundle | **Confirmed and fixed.** The bundle is imported into a cascade layer so unlayered published styles win, guarded by `verify-theme-authority.mjs`. |
| Design-system geometry and typography unused | **Confirmed and fixed for type and radius**: 71 font sizes and 55 radii bound to tokens, every count held at zero by `verify-admin-token-conformance.mjs`. Weight and leading are still hand-set and are the next migration. |
| 13 native `confirm()` against 1 typed confirmation | **Confirmed, and fixed for the mechanism.** All thirteen sites now go through one `askConfirm` (`src/shared/ui/confirm.tsx`) drawn by a single `<ConfirmHost />` in the shell: a themed dialog with `role="alertdialog"`, Escape to dismiss, and an action that runs only on confirm. `window.confirm` is unstyled, blocks the JavaScript thread, and cannot be answered by a test — so every destructive path in the panel was outside the suite's reach. Three tests now cover confirm, cancel and a custom label. **A typed confirmation for the most destructive actions is still not implemented** — that is a product decision about which actions deserve it, not a mechanism gap. |

**Honourable mentions (21–24):** the command palette's placeholder lies about record search (#6 in §5.9); `RuntimePage` renders controls it cannot write (`RuntimePage.tsx:16` vs `:17`); `LoginScreen` ships `owner@orderak.app` pre-filled (`LoginScreen.tsx:7`); `StoreDetailPage` silently truncates subscription data at 10 fields (`StoresPage.tsx:35`); the bell and profile buttons both go to `/system/security` (`AppShell.tsx:73`); the dead `void sectionById` (`App.tsx:80`); the stale `AuditPage`/`TasksPage` chunks in `dist/`.

---

## 10. Must not break

Ordered by blast radius. Everything here is enforced by a test, a repo guard, or a documented contract.

### 10.1 Security and authority invariants

| # | Invariant | Why | Cite |
|---|---|---|---|
| 1 | **The server remains the only authority.** No client-side permission expansion, no client-side implication rules. | The comment at `auth-context.tsx:128-136` records that a client-side re-derivation *had already drifted* and hid sections the API would serve | `auth-context.tsx:137-140`; `auth.ts:399-411` |
| 2 | **`x-csrf-token` on every non-GET**, sourced from the session response, never from a cookie read. | Double-submit HMAC derived server-side; e2e asserts the header value | `client.ts:7-15,20-22`; `auth-context.tsx:34`; `admin-workflows.spec.ts:116,171` |
| 3 | **`credentials: 'same-origin'` and same-origin-only navigation for downloads.** `ExportDownload` explicitly rejects an off-origin `download_url`. | Prevents an open-redirect / `javascript:` download | `client.ts:23`; `ResourcePage.tsx:115-117` |
| 4 | **Step-up minting stays owner-only and single-use entity-bound.** | `admin-control-plane.ts:492`, `:548-554`; docs `security-model.md:444-446` | — |
| 5 | **The `authorizeAction` role check and `consumeActionAuthorization`'s atomic `UPDATE … RETURNING` must not be "fixed" client-side.** | The comment at `:508-534` documents that this replaced a double-spendable check-then-set | `:508-556` |
| 6 | **The admin edge Worker stays data-binding-free, canonical-host-confined, and proxies only `/api/admin/v1/`, `/theme.css`, `/theme-preview*`.** | `verify-deployment-map.mjs:231-239` asserts the bindings and `assets.directory`; `edge-worker.test.ts:65-69` asserts the 404 | `wrangler.edge.jsonc:31-39`; `edge/worker.ts:15-19,17` |
| 7 | **`public/_headers` CSP and the `/theme-preview*` block.** | `theme-delivery.test.ts:14-22` asserts the strings; replay was deliberately excluded from Sentry for PII reasons | `public/_headers:1-20`; `main.tsx:13-28` |
| 8 | **Session teardown on 401 must clear the React Query cache.** | The comment at `auth-context.tsx:117-124` records the cross-administrator data-leak this fixed | `auth-context.tsx:60-61,114-126` |
| 9 | **The `mustChangePassword` / `recovery-codes` / MFA gates stay ahead of the router.** | `App.tsx:50-51`; `docs/architecture/security-model.md:430-452` | — |
| 10 | **Do not add Session Replay, and do not widen `connect-src` beyond the three Sentry ingest origins.** | `main.tsx:13-28`; `public/_headers:2` | — |
| 11 | **`DataTable`'s sensitive-key redaction regex must keep working.** | `DataTable.tsx:7,13`; `Page.tsx:12` independently filters `password\|secret\|token\|cipher` | — |

### 10.2 Documented contracts that must stay true

| # | Contract | Cite |
|---|---|---|
| 12 | **Truthful enforcement** — the capabilities registry is the authoritative record of `enforced`/`display_only`/`planned`, and `display_only`/`planned` controls cannot be mutated. | `docs/product/app-plan.md:505-506`; `docs/reference/api.md:1432-1433`; `admin-control-plane.ts:136` |
| 13 | **Deployment hard gates are authoritative; the panel can only narrow.** | `docs/architecture/security-model.md:287-299`; `RuntimePage.tsx:17`; `actions.ts:8` |
| 14 | **Plan revisions are immutable**; only drafts are edited; publish is `plans:publish`; restrictive changes apply at renewal. | `docs/architecture/overview.md:410-412`; `docs/architecture/security-model.md:383-385`; `PlansPage.tsx:47,54,84` |
| 15 | **Export artifacts expire in 24 h, download tokens in 5 min and are one-use**, and sensitive exports need action-bound password + TOTP. | `docs/architecture/security-model.md:458-466`; `actions.ts:23`; `ResourcePage.tsx:119-120` |
| 16 | **Every admin mutation is audited**, and audit archives are hash-then-signature verified. | `docs/domains/admin-control-plane.md:67-89`; `admin-worker.ts:102` |
| 17 | **The sidebar is 268px; the top-bar hide control fully hides/restores it and remembers `visible`/`hidden` per administrator; below 860px the same control opens the overlay drawer with the desktop preference preserved but ignored.** | `docs/product/app-plan.md:108-112`; implemented `AppShell.tsx:12-17,32-34,36-45,47-57,58,61-66,73` |
| 18 | **Themes are published as immutable higher-ID revisions; conflicts never permit force overwrite; the current revision cannot be deleted; inactive deletion is owner-only at 10/hour.** | `docs/architecture/security-model.md:226-243`; `docs/reference/api.md:86-99`; `ThemeBuilderPage.tsx:311-314,539-540` |
| 19 | **The Subscription Test Lab is Staging-only and expires within 24 h.** | `docs/product/app-plan.md:330-334`; `PlansPage.tsx:26-27,92-93` |
| 20 | **The theme preview stays an isolated same-origin iframe under its own strict CSP with a 128 KB postMessage cap.** | `theme-preview.html:6`; `ThemeBuilderPage.tsx:74-101`; `edge/worker.ts:1,54-59` |
| 21 | **`/theme.css` must remain linked before the app module.** | `index.html:6,12`; asserted `theme-delivery.test.ts:7-12` |
| 22 | **The admin surface is English-only today and the design system declares logical-properties-only.** Whichever way a redesign resolves this, both the doc and the code must move together. | `docs/domains/design-system-reference.md:185-191`; `index.css` physical properties |

### 10.3 Test and guard surfaces a redesign must keep green

| # | Must keep green | Cite |
|---|---|---|
| 23 | `apps/admin-web/src/tests/*` — 19 tests, especially `.status` tone classes, `Filter these results`, `Previous/Next page`, `Store Name`, the theme-recovery key format, and the `/theme.css`-before-`main.tsx` ordering | §7.1 |
| 24 | `services/backend/test/admin-permission-coverage.spec.ts` — **every new/renamed route gate must be reachable by a non-owner or added to `OWNER_ONLY` with a reason; the list may not go stale; `gates.size > 40` fails** | `:43-101` |
| 25 | `services/backend/test/admin-panel-coverage.spec.ts` — the 40-key list, unique paths, `:` in every permission | `:6-11` |
| 26 | `tooling/repository/verify-deployment-map.mjs` — `apps/admin-web` exists, both `wrangler.edge*.jsonc` keep their names/hostnames/`assets.directory: "./dist"`, `staging-deploy.yml` still names `apps/admin-web`, exactly **251** OpenAPI operations | `:47,231-239,319,332` |
| 27 | `tooling/repository/verify-worker-budget.mjs` — `dist/` must exist; **edge Worker gzip ≤ 1024 KiB, startup ≤ 250 ms active CPU** | `:56-71,138-155` |
| 28 | `tooling/repository/verify-doc-claims.mjs` — every backticked path and every `pnpm run <script>` reference in `docs/**` must resolve, and every backticked `orderak-*` must be a declared resource | `:201-215` |
| 29 | `contracts/openapi` `pnpm run check` over `src/admin-v1.json` (spectral, redocly, examples, route coverage) | `contracts/openapi/package.json:18` |
| 30 | `.oxlintrc.json` — `react/rules-of-hooks: error`, `react/only-export-components: warn`; two files already carry the suppression and must keep it | `.oxlintrc.json:5-6`; `DataTable.tsx:1`; `auth-context.tsx:1` |
| 31 | `pnpm run build` = `tsc -b && vite build`; `tsconfig.app.json` has `verbatimModuleSyntax` on (so `import type` discipline) | `package.json:8`; `tsconfig.app.json:14` |
| 32 | `pnpm run cf-types:check` — generated Worker types must stay current | `package.json:17`; run in both deploy workflows |
| 33 | **The e2e DOM/accessible-name surface**: `#admin-navigation` + `aria-controls`, `orderak:admin-sidebar:<adminId>` ∈ {`hidden`,`visible`}, `.workspace { margin-left: 0 }` when hidden, `Hide/Show/Open navigation` labels, `Orderak Control Center`, `Two-factor authentication`, `Dashboard`, `Truthful control policy is active`, `Support`, `Reply`, `Send reply`, `Theme Builder`, iframe title `Isolated design system preview`, `Run your store with confidence`, `Apply as current`, `Revision history`, `Current configuration`, `Saved configurations`, `Recent checkpoints`, `Save version`, `Configuration name`, `Save name`, `Make current`, `Delete permanently`, `Permanent deletion confirmation`, and the `primary hex value` label | `admin-workflows.spec.ts:45-93,111-114,160-254`; sources as listed in §7.4 |
| 34 | `Ctrl/⌘+K` opens the palette; `Escape` closes palette and drawer | `AppShell.tsx:24-27` |
| 35 | The deploy command shape: `deploy:staging` stays the default `deploy`; `deploy:production` stays separate and stays behind the freeze gate | `package.json:11-15`; `wrangler.edge.jsonc:1-13`; `production-deploy.yml:41-58` |

### 10.4 Explicit non-goals to keep out of the redesign

| Do not | Why | Cite |
|---|---|---|
| Embed Worker HTML panels back into the admin | "embedded Worker HTML panels have been removed" — the standalone SPA is the canonical control plane | `docs/product/app-plan.md:498-499` |
| Give the admin edge Worker any data binding | Documented as `None`; asserted by the deployment-map guard | `docs/domains/admin-control-plane.md:21-34`; `verify-deployment-map.mjs:231-239` |
| Widen the preview iframe's CSP or drop `sandbox` | The 15-line comment explains why `allow-same-origin` is paired with the strict CSP and why removing it breaks the preview | `ThemeBuilderPage.tsx:77-101` |
| Rename or redeploy live Cloudflare resources as part of a refactor | Explicit repo rule | `apps/admin-web/README.md:31-33` |
| Add a second UI kit or a second state manager | The repo already carries the cost of one abandoned kit (dead shadcn imports for 21 pages, stale Refine deps) | `ThemeBuilderPage.tsx:6-16`; `.vite/deps/@refinedev_core.js` |
| Fix the 403-vs-error problem by re-deriving permissions client-side | Already tried; it drifted | `auth-context.tsx:128-136` |

---

## 11. Unverified items

Explicitly **not** verified. Nothing was executed, built or run during this audit.

1. **Runtime route precedence and matching.** The 174-pattern count and all overlap reasoning (e.g. `DELETE /plans/:id` vs `POST /plans/:id/drafts`; the `themeApp` catch-alls at `admin-theme.ts:227-228` vs `GET/PUT /theme`; the `/api/admin/v1/*` delegation vs `/api/admin/v1/health`) are read from source order, not observed.
2. **Which stylesheet wins the cascade at runtime.** The conclusion in §1.6 is drawn from the committed `apps/admin-web/dist/index.html` link order plus equal `:root` specificity. The document was not loaded in a browser; a dev-mode `<style>` injection was not observed.
3. **Whether the committed 6 e2e tests pass.** Not run. The two theme tests are provably broken by `resolve(process.cwd(), '..', …)` at `admin-workflows.spec.ts:120,175`; the other four are unverified. The recorded `test-results/` artifacts describe a 363-line spec that is in no commit, so they cannot be taken as the current status.
4. **OpenAPI ↔ Worker parity.** All 176 `admin-v1.json` operations were mapped to Worker routes by manual path comparison. `contracts/openapi/scripts/route-coverage.mjs`, `route-inventory.mjs` and `hono-inventory.mjs` were **not run**; method-level parity for every operation is inspection-based.
5. **Generated spec copies.** `contracts/openapi/dist/admin-v1.json`, `dist/cloudflare-admin-v1-oas30.json` and `portal-build/internal/specs/admin-v1.json` were listed but not diffed against `src/admin-v1.json`.
6. **Deployed configuration.** `services/backend/wrangler.admin.jsonc` describes one Worker with crons and queues; whether the deployed Worker has additional routes, versions or bindings not in that file is unverified.
7. **Frontend "no reference" determinations** are literal-string greps over `apps/admin-web/src`. One route is known to be reached dynamically (`/exports/:id/file` via the returned `download_url`, `ResourcePage.tsx:110-117`); others could be.
8. **`ADMIN_JWT_SECRET` / local bearer mode.** The role-to-permission behaviour for local bearer tokens (`admin-auth.ts:220-221`, `LOCAL_ADMIN_ENABLED=true`) was not exercised.
9. **Which CI checks are GitHub *required checks*.** Rulesets live in GitHub settings, not in the repo; only counts are documented (`docs/guides/staging-production-workflow.md:49-51`).
10. **The `34 of 51` hardcoded-colour figure** quoted in `docs-ci.yml:80` and `verify-no-hardcoded-colors.mjs:12-15` is a historical claim about the admin panel. Current measurement: `index.css` has 1 hex literal and 19 legacy aliases; no stored measurement exists to compare.
11. **The provenance of `apps/admin-web/src/orderak-tokens.css`.** It claims generation from an external project's `tokens/*.css`, which is not in the repository. Whether the committed file matches what that external generator would now produce is **unverifiable from this checkout**.
12. **The admin TypeScript is not strict.** `tsconfig.app.json` sets no `"strict": true` and disables `noUnusedLocals`/`noUnusedParameters`; the real number of latent type errors a strict mode would surface is unverified.
13. **Database schema** for `admin_action_authorizations`, `admin_sessions`, `admin_exports` and the audit tables (constraints beyond the SQL visible in the domain files) was not inspected — migrations were outside this audit's scope.
14. **Real production/Staging row counts** and the `docs/domains/admin-control-plane.md:144-157` table are a live-D1 measurement dated 2026-08-21 and were not reproduced.
15. **Bundle sizes** are raw `dist/assets` file sizes; gzip sizes (the number the CI budget actually checks) were not computed.

---

*End of audit. Report written to `docs/redesign/recon/admin-panel-audit.md`. No other file was created, modified or deleted.*
