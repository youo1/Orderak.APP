---
status: draft
generated: false
owner: product
applies_to: [internal]
---
# Redesign decision log

Every decision the redesign depends on is recorded here, including the decisions
not taken. A phase may not start while a decision it depends on is still
`Proposed`.

Status values:

| Status | Means |
| --- | --- |
| Proposed | Written down with a recommendation; nobody with authority has accepted it |
| Decided | Accepted, with the approver and the date recorded |
| Deferred | Accepted as real, deliberately not now, with a trigger that reopens it |
| Rejected | Considered and refused, with the reason — so it is not relitigated |
| Blocked | Cannot be decided until the named evidence exists |

## 1. Redesign direction

### RD-01 — Scope of the redesign

| | |
| --- | --- |
| Status | Decided |
| Decision | Redesign the Android seller app and the admin control plane, and right-size the backend that serves them. Do not rewrite the platform, the data model, or the backend's authority boundaries. |
| Evidence | `docs/redesign/master-redesign-prompt.md` sections 1 and 6 |
| Consequence | The visual layer and the surface area change; the contracts do not. |

### RD-02 — The five seller surfaces stay

| | |
| --- | --- |
| Status | Decided |
| Decision | The redesign works inside Today, Orders, Store, Customers, and Account. Creating a sixth surface is a product-architecture change and needs the same evidence the original choice rested on. |
| Evidence | `docs/ux/feature-surface-map.md` — 242 catalog features classified, each mapped to exactly one surface; the surface decision is recorded in the navigation source itself. |
| Consequence | A feature with no honest home is reported as a product gap, not solved by adding a tab. |

### RD-03 — Visual identity is not the redesign

| | |
| --- | --- |
| Status | Proposed — recommendation: keep |
| Decision | Keep the brand seed, the generated scheme, and Cairo. Redesign layout, density, hierarchy, and component composition instead. |
| Evidence | The design system is generated from a seed with 264 contrast pairs already validated; a rebrand is a different project with a different approval. |
| Consequence | Token changes, if any, are additive and justified one at a time. |

## 2. Interface decisions

### RD-04 — Today surface shape

| | |
| --- | --- |
| Status | Proposed |
| Decision | Today carries counters that name the action they open, plus one "needs you now" block that is honestly empty when nothing does. |
| Evidence | Phase 0 finding on what requires seller action daily; `docs/ux/screen-contracts.md` for the surface's declared states. |
| Consequence | Every action-requiring item is discoverable at first paint without navigation. |

### RD-05 — Component library strategy, Android

| | |
| --- | --- |
| Status | Proposed |
| Decision | Extend the in-repo Compose component library, give it a documented inventory, and add a rule for when a new component is allowed. Do not adopt an external Compose UI kit. |
| Evidence | The repository already owns a shared component module and a screenshot suite that asserts component states. |
| Consequence | A screen may not define a visual primitive the library does not have. |

### RD-06 — Component foundation, admin panel

| | |
| --- | --- |
| Status | Proposed |
| Decision | Keep React, the existing router, the existing data layer, and the existing styling approach. Adopt a component foundation (shadcn/ui) and headless table and form libraries. Do not adopt an admin framework. |
| Evidence | `docs/redesign/recon/open-source-evaluation.md` — the panel's dependency list is already the component stack minus the components; an admin framework would duplicate the router and data layer the panel already has. |
| Consequence | No new design language and no second theme authority. |

### RD-07 — Admin navigation model

| | |
| --- | --- |
| Status | Proposed |
| Decision | Replace the flat section list with task-grouped navigation and a role-scoped landing view derived from operator jobs. |
| Evidence | Phase 0 operator job map; the current section list groups by database subject rather than by work. |
| Consequence | Every section is reachable in at most two navigations from the landing view. |

### RD-08 — The internal project tracker branch

| | |
| --- | --- |
| Status | Proposed — recommendation: remove from the panel |
| Decision | The roadmap, tasks, bugs, releases, and project-documentation screens have no operational consumer. Redesigning them is wasted work; propose their removal. |
| Evidence | The repository's own admin control plane documentation records that these tables are empty in production and that the screens exist for a workflow nobody runs. |
| Consequence | A schema change with its own migration and approval, proposed in Phase 5 and not executed without it. |

## 3. Backend decisions

### RD-09 — Depth of the backend right-sizing

