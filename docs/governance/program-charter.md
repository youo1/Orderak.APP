---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Phase 0 program charter

## Document control

| Field | Value |
| --- | --- |
| Charter ID | `GOV-CHARTER-001` |
| Version | 0.9 - ready for executive approval |
| Effective date | On approval; temporary controls are already active |
| Phase window | 18-26 July 2026 |
| Executive sponsor | Ayman Mohamed Abdellatif |
| Acting program lead | Founder / CEO until delegated |
| Review frequency | Weekly during implementation; on every material scope change |

## Purpose

Mobilize Orderak's Egypt launch as one controlled program. The program must
convert the existing working Android and Cloudflare platform into a legally
classified, company-owned, privacy-governed, secure, supportable, and
evidence-backed service before public release or paid scale.

## Phase 0 objective

Establish decision authority, accountable ownership, source-plan traceability,
evidence discipline, and temporary risk controls before any new production,
vendor, data, permission, billing, AI, or regulated-feature change.

## Program scope

### Included

- Egypt business and regulated-activity classification.
- Company, tax, intellectual-property, people, and account ownership readiness.
- Privacy, DPO, records, retention, vendor, and cross-border-transfer readiness.
- Product scope, billing responsibility, acceptance criteria, and feature gates.
- Android, Cloudflare, Firebase, Google Play, security, resilience, and release readiness.
- Policies, merchant contracts, support, complaints, refunds, incident response, and evidence.
- Closed merchant pilot, staged rollout, Go/Conditional Go/No-Go, and hypercare.

### Excluded until separately approved

- Custody, routing, or settlement of buyer funds by Orderak.
- Wallets, lending, BNPL, insurance, investment, regulated transport, health,
  telecom, gaming, or another regulated service.
- Live AI assistant exposure or personal-data transfer to an AI provider.
- Paid in-app SaaS entry points without a compliant billing decision and
  server-validated entitlement lifecycle.
- Expansion beyond Egypt or addition of buyer-facing French content.
- Any intentional migration of the protected Phase 1 authentication or
  localization contracts.

## Launch principles

1. A gate is an evidence decision, not a calendar milestone.
2. One accountable owner must exist for every requirement and residual risk.
3. The Android app calls only the Cloudflare backend; secrets never enter the app.
4. Data, permissions, vendors, logs, and retention are minimized by default.
5. Public statements, policies, Play declarations, and production behavior must match.
6. No Critical or High legal, privacy, security, payment, deletion, or release
   blocker may be waived informally.
7. Protected repository contracts remain unchanged unless the owner explicitly
   approves a versioned migration with tests and documentation.
8. Every completed task has reviewable evidence that does not expose secrets or
   personal data.

## Decision rights

| Decision | Accountable authority | Mandatory consultation | Blocking authority |
| --- | --- | --- | --- |
| Program scope, funding, and final Go/No-Go | Executive sponsor | Program, product, finance, counsel, DPO, engineering, security, operations | Counsel, DPO, security, release owner within their control domains |
| Legal form, contracts, licensing, and regulated boundaries | Executive sponsor | Egyptian counsel, accountant, product | Egyptian counsel for unresolved legal classification |
| Privacy role, DPO, lawful basis, transfer, retention, and incident position | Executive sponsor | Registered DPO/privacy lead, counsel, CTO | DPO/privacy lead and counsel |
| Product scope and acceptance criteria | Product owner | Counsel, DPO, security, engineering, QA, operations | Counsel, DPO, security for noncompliant requirements |
| Architecture, vendors, environments, access, and recovery | CTO / engineering lead | DPO, security, operations, product | Security and DPO for material unresolved exposure |
| Release candidate and Play submission | Release owner | Product, mobile, backend, QA, DPO, counsel, operations | QA, security, DPO, counsel, executive risk owner |
| Residual risk acceptance | Executive sponsor | Risk owner and affected control owner | No delegation for Critical risk; High requires documented specialist review |

