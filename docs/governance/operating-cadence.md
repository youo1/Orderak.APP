# Phase 0 operating cadence

The cadence keeps decisions, dependencies, risks, and evidence synchronized.
Meeting notes are control evidence and must follow the
[evidence standard](./evidence-standard.md).

## Calendar

| Forum | Frequency | Accountable owner | Required participants | Primary output |
| --- | --- | --- | --- | --- |
| Build / pilot / hypercare stand-up | Daily when active | Engineering or operations lead | Active task owners, QA, operations | Blockers, incidents, release health, action owners |
| Integrated program review | Weekly | Program lead | Executive sponsor, all workstream leads | Gate dashboard, decisions, risks, issues, dependencies, evidence gaps |
| Product/privacy/security design authority | Fortnightly and change-triggered | Product owner | Product, privacy, security, engineering, counsel as needed | Approved/rejected requirements, data, SDK, billing, AI, permission, and architecture changes |
| Executive risk and compliance committee | Monthly and before each gate | Executive sponsor | Program, counsel, DPO/privacy, finance, security, product, operations | Residual-risk decisions, regulator/vendor delays, scope/date changes |
| Access and vendor review | Monthly | Security or operations lead | DPO/privacy, engineering, procurement/finance | Access recertification, vendor status, renewals, offboarding actions |
| Incident / emergency change forum | Ad hoc | Incident commander or executive sponsor | Relevant legal, privacy, security, engineering, operations, communications owners | Containment, authority, evidence, notification, recovery, post-incident actions |

## Weekly program review agenda

1. Confirm attendees, decision quorum, and previous action closure.
2. Review G0 and the next applicable launch gate by evidence status.
3. Review the critical path and any due-date change.
4. Review new and changed requirements, assumptions, and protected contracts.
5. Review Critical/High risks and all blocked issues.
6. Review proposed changes, exceptions, vendors, SDKs, permissions, data fields,
   production access, billing, AI, and release activity.
7. Review finding closure and missing evidence.
8. Record decisions, owners, due dates, escalation, and the next meeting.

## Standard inputs

- [Requirements register](./registers/requirements-register.md)
- [Decision log](./registers/decision-log.md)
- [Risk register](./registers/risk-register.md)
- [Issue and change log](./registers/issue-and-change-log.md)
- [Third-party and permission register](./registers/third-party-and-permission-register.md)
- [Policy version register](./registers/policy-version-register.md)
- [Findings register](./registers/findings-register.md)
- Current gate checklist and evidence links

## Required meeting record

Each record must contain:

- meeting ID, title, date/time, chair, recorder, and attendees;
- agenda and scope;
- evidence reviewed;
- decisions and rejected alternatives;
- actions with one owner and due date;
- new/changed risks, issues, findings, and change requests;
- conflicts or recusals;
- next meeting and escalation deadline.

Use the filename `meeting-YYYYMMDD-<forum>-v1.0.md` and store it in the
approved evidence location. Never include secrets, OTPs, tokens, personal
phone numbers, raw customer records, or unrestricted incident detail.

## Quorum and missed decisions

- The accountable owner or an explicitly authorized deputy must attend for a
  decision to be valid.
- A legal, privacy, security, payment, or release decision cannot be made when
  its mandatory specialist is absent.
- A missed decision remains `Pending`; silence is not approval.
- If a gate date is threatened, the program lead escalates the blocker rather
  than weakening the gate.

## Initial schedule actions

| ID | Action | Owner | Due | Status |
| --- | --- | --- | --- | --- |
| `CAD-001` | Create weekly integrated program review invitation | Acting program lead | 20 July 2026 | Pending |
| `CAD-002` | Create fortnightly design-authority invitation | Acting product owner | 22 July 2026 | Pending |
| `CAD-003` | Create monthly risk/compliance invitation | Executive sponsor | 22 July 2026 | Pending |
| `CAD-004` | Name incident-call initiator and backup | Executive sponsor | 22 July 2026 | Pending |
| `CAD-005` | Record first G0 review using the standard inputs | Acting program lead | 26 July 2026 | Pending |
