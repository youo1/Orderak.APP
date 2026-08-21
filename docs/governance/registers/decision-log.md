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

The following accepted ADRs remain authoritative unless superseded through the
ADR process:

- [ADR-001: Cloudflare Workers + D1](../../decisions/adr-001-cloudflare-workers-d1.md)
- [ADR-002: Integer piasters](../../decisions/adr-002-integer-piasters.md)
- [ADR-003: UUID public URLs](../../decisions/adr-003-uuid-public-urls.md)
- [ADR-004: Free launch billing](../../decisions/adr-004-free-launch-billing.md)

`ADR-001` must be revisited if the approved Egyptian hosting/transfer outcome
requires a materially different platform architecture.

## Decision completion rule

A decision is `Approved` only when the accountable authority, date, scope,
alternatives, consequences, and evidence are recorded. `Proposed` behavior must
not be represented as final policy or production authorization.
