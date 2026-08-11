# Phase 0 role assignment and RACI

This document assigns one accountable role to each Phase 0 result. Named role
acceptance is a G0 requirement; provisional role labels do not represent a
professional appointment or regulatory registration.

## RACI key

- **A - Accountable:** owns the outcome and final decision. Exactly one per row.
- **R - Responsible:** performs or coordinates the work.
- **C - Consulted:** must be consulted before completion.
- **I - Informed:** receives the decision or status.
- **B - Blocker:** may stop progression within an assigned control domain.

## Role assignment register

| Role | Named assignee | Current state | Authority / limitation | Acceptance evidence |
| --- | --- | --- | --- | --- |
| Executive sponsor / risk owner | Ayman Mohamed Abdellatif | Existing founder and protected-contract owner; executive launch authority to confirm | Final scope, funding, residual risk, and Go/No-Go | Pending charter approval |
| Program / implementation lead | Founder / CEO acting | Proposed interim assignment | Coordinates plan and evidence; cannot self-approve specialist conclusions | Pending acceptance |
| Egyptian counsel | Not appointed in repository evidence | Blocked | Must be qualified to advise on Egypt-specific company, regulatory, contract, payment, telecom, consumer, and data matters | Engagement and scope required |
| Registered DPO / privacy lead | Not appointed in repository evidence | Blocked | Interim privacy coordination is not PDPC registration or appointment | Registration/appointment evidence required |
| Accountant / finance lead | Not appointed in repository evidence | Blocked | Must confirm tax, VAT, e-invoice/e-receipt, e-seal, payroll, and filing obligations | Engagement and scope required |
| Product owner | Founder / CEO acting | Proposed interim assignment | Owns value, scope, acceptance, billing choice, and pilot metrics | Pending acceptance |
| CTO / engineering lead | Named maintainer required | Open | Owns architecture, code, environments, migration, release engineering, and technical evidence | Named acceptance required |
| Security lead | Named specialist required | Open | Owns threat model, access, security controls, incidents, tests, and findings | Named acceptance required |
| QA / release lead | Named owner required | Open | Owns test evidence, finding closure, release candidate, Play submission, and rollback | Named acceptance required |
| Cloud / operations lead | Named owner required | Open | Owns Cloudflare, Firebase, email, monitoring, backup, recovery, access, and on-call | Named acceptance required |
| Support / trust lead | Named owner required | Open | Owns merchant onboarding, tickets, complaints, prohibited content, and privacy routing | Named acceptance required |

## Phase 0 RACI matrix

| Activity | Executive sponsor | Program lead | Counsel | Privacy lead | Product | Engineering | Security | QA/release | Operations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GOV-01` Charter and scope | A | R | C | C | C | C | C | C | I |
| `GOV-02` Evidence repository and registers | I | A/R | C | C | C | C | C | C | C |
| `GOV-03` Requirements and assumptions | I | R | C | C | A | C | C | C | I |
| `GOV-04` Temporary risk freeze | A | R | B | B | C | C | B | B | C |
| `GOV-05` Operating cadence | I | A/R | C | C | C | C | C | C | C |
| `GOV-06` Status and gate workflow | I | R | C | C | C | C | C | A | I |
| G0 evidence review | A | R | C | C | C | C | C | R | C |
| Legal/company workstream | A | I | R/B | C | C | I | I | I | C |
| Privacy/transfer workstream | I | I | C/B | A/R/B | C | C | C | C | C |
| Product/billing workstream | I | C | C | C | A/R | C | C | C | I |
| Architecture/platform workstream | I | I | C | C/B | C | A/R | C/B | C | C |
| Security/assurance workstream | I | I | C | C/B | I | C | A/R/B | C | C |
| Release/Play workstream | A | I | C/B | C/B | C | C | C/B | R/B | C |

## Appointment procedure

1. The executive sponsor names the individual, organization, or contracted
   provider and defines the scope, start date, backup, and authority.
2. The assignee confirms acceptance and conflicts of interest.
3. Specialist credentials, registration, or engagement evidence is stored as
   restricted evidence; the public register stores only a safe reference.
4. The program lead updates this register and the relevant risk/issue owner.
5. The G0 gate owner verifies that no workstream lacks one accountable owner or
   an escalation path.

## Separation-of-duties minimums

- A code author must not be the only approver of a production release.
- A finding owner must not be the only person who verifies its closure.
- A payment, refund, data export, deletion override, or privileged access change
  requires a second authorized reviewer.
- The DPO/privacy lead must be able to escalate independently to the executive sponsor.
- The executive sponsor cannot replace required specialist conclusions with a
  business-risk acceptance when law or platform policy requires compliance.
