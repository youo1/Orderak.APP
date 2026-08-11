# Phase 4 traceability and G4 gate record

## Deliverable traceability

| Roadmap item | Controlled artifact | Implementation / evidence | Status |
| --- | --- | --- | --- |
| `PRD-01` scope freeze | [Launch PRD](./phase4-product-requirements.md) | Android screen tree, backend routes, explicit deferred list | Implemented; approval pending |
| `PRD-02` traceability | This document and requirements register | Requirement IDs linked to docs, code, tests, risks, and gates | Implemented baseline |
| `IAM-01` roles/permissions | [Roles and journeys](./phase4-roles-and-journeys.md) | `services/backend/src/domains/identity/auth.ts`, admin route gates, seller store scoping | Implemented baseline; compliance access gap noted |
| `FLOW-01` seller journeys | [Roles and journeys](./phase4-roles-and-journeys.md) | Android navigation, auth/sync/order/deletion code and tests | Implemented baseline; ops evidence pending |
| `FLOW-02` buyer/responsibility | [Roles and journeys](./phase4-roles-and-journeys.md) | Public routes/order form; counsel confirmation pending | Draft control; approval pending |
| `BILL-01` billing decision | [ADR-004](../decisions/adr-004-free-launch-billing.md) | Free launch; direct merchant buyer payments | Engineering decision implemented; approval pending |
| `BILL-02` enforce decision | Worker launch flags and fail-closed tests | `services/backend/src/domains/commerce/billing.ts`, `services/backend/src/entrypoints/public-worker.ts`, `services/backend/test/index.spec.ts` | Implemented for default-off state |
| `DATA-01` data/permissions | [Data and permission matrix](./phase4-data-and-permissions.md) | Manifest review, privacy/DPO workstream, Data Safety later | Baseline complete; legal retention pending |
| `ACC-01` acceptance criteria | PRD, journey, content, and billing criteria | Existing tests plus G6 backlog below | Partially evidenced |
| `UGC-01` content controls | [Content controls](./phase4-content-controls.md) | Admin/content/support capabilities; workflow build/test pending | Requirements frozen; implementation gap |

## Requirement-to-test baseline

| Requirement group | Current automated evidence | G6 evidence still required |
| --- | --- | --- |
| Authentication | `AuthViewModelTest`, `OtpRequestStateTest`, backend Firebase auth tests, protected contract gate | Production signed-build physical SMS and recovery matrix |
| Store/catalog/public order | Backend identity, store, public-route, translation-schema tests | Android repository/UI sync, media failure, cross-store adversarial suite |
| Orders/customers | Repository state constraints and backend store/order behavior | Full status/failure/duplicate/offline and buyer-data isolation suite |
| Localization/accessibility | Android localization tests, locale UI test, Worker i18n tests, protected localization gate | Frozen launch journey screenshots and accessibility report |
| Privacy/retention/deletion | Backend retention tests and documented deletion flow | Vendor deletion, backup expiry/replay, legal hold, rights and support evidence |
| Admin/RBAC | Admin smoke tests and route permission checks | Formal permission-denial matrix, MFA, break-glass, audit completeness evidence |
| Billing/AI default off | Worker fail-closed tests | Signed production configuration evidence; billing lifecycle tests only if re-enabled |
| Content controls | Requirements only | End-to-end report/takedown/appeal/suspension tests and operational exercise |

## Gate G4 decision record

Target state: `Conditional - engineering baseline frozen; formal gate not passed`.

| Required approver | Decision | Date / evidence |
| --- | --- | --- |
| Product owner | Pending named acceptance |  |
| Egyptian counsel | Pending responsibility, content, consumer, billing, and operator review |  |
| DPO / privacy lead | Pending data role, purpose, retention, notice, and transfer review |  |
| Security lead | Pending role/permission and abuse-control review |  |
| Finance/accountant | Pending free-launch, tax/invoice, future billing, refund and reconciliation review |  |

G4 passes only when all five approve the same version, the requirements register
has no unowned launch item, and every exception is either removed from scope or
has an approved change and blocking downstream gate. Until then, engineering may
close frozen free-launch gaps but must not enable billing, AI, regulated features,
new permissions, new vendors, or new data fields.

## Open blockers carried forward

- Named role acceptance and formal Phase 0/G0 authority.
- Counsel/DPO confirmation of operator, merchant/buyer, consumer, data role,
  retention, complaint, refund, and content positions.
- Content report/takedown/appeal implementation and operational ownership.
- Compliance reviewer least-privilege access if `readonly` is insufficient.
- Full G6 acceptance evidence for offline, failure, privacy, security,
  accessibility, Arabic/RTL, and production configuration.
