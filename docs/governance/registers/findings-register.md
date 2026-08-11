# Findings register

Findings record observed control gaps or verification results. Closure requires
accepted evidence and, for a defect or vulnerability, independent retest.

| ID | Observation | Severity | Owner | Affected gate | Status | Required closure evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `FND-001` | Backend tests and Android unit/lint/protected-contract checks were observed passing on 2026-07-18, but durable output tied to a commit is not stored | Medium evidence gap | QA / release lead | G0/G6 | Open | CI or sanitized command output with commit/build and scope |
| `FND-002` | D1 and R2 were observed in `WEUR`; D1 jurisdiction is `null` | Critical architecture/privacy finding | CTO + privacy lead | G3 | Open | Approved transfer/hosting decision, filings/DPAs, architecture and migration evidence as required |
| `FND-003` | Android compileSdk and targetSdk are 35 | High release finding | Mobile + release lead | G6/G9 | Open | API 36 build, Android 16 regression, final AAB and Play evidence |
| `FND-004` | Source main manifest declares only `android.permission.INTERNET`; final merged release manifest is not recorded | Medium release evidence gap | Mobile + privacy lead | G6/G9 | Open | Merged release manifest and SDK component/permission disposition |
| `FND-005` | Google Play Billing client code exists, but complete backend token validation and entitlement lifecycle are not evidenced | Critical if paid acquisition reopens | Product + services/backend/mobile + finance | G4/G6 | Contained for free launch; G4 approval pending | ADR-004, default-off production flags, fail-closed tests; full lifecycle evidence before any paid re-enable |
| `FND-006` | Current public legal documents identify the existing individual operator and do not evidence final company/DPO/transfer decisions | Critical legal/privacy finding | Executive sponsor + counsel + privacy lead | G2/G3/G6 | Open | Approved entity/operator and bilingual versioned documents with behavior reconciliation |
| `FND-007` | Release upload/Play signing fingerprints and physical-device production Firebase SMS evidence remain missing | High auth/release finding | Mobile + release lead | G6/G9 | Open | Console fingerprint records, signing/recovery plan, physical-device evidence |
| `FND-008` | Registered DPO, Egyptian counsel, accountant, and several control-owner appointments are not evidenced | Critical governance/compliance finding | Executive sponsor | G0-G3 | Open | Named acceptance plus restricted appointment/engagement references |
| `FND-009` | Restricted evidence vault and chain-of-custody/access model are not selected | High evidence handling finding | Executive sponsor + security | G0 | Open | Approved vault, two admins, access matrix, retention/backup/recovery evidence |
| `FND-010` | Independent penetration test, cloud configuration review, restore test, incident tabletop, and policy-to-practice audit are not complete | Critical assurance finding | Security + QA + cloud + privacy | G7 | Open | Accepted reports, retests, restore result, exercise record, and closed findings |
| `FND-011` | Account-deletion documentation claimed preferred automation, but `scheduled()` invokes retention only, the admin handler is a stub, external cleanup is incomplete, and completion can follow best-effort failures | Critical privacy/release finding | Backend + privacy + security + QA | G3/G6/G7/G9 | Open | Approved workflow, code-to-matrix reconciliation, integration tests for partial failure/retry, Firebase/provider evidence, deadline alerting, and independent retest |

## Closure workflow

1. Owner records root cause, affected requirements/releases/data, and treatment.
2. Reviewer confirms the proposed fix does not create another uncontrolled change.
3. Owner implements through an approved change and attaches evidence.
4. Independent reviewer retests or validates the control.
5. QA/release lead records closure date, reviewer, residual risk, and gate impact.
6. Critical/High closure is reviewed at the executive risk committee.

No finding may be downgraded or closed solely to permit a release date.
