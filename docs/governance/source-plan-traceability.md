---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Phase 0 source-plan traceability

This index prevents requirements from being lost between the source plans, the
integrated roadmap, the repository, and launch evidence. It is not a substitute
for reading the source document when implementing a detailed requirement.

## Source register

| Source ID | Unpublished source record | Phase 0 use |
| --- | --- | --- |
| `SRC-000` | `Orderak_Egypt_Company_and_Android_Launch_Implementation_Roadmap.docx` | Integrated 24-week sequence, Phase 0 tasks, gates, risks, and ownership model |
| `SRC-001` | `0. Prohibitions Compliance Implementation Plan.docx` | Temporary prohibitions, ownership, logs, vendor, release, and sign-off controls |
| `SRC-005` | `5. Privacy, Compliance, and Records Implementation Plan.txt` | DPO, ROPA, transfer, retention, consent, rights, incidents, and records workstreams |
| `SRC-006` | `6. MVP Specification and Compliance Planning.txt` | MVP scope, roles, billing, permissions, data-to-feature, and acceptance requirements |
| `SRC-007` | `7. Technical Architecture and Platform Readiness Plan.txt` | Architecture, accounts, environments, security, recovery, monitoring, and Android readiness |
| `SRC-008` | `8. MVP Development and Compliance Implementation Plan.txt` | Traceable implementation, API security, privacy workflows, DoD, SDKs, and change control |
| `SRC-009` | `9. Technical, Security, and Compliance Go-Live Test Plan.txt` | QA, security, privacy, resilience, finding closure, evidence, and Go/No-Go |
| `SRC-APP` | `App Document.docx` | Documentation-first execution, IDs, ADRs, one controlled task, and tests as proof |
| `SRC-LEGACY` | `roadmap_egypt_android_company_final.docx` | Original Egypt company-to-launch sequencing reconciled into the integrated roadmap |

## Phase 0 requirement mapping

| Requirement | Source | Implemented artifact | Owner | Verification |
| --- | --- | --- | --- | --- |
| `REQ-GOV-001` Approve charter, scope, calendar, decision rights, and gate owners | `SRC-000`, `SRC-001` | [Program charter](./program-charter.md) | Executive sponsor | Dated approval record |
| `REQ-GOV-002` Establish controlled evidence and core registers | `SRC-000`, `SRC-008`, `SRC-009`, `SRC-APP` | [Evidence standard](./evidence-standard.md), [register index](./registers/index.md) | Program lead | Link and metadata check |
| `REQ-GOV-003` Record requirements, assumptions, questions, and protected contracts | `SRC-000`, `SRC-006`, `SRC-APP` | [Requirements register](./registers/requirements-register.md) | Product owner | Every item has ID/owner/status/source |
| `REQ-GOV-004` Freeze unreviewed data, vendor, permission, logging, transfer, billing, AI, and regulated changes | `SRC-000`, `SRC-001`, `SRC-005`, `SRC-006` | [Temporary freeze](./temporary-change-freeze.md) | Executive sponsor | Required acknowledgements |
| `REQ-GOV-005` Establish weekly, fortnightly, monthly, and ad hoc governance | `SRC-000`, `SRC-007`, `SRC-009` | [Operating cadence](./operating-cadence.md) | Program lead | Invitations and first meeting record |
| `REQ-GOV-006` Define status, evidence review, and gate workflow | `SRC-000`, `SRC-008`, `SRC-009`, `SRC-APP` | [Governance index](./index.md), [evidence standard](./evidence-standard.md) | QA / release lead | First G0 gate pack |
| `REQ-GOV-007` Assign accountable owners and blocking authority | `SRC-000`, `SRC-001`, `SRC-009` | [RACI](./raci.md) | Executive sponsor | Named role acceptance |
| `REQ-GOV-008` Initialize source-plan traceability | All | This document | Program lead | All Phase 0 requirements mapped |

## Protected repository contracts

| Contract | Source of truth | Change authority | Required verification |
| --- | --- | --- | --- |
| Phase 1 authentication | `docs/contracts/auth-phase1-contract.md` | Ayman Mohamed Abdellatif, explicit migration approval | `gradlew.bat verifyAuthPhase1Contract` plus contract/test/security/API updates |
| Localization architecture | `docs/architecture/localization-architecture.md` | Explicit product approval | `gradlew.bat verifyLocalizationContract` plus contract and screenshot updates where required |
| Backend API behavior | `docs/reference/api.md` | Product/backend review | Backend tests and API documentation update |
| Product behavior | `docs/product/app-plan.md` | Product owner | Acceptance tests and app-plan update |
| Security/auth architecture | `docs/architecture/security-model.md` | Security/architecture review | Relevant auth/security tests and documentation update |
| Database migrations | `docs/guides/database-migrations.md` | Backend/release review | Migration tests, ledger verification, and guide update |

## Downstream handoff

The program lead must expand this Phase 0 index into requirement-to-design,
code, test, evidence, policy, runbook, and release traceability during Phases
1-8. An item is not complete merely because it appears in this table.
