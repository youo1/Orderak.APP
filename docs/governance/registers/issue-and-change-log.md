---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Issue and change log

## Issue log

| ID | Issue | Severity / gate | Owner | Due | Next action | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `ISS-001` | Named engineering, security, QA/release, operations, support, and specialist owners have not accepted assignments | Blocker / G0 | Executive sponsor | 2026-07-22 | Name assignees, deputies, authority, and acceptance evidence | Blocked |
| `ISS-002` | Phase 0 charter has not been approved | Blocker / G0 | Executive sponsor | 2026-07-20 | Decide approval/conditions in charter approval record | Ready for decision |
| `ISS-003` | Temporary freeze acknowledgements are incomplete | Blocker / G0 | Acting program lead | 2026-07-22 | Circulate control and record acknowledgements | In progress |
| `ISS-004` | Restricted evidence vault and access/retention model are not selected | Blocker / G0 | Executive sponsor + security | 2026-07-22 | Select company-controlled vault and two administrators | Open |
| `ISS-005` | Egyptian counsel and accountant engagements/scopes are not evidenced | Critical path / G1-G2 | Executive sponsor | 2026-07-31 | Appoint qualified advisers and store restricted engagement evidence | Open |
| `ISS-006` | Registered DPO candidate and appointment path are not evidenced | Critical path / G3 | Executive sponsor + privacy lead | 2026-08-03 | Select candidate and confirm registration/appointment requirements | Open |
| `ISS-007` | Cross-border hosting/transfer decision is unresolved | Critical / G3 | Executive sponsor + counsel + CTO | 2026-08-14 | Complete map/options and approve filing/migration/retention path | Open |
| `ISS-008` | Android compile/target SDK remains 35 | High / G6-G9 | Mobile + release lead | 2026-08-14 | Implement API 36 upgrade and complete regression evidence | Open |
| `ISS-009` | Release/Play signing fingerprints and physical-device production OTP evidence are missing | High / G6-G9 | Mobile + release lead | 2026-08-14 | Complete signing plan, Firebase registration, and physical-device test | Open |
| `ISS-010` | Future merchant billing channel and server entitlement lifecycle are unresolved; free-launch acquisition is disabled | Critical if paid scope reopens / G4-G6 | Product + finance + counsel | Before paid change | Approve future paid design and complete ADR-004 re-enable evidence | Contained for free launch; approval pending |
| `ISS-011` | Company incorporation/interim operating status is not evidenced | Critical / G2 | Executive sponsor + counsel | 2026-08-03 | Select legal form and begin/confirm GAFI process | Open |
| `ISS-012` | Durable CI output for the 18 July automated baseline is not stored | Medium / G0 evidence quality | QA / release lead | 2026-07-26 | Rerun in CI or attach sanitized command output tied to commit | Open |
| `ISS-013` | Account-deletion intake exists, but fulfillment is not scheduled or safely operator-triggered; Firebase deletion and partial-failure handling are incomplete | Critical privacy/release blocker / G3-G7 | Backend + privacy + security + QA | Before production | Implement an approved idempotent workflow, reconcile the retention matrix field by field, test failures/retries, and capture completion evidence | Open |

## Change log

| ID | Date | Proposed change | Risk / scope | Required approvers | Status | Evidence / rollback |
| --- | --- | --- | --- | --- | --- | --- |
| `CHG-001` | 2026-07-18 | Establish Phase 0 governance package under `docs/governance/` and link it from repository documentation | Low; documentation/governance only; no product/auth/localization behavior change | Acting program lead; executive ratification for charter authority | Implemented; approval pending | Repository diff; remove links/files to roll back before approval |
| `CHG-002` | 2026-07-18 | Freeze Phase 4 free-launch scope and make billing acquisition and seller AI fail closed by default | Medium; product/API configuration and documentation; no auth/localization contract change | Product, counsel, DPO, security, finance; downstream release approval | Implemented engineering baseline; G4 approval pending | Phase 4 artifacts, Worker tests, revert flags/code/docs before deployment to roll back |
| `CHG-003` | 2026-07-19 | Establish documentation authority order, archive source plans/history, and correct verified operational documentation claims | Low; documentation only; no runtime, auth-contract, or localization-contract behavior change | Repository owner; specialist owners for legal/security claims | Implemented; specialist review pending | Repository diff; originals retained in unpublished repository history |
| `CHG-004` | 2026-07-19 | Implement organization-scoped, versioned subscription plans, typed entitlements, administrator-controlled limits, numeric device caps, optional storefront locales, and a server-verified Google Play billing lifecycle | High; product, billing, authentication, localization, D1 schema, Android, administration, security, legal, finance, privacy, operations, and release scope; local development only | Product and protected-contract owner for implementation; finance, counsel, privacy/DPO, security, services/backend/mobile, QA, operations, and release before production activation | Approved for local implementation by the repository owner in the 2026-07-19 Codex task; production activation blocked pending the remaining approvals and ADR evidence | Approved implementation plan in the Codex task; migrations and automated tests; billing remains fail-closed; rollback by disabling `ENTITLEMENTS_ENABLED`/`BILLING_ENABLED` and restoring the prior published plan revision |

## New change template

Add a row before implementation with:

- requirement and business value;
- affected data, roles, vendors, SDKs, permissions, policies, architecture,
  environments, tests, and gates;
- alternatives and least-risk option;
- security, privacy, legal, financial, operational, and user impact;
- migration, rollback, monitoring, and communication plan;
- required approvers and actual dated decisions;
- test/evidence links and post-change review result.

An emergency containment action follows the emergency process in the
[temporary freeze](../temporary-change-freeze.md#emergency-process) and is
entered here within one business day.
