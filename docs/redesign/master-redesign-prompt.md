---
status: draft
generated: false
owner: product
applies_to: [internal]
---
# Orderak full redesign — master execution prompt

This document is a **prompt**: a complete, self-contained instruction set for an
AI coding agent to plan and execute a full redesign of the two human interfaces
of Orderak — the Android seller app and the admin control plane — together with
a right-sizing pass over the Cloudflare Workers backend that serves them.

It is written to be pasted into a fresh agent session rooted at this repository.
It is not a design document, a specification, or an approval. It is the brief
that produces those.

## 0. How to run this prompt

| | |
| --- | --- |
| Audience | An AI coding agent with read/write access to this repository |
| Prerequisites | A clean working tree; the ability to run the verification commands in section 15 |
| Output | Redesign decisions, implemented changes, updated contracts, and evidence |
| Hard stops | Section 2 (non-negotiable rules) and the gates in sections 7–14 |

Read `AGENTS.md` first, then this document in full, then the four baseline
reports produced by Phase 0. Do not begin Phase 2 before the Phase 1 gate is
signed off. Do not skip Phase 0: every later phase cites its evidence.

Three rules govern the whole engagement:

1. **Evidence or silence.** Every claim about current behaviour must cite a file
   path with a line number, a command with its output, or a document. "It looks
   like" is not a finding.
2. **Contracts outrank taste.** A redesign that breaks a protected contract is a
   failed redesign regardless of how it looks.
3. **Deletion is a proposal, not an action.** Phase 5 classifies backend
   capabilities as keep, simplify, fix, defer, or delete. Executing a deletion
   requires the owner's explicit approval recorded in the redesign decision log.

## 1. Mission

Redesign, in one coherent programme:

- **The Android seller app** — its information architecture, its screen
  composition, its component library, and its visual execution, for an Egyptian
  small merchant using a mid-range Android phone, in Arabic, often on a flaky
  connection.
- **The admin control plane** — the operator's workspace at
  `admin.orderak.app`, currently 41 sections that grew by accretion rather than
  by navigation design.
- **The backend, right-sized** — a deliberate keep / simplify / fix / defer /
  delete verdict on every capability, so that what remains is the smallest
  system that fully serves a free-launch Egyptian merchant product.

The redesign is **not** a rewrite. The platform, the contracts, the data model,
and the backend's authority boundaries stay. The interfaces and the surface area
change.

### What "done" means

A seller can install the app and publish a first product without instructions. An
operator can find any record, understand its state, and take the safe next action
without reading documentation. And the backend can be described in one page
without footnotes about features nobody uses.

## 2. Non-negotiable rules

These are not preferences. Breaking one is a defect, and sections 15–16 exist to
catch it.

### 2.1 Repository rules (from `AGENTS.md`)

- Android is Kotlin and Jetpack Compose. Backend is Cloudflare Workers with
  TypeScript. Admin is React and TypeScript.
- No provider API key or secret of any kind in the Android app. Secrets live in
  Worker secrets or local environment files.
- The Android app calls the Cloudflare backend and nothing else.
- Keep code beginner-friendly. Avoid unnecessary abstraction — the redesign is a
  licence to simplify, never to add a layer.
- Documentation is part of the change, not a follow-up: `docs/reference/api.md`,
  `docs/product/app-plan.md`, `docs/guides/setup.md`, and
  `docs/architecture/overview.md` are updated in the same commit when the thing
  they describe changes.

### 2.2 Protected versioned contracts

These are versioned safety contracts. Their outcomes may not change without the
owner's explicit approval and an executable migration recorded in the same
change.

| Contract | What it fixes in place |
| --- | --- |
| `docs/contracts/auth-phase1-contract.md` | Firebase/OTP/passkey guarantees, timing, logout ordering, consent evidence |
| `docs/contracts/authentication-security-invariants.md` | 10 invariants: phone-bound proof, terminal states, no secrets in logs, server-side verification, throttling, affirmative versioned consent, hash-only device secrets, logout ordering, recovery parity, no shipped bypasses |
| `docs/architecture/localization-architecture.md` and `docs/contracts/localization-invariants.md` | Locale set, per-app language behaviour, App Bundle language-split policy, translation lifecycle, RTL, numeral-system rules |
| `docs/contracts/api-compatibility-contract.md` | Pre-release route policy: the app uses `/api/v1/*`; unversioned and v2 routes are rejected |
| `docs/contracts/sync-conflict-contract.md` | Authority, revision, idempotency, retry, and conflict policy per entity |

A cosmetic redesign will not need to touch these. If yours does, stop and ask.

### 2.3 Design-system rules

- Colour, spacing, type, radius, elevation, and motion come from tokens. **A
  literal outside the token file is a bug** — `tooling/repository/verify-no-hardcoded-colors.mjs`
  enforces this for Android.
- The runtime authority is the active immutable D1 design-system revision,
  generated by the pinned Worker algorithm from a seed and a described intent
  (seed, scheme variant, contrast, mode, surface temperature, font family,
  density, shape preset). It is not a hand-edited palette.
- Changing the brand seed or the token set is a **generator** change: update the
  source intent, regenerate, and let `pnpm run design-system:check` prove the
  Android fallback hash still matches.
