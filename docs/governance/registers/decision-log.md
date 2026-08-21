---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Decision log

| ID | Date | Decision / question | Status | Accountable owner | Rationale and consequence | Evidence / next action |
| --- | --- | --- | --- | --- | --- | --- |
| `DEC-001` | 2026-07-18 | Use `docs/governance/` as the source-controlled launch governance package | Implemented; executive ratification pending | Acting program lead | Makes Phase 0 artifacts reviewable with code and documentation | This package; approve in `GOV-CHARTER-001` |
| `DEC-002` | 2026-07-18 | Launch first as Egypt B2B commerce-enablement SaaS without Orderak custody of buyer funds | Proposed | Executive sponsor | Minimizes accidental payment/financial regulation and separates merchant sales from SaaS billing | Counsel classification and money-flow diagram required |
| `DEC-003` | 2026-07-18 | Defer seller-facing AI for first public release | Implemented engineering baseline; product approval pending | Product owner | Current provider transfer, DPA, prompt, retention, security, and disclosure controls are not approved | `AI_ASSISTANT_ENABLED=false`; revisit through change control |
| `DEC-004` | 2026-07-18 | Preserve protected authentication and localization contracts during launch work | Existing approved constraint | Protected-contract owners | Prevents silent security or localization architecture drift | Run contract verification after affected changes |
| `DEC-005` | 2026-07-18 | Launch free and keep paid SaaS acquisition unavailable until billing and server entitlement are approved and tested | Implemented engineering baseline; G4 approval pending | Product + finance + counsel | Client billing code exists but complete policy/entitlement evidence is not established | [ADR-004](../../decisions/adr-004-free-launch-billing.md); `BILLING_ENABLED=false` |
| `DEC-006` | 2026-07-18 | Treat Cloudflare Western Europe processing as a cross-border architecture decision, not Egypt residency | Constraint accepted; hosting choice pending | Executive sponsor + counsel + CTO | D1/R2 were observed in `WEUR`; D1 jurisdiction is `null`; Workers/KV/vendor access also require mapping | Resolve `ISS-007` and `R-003` |

## Existing architecture decisions

Every ADR in `docs/decisions/`, with the status each record states about
itself. This list is the index; the ADR is authoritative on its own status.

| ADR | Status | Note |
| --- | --- | --- |
| [ADR-001: Cloudflare Workers + D1](../../decisions/adr-001-cloudflare-workers-d1.md) | Accepted | Revisit if the approved Egyptian hosting/transfer outcome requires a materially different platform architecture |
| [ADR-002: Integer piasters](../../decisions/adr-002-integer-piasters.md) | **Superseded** by ADR-009 on 2026-08-21 | Integer minor units still hold; fusing currency and exponent into the unit name does not |
| [ADR-003: UUID public URLs](../../decisions/adr-003-uuid-public-urls.md) | Accepted | |
| [ADR-004: Free launch billing](../../decisions/adr-004-free-launch-billing.md) | Accepted | Paired with `DEC-005` |
| [ADR-005: Versioned entitlements and Google Play](../../decisions/adr-005-versioned-entitlements-google-play.md) | Accepted | |
| [ADR-006: Authoritative Play verification](../../decisions/adr-006-authoritative-play-verification.md) | Accepted | |
| [ADR-007: Shard-ready single D1](../../decisions/adr-007-shard-ready-single-d1.md) | Accepted | |
| [ADR-008: Evolvable safety contracts](../../decisions/adr-008-evolvable-safety-contracts.md) | Accepted | |
| [ADR-009: Minor units with explicit currency](../../decisions/adr-009-minor-units-with-explicit-currency.md) | **Proposed** | ⚠ See the note below — implemented while still proposed |
| [ADR-010: Schema-first API contract](../../decisions/adr-010-schema-first-api-contract.md) | Proposed | |

> **Open governance item — ADR-009.** The record states `Status: proposed`, but
> its decision is deployed: migration
> `044_money_minor_units_with_currency.sql` applied to staging D1 on
> 2026-08-21, and the backend and schema use `*_minor` with an explicit
> `currency` throughout. That conflicts with the completion rule below, which
> says proposed behavior must not be represented as production authorization.
> Either the ADR should be moved to Accepted with an accountable owner and
> date recorded, or the deployment needs a recorded exception. This index does
> not resolve it — raised 2026-08-21 during a documentation audit.

## Decision completion rule

A decision is `Approved` only when the accountable authority, date, scope,
alternatives, consequences, and evidence are recorded. `Proposed` behavior must
not be represented as final policy or production authorization.
