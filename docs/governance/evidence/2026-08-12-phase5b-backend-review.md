---
status: archived
generated: false
owner: backend
last_verified: 2026-08-12
applies_to: [production, staging]
---
# Phase 5b — code review, all four deployable units

Phase 5b lists six criteria per deployable unit. Two were satisfied during
Phase 4 and recorded there; the other four had not been done. This is that
work for `services/backend`, where all six bite, followed by the other three
units.

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

## 2. Error handling, retries, idempotency, timeouts

The criterion is "documented **where they exist**". The finding is that they
exist far more thoroughly than the absence of documentation suggested: the
reliability work was done and tested, and simply never written down in one
place. What follows is that record, plus three genuine gaps the reading
surfaced.

### Retries — queue consumers

Both consumers retry explicitly per message; neither uses `retryAll()`.

| Surface | Backoff | Ceiling |
| --- | --- | --- |
| Play verification (`admin-worker.ts:136`) | server-supplied `retryAfterSeconds` | 6 h, floor 30 s |
| Play consumer, unexpected throw (`:146`) | flat 30 s | — |
| Admin export (`:175`) | `30 × 2^(attempts-1)` | 1 h |
| Email (`public-worker.ts:503`) | `30 × 2^(attempts-1)` | 1 h |

Attempt counts are bounded by the platform, not the code, and **every
consumer sets the bound explicitly — none inherits the default**:

| Queue | `max_retries` | DLQ |
| --- | --- | --- |
| `orderak-play-billing` | **8** | `orderak-play-billing-dlq` |
| `orderak-email` | 5 | `orderak-email-dlq` |
| `orderak-admin-exports` | 3 | `orderak-admin-exports-dlq` |
| all three DLQs | 3 | — (terminal) |

The gradient is the design: Play billing is the money path and gets the most
attempts, admin exports are operator-initiated and re-runnable so they get
the fewest. Each `-staging` variant carries identical settings, so a staging
rehearsal exercises the same retry behaviour production will.

Exhaustion routes to a DLQ whose consumer's only job is to record the
terminal state —
`markPlayVerificationDeadLetter`, `markExportDeadLetter` — then `ack()`. A
dead-lettered Play job is recoverable by an operator: `google-play.ts:856`
requeues it, and refuses unless the job is genuinely in `dead_lettered`.

**Malformed messages are acked, not retried** (`admin-worker.ts:127`,
`:160`). Correct — a message that fails to parse will fail identically on
every attempt, so retrying it only delays the batch. Likewise an unknown
queue name acks the whole batch after logging `unknown_admin_queue`, rather
than poisoning a queue this Worker cannot service.

### Idempotency

Four distinct mechanisms, each matched to its surface:

1. **Client-supplied key** — billing checkout reads `x-idempotency-key`,
   falling back to a body field (`billing.ts:228`), then looks up
   `subscriptions WHERE idempotency_key = ? AND seller_id = ?` and returns
   the *same* subscription rather than creating a second. Scoping the lookup
   by seller means one seller's key cannot collide with another's.
2. **Entitlement ledger keys** — `entitlements.ts:519-560` keys a delta on
   `(organization_id, entitlement_key, idempotency_key)`.
3. **Terminal-state guards** — Play verification refuses to re-process a job
   already in `succeeded`, `terminal_failed`, `superseded` or
   `dead_lettered` (`google-play.ts:649`, and again at `:663` after the
   external call, closing the window where two isolates raced).
4. **`ON CONFLICT` upserts** — 15 modules, including the RTDN message-ID
   dedupe.

The buyer-facing order form is idempotent too, and from the *client* side:
the generated catalogue page sends `idempotency-key: orderKey`
(`catalog.ts:217`), so a double-tap on a flaky mobile connection cannot
create two orders.

### Leases and crash recovery

Long-running work is claimed under a lease rather than a lock, so a Worker
that dies mid-job does not strand it. `billing-reliability.spec.ts` covers
exactly this: one atomic claimant wins, an active lease reads as
unavailable, an expired lease is reclaimed, and the original holder's
now-stale claim token is rejected as a zombie. A cron sweep
(`dispatchPendingPlayJobs`, `sweepUndispatchedEmails`) redispatches anything
that was claimed but never completed.

