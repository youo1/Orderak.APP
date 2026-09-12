---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Findings register

Findings record observed control gaps or verification results. Closure requires
accepted evidence and, for a defect or vulnerability, independent retest.

| ID | Observation | Severity | Owner | Affected gate | Status | Required closure evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `FND-001` | Backend tests and Android unit/lint/protected-contract checks were observed passing on 2026-07-18, but durable output tied to a commit is not stored | Medium evidence gap | QA / release lead | G0/G6 | Open | CI or sanitized command output with commit/build and scope |
| `FND-002` | D1 and R2 were observed in `WEUR`; D1 jurisdiction is `null` | Critical architecture/privacy finding | CTO + privacy lead | G3 | Open — not verifiable from the repository (checked 2026-09-12) | Approved transfer/hosting decision, filings/DPAs, architecture and migration evidence as required |
| `FND-003` | Android compileSdk and targetSdk are 35 | High release finding | Mobile + release lead | G6/G9 | Open | API 36 build, Android 16 regression, final AAB and Play evidence |
| `FND-004` | Source main manifest declares only `android.permission.INTERNET`; final merged release manifest is not recorded | Medium release evidence gap | Mobile + privacy lead | G6/G9 | Open | Merged release manifest and SDK component/permission disposition |
| `FND-005` | Google Play Billing client code exists, but complete backend token validation and entitlement lifecycle are not evidenced | Critical if paid acquisition reopens | Product + services/backend/mobile + finance | G4/G6 | Contained for free launch; G4 approval pending. Containment re-confirmed 2026-09-12 (`BILLING_ENABLED` and `GOOGLE_PLAY_LIFECYCLE_ENABLED` are `"false"` in both environments); the lifecycle itself needs a runtime exercise and stays unevidenced | ADR-004, default-off production flags, fail-closed tests; full lifecycle evidence before any paid re-enable |
| `FND-006` | Current public legal documents identify the existing individual operator and do not evidence final company/DPO/transfer decisions | Critical legal/privacy finding | Executive sponsor + counsel + privacy lead | G2/G3/G6 | Open | Approved entity/operator and bilingual versioned documents with behavior reconciliation |
| `FND-007` | Release upload/Play signing fingerprints and physical-device production Firebase SMS evidence remain missing | High auth/release finding | Mobile + release lead | G6/G9 | Open | Console fingerprint records, signing/recovery plan, physical-device evidence |
| `FND-008` | Registered DPO, Egyptian counsel, accountant, and several control-owner appointments are not evidenced | Critical governance/compliance finding | Executive sponsor | G0-G3 | Open | Named acceptance plus restricted appointment/engagement references |
| `FND-009` | Restricted evidence vault and chain-of-custody/access model are not selected | High evidence handling finding | Executive sponsor + security | G0 | Open | Approved vault, two admins, access matrix, retention/backup/recovery evidence |
| `FND-010` | Independent penetration test, cloud configuration review, restore test, incident tabletop, and policy-to-practice audit are not complete | Critical assurance finding | Security + QA + cloud + privacy | G7 | Open | Accepted reports, retests, restore result, exercise record, and closed findings |
| `FND-011` | Account-deletion automation was recorded as absent. Re-verified against `36a90a8` on 2026-09-12: every one of the four observations is now false — see the note below | Critical privacy/release finding | Backend + privacy + security + QA | G3/G6/G7/G9 | Remediation observed 2026-09-12; closure pending independent retest | Independent retest of the four behaviours listed below, plus deadline alerting and Firebase/provider evidence, which remain unverified |

## FND-011: what was re-verified, and against what

The original observation made four claims. Each was checked against `36a90a8` on
2026-09-12 and none of them now holds:

| Original claim | Current state |
| --- | --- |
| "`scheduled()` invokes retention only" | `services/backend/src/entrypoints/public-worker.ts` dispatches four crons; deletion has its own, `2 3 * * *`, running `processDeletionRequests` through `runObservedJob` |
| "the admin handler is a stub" | `retryDeletionRequest` in `deletion.ts` is exported and wired into `admin-operations.ts`, reusing the same guarded fulfilment path — it never promotes a pending request to verified and never bypasses the deadline |
| "external cleanup is incomplete" | `fulfillDeletion` purges the store's R2 prefix and then re-lists it, throwing `deletion_r2_verification_failed` if anything remains; Firebase identity removal fails closed on missing credentials |
| "completion can follow best-effort failures" | Marking the request `completed` is one statement inside the same `env.orderak_db.batch()` as the rest of the D1 cleanup, and the batch rethrows. A failed fulfilment leaves `status='verified'` and is retried on the next run |

This entry is **not closed**. The closure workflow below requires independent
retest for a defect, and this re-verification was performed by the same pass that
found the drift. Deadline alerting and Firebase/provider evidence were not
checked at all and remain genuinely open.

### Why this is recorded rather than quietly corrected

The register is the artifact a gate review reads, and its value depends entirely
on being current. A stale entry costs engineering time re-investigating a solved
problem — but the symmetric failure is the one that matters: an entry that has
silently become *understated* looks identical from the outside. Correcting this
row without saying what changed would leave no way to tell the two apart next
time.

An open row should carry the date it was last checked against the tree, so the
distance between a finding and the code it describes is visible rather than
assumed.

## Closure workflow

1. Owner records root cause, affected requirements/releases/data, and treatment.
2. Reviewer confirms the proposed fix does not create another uncontrolled change.
3. Owner implements through an approved change and attaches evidence.
4. Independent reviewer retests or validates the control.
5. QA/release lead records closure date, reviewer, residual risk, and gate impact.
6. Critical/High closure is reviewed at the executive risk committee.

No finding may be downgraded or closed solely to permit a release date.
