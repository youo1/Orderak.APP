---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Orderak launch governance

This package is the source-controlled control center for executing the Orderak
Egypt company and Android launch roadmap. It turns Phase 0 into maintained
owners, registers, evidence rules, decision rights, and an objective G0 gate.

## Phase 0 status

| Field | Current value |
| --- | --- |
| Phase | Phase 0 - Mobilization and risk freeze |
| Execution window | 18-26 July 2026 |
| Overall status | In progress - evidence-ready, pending appointments and approval |
| Executive sponsor | Ayman Mohamed Abdellatif, founder and protected-contract owner |
| Acting program lead | Founder / CEO until a named delegate accepts the role |
| Gate owner | Executive sponsor |
| Next gate | G0 Mobilized |

The governance structure is active immediately. This does not assert that
Orderak is legally incorporated, that a registered DPO has been appointed, or
that external counsel and accountant engagements are complete.

## Phase 4 parallel work status

The Phase 4 engineering baseline is prepared and scope-frozen in the
[launch PRD](../product/phase4-product-requirements.md), with roles/journeys,
data/permissions, content controls, free-launch billing ADR, traceability, and a
[G4 gate record](../product/phase4-traceability-and-gate.md). Billing acquisition
and seller AI now fail closed behind production default-off flags.

G4 has **not passed**. Product, counsel, DPO, security, and finance approvals
remain pending, and Phase 0/G0 authority and appointment blockers are unchanged.

## Phase 0 deliverables

| Deliverable | Source of truth | Status |
| --- | --- | --- |
| Program charter and decision rights | [Program charter](./program-charter.md) | Ready for approval |
| Role assignment and RACI | [RACI](./raci.md) | Interim assignments; named confirmations open |
| Operating cadence | [Operating cadence](./operating-cadence.md) | Active |
| Evidence repository and naming convention | [Evidence standard](./evidence-standard.md) | Active |
| Temporary data, vendor, and release controls | [Temporary change and release freeze](./temporary-change-freeze.md) | Active |
| Decision, risk, issue, change, vendor, permission, policy, and finding registers | [Registers](./registers/index.md) | Initialized |
| Source-plan traceability | [Source-plan traceability](./source-plan-traceability.md) | Initialized |
| Repository baseline evidence | [18 July 2026 baseline](./evidence/2026-07-18-repository-baseline.md) | Recorded |
| Initial G0 gate review | [G0 gate pack](./evidence/gate-g0-20260718-v0.1.md) | Not passed; blockers recorded |

## G0 Mobilized exit checklist

G0 passes only when every row is complete. A date target never overrides a
failed gate.

| Criterion | Evidence | Status |
| --- | --- | --- |
| Charter scope, authority, and decision rights approved | Approval record in [program charter](./program-charter.md#approval-record) and [G0 gate pack](./evidence/gate-g0-20260718-v0.1.md) | Pending executive approval |
| Each workstream has one accountable owner and an accepted deputy | [Role assignment register](./raci.md#role-assignment-register) | Pending named appointments |
| Evidence structure, metadata, and handling rules are active | [Evidence standard](./evidence-standard.md) | Complete |
| Decision, risk, issue, change, finding, vendor, SDK, permission, and policy registers exist | [Register index](./registers/index.md) | Complete |
| Temporary freeze has been issued and acknowledged | [Acknowledgement record](./temporary-change-freeze.md#acknowledgement-record) | Pending acknowledgements |
| Critical source-plan requirements are traceable to an owner and artifact | [Source-plan traceability](./source-plan-traceability.md) | Complete for Phase 0 |
| Weekly, fortnightly, monthly, and ad hoc forums have owners and outputs | [Operating cadence](./operating-cadence.md) | Defined; invitations pending |
| Open blockers have owner, due date, escalation route, and next action | [Issue and change log](./registers/issue-and-change-log.md) | Complete for recorded blockers |

**Current G0 result:** Not passed. The package is operational, but G0 remains
blocked by `ISS-001` (named role acceptance), `ISS-002` (charter approval), and
`ISS-003` (freeze acknowledgement).

## Daily use

1. Start work from the [requirements register](./registers/requirements-register.md).
2. Record a material choice in the [decision log](./registers/decision-log.md).
3. Record uncertainty or exposure in the [risk register](./registers/risk-register.md).
4. Record a present blocker in the [issue log](./registers/issue-and-change-log.md#issue-log).
5. Obtain approval before a controlled change using the [change log](./registers/issue-and-change-log.md#change-log).
6. Attach durable, sanitized evidence using the [evidence standard](./evidence-standard.md).
7. Review G0 status at every weekly program meeting until the gate passes.

## Status vocabulary

Use only these statuses across the Phase 0 package:

- `Proposed`: drafted and awaiting the accountable owner's decision.
- `Approved`: accepted by the accountable owner with dated evidence.
- `In progress`: work has started and a next action exists.
- `Blocked`: progress cannot continue without a recorded dependency or decision.
- `Ready for evidence review`: implementation is complete and evidence awaits review.
- `Accepted`: evidence has been reviewed and the requirement is closed.
- `Risk accepted`: an authorized owner has accepted a defined residual risk.
- `Rejected`: the proposal is not authorized and must not be implemented.
