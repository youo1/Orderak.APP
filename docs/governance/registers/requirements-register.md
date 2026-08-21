---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Requirements, assumptions, and protected-contract register

## Confirmed Phase 0 requirements

| ID | Requirement | Source | Accountable owner | Status | Evidence / next action |
| --- | --- | --- | --- | --- | --- |
| `REQ-GOV-001` | Approve charter, scope, calendar, decision rights, and gate owners | `SRC-000`, `SRC-001` | Executive sponsor | Ready for evidence review | Approve [program charter](../program-charter.md) |
| `REQ-GOV-002` | Maintain controlled evidence and all core registers | `SRC-000`, `SRC-008`, `SRC-009`, `SRC-APP` | Program lead | Implemented | Review [evidence standard](../evidence-standard.md) and register index |
| `REQ-GOV-003` | Track requirements, assumptions, questions, ideas, and protected contracts | `SRC-000`, `SRC-006`, `SRC-APP` | Product owner | Implemented | This register; continue weekly review |
| `REQ-GOV-004` | Freeze unreviewed data, vendor, SDK, permission, transfer, logging, billing, AI, and regulated changes | `SRC-000`, `SRC-001`, `SRC-005`, `SRC-006` | Executive sponsor | Implemented; acknowledgement pending | [Temporary freeze](../temporary-change-freeze.md) and `ISS-003` |
| `REQ-GOV-005` | Operate weekly, fortnightly, monthly, and ad hoc governance forums | `SRC-000`, `SRC-007`, `SRC-009` | Program lead | Defined; scheduling pending | [Operating cadence](../operating-cadence.md) and `CAD-001` to `CAD-005` |
| `REQ-GOV-006` | Use controlled status and evidence-review workflow | `SRC-000`, `SRC-008`, `SRC-009`, `SRC-APP` | QA / release lead | Defined; owner pending | Produce first G0 gate pack |
| `REQ-GOV-007` | Give every workstream one accountable owner and blocking route | `SRC-000`, `SRC-001`, `SRC-009` | Executive sponsor | Blocked | `ISS-001`; complete [role register](../raci.md#role-assignment-register) |
| `REQ-GOV-008` | Maintain source-plan traceability | All source plans | Program lead | Implemented for Phase 0 | [Source-plan traceability](../source-plan-traceability.md) |
| `REQ-MKT-001` | Treat Egypt as the first commercial launch market, then expand through MENA and globally; keep shared engineering market-portable while gating each production market on readiness | Product owner direction, 2026-07-30 | Product owner | Approved product direction | App plan and architecture document the portability guardrails; define the first MENA country and readiness gate before activation |

## Phase 4 product requirements

| ID | Requirement | Accountable owner | Status | Evidence / next action |
| --- | --- | --- | --- | --- |
| `REQ-P4-001` | Freeze the free-launch PRD and explicit deferred scope | Product owner | Implemented baseline; approval pending | [Launch PRD](../../product/phase4-product-requirements.md) |
| `REQ-P4-002` | Trace requirement to backlog, code, test, evidence, release, and documentation | Product + QA | Implemented baseline | [Traceability and G4 record](../../product/phase4-traceability-and-gate.md) |
| `REQ-P4-003` | Define seller, buyer, support, finance, reviewer, owner, and service permissions | Product + security | Implemented baseline; least-privilege review pending | [Roles and journeys](../../product/phase4-roles-and-journeys.md) |
| `REQ-P4-004` | Define seller and buyer journeys, failures, and merchant/platform responsibilities | Product + counsel | Draft frozen; counsel approval pending | [Roles and journeys](../../product/phase4-roles-and-journeys.md) |
| `REQ-P4-005` | Launch free and prevent unapproved paid SaaS acquisition | Product + finance + counsel | Fail-closed control implemented; approval pending | [ADR-004](../../decisions/adr-004-free-launch-billing.md) and Worker tests |
| `REQ-P4-006` | Keep seller AI deferred and fail closed | Product + privacy + CTO | Fail-closed control implemented; approval pending | PRD, Worker configuration, and Worker tests |
| `REQ-P4-007` | Map launch features to data, access, vendors, retention, and permissions | DPO + product + mobile | Baseline implemented; legal retention review pending | [Data/permission matrix](../../product/phase4-data-and-permissions.md) |
| `REQ-P4-008` | Define functional, privacy, legal, security, operational, accessibility, RTL, offline, and failure acceptance criteria | QA + product | Partially evidenced | PRD and G6 test backlog in traceability record |
| `REQ-P4-009` | Implement public content report, takedown, appeal, repeat-offender, emergency, and evidence controls | Support/trust + counsel + product | Requirements frozen; implementation open | [Content controls](../../product/phase4-content-controls.md) |
| `REQ-P4-010` | Obtain G4 approval from product, counsel, DPO, security, and finance | Product owner | Blocked pending named approvals | [G4 gate record](../../product/phase4-traceability-and-gate.md) |

## Planning assumptions requiring confirmation

| ID | Assumption | Owner | Impact if false | Status / next action |
| --- | --- | --- | --- | --- |
| `ASM-001` | First launch is an Egypt-focused B2B commerce-enablement SaaS for merchants; Egypt is not the product boundary | Executive sponsor | Changing the first market reopens legal, product, tax, privacy, architecture, and Play launch scope | Confirmed by product owner on 2026-07-30; MENA/global activation remains separately gated |
| `ASM-002` | Orderak does not custody, route, or settle buyer funds and is not merchant of record for merchant sales | Executive sponsor + counsel | May trigger payment licensing, contracts, technical, and fund-control redesign | Proposed; document money flow and obtain written opinion |
| `ASM-003` | Sellers are adults conducting legitimate commercial activity; the service is not directed to children | Product + counsel + privacy | Changes consent, target audience, content, and verification controls | Proposed; confirm in PRD and notices |
| `ASM-004` | Arabic is primary for Egypt legal/consent content; current protected app locales remain Arabic, English, and French | Product + privacy | Changes legal notices, UX, tests, and localization contract | Partially confirmed by existing contract; legal review pending |
| `ASM-005` | AI assistant is not required for first public release | Product owner | Enabling it triggers vendor, transfer, prompt, retention, security, and disclosure work | Adopted engineering baseline; formal product approval pending |
| `ASM-006` | Paid merchant SaaS is either compliant and server-validated or unavailable from the Play-distributed app | Product + finance + counsel | Noncompliant payment flow or revenue delay | Free launch adopted as engineering baseline; G4 approval pending |
| `ASM-007` | Company-owned accounts will replace personal ownership with two recovery administrators | Executive sponsor + operations | Account loss, control, IP, and continuity exposure | Proposed; complete ownership inventory |

## Open questions

| ID | Question | Decision owner | Due / gate | Related item |
| --- | --- | --- | --- | --- |
| `Q-001` | What legal form and interim operating model are approved? | Executive sponsor + Egyptian counsel | 2026-08-03 / G2 | `ISS-011`, `R-001` |
| `Q-002` | Which registered DPO category/candidate and appointment path apply? | Executive sponsor + privacy lead | 2026-08-03 / G3 | `ISS-006`, `R-002` |
| `Q-003` | What licences, permits, Law 175/2018 records, NTRA, payment, and consumer positions apply? | Egyptian counsel | 2026-07-31 / G1-G3 | `ISS-005`, `R-002` |
| `Q-004` | Is Western Europe Cloudflare hosting/processing approved, and what filing/architecture is required? | Executive sponsor + counsel + CTO | 2026-08-14 / G3 | `ISS-007`, `R-003` |
| `Q-005` | Which compliant merchant subscription channel will replace the free-launch baseline, if and when paid scope is approved? | Product + finance + counsel | Before paid change / G4-G6 | `ISS-010`, `R-005`, ADR-004 |
| `Q-006` | What counsel-approved deletion, retention, legal-hold, and 180-day record categories apply? | Privacy lead + counsel | G3 | `R-008` |
| `Q-007` | Which restricted evidence vault and access/retention controls will be used? | Executive sponsor + security | 2026-07-22 / G0 | `ISS-004` |

## Protected contracts

| ID | Contract | Source of truth | Change rule | Status |
| --- | --- | --- | --- | --- |
| `CTR-001` | Seller authentication security outcomes and current Android Firebase profile | `docs/contracts/auth-phase1-contract.md`, `docs/contracts/authentication-security-invariants.md`, `docs/platforms/android-auth-profile.md` | Explicit Ayman Mohamed Abdellatif approval; invariant/profile, behavioral and Worker tests, security/API docs updated together | Versioned and protected |
| `CTR-002` | Localization outcomes and current Android locale profile | `docs/architecture/localization-architecture.md`, `docs/contracts/localization-invariants.md`, `docs/platforms/android-localization-profile.md` | Explicit product approval; invariant/profile and required tests/baselines updated together | Versioned and protected |
| `CTR-003` | Android calls Cloudflare backend only; no provider secrets in app | `AGENTS.md`, architecture docs | Security architecture approval required | Protected project rule |
| `CTR-004` | Database changes use migrations and preserve the Wrangler ledger | `docs/guides/database-migrations.md` | Migration/change approval and guide update | Protected workflow |

## Deferred ideas

Ideas remain out of launch scope until converted into an approved requirement:

- seller-facing AI assistant and expanded automatic translation;
- custody or routing of buyer payments;
- wallets, lending, BNPL, insurance, or other regulated financial services;
- buyer-facing French catalogs;
- broad contacts, location, or other sensitive Android permissions;
- production activation outside Egypt before a country-readiness gate is
  approved; market-portable engineering is required now;
- replacement of the protected Phase 1 auth model.
