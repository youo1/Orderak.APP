---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Launch risk register

## Rating rules

- `Critical`: could make operation unlawful, expose funds or sensitive data,
  cause severe compromise/loss, or make public launch impermissible.
- `High`: material customer, compliance, security, availability, financial, or
  schedule impact requiring leadership oversight.
- `Medium`: manageable impact with a funded owner and dated treatment.
- `Low`: routine control improvement monitored by the workstream owner.

Critical risk cannot be accepted solely to meet a date. High acceptance
requires written specialist review and executive authorization.

## Active risks

| ID | Risk | Rating | Owner | Treatment / control | Due / gate | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `R-001` | Public operator, contracts, invoices, IP, and actual legal entity do not match | Critical | Executive sponsor + counsel | Select/confirm legal form and interim model; version all identities and contracts after change | G2 | Open |
| `R-002` | DPO appointment, PDPC licence/permit, Law 175/2018, or sector filing is incomplete | Critical | Privacy lead + counsel | Appoint registered DPO; obtain written applicability/licensing path and evidence | G3 | Open |
| `R-003` | Western Europe hosting or another vendor transfer is not approved | Critical | CTO + privacy lead | Complete data/vendor/access-country map, options paper, filing/DPA path, and migration if required | 2026-08-14 / G3 | Open |
| `R-004` | API 36 upgrade misses the Google Play deadline or causes regression | High | Mobile + release lead | Upgrade by 2026-08-14; test Android 16, dependencies, background work, auth, billing, RTL, and release build | G6/G9 | Open |
| `R-005` | Paid SaaS is offered without compliant Play Billing and server entitlement | Critical | Product + finance | Free launch; default-off acquisition flag; approve channel and lifecycle before paid re-enable | Before paid change / G4-G6 | Controlled by default-off implementation; approval/evidence pending |
| `R-006` | Seller, buyer, merchant, controller/processor, consumer, refund, and tax responsibilities are unclear | High | Counsel + product | Approve role/money/data matrices, seller agreement/DPA, buyer notice, and complaint/refund evidence | G4/G6 | Open |
| `R-007` | AI/translation sends personal or confidential data to an unapproved provider | High | Privacy lead + CTO | Defer seller AI; default-off API; minimize translation data; approve vendor/DPA/transfer/retention/security and notices | Before AI enablement | Seller AI controlled by default-off implementation; translation review remains open |
| `R-008` | Deletion or restore leaves, revives, or prematurely removes regulated/personal records | High | Privacy lead + cloud lead | Approve retention/legal-hold rules; test downstream deletion, backup expiry, and post-restore replay | G7 | Open |
| `R-009` | Critical auth, admin, API, cross-store, or cloud vulnerability reaches release | Critical | Security lead | Preserve auth contract; least privilege; independent pentest; no open Critical/High at release | G7 | Partially controlled; assurance pending |
| `R-010` | Support, complaint, privacy-rights, or incident capacity fails during launch | High | Operations lead | Staff/on-call, response targets, templates, training, pilot load, and rollout pause thresholds | G8-G10 | Open |
| `R-011` | Merchant demand, activation, retention, or willingness to pay is too weak | High | Founder + product | Discovery and pilot gates; prohibit paid scale until activation/retention/WTP evidence is approved | G4/G8 | Open |
| `R-012` | Vendor outage, lock-in, credential loss, or account ownership failure stops service | High | Cloud + operations lead | Company ownership, two admins, recovery, export/restore, exit plan, flags, and fallback runbooks | G5 | Open |

## Review and escalation

At every weekly program review:

1. confirm risk statement, cause, consequence, rating, and affected gates;
2. review control evidence and whether likelihood/impact changed;
3. confirm one owner, due date, budget, dependency, and next action;
4. escalate missed Critical/High treatments immediately;
5. record residual risk and acceptance authority before closure.