No participant may override a documented block by changing labels, removing a
test, weakening a control, or releasing outside the approved process.

## Workstreams and outcomes

| Workstream | Required outcome | Current accountable role |
| --- | --- | --- |
| Program governance | Integrated plan, registers, decisions, gate packs, and evidence | Acting program lead |
| Legal and company | Approved operating model, entity, contracts, IP, tax, and people obligations | Executive sponsor with Egyptian counsel |
| Privacy and records | DPO path, ROPA, lawful basis, transfers, retention, rights, and incidents | Interim privacy lead; registered DPO appointment required |
| Product and market | Validated merchant problem, frozen MVP, roles, journeys, and billing decision | Acting product owner |
| Engineering and architecture | Approved architecture, traceable implementation, CI/CD, environments, and recovery | Engineering lead |
| Security and assurance | Threat model, security controls, independent testing, findings, and sign-off | Security lead |
| Operations and support | Accounts, monitoring, runbooks, support, complaints, and incident readiness | Operations lead |
| QA and release | Test strategy, release candidate, Play submission, rollout, and rollback | QA / release lead |

Named appointments and acceptance are maintained in the
[role assignment register](./raci.md#role-assignment-register).

## Protected constraints

- `docs/contracts/auth-phase1-contract.md` remains the protected authentication source of truth.
- `docs/architecture/localization-architecture.md` remains the protected localization source of truth.
- Authentication changes must pass `gradlew.bat verifyAuthPhase1Contract`.
- Localization changes must pass `gradlew.bat verifyLocalizationContract`.
- Database changes use Wrangler migrations and update the migration guide.
- Backend endpoint, product, setup, architecture, security, and migration
  changes update their authoritative repository documents in the same change.

## Phase 0 deliverables and acceptance

| ID | Deliverable | Acceptance condition |
| --- | --- | --- |
| `GOV-01` | Approved charter, scope, calendar, and decision rights | Executive sponsor records approval and any conditions |
| `GOV-02` | Controlled evidence structure and registers | Links resolve; owner, status, date, and evidence fields are present |
| `GOV-03` | Requirements, assumptions, questions, ideas, and protected contracts | Each item has an ID, source, owner, status, and next action |
| `GOV-04` | Temporary risk freeze | Required roles acknowledge it; exceptions use the change log |
| `GOV-05` | Operating cadence | Forum owners, inputs, outputs, and escalation triggers are defined |
| `GOV-06` | Status and gate workflow | Only approved status terms are used and G0 evidence is reviewable |

## Escalation path

1. The task owner records the issue, affected requirement, impact, evidence,
   next action, and due date.
2. The program lead assigns the control owner and places the item on the next
   appropriate forum.
3. Critical or time-sensitive legal, privacy, security, payment, deletion, or
   production issues immediately notify the executive sponsor and specialist owner.
4. If no authorized resolution exists, the affected gate remains failed and the
   release or change is paused.
5. Resolution is complete only after evidence review and register closure.

## Approval record

| Approver | Decision | Date | Conditions / evidence |
| --- | --- | --- | --- |
| Ayman Mohamed Abdellatif, executive sponsor | Pending | - | Confirm charter, acting appointments, and authority model |
| Acting program lead | Pending | - | Accept operating cadence and register ownership |
| Interim privacy lead | Pending appointment | - | Acknowledgement is not DPO registration |
| Engineering lead | Pending named acceptance | - | Confirm architecture and production-change authority |
| Security lead | Pending named acceptance | - | Confirm security blocking authority |
| QA / release lead | Pending named acceptance | - | Confirm evidence and release blocking authority |

Approval is recorded by replacing `Pending` with `Approved` or `Approved with
conditions`, adding the date, and linking a signed or otherwise authoritative
decision record. Editing the table alone is not sufficient evidence if the
approver did not actually decide.