- Historical snapshots are never regenerated. A generator upgrade creates future
  snapshots only.

### 2.4 Data and authority rules

- D1 is the system of record. Room on the device is a cache plus a command
  queue. Only the designated cache writers may write the cache, and
  `tooling/repository/verify-cache-write-boundary.mjs` enforces it.
- All money is integer minor units with an explicit ISO 4217 currency. There is
  no amount without a currency.
- Public identifiers (`store_code`, `product_code`, `category_code`) are
  immutable and are screen identities, not display names.
- Route class names in `Routes.kt` are the key between the Android navigation
  graph and the synced screen manifest. Renaming one silently breaks that
  mapping: change the route and the manifest in the same commit, and let
  `tooling/repository/verify-screen-manifest.mjs` prove it.

### 2.5 Interface rules that a redesign must not quietly drop

- Arabic is the primary market language, not a translation layer. `ar`, `en`,
  `fr` ship complete and in parity; the engineering fallback is English.
- Egyptian colloquial Arabic is the product voice in `values-ar`.
- The phone app has no shadows: surfaces separate by tone and a 1px outline.
  Web surfaces use exactly five elevations.
- 48dp minimum touch target everywhere, generator-enforced.
- Colour is never the only signal: every soft semantic container carries both a
  container outline and an icon.
- Focus is always visible. Motion is 150–200ms, standard easing, and honours
  reduced motion.
- Quantities follow the locale's numeral system; identifiers and codes do not.
  No string mixes the two.

## 3. Product context the agent must internalize

Orderak lets a small Egyptian merchant run a shop from a phone: create a store,
publish a catalog, take and track orders, keep customers, and share a public
catalog link that buyers can order from.

- **Seller client:** `apps/seller-android/` — Kotlin, Jetpack Compose, package
  `app.orderak.seller`, flavors `staging` and `production`.
- **Admin control plane:** `apps/admin-web/` — React, TypeScript, Vite, served at
  `admin.orderak.app` by an asset-only edge Worker that holds no data bindings.
- **Backend:** `services/backend/` — Cloudflare Workers, D1, R2, Queues, Durable
  Objects. Two trust boundaries: the public/seller Worker and the private admin
  Worker.
- **Public storefront:** server-rendered pages on `orderak.app`, Arabic and
  English, aimed at the buyer.

Commercial state: a **free launch**. Paid acquisition, Google Play billing, the
entitlement engine, and the AI assistant are implemented but disabled behind
fail-closed flags. Design for the free product that exists, and leave the gated
surfaces structurally ready rather than visually promoted.

Who the seller is: a shopkeeper, not a SaaS operator. They are working, often
standing, often interrupted, sometimes offline. They read Arabic on a phone that
is not new. They need to answer one question repeatedly: *what needs me right
now?* Every redesign decision is measured against that.

## 4. Current-state baseline

These are counted from this repository. Phase 0 re-verifies them; a number that
has drifted is itself a finding.

### 4.1 API and backend

| Fact | Value |
| --- | --- |
| Documented seller API operations | 73 (`contracts/openapi/src/seller-v1.json`) |
| Documented admin API operations | 176 (`contracts/openapi/src/admin-v1.json`) |
| Documented integration operations | 2 (`contracts/openapi/src/integrations-v1.json`) |
| Route registrations | 276 total — 93 public, 183 admin |
| Admin share of the API | ~70% of documented operations |
| Backend source | 71 files, 37,906 lines — of which 15,540 are generated Worker env bindings, leaving ~22,366 hand-written |
| Backend tests | 58 files, 10,331 lines |
| D1 migrations | 61 files, highest `059_stock_movements_product_code_not_null.sql` |
| D1 tables | 114 |
| Deploy flags | 13, plus 2 D1 runtime controls and 11 non-flag variables |
| Secret names | 36 declared, 14 in a required list |
| Admin panel sections | 41 (`apps/admin-web/src/app/config/sections.ts`) |
| Admin frontend | 61 files, 6,299 lines |

### 4.2 Android and design

| Fact | Value |
| --- | --- |
| Android source | 138 files, 24,741 lines of Kotlin in `main` — feature 13,159 · data 7,261 · core 3,755 · app 494 · domain 72 |
| Navigation routes | 22 in `Routes.kt` |
| User-visible screens | 28 — 22 routes + 5 hosted surfaces + 1 governance overlay |
| Screen contracts | 28, with 83 declared states × 2 themes = 166 screenshot cases |
| Android tests | 50 unit test files (5,379 lines), 21 screenshot classes (3,794 lines, ~254 previews), 256 staged reference PNGs |
| Shipped locales | `ar`, `en`, `fr`; the Arabic string file is the largest |
| Brand seed | `#014D4E`, 264 contrast pairs validated, zero failures |
| Largest single UI file | `OperationsScreens.kt` at 1,446 lines, holding nine screens |
| Catalog features classified | 242, of which 108 are screen-level and 27 are backend or storefront only |

The five seller surfaces are fixed by a documented architecture decision:
**Today, Orders, Store, Customers, Account**. They were chosen so that each
catalog feature has exactly one home. The redesign works **within** those five.
Creating a sixth surface is a product-architecture change, not a redesign
decision, and requires the same evidence the original choice rested on.