| | |
| --- | --- |
| Status | Decided |
| Decision | Produce a verdict table with keep, simplify, fix, defer, and delete for every capability. Propose deletions as grouped, independently revertible changes. Execute nothing in the redesign without explicit approval. |
| Evidence | `docs/redesign/master-redesign-prompt.md` section 12 |
| Consequence | The redesign's backend output is evidence and a proposal, not a migration. |

### RD-10 — Commerce branch during a free launch

| | |
| --- | --- |
| Status | Blocked |
| Blocking evidence | A decision on whether paid acquisition opens in the next two quarters. Until that exists, the question is whether the commerce surfaces should stay reachable and documented, not whether they work. |
| Options | Freeze behind flags and stop documenting them as product · keep them reachable but out of the primary navigation · redesign them for the eventual paid launch |
| Recommendation | Keep them enforced, remove them from the primary navigation, and stop treating them as a product surface until acquisition opens. |

### RD-11 — Legacy and duplicate implementations

| | |
| --- | --- |
| Status | Proposed |
| Decision | Each duplicated implementation kept for rollback — the legacy entitlement path, the older auth pair, the mirror product-sync surface, the legacy geo rollback tables — needs a named removal trigger and a date, or it needs to be deleted. |
| Evidence | Phase 0 capability inventory with callers named per implementation. |
| Consequence | No duplicated path is deleted while a live client depends on it; none is kept indefinitely without a trigger. |

## 4. Engineering decisions

### RD-12 — Screenshot baseline handling

| | |
| --- | --- |
| Status | Decided |
| Decision | Rebuild screenshot baselines per redesigned surface, reviewed screen by screen. Never regenerate the whole suite in one commit. |
| Evidence | The suite exists to make visual change reviewable; a blanket regeneration removes the evidence rather than updating it. |
| Consequence | Each surface's rebuild commit contains its own baseline delta. |

### RD-13 — Open-source adoption is separate from the rebuild

| | |
| --- | --- |
| Status | Decided |
| Decision | Each adopted dependency is its own reviewable change with its own licence record and rollback. No new dependency is bundled into a screen rebuild. |
| Evidence | `docs/redesign/recon/open-source-evaluation.md` sections 8 to 10 |
| Consequence | A broken screen has one plausible cause, not two. |

### RD-14 — Feature flag interface

| | |
| --- | --- |
| Status | Deferred |
| Decision | Consider adopting an open flag interface rather than any self-hosted flag server. The repository already evaluates flags on D1 against a context of actor, country, app version, plan, seller, and store. |
| Trigger | A second product surface needing flags outside the Worker, or a request for flag evaluation in a non-Worker runtime. |

### RD-15 — ORM

| | |
| --- | --- |
| Status | Deferred |
| Decision | Do not adopt an ORM as part of the redesign. Typed raw SQL against D1 is a legitimate answer at this scale. |
| Trigger | A separate architecture decision record with its own timeline, if the data layer becomes the bottleneck. |

## 6. Decisions taken by the owner

These were open, and the owner has now decided them. They are no longer
proposals, so no later round may reopen them without saying what changed.

### RD-16 — One design system, and the panel is moved onto it

