---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Orderak documentation

Use this page to find the right document for your role or task. New
contributors should begin with the setup guide and then run the documented
verification checks.

## Authority order

When documents disagree, use this order:

1. Versioned safety contracts: [seller authentication](./contracts/auth-phase1-contract.md),
   [localization architecture](./architecture/localization-architecture.md), and their
   outcome-invariant/platform-profile documents.
2. Implemented current state: [app plan](./product/app-plan.md), [API reference](./reference/api.md),
   [setup](./guides/setup.md), and the architecture documents.
3. Approved product and architecture decisions: `product/` and `decisions/`.
4. Operational procedures: `runbooks/`, but only when their prerequisites and
   current-status warnings are satisfied.
5. Governance records: approvals, risks, issues, evidence, and gate state.
Status words have specific meanings: **Current** describes verified behavior,
**Proposed** is not authorized, **Blocked** cannot safely proceed, **Generated**
duplicates a machine source, and **Archived** is historical only.

## Table of contents

- [Authority order](#authority-order)
- [Current development focus](#current-development-focus)
- [New contributors](#new-contributors)
- [Developers](#developers)
- [Operators](#operators)
- [Launch governance](#launch-governance)
- [Product and support](#product-and-support)
- [Repository policies](#repository-policies)

## Current development focus

For day-to-day implementation, use the current-state documents above and keep
these release-impacting gaps visible:

| Priority | Current state | Source |
| --- | --- | --- |
| P0 | Account-deletion intake exists, but safe fulfillment is not wired or fully tested | [Account deletion runbook](./runbooks/account-deletion.md), `ISS-013` / `FND-011` |
| P1 | Android still targets API 35; API 36 upgrade and regression evidence are required before the 2026 Play deadline | [Setup](./guides/setup.md), `ISS-008` / `FND-003` |
| P1 | Release signing fingerprints and physical-device production OTP evidence are missing | [Production auth plan](./product/production-auth-plan.md), `ISS-009` / `FND-007` |
| P1 | Legal/entity/DPO/transfer approvals and named operational owners are not evidenced | [Governance registers](./governance/registers/index.md) |
| Contained | Paid acquisition and seller AI are disabled for the free launch; do not reopen them implicitly | [App plan](./product/app-plan.md), [ADR-004](./decisions/adr-004-free-launch-billing.md) |

The [issue/change log](./governance/registers/issue-and-change-log.md) and
[findings register](./governance/registers/findings-register.md) carry ownership
and closure evidence. Archived plans do not create new implementation scope.

## New contributors

| Document | What it covers |
| ---------- | --------------- |
| [Setup guide](./guides/setup.md) | First-time local setup, Cloudflare provisioning, Firebase, email, and production deployment |
| [Glossary](./reference/glossary.md) | All domain terms with Arabic translations (`store_code`, `public_identifier`, `piasters`, …) |
| [Testing guide](./guides/testing.md) | How to run each test suite (backend + Android) |
| [Staging and Production workflow](./guides/staging-production-workflow.md) | GitHub flow, environment isolation, Staging testing, Production promotion, and rollback |
| [Troubleshooting](./guides/troubleshooting.md) | Common issues and their fixes |
| [Documentation guide](./guides/documentation.md) | Writing standards, source-of-truth map, and review checklist |

## Developers

| Document | What it covers |
| ---------- | --------------- |
| [API reference](./reference/api.md) | All backend endpoints, request/response shapes, error codes |
| [Architecture overview](./architecture/overview.md) | System diagram, hostnames, data flows |
| [Database topology](./data/database.md) | Which databases exist, the tenant key, and the concurrency patterns D1 forces |
| [Identity domain](./domains/identity.md) | The seller account, authentication, device secrets, deletion and retention |
| [Stores domain](./domains/stores.md) | Store code, slug, public identifier, and how a renamed store stays reachable |
| [Catalog domain](./domains/catalog.md) | Products, categories, translations, business taxonomy, geo catalogue, public pages |
| [Orders domain](./domains/orders.md) | Order status machine and every defence on the public order endpoint |
| [Billing domain](./domains/billing.md) | Payment gateway abstraction, Google Play verification, and the two gates that keep billing closed |
| [Entitlements domain](./domains/entitlements.md) | Legacy plan limits versus the v2 organization-scoped engine, and how monthly usage is reserved |
| [Growth domain](./domains/growth.md) | Ads, coupons and referrals — which serve while billing is closed and which do not |
| [Design system domain](./domains/design-system.md) | Immutable token revisions, rollback, store theme, and the Android screen manifest |
| [Admin control plane](./domains/admin-control-plane.md) | The separate admin Worker and identity system, step-up authorization, signed audit archives |
| [Android-first portability](./architecture/cross-platform-readiness.md) | Current versioning/platform seams and explicitly deferred iOS/PWA work |
| [Seller API compatibility](./contracts/api-compatibility-contract.md) | API version, payload, compatibility, and enforcement rules |
| [Sync/conflict contract](./contracts/sync-conflict-contract.md) | Authority, revision, retry, idempotency, and conflict policy by entity |
| [Interactive full architecture](./architecture/orderak-full-architecture.html) | Filterable Android, Worker, data, billing, admin, AI, and provider boundaries |
| [Security model](./architecture/security-model.md) | Auth flow, token verification, secret storage |
| [Database migrations](./guides/database-migrations.md) | Migration workflow and an index explaining what each migration does |
| [Staging and Production workflow](./guides/staging-production-workflow.md) | Daily branch workflow and safe promotion of a tested commit between environments |
| [Architecture decision records](./decisions/adr-001-cloudflare-workers-d1.md) | Records of significant technical decisions |

## Operators

| Document | What it covers |
| ---------- | --------------- |
| [Production auth plan](./product/production-auth-plan.md) | Firebase console checklist, SMS policy, Play Integrity |
| [Versioned seller auth contract](./contracts/auth-phase1-contract.md) | Firebase SMS guarantees, invariant evidence, Android profile, and migration procedure |
| [Account deletion runbook](./runbooks/account-deletion.md) | **Blocked:** safely operate intake while production fulfillment is repaired and tested |
| [D1 migration drift runbook](./runbooks/d1-migration-drift.md) | Diagnose migration state safely; ledger mutation requires backup and explicit approval |
| [Firebase authentication outage runbook](./runbooks/firebase-auth-outage.md) | Respond to Firebase sign-in outages |
| [Google Play billing DLQ runbook](./runbooks/play-billing-dlq.md) | Investigate and safely requeue dead-lettered billing verifications without exposing purchase tokens |
| [Tenant shard migration runbook](./runbooks/tenant-shard-migration.md) | Rehearsal-gated fence/copy/checksum/catch-up/flip/rollback procedure and evidence requirements |
| [Localization architecture](./architecture/localization-architecture.md) | Versioned localization outcomes and Android profile; changes require approval and evidence |

## Launch governance

| Document | What it covers |
| ---------- | --------------- |
| [Governance control center](./governance/index.md) | Phase 0 status, deliverables, G0 gate, and daily workflow |
| [Program charter](./governance/program-charter.md) | Scope, decision rights, workstreams, escalation, and approval |
| [Role assignment and RACI](./governance/raci.md) | Accountable roles, blocking authority, assignments, and separation of duties |
| [Operating cadence](./governance/operating-cadence.md) | Weekly, fortnightly, monthly, and incident forums |
| [Evidence standard](./governance/evidence-standard.md) | Evidence locations, IDs, metadata, review, and handling rules |
| [Data map](./governance/data-map.md) | Draft field/vendor inventory and unresolved privacy-transfer questions |
| [Retention and deletion matrix](./governance/retention-matrix.md) | Proposed retention/deletion policy and implementation target—not proof of enforcement |
| [Temporary change freeze](./governance/temporary-change-freeze.md) | Controlled data, vendor, SDK, permission, billing, AI, and release changes |
| [Governance registers](./governance/registers/index.md) | Requirements, decisions, risks, issues, changes, vendors, permissions, policies, and findings |

## Product and support

| Document | What it covers |
| ---------- | --------------- |
| [App plan](./product/app-plan.md) | Product vision, core screens, sync model, known gaps |
| [Tiered plan catalog](./product/orderak-plan-catalog.json) | Machine-readable 242-feature comparison, implementation status, and four plan values |
| [ADR-005](./decisions/adr-005-versioned-entitlements-google-play.md) | Versioned organization entitlements and server-verified Google Play lifecycle |
| [ADR-006](./decisions/adr-006-authoritative-play-verification.md) | Authoritative Play verification, asynchronous lifecycle processing, and race-safe entitlement application |
| [ADR-007](./decisions/adr-007-shard-ready-single-d1.md) | Single-D1 TenantContext boundary, table ownership, and future cross-shard operations |
| [Phase 4 launch PRD](./product/phase4-product-requirements.md) | Frozen launch scope, failure behavior, acceptance criteria, and deferred features |
| [Phase 4 roles and journeys](./product/phase4-roles-and-journeys.md) | Seller/buyer journeys, technical roles, permissions, and responsibilities |
| [Phase 4 data and permissions](./product/phase4-data-and-permissions.md) | Feature data, Android permissions, recipients, and launch gates |
| [Phase 4 traceability and G4 record](./product/phase4-traceability-and-gate.md) | Roadmap mapping, test evidence, blockers, and required approvals |
| [Public catalog content controls](./product/phase4-content-controls.md) | Report, takedown, appeal, suspension, and evidence requirements |
| [Seller getting-started guide](./user-guide/getting-started.md) | Pre-launch seller guide limited to currently available behavior |
| [Legal-document status](./legal/README.md) | Approval, language-parity, disclosure, and publication cautions |
| [Privacy policy](./legal/privacy-policy.md) | Repository privacy-policy text; legal review still required |
| [سياسة الخصوصية](./legal/privacy-policy.ar.md) | سياسة الخصوصية باللغة العربية |
| [Terms of service](./legal/terms-of-service.md) | Repository terms text; legal review still required |
| [شروط الاستخدام](./legal/terms-of-service.ar.md) | شروط الاستخدام باللغة العربية |

## Repository policies

| File | Purpose |
| ------ | --------- |
| [Project README](https://github.com/youo1/Orderak.APP/blob/main/README.md) | Project landing page and quick start |
| [Contribution guide](https://github.com/youo1/Orderak.APP/blob/main/CONTRIBUTING.md) | Development workflow, testing, and documentation checklist |
| [Changelog](https://github.com/youo1/Orderak.APP/blob/main/CHANGELOG.md) | Version history in Keep a Changelog format |
| [Security policy](https://github.com/youo1/Orderak.APP/blob/main/SECURITY.md) | Vulnerability reporting, secret handling, and key rotation |
| [Repository instructions](https://github.com/youo1/Orderak.APP/blob/main/AGENTS.md) | AI-assistant and contributor rules |