### 4.3 Baseline findings already established

The Phase 0 reports exist for the areas audited so far. Read them before
starting, and treat their numbers as the baseline rather than re-deriving them:

- Backend inventory and necessity review — [recon/backend-inventory.md](./recon/backend-inventory.md)
- Android UI and front-end audit — [recon/android-ui-audit.md](./recon/android-ui-audit.md)
- Admin panel audit — [recon/admin-panel-audit.md](./recon/admin-panel-audit.md)
- Open-source evaluation — [recon/open-source-evaluation.md](./recon/open-source-evaluation.md)

The findings that most change the shape of this programme:

1. A large share of the admin API surface is internal project tooling —
   roadmap, tasks, screens, endpoints, prompts, design assets, releases, bugs,
   and project documents — rather than operations the product performs. One of
   those tables is a live runtime dependency of the seller AI endpoint, so the
   removal has an ordering constraint, not just a size.
2. Four D1 tables appear unreferenced or superseded, and a set of exported
   symbols has no caller at all.
3. The production baseline runs one plan-limits implementation while staging runs
   the newer entitlements engine, and one document states both are off.
4. The Android audit found failure states that cannot be retried, an empty state
   whose copy tells the seller to tap a control the screen has not rendered,
   irreversible actions without confirmation, and tab state that is discarded on
   every switch.
5. The Android design system is compiled into the app: admin theme publications
   have no delivery path to the device, and a guard fails the build if runtime
   theming returns. A token change is therefore a three-file regeneration, and
   the Theme Builder is currently an admin-side control with no client effect.
6. Several guards match **source text**, not behaviour — a specific expression in
   an auth composable, a specific logout call, a hardcoded file path in a
   localization guard. Moving a callback into a child composable, or renaming a
   file, breaks a contract guard while changing no behaviour. Read the guard
   before moving the code it protects.

### 4.4 Admin panel baseline findings

The panel's domain logic and security model are sound: opaque D1 sessions, CSRF
double-submit, single-use entity-bound step-up authorization, immutable plan and
theme revisions, and a hash-chained audit. What is broken is the presentation
layer. In particular:

1. **Two parallel design systems.** A component kit is imported by exactly one
   file; twenty-one other components use hand-rolled classes, and most modals are
   hand-rolled. This is why the panel looks inconsistent and why fixing it means
   consolidating primitives, not restyling pages.
2. **The published theme loses to a committed token bundle.** The built HTML
   links the theme stylesheet before the application stylesheet, and both declare
   the same custom properties, so the committed bundle wins. It is invisible
   because the theme builder also writes inline styles on the document element,
   which restyles the publishing administrator's own tab and nobody else's. Treat
   this as the highest-severity finding in the panel audit and fix it before any
   visual work, or every later review will be measuring the wrong colours.
3. **Two unsynchronised route registries**, one in the frontend config and one in
   the shared contract types, plus a hand-maintained exclusion string that drives
   route generation.
4. **The design system is half-consumed.** Colour, motion, and state tokens are
   used; space, shape, and type tokens are referenced nowhere in source, with
   hardcoded font sizes — two of them below the system's own Latin minimum — and
   hand-picked radii.
5. **No forbidden state.** A permission refusal renders through the same card as a
   network failure. Operators cannot tell "you may not" from "it did not load".
6. **Destructive actions are inconsistent**: many native confirmations and one
   typed confirmation. There is no success feedback and no error boundary.
7. **The tables cannot be worked with.** No sorting, no column filters, no bulk
   actions, no column choice, and one empty state that conflates "no data" with
   "filtered to nothing".
8. **Twelve UI-to-server permission mismatches**, three of which let an operator
   satisfy the interface gate, enter a fresh password and a second factor, and
   only then be refused.
9. **Thirty-eight backend admin routes have no interface at all.**
10. **The panel's end-to-end tests are invoked by no workflow**, and their last
    recorded run failed on a working-directory off-by-one that is still on disk.

The verdict is an incremental, design-system-led redesign of the panel's shared
primitives and its information architecture. It is not a rewrite: the
authorization invariants and their guards are the asset worth keeping, and a
rewrite would discard them while leaving every defect above in place.

## 5. Goals and success criteria

Each goal has a criterion that a reviewer can check without asking the agent.

### G1 — A new seller reaches first value faster

Criterion: the count of taps and required fields between first launch and a
published product with an image is measured before and after, and the after
number is lower with no required field removed that a contract or a legal
obligation requires. The onboarding draft stays resumable.

### G2 — The app answers "what needs me now" without navigation

Criterion: the Today surface, at first paint and with no interaction, shows
everything that is genuinely action-requiring today — new orders, unpaid orders,
orders waiting to ship, a failed or pending sync, and a plan limit that is
blocking work — or explicitly shows that there is nothing. No such item requires
a tab change to discover.

### G3 — One visual language across all three surfaces

Criterion: Android, the admin panel, and the public storefront resolve every
colour, spacing value, type role, radius, and elevation to a token. The admin
panel's hand-written colour exceptions are eliminated, and
`tooling/repository/verify-no-hardcoded-colors.mjs` stays green.

### G4 — The admin panel becomes navigable