Email uses an outbox: the job is committed to D1 **before** it is queued, and
the message carries only an id. `email-outbox.spec.ts` pins the two
properties that matter — a failed `Queue.send` keeps the job instead of
losing it, and the consumer sends *what the record says, not what the message
says*, so a forged or stale message body cannot redirect an email.

### Circuit breaker

`platform/resilience/provider-circuit.ts` guards `google_play` and
`deepseek`. State lives in D1 rather than in memory, deliberately — the
comment states the reason: D1 is the shared authority across isolates, so
one isolate's open circuit is not re-learned independently by every other.
Opens after five retryable failures, allows exactly one half-open probe under
a lease, and returns `retryAfter` to the caller. Verified by test, not by
reading: `"opens after five retryable failures and allows one half-open
recovery probe"`.

### Timeouts — and the three gaps

Outbound calls that are bounded: DeepSeek at 20 s (`deepseek.ts:156`), and
every Google Play call through `timeoutSignal()`, also 20 s
(`google-play.ts:127`).

Three server-side calls carry **no timeout at all**:

| Call | File | Context |
| --- | --- | --- |
| Firebase OAuth token | `deletion.ts:373` | cron |
| `accounts:lookup` | `deletion.ts:392` | cron |
| `accounts:delete` | `deletion.ts:402` | cron |

A fourth, `api-store.ts:153` (`accounts:lookup` for remote ID-token
verification), is also unbounded and is the one in a **request** path. Its
blast radius is limited by a `try/catch` that returns `null` — the request
fails closed as unauthenticated rather than hanging open — but the hang
itself is unbounded until the platform kills it.

The `deletion.ts` three run under `runObservedJob(env, "deletions", …)` on
cron, so a hang stalls the deletion sweep rather than a user request. That
still matters: deletion carries a 90-day statutory deadline, and the sweep is
what meets it. **Recorded, not fixed** — adding a timeout changes runtime
behaviour on a compliance path, which is precisely what Rule 1 defers past
cutover. Flagged for Phase 10 with the note that `timeoutSignal()` already
exists and is the obvious import.

Two things checked that turned out *not* to be gaps: `catalog.ts:217` is
browser JavaScript inside a generated HTML page, not Worker code, so a
server-side timeout is not the applicable control; and `auth-v2.ts:664,749`
`timeout: 60_000` is the **WebAuthn ceremony** timeout passed to the
authenticator, not a network timeout. Both match a `grep` for timeouts and
neither belongs in this table.

### One documented claim that the code does not clearly support

`deletion.ts:126-128` carries the comment: *"The operation treats an
already-absent user as success, making retries safe."* That holds on one
path — when the UID is unknown, `accounts:lookup` returns no user and the
function returns early. It is **not** evident on the other: when
`seller.firebase_uid` is already known, the code calls `accounts:delete`
directly and throws on any non-OK response (`:406`). Whether Google returns
OK for deleting an already-deleted UID decides whether the comment is true,
and that was **not verified here** — asserting either way without testing
against the live Identity Toolkit would be exactly the assumption this review
is meant to avoid. Recorded as a claim requiring verification, not as a
defect.

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
| 2 — error handling documented | Pass — documented above; 4 unbounded fetches and 1 unverified comment logged for Phase 10 |
| 3 — no PII in logs/queues/DO names | Pass |
| 4 — structured logs only | **Violated** — 20 sites, recorded for Phase 10 |
| 5 — dry-run clean | Pass |
| 6 — type-check clean | Pass |

## The other three units

### apps/admin-web

**Criterion 4 — structured logs: not applicable, and passes trivially.** Zero
`console.*` calls across 46 source files.

**Criterion 3 — PII: the real surface is not logging.** `src/app/main.tsx`
initialises Sentry with `replayIntegration()`, and Session Replay records the
DOM. In an admin panel that DOM contains seller phone numbers and buyer
contact data — L2 under `logging-standard.md` §2. The sample rates are
`replaysSessionSampleRate: 0.01` and **`replaysOnErrorSampleRate: 1.0`**, so
every session that hits an error is captured in full.

Three facts that together make this a recorded risk rather than a live leak:

1. **Text is masked by default.** `maskAllText = true` is the constructor
   default in the installed `@sentry/replay` (verified by reading
   `node_modules/@sentry/replay/build/npm/cjs/index.js`, not from the docs).