| | |
| --- | --- |
| Status | Decided by the owner |
| Decision | Unify the two design systems in the admin panel. `apps/admin-web/src/shared/ui/*` becomes the kit; the twenty-one files that hand-roll `.button`, `.field`, `.panel` and `.modal` are moved onto it, and the duplicate CSS is deleted rather than left beside it. |
| Evidence | `docs/redesign/recon/admin-panel-audit.md` §11 — the Radix kit is imported by exactly one page while twenty-one files hand-roll the same primitives; five of six modals are hand-rolled. |
| Consequence | The kit absorbs `DataTable`, `PageHeader`, `ConfirmAction` and the four states, so the one-pattern-per-job rules have something real to point at. `components.json` must be corrected in the same change: its aliases do not match `@/shared/ui`. |
| Order | After the Android surface work, not before: the Android side has a broken file blocking it and the panel does not. |
| Executed | **One kit, one set of primitives.** The kit files were hand-rolling the primitives the kit exists to provide: `confirm.tsx` drew its own `div.modal-backdrop` with a `section.modal` and a manual Escape listener while `dialog.tsx` exported a Radix dialog, and `Page.tsx` wrote `<button className="button">` for its retry. Both are on the kit now — Radix brings `aria-modal`, a real focus trap, scroll lock and portalled rendering. `components.json` is corrected and guarded, because aliases pointing at `@/components/ui` would have let the next `shadcn add` write a third component set. |
| Executed | **The type roles are complete.** 21 rules carried 650/700/800/900 and the kit carried five `font-semibold` classes; each element now takes the weight of the role whose size it already used. The scale's own rule — 400 or 500, never one role's size with another's weight — is now enforced by `verify-admin-token-conformance.mjs`, whose every ceiling (type size, radius, duration, weight, unknown variable, weight class) is zero. |
| Remaining | **Nothing.** 127 hand-rolled usages across 13 files, down to **0**, and the guard's ceiling map is now empty — the ratchet became the absolute rule it was walking towards. Two primitives the kit was missing are in it now: `field.tsx` (46 call sites wanted it) and `textarea.tsx`, which also carries `NativeSelect` — a styled native `<select>`, deliberately not the Radix one beside it, because every `.field select` was a plain form control with an `onChange` and swapping it would have been a behaviour change dressed as a consolidation. The duplicate CSS is deleted: 20 rules removed and 3 mixed selectors rewritten to their live part, because `.panel.spaced, .resource-group` and `.field input, …, .search-box input` each had a live class that deleting the line would have taken with it. Verified by `tsc`, 29 unit tests, `oxlint` and 6 Playwright tests. |

### RD-17 — Every Android screen is rebuilt, and features move to where they belong

| | |
| --- | --- |
| Status | Decided by the owner |
| Decision | Rebuild all twenty-eight screens against the design system, and move features that sit in the wrong place to the place their job implies. This is the information-architecture change the audit asked for, now authorised. |
| Evidence | `docs/redesign/recon/android-ui-audit.md` §3 and §4: daily actions two levels deep in Account, the Account surface stacking two app bars, surfaces that are not routes so a tab switch discards its state, and Back from a non-Today surface exiting the app. |
| Consequence | Work is done surface by surface with the owner reviewing renders, not in one pass: `docs/ux/feature-surface-map.md` already routes all 242 catalog features to one of five surfaces, so a feature that seems misplaced has a documented home. The five surfaces stay (RD-02); what moves is what sits inside them. |
| Constraint | Every screen keeps the states its contract declares, and each rebuilt surface regenerates its own baselines for review. The 1,572-line file holding nine screens is split before it is touched. |

### RD-18 — Spacing and radius literals are moved onto the tokens, and guarded

| | |
| --- | --- |
| Status | Decided — an existing invariant, enforced |
| Decision | Every distance and every corner in the Android app names a design-system token. A padding, a `spacedBy` or a Spacer dimension must read `LocalOrderakSpacing.current`; a corner comes from `MaterialTheme.shapes` (or `Shapes.full`). The four measurements that are not rhythm — `minimumTouchTarget`, `fabClearance`, `thumbnail`, and the icon group — are named in `OrderakSpacing` with the reason beside each. |
| Authority | No product decision was taken here: `docs/domains/design-system-reference.md` already said "Never invent a colour, spacing value, type size, radius, duration or shadow", and `tooling/repository/verify-android-motion-tokens.mjs` recorded the gap in its own header — this migration "is real and still open; it needs a token set first". The token set exists, and the redesign authorisation covers executing it. |
| Evidence | Before: 152 raw literals in spacing positions across 24 files, 14 hand-written radii, and 46 of the spacing literals in the two flows a new seller meets first (authentication, shop setup). Most were off the scale entirely — 6, 10, 14, 18, 22, 28, 30 — so two screens meant to share a rhythm each had their own. After: 191 spacing positions read a token, 0 literals, 0 hand-written radii. |
| Consequence | A value is snapped to the nearest token, and a tie rounds up the scale (6→8, 10→12, 14→16, 20→24, 28→32) because a hair more room never clips an Arabic ascender while a hair less can. That is a visible change on every surface, so every affected baseline is regenerated and the owner reviews the renders. |
| Guard | `tooling/repository/verify-android-spacing-tokens.mjs`, wired into `.github/workflows/docs-ci.yml`. It reads the allowed values out of `OrderakSpacing` rather than restating them, so adding a token needs no second edit and deleting one fails every call site. |
| Deliberately out of scope | `size(96.dp)` ad images, `height(56.dp)` buttons, `heightIn(max = 420.dp)` scroll caps and the 720dp breakpoint are the size of one thing, not a distance between two, so the guard leaves them alone. The two that repeat enough to matter are named in `OrderakLayout` (560dp reading measure, 720dp breakpoint) because eight copies are eight places to miss, but that is a judgement about importance rather than a rule a guard could enforce. |