Criterion: every one of the panel's sections is reachable in at most two
navigations from the landing view, the panel's information architecture is
documented as a tree with a stated purpose per branch, and no branch exists
solely because a table does.

### G5 — Operators can act safely and quickly

Criterion: for each destructive or irreversible operator action, the panel
states the consequence, requires the confirmation the backend requires, and
records the audit event. For each long-running operation, the panel shows
progress and a truthful terminal state.

### G6 — The backend is explainable

Criterion: every capability has a keep / simplify / fix / defer / delete verdict
with evidence, deletions are proposed as a grouped change with a migration and a
rollback plan, and the resulting API surface can be described in one page.

### G7 — Nothing protected broke

Criterion: the full verification matrix in section 15 passes, or every exception
is named, explained, and approved. No guard is weakened, renamed, skipped, or
deleted to make a redesign pass.

## 6. Explicitly out of scope

- iOS, desktop, and seller web/PWA clients.
- Activating billing, entitlement rollout, or the AI assistant. The redesign
  prepares their surfaces; it does not open them.
- Changing the free-launch commercial decision.
- Changing the authentication provider, the OTP state machine, the passkey
  ceremonies, or the logout sequence.
- Changing the locale set, the default locale, the App Bundle language-split
  policy, or the translation lifecycle.
- Replacing D1, R2, Queues, or Durable Objects.
- Redesigning the public storefront's architecture. Visual consistency with it
  is in scope; its rendering model is not.
- Any change whose only justification is novelty.

## 7. Phase 0 — Baseline evidence

No code is edited in this phase. The output is four reports and one decision
log.

### 7.1 Required reports

Write these as the starting evidence for every later phase:

```text
docs/redesign/recon/backend-inventory.md       backend routes, migrations, flags, secrets, orphan code, cost ledger
docs/redesign/recon/android-ui-audit.md        screens, states, components, tokens, layout observations, constraints
docs/redesign/recon/admin-panel-audit.md       routes, sections, components, backend coupling, UX observations
docs/redesign/recon/open-source-evaluation.md  candidate libraries and tools with licenses and verdicts
docs/redesign/redesign-decisions.md            the decision log, opened in this phase
```

### 7.2 Tasks

1. Reproduce the counts in section 4 and record any that differ. A stale count is
   a finding: it means a document is drifting.
2. Produce the screen inventory for Android, one row per route and per hosted
   surface: route key, file, view model, states, primary actions, data read, and
   the contract that protects it.
3. Produce the section inventory for the admin panel: path, purpose, permission,
   endpoints called, and states.
4. Classify every backend capability as keep / simplify / fix / defer / delete,
   with evidence and a stated cost.
5. Identify every UI literal that bypasses the token system, on each of the three
   surfaces, with file and line.
6. List every duplicated UI pattern that should become one component, and every
   one-off that should not.
7. List every place where the same fact is presented two different ways across
   surfaces.
8. Record the current screenshot baseline count so Phase 6 can prove the delta.
9. Open the decision log with the decisions that are already forced by the
   evidence.

### 7.3 Phase 0 exit criteria

- The four reports exist, are factual, and cite paths with line numbers.
- Every number in section 4 is either confirmed or corrected in the reports.
- The decision log lists the open decisions, each with its options and its
  blocking evidence.

## 8. Phase 1 — Design decisions and tokens

This phase produces decisions, not screens. It ends at a gate.

### 8.1 Decisions to make, each with a recommendation to accept or reject

| # | Decision | Options | Default recommendation |
| --- | --- | --- | --- |
| D1 | Visual direction of the seller app | Keep the current generated scheme · new seed · new scheme variant · new type scale | Keep the brand seed and the generated scheme. Restyle layout, density, and hierarchy — not identity. A rebrand is a different project with a different approval. |
| D2 | Type scale | Keep Cairo and the 15 M3 roles · add a display role for the Today surface · switch family | Keep Cairo at one family for both scripts. Add hierarchy through size and weight within the existing roles before adding roles. |
| D3 | Density | Keep 16dp gutters and 8dp intra-group · tighten the list surfaces · loosen the forms | Keep the scale but stop treating every screen as a form. List surfaces get row tokens; forms keep the gated rhythm. |
| D4 | Elevation and surface separation | Keep tone-only on the phone · introduce a card system | Keep tone-only. Introduce one documented "primary action card" pattern that is a token composition, not a shadow. |
| D5 | Today surface shape | Counters only · counters plus a next-action block · a full task inbox | Counters that name the action they open, plus one "needs you now" block that is empty when nothing does. |
| D6 | Component library scope | Extend the existing shared components · adopt an external Compose kit · build a documented design-system module | Extend the existing in-repo components, and give the library a documented inventory with a rule for adding a component. |
| D7 | Admin panel foundation | Keep the current hand-rolled shell · adopt an open-source admin framework · adopt a component system only | Keep React and the existing data layer; adopt a component-level foundation only. A framework migration is not a redesign and would put 176 admin operations behind a new abstraction. |
| D8 | Admin navigation model | Flat 41-section list · task-grouped navigation · role-scoped landing views | Task-grouped navigation with a role-scoped landing view. The flat list is the problem being solved. |
| D9 | Backend right-sizing depth | Documentation only · freeze and flag · proposed deletion with a migration | Proposed deletion with a migration, unexecuted until approved. |
| D10 | Screenshot and contract churn | Regenerate all baselines · rebuild only redesigned surfaces · per-screen review | Rebuild per redesigned surface, reviewed screen by screen. A blanket baseline regeneration destroys the evidence the suite exists to provide. |

