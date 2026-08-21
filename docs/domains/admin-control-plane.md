---
status: current
generated: false
owner: backend
last_verified: 2026-08-21
applies_to: [production, staging]
authoritative_for: [admin-control-plane-domain]
---
# Admin control plane

The internal operations surface: **176 of the backend's 246 API operations**,
72% of the whole API, served by a different Worker from the seller API and
protected by a different identity system.

This is the largest single area of the backend. This page is a map of it, not
an exhaustive route list — that is `contracts/openapi/src/admin-v1.json`, which
is authoritative.

## Three Workers, one boundary

| Worker | Serves | Data bindings |
| --- | --- | --- |
| `orderak-admin-edge` | `admin.orderak.app` — the React app's static assets | **None** |
| `orderak-admin-worker` | `/api/admin/v1/*` | D1, R2 media, R2 audit, queues |
| `orderak-worker` | Seller and public API | D1, geo D1, R2, queues, Durable Object |

The edge Worker holds **no D1, R2, KV or provider access at all**. It serves the
bundle and reaches the admin Worker over the `ADMIN_WORKER` service binding.
A compromise of the asset-serving layer therefore yields no data access — the
static surface and the privileged surface are separate deployments with
separate credentials.

`admin.orderak.app/` is the only canonical admin URL. There is no embedded
`/admin` path on the public Worker and no localhost fallback in production.

## Administrator identity is separate

Administrators share no tables with sellers. `admin_users`, `admin_sessions`,
`admin_recovery_codes`, `admin_invitations`, `admin_auth_challenges` and
`admin_action_authorizations` are a parallel system, and an administrator is
never a `sellers` row.

`services/backend/src/domains/admin/admin-auth.ts` implements:

- **TOTP with versioned keys.** `totp_secret_ciphertext` is encrypted at rest
  under a key selected by `totp_key_version`; `ADMIN_TOTP_KEY_CURRENT` picks
  which key new secrets use, while `ADMIN_TOTP_KEY_V1` / `_V2` stay available to
  decrypt existing rows. Rotation re-encrypts forward without a flag day. Both
  environments are on key version 2.
- **Peppered session and recovery secrets.** Separate peppers for session
  tokens and recovery codes, so compromising one store does not yield the other.
- **Opaque sessions with CSRF binding.** The session cookie value is not a
  token — only its hash and server-side expiry and revocation state are stored,
  and `csrf_hash` binds the session to its CSRF secret. The Worker resolves the
  session server-side on every request.

### Step-up authorization for dangerous actions

`consumeActionAuthorization(request, env, admin, action, entityId)` requires a
fresh, single-use authorization for a specific `(action, entityId)` pair,
recorded in `admin_action_authorizations`.

Being logged in is not enough to perform a destructive operation. The
authorization is consumed on use, so it cannot be replayed against a second
entity.

## Audit, signed and archived

`admin_audit` records who did what. Archives are written to the
`orderak-admin-audit` R2 bucket by `archiveAuditBatch` and checked by
`verifyAuditArchives`.

Verification checks the **content hash before the signature**, and reports a
typed reason — `object_missing`, `key_unavailable`, `hash_mismatch`, or
`signature_mismatch`. Ordering matters: a hash mismatch means the bytes changed,
which is a different incident from a signature that will not verify under an
available key. Collapsing them into one "invalid" would lose that distinction.

Signatures are HMAC-SHA256 with a `signing_key_version` on every record, so
signing keys rotate the same way TOTP keys do.

> The code comments record that this table once carried a `verified_at` column
> nothing wrote and a signature nothing checked. The verification path exists
> now because that gap was found and closed — treat any future "we have audit
> signing" claim as requiring a run of `verifyAuditArchives`, not a schema
> inspection.

