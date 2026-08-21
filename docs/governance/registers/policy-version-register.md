---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Policy and contract version register

This register reconciles approved text, product behavior, stored acceptance,
and release declarations. Legal approval and restricted signed evidence are
not inferred from a file existing in the repository.

| ID | Artifact | Repository version / date | Audience | Owner | Current state | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| `POL-001` | Terms of Service - English | Last updated 2026-07-13 | Sellers/users | Counsel + product | Published repository text; final company/operator review pending | Align operator, SaaS billing, seller/buyer responsibility, complaints, refunds, and effective version |
| `POL-002` | Terms of Service - Arabic | Last updated 2026-07-13 | Sellers/users; Arabic primary for Egypt | Counsel + product | Published repository text; parity review pending | Qualified Arabic legal review and synchronized approval/version |
| `POL-003` | Privacy Policy - English | Last updated 2026-07-13 | Sellers, buyers, visitors | Privacy lead + counsel | Published repository text; DPO/transfer/final-role review pending | Align company identity, DPO, roles, countries, lawful bases, retention, rights, complaints, AI/analytics |
| `POL-004` | Privacy Policy - Arabic | Last updated 2026-07-13 | Sellers, buyers, visitors; Arabic primary | Privacy lead + counsel | Published repository text; parity review pending | Qualified Arabic review and synchronized approval/version |
| `POL-005` | Versioned Seller Authentication Contract | Contract v7; invariants v1; Android profile v1; approved 2026-08-01 | Engineering, security, release | Ayman Mohamed Abdellatif | Versioned, behavior-tested, and build-guarded; V6 runtime profile unchanged | No outcome change without explicit approved migration and evidence |
| `POL-006` | Localization Architecture Contract | Contract v3; invariants v1; Android profile v1; approved 2026-08-01 | Product, engineering, release | Product owner | Versioned and build-guarded; locale/runtime profile unchanged | Preserve current locale scope unless an approved profile migration updates evidence |
| `POL-007` | Production Authentication Plan | Implementation state dated 2026-07-13 | Engineering, operations, release | Auth/release owner | Repository phase documented; production evidence gaps remain | Add release/Play fingerprints and physical-device SMS evidence |
| `POL-008` | Application Plan | Repository current | Product and engineering | Product owner | Implemented/current-state source with known gaps | Update only when product behavior changes |
| `POL-009` | Security Model | Repository current | Engineering, security, operations | Security/architecture owner | Current architecture source | Update with approved auth/security model changes |
| `POL-010` | Temporary Data, Vendor, and Release Freeze | `GOV-FREEZE-001`, effective 2026-07-18 | All launch contributors | Executive sponsor | Active; acknowledgement pending | Complete acknowledgement record and review at each gate |

## Version rules

- Public Arabic and English versions must share the same approval scope,
  effective date, and material meaning.
- Store the exact accepted policy identifiers with user consent evidence.
- A changed operator, DPO, purpose, lawful basis, vendor/country, retention,
  billing model, deletion promise, complaint route, or material user right
  requires version and re-notice/acceptance analysis.
- A policy file is not approved merely because it is merged or deployed.
- Production behavior, support procedures, Play Data Safety, and public notices
  must be reconciled before release.

## Acceptance evidence check

The production-auth plan states that migrations 021-023 store legal acceptance
and deletion-request evidence. Before G6/G9, verify against the final policy
versions that:

1. Terms and Privacy identifiers are immutable and queryable;
2. acceptance timestamp, language, actor/account, and separate marketing
   consent are recorded without sensitive logging;
3. withdrawal and updated-version journeys work;
4. the published URL and in-app text match the stored version;
5. deletion/retention exceptions are disclosed and operationally implemented.