### 8.2 Token work

1. Decide whether the token set needs any addition at all. The current set has
   colour, type, spacing, shape, elevation, motion, and semantic roles. A
   redesign that needs a new token must say what it encodes and why an existing
   token cannot express it.
2. If tokens change, change them at the source: the described intent in the
   generator, then regenerate, then confirm the Android fallback contract hash.
   Never edit a generated artifact by hand.
3. Publish the token delta as a table of before and after values with the
   contrast validation result.

### 8.3 Phase 1 gate

The owner signs off on: the visual direction, the decisions table with each row
accepted or overridden, the token delta, and the phase plan. Until then, no
screen code changes.

## 9. Phase 2 — Android information architecture

### 9.1 Work

1. Map every one of the 242 classified catalog features to a surface, a screen,
   or a section. Record any feature that has no honest home. A feature with no
   home is a product finding, not a layout problem.
2. Re-lay the navigation inside the five surfaces. For each surface, state its
   one purpose, its entry screen, its depth limit, and what it must never
   contain. Depth beyond two levels from a surface root needs a justification.
3. Design the **Today** surface as the answer to the daily question, and design
   its empty state as carefully as its full state.
4. Re-place every Account feature into a group with a stated rule for membership.
   The documented risk is that Account becomes a settings dumping ground; the
   redesign must actively prevent that.
5. Define the cross-cutting patterns once, centrally: loading, empty, error,
   offline, restricted, plan-limited, permission-denied, destructive
   confirmation, and success acknowledgement. Each has one shape and one voice.
6. Define the form rules: when a field is validated, how an error is reported,
   how a required field is marked, how a save is confirmed, and what happens to
   an interrupted form.
7. Define the money, count, date, and identifier presentation rules once, and
   route every screen through them.
8. Define the offline story per surface: what is readable, what is writable, what
   queues, what refuses, and what the seller sees in each case.

### 9.2 Deliverables

- A surface-and-navigation tree for the app, with a purpose line per branch.
- A screen inventory keyed by route, with the states each screen declares.
- A cross-cutting pattern specification.
- An updated screen-contract source so the generated documents follow.

### 9.3 Phase 2 exit criteria

- Every catalog feature has a home or an explicit gap entry.
- Every route in `Routes.kt` appears in the tree with a stated purpose.
- No surface exceeds its declared depth limit without a recorded justification.
- The pattern specification has no screen-local exception.

## 10. Phase 3 — Android screen rebuild

Rebuild surface by surface, in this order, because it follows user frequency and
because the second surface validates the first:

```text
Today  →  Orders  →  Store  →  Customers  →  Account
```

For each surface:

1. Rebuild the shared components the surface needs **first**, in the component
   module, with a preview per state.
2. Rebuild the surface's screens against those components only. A screen may not
   define a visual primitive the library does not.
3. Preserve every state the contract declares. Adding a state is allowed;
   dropping one is a contract change.
4. Preserve every action the contract declares, or record why it moved.
5. Keep the contract's route keys unchanged unless the change is deliberate and
   the screen manifest is updated in the same commit.
6. Update all three locale resource files in the same change. No hardcoded user
   visible text, ever.
7. Prove RTL: the layout must mirror correctly in Arabic, and numeric runs must
   stay isolated and correct.
8. Add or update the screenshot cases for every declared state, in both themes,
   and review each one visually rather than accepting a regenerated baseline.
9. Re-run the money-formatting guard: no screen may rely on an ambient locale.
10. Run the surface's tests and the applicable contract guards before moving on.

### 10.1 Required review artefacts per surface

- A state-by-state screenshot set, light and dark, Arabic and English.
- A component list with the components added, changed, or removed.
- A before/after tap count for the surface's primary task.
- A list of contract, route, and manifest changes with justification.

### 10.2 Forbidden in this phase

- Editing a generated document by hand instead of its source.
- Adding a colour, spacing, radius, duration, or type-size literal.
- Introducing a second way to do something the app already does.
- Changing authentication, localization, or data-layer behaviour for layout
  reasons.

## 11. Phase 4 — Admin control plane redesign

### 11.1 Work

1. Re-derive the panel's information architecture from **operator jobs**, not
   from database tables. State each job: who does it, how often, what they need
   on screen to decide, and what the safe next action is.
2. Group sections into job-based branches and retire the branch that exists only
   to mirror an internal project tracker. That branch has no operational
   purpose; propose its removal rather than redesigning it.
3. Design a role-scoped landing view: an owner, a support operator, a finance
   operator, and a read-only reviewer should each land on the work that is
   theirs.
4. Define one data-table pattern: columns, density, sorting, filtering,
   pagination, row actions, empty state, loading state, error state, permission
   state, export, and bulk action rules. Every table uses it.
5. Define one record-detail pattern: header with identity and state, then the
   facts, then the timeline, then the actions. Every detail view uses it.