`admin_audit` IP addresses are nulled after 30 days and rows deleted after 2
years by the [retention sweep](./identity.md#retention).

## What the control plane controls

**Feature flags.** `feature_flags` and `feature_flag_rules`, evaluated by
`evaluateFlag` against a `FlagContext` of flag key, actor key, country, app
version, plan, seller and store. The result reports both a `value` and its
`source`, plus any `envGate` — so an operator can see *why* a flag resolved as
it did, not just what it resolved to. The admin panel exposes this as a flag
simulator.

**App version policies.** `app_version_policies`, resolved by
`effectiveAppVersionPolicy(env, platform, country)` — minimum and recommended
client versions, per platform and per country, which is how a forced upgrade is
rolled out to one market at a time.

**Store capabilities.** `capability_definitions` and
`store_capability_overrides`, read at request time by `storeCapabilityEnabled`.
This is how `orders.accepting` closes a single store's order intake — see
[orders](./orders.md#the-public-order-path).

**Runtime settings.** The `settings` table, read by `runtimeControlEnabled`.
This is the second billing gate described in
[billing](./billing.md#two-gates-not-one).

**Entitlements and plans.** `admin-entitlements.ts` is the write side of the v2
tables that [entitlements](./entitlements.md) describes from the read side:
publishing plan revisions, recording `organization_plan_approvals`, and writing
`organization_entitlement_overrides`.

**Exports.** `admin_exports` and `admin_audit_exports`, produced by
`generateExport`, delivered by `handleExportFile`, with `markExportDeadLetter`
for failures. Transport is the `orderak-admin-exports` queue plus its DLQ.

**Content and communications.** `content_pages`, `content_page_versions`,
`content_configs`, `announcements`, `announcement_reads`, plus support
(`support_tickets`, `support_messages`, `support_macros`) and the email template
system.

**Buyer protection.** `buyer_restrictions` and `buyer_privacy_requests` — see
[orders](./orders.md#buyers-are-derived-not-stored).

**Operational visibility.** `error_logs`, `security_alerts`, `api_endpoints`,
`operational_job_runs`, `operational_leases`, `provider_circuit_state`.

## An internal project tracker lives in the product database

`project_tasks`, `project_docs`, `roadmap_items`, `bugs` and `releases` are
real tables, created for the admin panel and queried by
`domains/admin/admin-project.ts`.

They hold Orderak's own engineering workflow, not customer data, inside the same
D1 database as customer data. That is worth knowing before reasoning about
backup scope, restore blast radius, or row counts.

**Measured against production D1 on 2026-08-21, it is almost entirely unused:**

| Table | Rows in production |
| --- | --- |
| `project_tasks` | 0 |
| `roadmap_items` | 0 |
| `bugs` | 0 |
| `releases` | 0 |
| `project_docs` | 6 |
| `app_screens` | 23 |

`app_screens` is genuinely live — it is the synced
[screen manifest](./design-system.md#the-app-screen-manifest), not part of the
tracker. The four empty tables and `project_docs` are the tracker itself.

So the schema, the admin routes in `admin-project.ts`, and the panel screens
exist for a workflow nobody is running. That makes them a **removal candidate**
rather than a documentation gap. Removing them is a schema change with its own
migration and approval, and is out of scope for documentation — but nothing
should be built on top of them in the meantime.

## Boundaries

- **Seller-facing behaviour** belongs to the seller domains. This page covers
  the operator's side of the same tables.
- **Route shapes and payloads** are `contracts/openapi/src/admin-v1.json` and
  the [API reference](../reference/api.md).
- **Security properties** are the [security model](../architecture/security-model.md)
  and the [threat model](../architecture/threat-model.md), both authoritative
  over this page.
- **Secret rotation procedure** is the
  [secret rotation runbook](../runbooks/secret-rotation.md).

## Related

- [Security model](../architecture/security-model.md)
- [Threat model](../architecture/threat-model.md)
- [Secret rotation runbook](../runbooks/secret-rotation.md)
- [Entitlements domain](./entitlements.md)
- [Billing domain](./billing.md)
- [Deployment environment map](../architecture/deployment-environment-map.md)
