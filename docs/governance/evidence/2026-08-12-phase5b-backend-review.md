---
status: current
generated: false
owner: backend
last_verified: 2026-08-12
applies_to: [production, staging]
---
# Phase 5b — backend code review

Phase 5b lists six criteria per deployable unit. Two were satisfied during
Phase 4 and recorded there; the other four had not been done. This is that
work for `services/backend`, the unit where all six actually bite.

**Governing Rule 1 applies throughout:** migration preserves behaviour, and
modernization happens after cutover. Findings below are therefore *recorded*
unless they are a live defect. Cleaning up code because it offends a checker
is exactly the change this phase is not for.

## 1. Every exported symbol reachable, or explained as deliberately dead

308 exported symbols. **71 are referenced nowhere else in `src`, `test` or
`scripts`.** By declaration kind:

| Kind | Count |
| --- | --- |
| `interface` | 32 |
| `type` | 16 |
| `function` | 17 |
| `const` | 5 |
| `class` | 1 |

**"Unreferenced" is not the same as "dead", and the difference matters.**
`AdminRow` is exported and used on line 100 of its own file
(`type SessionRow = AdminRow & {…}`). The check deliberately ignores
same-file use, so what it really finds is symbols exported more widely than
they are used — a narrowing opportunity, not dead code. That is a Phase 10
cleanup, not a migration change.

### The one that looked alarming, and was not

`handleDeletionRoutes` is exported from `domains/identity/deletion.ts` and
referenced by nothing at all. A route handler nothing mounts would mean
account deletion is unreachable — a compliance failure, not a tidiness one.

Checked against the live system rather than the code:

```text
POST /api/v1/account/deletion-request   -> 401   (route exists, auth required)
GET  /api/v1/plans                      -> 403   (known-good, for comparison)
GET  /api/v1/definitely-not-a-route     -> 404   (genuinely unrouted)
```

401, not 404 — the route is wired. `handleDeletionRoutes` turns out to be a
stub that unconditionally returns `null`, carrying a comment that routing
moved into `api-store.ts` "because the store auth interceptor already
protects it". It therefore satisfies the criterion's own escape clause:
**explained as deliberately dead.** Left in place under Rule 1; a candidate
for deletion in Phase 10.

## 2. Error handling, retries, idempotency, timeouts — NOT DONE

This criterion is not satisfied and is not claimed to be. It needs a
per-surface reading rather than a scan, and the honest position is that it
remains outstanding rather than partially inferred from the code that
happened to be opened for the other criteria.

## 3. No PII in logs, queues, or Durable Object names

**Durable Object names: pass, and deliberately so.** `rateLimiterStub`
hashes the bucket before naming the object, because buckets embed the thing
being limited — `authfail:+201001234567`, `delete-request:ip:1.2.3.4`.
Naming objects after them directly would put phone numbers and IP addresses
into Durable Object identities, where the D1 retention job cannot reach
them. The pepper used is `BUYER_PRIVACY_PEPPER`, so an identifier is
peppered consistently wherever it is derived, and the object itself stores
no identifier. The reasoning is written into the source, not inferred here.

**Logs: no PII found.** 69 `console.*` call sites reviewed against the
never-log list in `docs/architecture/logging-standard.md` §2 (passwords, OTP
codes, payment credentials, private keys, JWT/session tokens, Firebase ID
tokens, E.164 phone numbers, buyer contact data, IP addresses).

The residual risk is indirect: several sites log a caught error object, and
a database error that echoed a bound parameter would leak whatever was
bound. Tested rather than assumed — a failing D1 statement with a phone
number bound returned:

```text
table sellers has no column named store_id: SQLITE_ERROR [code: 7500]
```

Column and table names, no bound values. That is consistent with SQLite's
documented behaviour but is **one observation, not a proof for every error
class**, and is recorded at that strength.

## 4. Structured logs only — VIOLATED, recorded not fixed

Of 69 call sites, **20 in hand-written source are unstructured** — plain
strings or template interpolation rather than a JSON object. Concentrated
in `domains/identity/deletion.ts` (7), `integrations/email/` (6),
`domains/commerce/billing.ts` (2), `platform/http/shared.ts` (2), and the
two generic `console.error("Admin error:", e)` handlers.

One apparent violation was a false positive worth recording, because the
same mistake will be made again by anyone grepping for this:
`google-play.ts:100` reads `console.info(record)`, but `record` is built by
`JSON.stringify` on the line above. A line-based grep calls it unstructured;
it is not. Counts above exclude it, and exclude the generated `.d.ts` files
whose doc comments mention `console.*`.

Not fixed here. Log format is behaviour, no PII is leaking through these
sites, and Rule 1 puts format changes after cutover. Recorded as a Phase 10
item with the file list above.

## 5. `wrangler deploy --dry-run` clean, both configs — pass

Verified during Phase 4 for `wrangler.jsonc` and `wrangler.admin.jsonc`.

## 6. Type-check clean — pass

`tsc --noEmit` exits 0. Re-confirmed 2026-08-12 after the audit key
versioning work, alongside 222 passing tests across 35 files.

## Status

| Criterion | Result |
| --- | --- |
| 1 — exports reachable or explained | Pass, with 71 over-exported symbols logged for Phase 10 |
| 2 — error handling documented | **Outstanding** |
| 3 — no PII in logs/queues/DO names | Pass |
| 4 — structured logs only | **Violated** — 20 sites, recorded for Phase 10 |
| 5 — dry-run clean | Pass |
| 6 — type-check clean | Pass |

The other three deployable units — `apps/admin-web`, `apps/seller-android`,
`contracts` — have not had this review. Criteria 3 and 4 are backend-shaped
and largely do not apply to the contracts unit, but that is a reason to
scope the review per unit, not to skip it.