6. Define the destructive-action pattern end to end: what the operator sees,
   what the backend requires, what is recorded, and how the result is confirmed.
   The client is never the authority; the Worker enforces every privileged
   action.
7. Define the long-running-operation pattern: queued, running, succeeded,
   failed, retryable, dead-lettered — with the truthful state shown for each.
8. Specify responsive behaviour against the documented breakpoints, and specify
   keyboard and focus behaviour for a screen that is used all day by a
   professional.
9. Bring the panel onto the token system: eliminate hand-written colours,
   spacing, and sizes, and replace the panel's divergent values with tokens.
10. Keep the panel's own guards green: accessibility tests, the data-table tests,
    the section tests, the theme delivery tests, and the end-to-end workflow.

### 11.2 Deliverables

- An operator job map and a navigation tree derived from it.
- The table, detail, destructive-action, and long-running-operation patterns.
- A component inventory with everything duplicated collapsed into one component.
- A token-conformance report with before and after counts of literals.
- Playwright coverage for at least one material end-to-end operator workflow per
  role-scoped landing view.

## 12. Phase 5 — Backend right-sizing

The goal is the smallest backend that fully serves the product — not the
smallest possible backend.

### 12.1 Classification rules

| Verdict | Means | Required evidence |
| --- | --- | --- |
| KEEP | Core to the product now; at most polish remains | Which seller or operator journey depends on it, today |
| SIMPLIFY | Needed, over-built | What the simpler shape is, and what would be lost |
| FIX | Needed and unsafe, incomplete, or inconsistent | The concrete failure, reproduced |
| DEFER | Real later value; should stop costing maintenance now | What keeps it alive, and what freezing it saves |
| DELETE | Should leave the codebase | No live caller, no active data, no documented commitment — proven, not assumed |

### 12.2 Required analysis per capability

- The routes it owns and their callers, in the app, the panel, and the public
  site.
- The tables it owns, and whether those tables hold rows in production.
- The flags and secrets it needs.
- The migration and rollback cost of removing it.
- The documentation that would become false.
- The verification coverage that would go with it.

### 12.3 Special attention

These are the areas where the evidence is most likely to show weight that the
product does not need:

- **The internal project tracker branch** of the admin panel: roadmap, tasks,
  bugs, releases, project docs. The repository's own documentation already
  records that these tables are empty in production and that the panel screens
  exist for a workflow nobody runs.
- **The commerce branch** for a free launch: plans, revisions, entitlements,
  coupons, referrals, payouts, ads, and the Play verification queue. The
  question is not whether they work but whether they need to be reachable,
  documented, and maintained before acquisition opens.
- **Duplicate or legacy implementations** that exist for rollback: legacy
  entitlements, the auth v1/v2 pair, the mirror product-sync surface alongside
  per-product REST, and GeoNames alongside the pinned city catalogue. Each was
  correct when written; each now costs a reader time on every change.
- **Admin operations with no UI**, and panel sections with no consumer.

### 12.4 Output

A table with one row per capability: verdict, evidence, cost imposed, what
changes, what the removal or freeze would break, and the migration and rollback
plan. Deletion is grouped into the smallest number of coherent changes that can
be reviewed and reverted independently.

### 12.5 Hard rule

No deletion is executed in this phase. The output is a proposal with an approval
request. Executing it is a separate, approved change with its own migration,
`docs/guides/database-migrations.md` entry, and rollback.

## 13. Phase 6 — Verification and documentation synchronization

1. Run the full verification matrix (section 15) and record every command with
   its result. A skipped check is reported with its reason, never omitted.
2. Synchronize the documentation a redesign legitimately changes:
   `docs/product/app-plan.md` for product behaviour, `docs/ux/screen-contracts.md`
   and `docs/ux/feature-surface-map.md` through their generators,
   `docs/domains/design-system-reference.md` for the visual system,
   `docs/architecture/overview.md` for components and trust boundaries,
   `docs/reference/api.md` when endpoints change, and
   `docs/architecture/orderak-full-architecture.html` when components,
   integrations, queues, or data authority change.
3. Regenerate every generated document from its generator. Never paste output.
4. Confirm the screen manifest, the error-code extraction, and the DTO parity
   checks are green.
5. Write the before/after evidence: screenshot counts, literal counts, tap
   counts, section counts, operation counts, and the deletion proposal's size.
6. Record in `docs/redesign/redesign-decisions.md` every decision taken, every
   decision deferred, and every contract that was touched.

## 14. Phase 7 — Rollout

1. Ship to staging first. The staging app has its own application ID, its own
   Firebase project, and its own hosts.
2. Because the app is the seller's daily tool, ship the redesign behind the
   existing version-governance machinery rather than as a silent change: use the
   warning, grace, and forced-update states that already exist, per market.
3. Never block a seller on an unavailable network. Stale or offline policy
   becomes a visible warning, never a permanent lockout.
4. Keep the previous design reachable for exactly as long as the migration needs
   it, and no longer. Record the removal trigger.
5. Provide a rollback that is a deploy, not a rewrite. The design system already
   supports rollback by publishing a new revision that references the old one —
   use it for token-level rollback.

## 15. Verification matrix

Run the narrowest check first and the broadest last. Use the repository's
verification groups rather than inventing a sequence:

```powershell
node .github/skills/orderak-verification/scripts/verify.mjs android
node .github/skills/orderak-verification/scripts/verify.mjs backend
node .github/skills/orderak-verification/scripts/verify.mjs auth
node .github/skills/orderak-verification/scripts/verify.mjs localization
node .github/skills/orderak-verification/scripts/verify.mjs architecture
```

Also required after a redesign:

```powershell
gradlew.bat verifyAuthPhase1Contract verifyLocalizationContract verifySellerApiContract verifyDesignSystemContract verifyDataAuthorityContract
pnpm run openapi:check
pnpm run verify:doc-links
node tooling/repository/verify-doc-claims.mjs
node tooling/repository/verify-doc-frontmatter.mjs
pnpm run verify:implementation
pnpm run verify:dto-parity
pnpm run verify:error-codes
pnpm run verify:deployment-map
pnpm run verify:contract-guards
```

Some of those Gradle guards match **source text**, not behaviour: a specific
expression inside an auth composable, a specific logout call, a hardcoded file
path inside the localization guard. Moving a callback into a child component, or
renaming a guarded file, breaks the guard while changing nothing a seller can
observe. Read the guard before moving the code it protects, and treat a
source-text guard that a legitimate refactor breaks as a guard to update with
approval, never as a guard to delete.

Plus, from `services/backend`:

```powershell
pnpm run design-system:check
pnpm run verify:architecture
pnpm run test:types
pnpm run verify:migrations
```

And, from `apps/admin-web`:

```powershell
pnpm run test
pnpm run lint
pnpm run build
pnpm run test:e2e
```

Guards that a redesign is most likely to trip, and what each protects:

| Guard | Protects against |
| --- | --- |
| `tooling/repository/verify-no-hardcoded-colors.mjs` | Colour reaching the app around the generator's contrast validation |
| `tooling/repository/verify-screen-manifest.mjs` | A shipped route that never reached the synced screen manifest |
| `tooling/repository/verify-cache-write-boundary.mjs` | A local database write that assumes Room is the authority |
| `tooling/repository/verify-room-schema-history.mjs` | A schema version with no exported schema beside it |
| `tooling/repository/verify-money-locale.mjs` | Money formatted with an ambient locale instead of the screen's |
| `tooling/ux/verify-screen-contracts.mjs` | A route with no declared contract |
| `tooling/ux/render-coverage.mjs` | A claimed render with no screenshot pixels behind it |
| `tooling/ux/design-coverage.mjs` | A declared state with no design |
| `node --test tooling/ux/implementation-audit.test.mjs` | The verifier itself being wrong |
| `tooling/repository/verify-doc-claims.mjs` | Documentation naming a path or script that does not exist |

If a guard fails, the redesign is wrong or the guard's subject genuinely changed.
Restore the protected behaviour, or obtain explicit approval for the migration
and update the guard with the approval recorded. Never bypass, weaken, rename,
or delete a guard to pass.

## 16. Definition of done

The redesign is done when all of the following are true and evidenced:

1. Every one of the section 5 criteria is demonstrated with a measurement, not
   an assertion.
2. The full verification matrix passes, with any exception named, explained, and
   approved.
3. The decision log contains every decision, including the ones not taken.
4. The backend review exists as a verdict table with evidence, and its deletion
   proposals are either approved-and-executed in a separate change or explicitly
   deferred.
5. Generated documents were regenerated from their generators.
6. Screenshot baselines were rebuilt per surface and reviewed, with the count
   before and after recorded.
7. No literal colour, spacing value, radius, duration, or type size was added
   outside the token system.
8. Every user-visible string exists in all three locales.
9. Every route and surface is documented in the navigation tree with a purpose.
10. The redesign can be rolled back by deploying, and the rollback is written
    down.

## 17. Reporting format

After each phase, report in this shape and no other:

```text
Phase: <n> — <name>
Status: complete | blocked | partially complete
Decisions taken: <list, each with its evidence>
Files changed: <paths>
Guards run: <command> → <result>
Guards skipped: <command> → <reason>
Contract impact: none | <contract> with the approval reference
Open questions: <list, each with what would unblock it>
Next phase readiness: yes | no, because <reason>
```

Do not summarise a phase as complete while a required guard is red. Do not
report a guard as passing without having run it.

## 18. Failure modes and how to react

| Symptom | Correct reaction |
| --- | --- |
| A guard fails and the redesign "obviously" needs the change | Stop. The guard protects an outcome, not a name. Request an approved migration, or restore the behaviour. |
| A screen needs a colour that is not a token | Add it at the system level with a reason, or redesign the screen. A screen-local literal is never the answer. |
| The design needs a sixth surface | Treat it as a product-architecture change: present the evidence that the five surfaces cannot hold the feature. |
| A baseline screenshot change is unreviewable in size | Split the surface into smaller changes. A blanket baseline regeneration is a lost review. |
| Removing a backend capability turns out to break something | That is the evidence the classification was wrong. Reclassify with the caller named; do not proceed on the original verdict. |
| The redesign becomes a rewrite | Stop and re-scope. The platform, contracts, and data model are not in scope. |
| An open-source dependency would replace a protected contract | It cannot. A contract's outcomes are ours to keep; a library may implement them, never redefine them. |