### RD-19 — The catalogue slug belongs to the store surface

| | |
| --- | --- |
| Status | Decided — by evidence, after the two written authorities disagreed |
| Decision | The catalogue slug is edited on the store surface only, by `StoreInfoScreen`. The account surface shows the published link read-only and no longer carries a slug field. |
| Why it was open | The feature-surface map assigns `products_catalog.custom_catalog_slug` to **store** as a FIELD; the `account` screen contract listed "public slug" among its own data. Both are authorities, so the decision log carried it as a question for the owner rather than letting either one win by preference. |
| Evidence that settled it | The code, not the paperwork. **Two editors existed and only one could work.** `StoreInfoScreen` queries `/api/v1/slug/check`, reports available / taken / reserved / network, and keeps Save disabled until the name is free. The account surface's field had no check at all: it wrote to local storage, `savePayout` triggered a refresh, and `SellerRefresher.refresh()` pushed the value through `api.register` — which returns early on `!reg.ok`. A taken name therefore failed the entire registration, **stopping every pull and push behind it**, while the snackbar said "Payout details saved". The seller's feedback and the truth came from different places. So there was no working behaviour on the account side to preserve, and the map's assignment agreed with the implementation that works. |
| Consequence | The account surface keeps the published link as information — knowing your public URL is the account's business — and loses the ability to change it. `tooling/ux/screen-contracts.mjs` records the slug as `published catalogue link (read-only)` and its action as `save payout`, so the generated contract document follows. Every affected account render is regenerated. |
| Guard | `tooling/ux/verify-slug-authority.mjs`, wired into `.github/workflows/docs-ci.yml`. It asserts three things that cannot be allowed to come apart: exactly one file calls `saveSlug`, that file also calls `checkSlug`, and `AccountContent.kt` renders no slug editor. Verified to fail when a second editor is reintroduced. |
| Rejected alternative | Leaving the field and adding an availability check to it. It would have meant two server-checked editors for one value — more code, two places to keep in step, and the same "which one do I use?" question for the next feature that touches the store's identity. |

## 5. Open questions carried into Phase 0

These are questions, not decisions. Each is closed by evidence, and each blocks
the phase named beside it.

| # | Question | Blocks | Closed by |
| --- | --- | --- | --- |
| Q1 | Which admin operations exist in the Worker with no panel consumer, and which panel sections have no live consumer? | Phase 4 | Admin panel audit |
| Q2 | Which backend capabilities have no live caller in the app, the panel, or the public site? | Phase 5 | Backend inventory |
| Q3 | Which UI literals bypass the token system on each surface, and how many? | Phase 3 | **Closed** — Phase 0 scan: 152 spacing-position literals in 24 Android files, 14 hand-written radii, 46 of them in the auth and shop-setup flows, plus 278 raw `.dp` literals counting sizes. The Android half is migrated and guarded (RD-18); the admin half was measured at 71 font sizes and 55 radii and is migrated with its ceilings at 0. |
| Q4 | Does the pending design-system snapshot activation interact with a redesign that changes tokens? | Phase 1 | Design-system domain review |
| Q5 | Which fonts are subset at build time, and does the output preserve the licence obligations? | Phase 1 | Font pipeline audit |
| Q6 | Is any geo data derived from a share-alike database licence bundled into a shipped artifact? | Phase 1 | Third-party register review |
| Q7 | Exactly which licences are unconfirmed in the open-source evaluation, and do any verdicts depend on them? | Phase 1 | Licence verification pass |
| Q8 | What is the current count of screenshot cases, so the redesign's delta is provable? | Phase 6 | Phase 0 baseline |
| Q9 | What are the current tap counts for the app's three primary tasks? | Phase 2 | Phase 0 measurement |
| Q10 | Which shared UI patterns are duplicated across the three surfaces today? | Phase 2 | Phase 0 pattern scan |