2. **No masking option is set in our config.** The protection is entirely the
   SDK default, with nothing written down that would survive an SDK upgrade
   changing it.
3. **Nothing is being sent.** `dsn: import.meta.env.VITE_SENTRY_DSN`, and no
   Sentry variable or secret exists in any environment, so `Sentry.init` is
   inert.

The exposure is therefore latent, not active — but it activates the moment
someone sets `VITE_SENTRY_DSN`, with no review gate between that and 100%
error-session DOM capture. Recorded as a prerequisite on enabling Sentry:
set the masking options explicitly first, rather than inheriting them.

### apps/seller-android

**Criteria 3 and 4: pass.** Ten `Log.*` call sites in `app/src/main`. None
carries a phone number, token, OTP or password.

The one that looked like it might, `FirebaseAuthRepository.kt:97`, logs
`"OTP send failed: ${failure.failure.name}"` — a failure *category* enum, not
a code — and is wrapped in `if (BuildConfig.DEBUG)`. The rest are ad-loading
state, a feature/plan/status line in `UsageLogger`, generic passkey failure
messages, and a routing line carrying trigger name, decision name and a
duration in milliseconds.

### contracts

**Criteria 3 and 4 do not apply.** The unit is OpenAPI specifications and
generated TypeScript types; it has no runtime, no logging, and no Durable
Objects. Criteria 5 and 6 are covered by `pnpm run openapi:check`, which
lints, validates, checks examples and route coverage, and rebuilds the
bundles — executed and passing in the Phase 5a pass.

## Criterion 2 for the other three units

### apps/admin-web

Retries are TanStack Query's, configured once in `main.tsx:24`:
`retry: 1`, `staleTime: 30_000`, `refetchOnWindowFocus: false`. One
automatic retry per query — deliberate for an admin panel, where a silently
re-fired mutation is worse than a visible error.

Error handling is uniform and user-facing rather than swallowed: every page
renders `<ErrorState error={…} retry={() => query.refetch()} />`, so a failed
read is always recoverable by the operator without a reload. Destructive
actions are gated behind `confirm()` — deletion retry, job runs, invitation
revocation.

**No timeout is set on the fetch wrapper.** A hung admin request spins
indefinitely; the query never rejects, so `ErrorState` never renders. Same
class of gap as `api-store.ts`, lower stakes, recorded for Phase 10.

There is no client-side idempotency key on admin mutations. It is not needed
for reads, and the one mutation where duplication would matter — deletion
retry — is guarded server-side by the deadline and verification checks the
button's own confirm text names.

### apps/seller-android

The most complete of the four, because it is the one that runs on an unreliable
network by default.

**Timeouts are explicit**, set once in `NetworkModule.kt:23-25`: connect,
read and write all 30 s, with `cache(null)`. Nothing relies on OkHttp's
defaults.

**Retries are WorkManager's**, and the two workers bound them differently
on purpose:

- `SyncWorker` bounds by attempt count — `Result.retry()` only while
  `runAttemptCount < 3` (`:24`, `:32`), then gives up.
- `BillingVerificationWorker` does **not** bound by count. It retries under
  `BackoffPolicy.EXPONENTIAL` from 15 s (`:53`) and stops only when the
  *server* says to: `decideBillingVerification` returns `Succeeded`,
  `Retry` or `Terminal`, and only `Retry` re-enqueues (`:93-110`).

That asymmetry is right, not an oversight. A sync that fails three times is
a client problem; a purchase awaiting Google's verification must not be
abandoned by a client-side counter while the entitlement is still pending —
the authority on when to stop is the backend, which is the position
`adr-006-authoritative-play-verification.md` takes. Idempotency is the
`verificationId`, persisted in `sessionStore` with its `retryAt`, so a
process death resumes the same verification rather than starting a new one.

### contracts

Not applicable. No runtime, no outbound calls, nothing to retry.

## Remaining

Nothing on criterion 2. The Phase 10 backlog it produced:

1. Four unbounded outbound fetches — `deletion.ts:373,392,402` and
   `api-store.ts:153`. `timeoutSignal()` already exists in the codebase.
2. No timeout on the admin-web fetch wrapper.
3. Verify whether `accounts:delete` on an already-deleted UID returns OK,
   and either keep or correct the retry-safety comment at `deletion.ts:126`.