## 19. Open-source adoption decisions

The evaluation behind these decisions is
`docs/redesign/recon/open-source-evaluation.md`. The asymmetry to internalise
first: **roughly half of what is worth adopting is already in the repository.**
The admin panel's dependency list is already the shadcn/ui stack minus the
components, and the backend already runs Hono with `@hono/zod-openapi` and Zod 4.
The win is component reuse and deleting glue, not replacing frameworks.

### 19.1 The adoption test

Before any new dependency is added, it must pass all four:

1. Does it deploy as static assets or build-time output, or does it need a
   process and a database we do not have? A candidate that needs its own server
   is a second data authority beside D1, and that is the most expensive mistake
   available in this redesign.
2. Does it introduce a second theme authority next to the backend-generated
   design system? If it owns theming, it is wrong here.
3. Is the licence permissive enough for a closed-source commercial product, and
   verified from the project's own licence file rather than a summary?
4. Does adopting it delete more code than it adds?

### 19.2 Recommended shortlist

| # | Pick | Licence | What it earns |
| --- | --- | --- | --- |
| 1 | shadcn/ui | MIT | Components copied into the repo, no new runtime dependency, and no second design language. Removes the largest block of hand-rolled admin UI. |
| 2 | TanStack Table | MIT | Headless table state — sorting, filtering, pagination, selection, column visibility — which is the code every admin panel rewrites badly. No styling opinion, so it cannot fight the token pipeline. |
| 3 | react-hook-form with the Zod resolvers | MIT | Deletes bespoke form state and validates against the same Zod schemas the backend already defines. |
| 4 | Style Dictionary v5 | Apache-2.0 | A built-in Jetpack Compose format plus CSS and Tailwind outputs: one structural token source, CI-checked. Build-time only. |
| 5 | MaterialKolor | Apache-2.0 | The canonical Compose implementation of seed plus scheme variant plus contrast level into a `ColorScheme`. Used downstream of the server payload, never as an authority. |
| 6 | Scalar API Reference | MIT | A static, searchable reference generated from the OpenAPI already bundled, replacing the hand-maintained prose mirror. Deploys as static assets. |
| 7 | openapi-typescript | MIT | Turns DTO parity from a detective control into a generative one. Reinforces ADR-010. |
| 8 | Roborazzi | Apache-2.0 | Insurance for the one alpha dependency in the quality pillar: the Compose screenshot plugin is pre-1.0 and requires a recent AGP. Verifies screenshots on the JVM. |

Do not churn the adjacent keepers already adopted: Hono, `@hono/zod-openapi`,
Zod 4, `@material/material-color-utilities`, TanStack Query, Radix primitives,
Cloudflare Queues, Durable Objects and D1, the Sentry SDKs, MkDocs Material,
`com.android.compose.screenshot`, Schemathesis, Vitest, Playwright, oxlint.

### 19.3 Rejected, and the reason that matters

| Rejected | Reason |
| --- | --- |
| React Admin | MUI-based: a second design system beside the runtime token pipeline. |
| refine | A framework over routing and data fetching the panel already has. Abstraction cost exceeds the benefit for a small team. |
| Directus, Payload, AdminJS, Appsmith, ToolJet, Baserow, NocoDB | Each needs its own service and database. A second data authority beside D1. |
| MUI, Ant Design, Mantine, AG Grid | Each owns a theme model, which means two theme sources forever. |
| Drizzle ORM, Prisma | A full data-layer rewrite. Keep it out of a UI redesign and decide it as its own ADR if at all. |
| Self-hosted Sentry, Grafana, Plausible, Matomo, OpenStatus | Source-available or copyleft, and all need infrastructure the product deliberately does not run. |
| Self-hosted feature-flag servers | A flag system already runs on D1 and Workers. Consider OpenFeature as an interface only. |
| Vercel AI SDK, Cloudflare Agents SDK | Neither problem exists yet. One provider does not justify a routing layer. |
| Navigation 3, Compose Multiplatform, Showkase, Paparazzi | Pre-release, declining, or redundant. Spike separately; do not couple a redesign to them. |
| Money libraries | The integer minor units plus explicit currency model is already more correct than the float-based helpers. |

### 19.4 Traps to write into the Phase 1 decision log

1. **A second data authority.** No adopted tool may bring its own database.
2. **A second theme authority.** One authority for colour: the backend Theme
   Builder. Structural tokens may be generated at build time; they may not
   compete with the runtime one.
3. **Geo data licensing.** The city and country data is derived from a
   share-alike database licence. It stays server-side and attributed. It must
   never be bundled into the APK or published as a derivative dataset.
4. **Font licensing.** The build subsets fonts. Permissive font licences still
   carry reserved-name and licence-bundling obligations: confirm what the
   subsetting output preserves and that the licence text ships.
5. **Guards move with the architecture.** Adopting a token generator, a type
   generator, or a documentation renderer means updating the guards that
   describe them in the same change.

### 19.5 Adoption is a separate change

Each adoption is its own reviewable change with its own evidence, its own
licence record in the third-party register, and its own rollback. Do not bundle
a new dependency into a screen rebuild: if the screen is broken afterwards, two
variables were changed at once.
