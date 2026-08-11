# Temporary data, vendor, and release freeze

## Control notice

**Control ID:** `GOV-FREEZE-001`  
**Status:** Active immediately  
**Effective date:** 18 July 2026  
**Review point:** G0 and every subsequent design-authority meeting  
**Owner:** Executive sponsor  
**Coordinator:** Acting program lead

This is a risk-change freeze, not a stop-work order. Approved development may
continue in non-production environments, but no controlled change below may be
introduced without an ID, review, approval, tests, documentation, and evidence.

## Changes frozen without approval

- New or materially changed vendor, processor, sub-processor, SDK, library,
  service, domain, or remote-support arrangement.
- New Android permission, package visibility declaration, exported component,
  background capability, data access, or device identifier.
- New personal-data field, purpose, lawful basis, audience, recipient, country,
  retention period, log event, analytics event, or model prompt.
- Production personal-data export, cross-border access, bulk download, support
  access, or use of production data in development, testing, demos, or AI.
- New AI provider, live AI assistant, automatic translation of personal data,
  prompt logging, or model-training use.
- Live paid SaaS entry point, Google Play product, entitlement, Stripe path,
  refund rule, pricing, promotion, or buyer-fund flow.
- Marketing campaign, broad contact/location collection, direct marketing,
  behavioral analytics, or changed consent wording.
- Regulated payment, finance, telecom, transport, health, insurance, investment,
  lending, BNPL, wallet, gaming, or similar feature.
- Production deployment, binding, route, database, migration, secret, key,
  access role, logging, backup, restore, retention, deletion, or monitoring change.
- Change to public Terms, Privacy Notice, seller agreement, deletion promise,
  support commitment, Play declaration, or target audience.
- Change to a protected authentication or localization guarantee.

## Allowed work

The following may proceed when it does not trigger a frozen category:

- documentation, threat modeling, data mapping, test planning, and register work;
- local development using synthetic or de-identified data;
- tests and scans that do not expose secrets or production personal data;
- dependency inventory and non-mutating configuration review;
- fixes in a development branch that are not deployed and have a linked
  requirement/change record;
- emergency containment necessary to stop active harm, followed by the
  emergency process below.

## Approval matrix

| Change domain | Required approval before implementation | Required evidence |
| --- | --- | --- |
| Product scope or user journey | Product owner; consult counsel, privacy, security, QA | Requirement, acceptance criteria, data/role impact |
| Personal data, consent, retention, rights, vendor, transfer | Privacy lead/DPO and counsel; CTO for architecture | Data map, lawful-basis decision, vendor/transfer update, tests |
| Android permission, SDK, exported component | Mobile, security, privacy, product | Merged manifest, SDK analysis, alternatives, Data Safety impact |
| Billing, price, entitlement, refund, or funds flow | Product, finance, counsel, services/backend/mobile, QA | Billing ADR, money-flow diagram, end-to-end evidence |
| AI or translation provider | Product, privacy/DPO, counsel, security, CTO | DPIA/assessment, DPA, transfer, prompt/retention controls, disclosure |
| Production architecture, access, secret, data, migration, backup | CTO, security, privacy/DPO, operations, release | ADR/change record, test, backup/rollback, access review |
| Public policy, contract, or Play declaration | Counsel, privacy/DPO, product, release | Versioned approved text and behavior reconciliation |
| Protected auth contract | Explicit protected-contract owner approval | Contract migration, regression tests, security/API docs |
| Protected localization contract | Explicit product owner approval | Contract update, localization tests, screenshots where required |

## Standard exception process

1. Create a `CHG-NNN` row before work starts.
2. Link affected requirements, data, vendors, policies, risks, and source files.
3. Describe value, alternatives, risk, rollback, tests, and evidence.
4. Obtain every required approval; silence is not approval.
5. Implement in the lowest-risk environment and run required checks.
6. Review evidence, authorize release separately, and update documentation.
7. Close the change only after monitoring and rollback readiness are confirmed.

## Emergency process

Emergency action is limited to containing active security, privacy, fraud,
availability, or data-loss harm.

1. The incident commander records time, reason, authority, scope, and evidence.
2. Use the least-privilege, reversible action available.
3. Preserve evidence without exposing sensitive values.
4. Notify the executive sponsor and relevant security/privacy/legal owners as
   soon as practical.
5. Open the formal change and incident records within one business day.
6. Review root cause, policy/reporting duties, rollback, and permanent fix.

## Protected controls in force

- The Phase 1 Firebase SMS authentication contract must not drift.
- The localization contract must not drift.
- The current source manifest declares only `android.permission.INTERNET`;
  added permissions require explicit review.
- The live billing UI must remain gated until the billing and entitlement
  decision is approved and verified.
- AI exposure remains deferred until privacy, transfer, vendor, and disclosure
  review is complete.
- Orderak must not hold or route merchant buyer funds without an approved
  licensed-partner or authorized operating model.

## Acknowledgement record

| Role | Name | Decision | Date | Evidence |
| --- | --- | --- | --- | --- |
| Executive sponsor | Ayman Mohamed Abdellatif | Pending acknowledgement | - | - |
| Acting program lead | Founder / CEO acting | Pending acknowledgement | - | - |
| Product owner | Founder / CEO acting | Pending acknowledgement | - | - |
| Privacy lead / DPO | Not appointed | Blocked | - | `ISS-006` |
| Engineering lead | Not named | Pending | - | `ISS-001` |
| Security lead | Not named | Pending | - | `ISS-001` |
| QA / release lead | Not named | Pending | - | `ISS-001` |
| Operations lead | Not named | Pending | - | `ISS-001` |
