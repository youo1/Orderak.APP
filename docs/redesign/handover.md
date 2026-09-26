---
status: draft
generated: false
owner: product
applies_to: [internal]
---
# Handover

State of the redesign programme, and exactly where the next round should start.
Written from the working tree, not from memory: every claim here was verified by
running a command in the session that produced it.

## Status

**Work is in progress.** Nothing in this pack is released. The tree holds 67
changed files — 56 modified, 11 new — and no file is half-edited: the full guard
suite is green. That is 21 repository and UX guards, run in one pass; the four
added by this work are named below, and the rest were already in the repository
and are listed in `.github/workflows/docs-ci.yml`, which runs them on every pull
request.

Nothing has been committed. Review the tree before building on it.

## What is done, and how to re-verify it

| Area | Evidence |
| --- | --- |
| Android defect fixes (10) | `gradlew :app:testStagingDebugUnitTest` → 339 tests, 0 failures; five contract guards green |
| Admin defect fixes (5) | `pnpm --filter @orderak/admin-web run test` → 29 tests; `playwright test` → 6 passed |
| Backend dead code removed | backend suite → 54 files, 476 tests, 0 failures; `verify-architecture-map.mjs` → 20 nodes, 19 edges |
| Android spacing, motion and shape | every seller surface is free of hand-written padding except the nine screens inside `OperationsScreens.kt`; `verify-android-motion-tokens.mjs` green |
| Admin type and radius tokens | `verify-admin-token-conformance.mjs` → every count is zero |
| Theme authority | `verify-theme-authority.mjs` green |

The four new guards, each of which was shown to fail when the defect it prevents
was reintroduced:

- `tooling/repository/verify-theme-authority.mjs`
- `tooling/repository/verify-admin-token-conformance.mjs`
- `tooling/repository/verify-android-motion-tokens.mjs`
- `apps/admin-web/src/tests/{confirm,page-states,step-up}.test.*`

Three claims in the original recon reports were wrong and are corrected in place,
under a **Verification pass** heading in each report. Read those headings before
trusting a row.

## Where to start next

Ordered by value per unit of risk. The first two repeat a pattern that is already
proven in this tree, so they need no new design decisions.

1. **`OperationsScreens.kt` — 1,500+ lines holding nine screens.** This is now the
   only seller surface with hand-written spacing left, and it is the reason it is
   still the only one: split it before migrating it. A file that size cannot be
   reviewed, and a spacing migration would touch every part of it at once. The
   nine screens it holds are the Account surface's operations pages.
2. **The admin panel's two design systems.** `src/shared/ui/*` is the real kit and
   is imported by one page; twenty-one other files hand-roll `.button`, `.field`
   and `.modal`. Consolidating is the largest single visual win left, and it is a
   product decision about how the console should look — make it deliberately.
3. **Admin table capabilities.** No sorting, no column filters, no bulk actions,
   and one empty state that conflates "no data" with "filtered to nothing".
4. **Navigation grouped by operator job**, with a role-scoped landing view. The
   current 41-section flat list groups by database subject.
5. **Android tab state.** Surfaces are not routes, so switching tabs discards
   search, scroll and dialogs, and Back from a non-Today surface exits the app.
6. **Admin weight and leading.** Font sizes and radii are on tokens and held
   there by a guard; weight is not. The reference allows 400 and 500 only, and
   the panel sets 700 and 800 in many places. This is a visible change to how
   dense the console reads, so it needs eyes on it, not just a count.

## Waiting on a decision, not on work

Backend deletions that change schema or routes. These were proposed with evidence
in `recon/backend-inventory.md` and deliberately not executed:

- the admin project tooling and its nine tables, with `ai_prompts` moved first —
  it is a live runtime dependency of the seller AI endpoint;
- four D1 tables with no reachable reader;
- the Play Billing queues while their lifecycle flag is off;
- one of each duplicated pair: the rate limiter, the entitlements engine, and the
  legacy plan path.

Each needs a migration, a rollback, and an explicit owner decision. Nothing in
this pack removes a route or a table.

## How to work in this tree

- Read `master-redesign-prompt.md` for the rules, the phases and the verification
  matrix. It is the only document that has to be read end to end.
- Run the guards before believing a change worked. A guard that a refactor breaks
  is updated with approval, never deleted.
- `.scratch/shots/shot.mjs` and `.scratch/shots/probe.mjs` screenshot the admin
  panel and read its computed design-system conformance. Both need
  `npx playwright install chromium` once, and a `vite preview` server on 4173.
  The probe is the only way to tell a `var()` that resolves from one that names
  nothing — a stylesheet can be full of tokens and still render the wrong thing.
