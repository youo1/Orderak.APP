<!-- PROTECTED SETUP: Any modifications to this documented setup must be reviewed and approved. Unapproved changes are strictly prohibited. -->

> **⚠️ PROTECTED SETUP**
>
> Any modifications to this documented setup must be reviewed and approved.
> Unapproved changes are strictly prohibited. If a step in this document no
> longer matches reality, raise it for review — do not silently edit the
> setup or this document.

# Orderak — Complete Setup Guide

> **Status:** Current repository setup; production console state and secrets
> must be verified in their owning systems
>
> **Last verified:** 2026-07-31

This is the **single canonical setup document** for Orderak. It covers every
step needed to go from a fresh machine to a running local development
environment, and from a fresh Cloudflare account to a deployed production
Worker.

Orderak is an Android application for small sellers to manage a store,
products, customers, and orders from their phone. The repository contains two
deployable pieces plus supporting material:

- **`apps/seller-android/`** — the seller app: Kotlin, Jetpack Compose, Hilt, Room,
  WorkManager, Retrofit, and Firebase Phone Authentication. Application ID:
  `app.orderak.seller`.
- **`services/backend/`** — a Cloudflare Worker (TypeScript) that owns the D1 database,
  R2 media storage, D1-backed sessions, authentication enforcement, billing, email,
  and all calls to AI or other third-party services (DeepSeek today).
- **`packages/ai-prompts/`** — prompt templates used by the backend's AI features.
- **`design/`** — Figma and Canva links plus exported design assets.
- **`docs/`** — product plan, API reference, architecture notes, and companion
  guides.

The Android app talks **only** to the Cloudflare backend. Secret keys never
ship inside the app.

---

## 1. Prerequisites

This guide assumes a **fresh machine with nothing pre-installed**. You need:

| Requirement | Purpose | Notes |
| ----------- | ------- | ----- |
| **Git** | Clone and manage the repository | Any recent version |
| **Node.js 20 LTS or newer** | Runs Wrangler, tests, and backend tooling | Includes `npm`/`npx` |
| **Android Studio** (latest stable) | Builds the Android app | Bundles the Android SDK **and JDK 17** — no separate JDK install needed |
| **Cloudflare account** | Hosts Workers, D1, R2, Queues, and Email | **Workers Paid** plan is required for Email Sending (Section 8) |
| **Firebase project** | Phone (SMS) authentication for the app | Phone sign-in method must be enabled |
| **DeepSeek account** *(optional)* | AI chat testing and automatic product translation | Production AI chat is disabled by default; without a key, translations fall back to seller-authored text |
| **Payment-provider sandbox** *(future)* | Future paid-plan testing | The current backend implements `MockGateway` only; no Stripe gateway is wired |

Optional contributor tools: GitHub CLI, and AI coding assistants such as
Claude Code, Codex CLI, or Gemini CLI.

> **Note:** Wrangler (the Cloudflare CLI) is **not** installed globally. It is
> installed automatically as a backend npm dependency and invoked with
> `npx wrangler …`.

### 1.1 Install the core tools

1. **Git** — download from <https://git-scm.com/download/win> and install with
   default options.
2. **Node.js** — download the LTS installer from <https://nodejs.org/> and
   install with default options.
3. **Android Studio** — download from <https://developer.android.com/studio>
   and install. On first launch, let the setup wizard install the default
   Android SDK components.

### 1.2 Verify the toolchain

Open **Command Prompt (CMD)** on Windows and confirm each tool responds:

```cmd
git --version
node --version
npm --version
```

(`npx wrangler --version` will work after Section 3's `npm install`.)

---

## 2. Clone the Repository

```cmd
cd %USERPROFILE%\Documents
git clone <your-orderak-repository-url> Orderak
cd Orderak
```

All backend commands below run from `Orderak\backend`; all Android commands
run from `Orderak\apps\seller-android`.

---

## 3. Backend — Local Development Setup

### 3.1 Install dependencies

```cmd
cd services/backend
npm install
```

This installs Wrangler, Vitest, TypeScript, and the Worker's runtime
dependencies.

### 3.2 Create your local secrets file

Local secrets live in `services/backend/.dev.vars` which is **git-ignored and must
never be committed**:

```cmd
copy .dev.vars.example .dev.vars
```

Then open `.dev.vars` and fill in values:

| Variable | Required locally? | Purpose |
| -------- | ----------------- | ------- |
| `DEEPSEEK_API_KEY` | No | AI provider. With `AI_ASSISTANT_ENABLED=false`, `/api/v1/chat` returns `503` regardless of the key. Missing provider/budget configuration returns stable `ai_temporarily_unavailable`; catalog translations fall back to seller-authored text. |
| `ADMIN_API_KEY` | Admin Worker only | Bootstrap/break-glass key. It is not accepted as a browser session. |
| `ADMIN_JWT_SECRET` | Local tests only | Signs the explicitly enabled local bearer used by backend tests; production browser auth is session-based. |
| `ADMIN_SESSION_PEPPER` | Admin Worker | Hashes opaque session and invitation tokens. |
| `ADMIN_RECOVERY_PEPPER` | Admin Worker | Hashes the ten single-use MFA recovery codes. |
| `ADMIN_TOTP_KEY_CURRENT` | Admin Worker | Integer version of the active TOTP encryption key. |
| `ADMIN_TOTP_KEY_V1` / `ADMIN_TOTP_KEY_V2` | Admin Worker | Base64url 32-byte AES-256-GCM keys retained while ciphertext using that version exists. |
| `ADMIN_EXPORT_SIGNING_KEY` | Admin Worker | Hashes one-use, five-minute export download tokens. |
| `ADMIN_AUDIT_SIGNING_KEY` | Admin Worker | HMAC-signs every hash-chained audit archive batch. |
| `BUYER_PRIVACY_PEPPER` | Both Workers | HMAC key used for buyer restriction/privacy matching without storing plaintext identifiers. |
| `PAYMENT_WEBHOOK_SECRET` | Yes | Payment gateway webhook signature secret. |
| `STRIPE_SECRET_KEY` | No | Reserved and currently ignored. `MockGateway` is the only implemented gateway; setting this value does not enable Stripe. |
| `EMAIL_FROM` | No | Overrides the default sender `Orderak <no-reply@orderak.app>`. |
| `FORWARD_TO` | No | Personal inbox that receives a copy of inbound mail (must be a verified Email Routing destination). |
| `FIREBASE_WEB_API_KEY` | Yes (for auth flows) | Web API key of your Firebase project; the Worker uses it to verify Firebase ID tokens. See Section 6. |
| `FIREBASE_PROJECT_ID` | For deletion fulfillment | Firebase/Google Cloud project ID used by the Identity Platform Admin REST API. |
| `FIREBASE_SERVICE_ACCOUNT_EMAIL` | For deletion fulfillment | Least-privilege service-account issuer with Firebase Auth user lookup/delete permissions. |
| `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` | For deletion fulfillment | PKCS#8 private key stored only as a Worker secret; escaped newlines are supported. |
| `WEBAUTHN_ANDROID_ORIGINS` | Passkeys | Comma-separated exact `android:apk-key-hash:<base64url-sha256>` origins. Production contains release and Play App Signing certificates only; staging contains its debug certificate. |
| `WEBAUTHN_WEB_ORIGIN` | Optional web Passkeys | Exact `https://orderak.app` in production or `https://staging.orderak.app` with the staging RP. Omit until that web Passkey client is deliberately released. |
| `ANDROID_RELEASE_SHA256_CERT_FINGERPRINTS` | Asset Links | Comma-separated, colon-formatted SHA-256 fingerprints for the signed release and Play App Signing certificates. |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL` | Play lifecycle | Least-privilege Android Publisher issuer; set on public and Admin Workers. |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY` | Play lifecycle | PKCS#8 key for the same account; set on public and Admin Workers. |
| `GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY` | Play lifecycle | Base64-encoded 32-byte AES-GCM key shared by both Workers. |
| `GOOGLE_PLAY_PUBSUB_AUDIENCE` | Public Worker RTDN | Exact OIDC audience configured for the Pub/Sub push subscription. |
| `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL` | Public Worker RTDN | Exact verified Pub/Sub push identity. |

AI enablement additionally requires positive non-secret values for
`AI_MONTHLY_BUDGET_MICRO_USD`,
`DEEPSEEK_INPUT_MICRO_USD_PER_MILLION`, and
`DEEPSEEK_OUTPUT_MICRO_USD_PER_MILLION`. Keep the monthly budget at `0` while AI
is disabled. Provider pricing is configuration, not source code, so it can be
reviewed and updated without silently changing cost calculations.

### 3.3 Create the local database

The backend uses a single Cloudflare D1 database named `orderak-db`. Apply
every migration to the **local** database:

```cmd
npx wrangler d1 migrations apply orderak-db --local
```

Migration `027_operations_coverage.sql` is required before using the new
seller/admin operations surfaces. It adds device display metadata, translation
review provenance, announcement read state, observed job runs, retry-safe ad
event keys, and the D1 billing control. Apply it through Wrangler's migration
ledger; do not execute the SQL file directly.

Migration `028_admin_control_plane.sql` adds opaque admin sessions, MFA and
recovery state, invitations, fresh-action authorizations, security alerts,
capability/flag/version policy, store controls, buyer privacy/restriction,
content/macros, governed exports, and audit-archive metadata.
Migration `029_admin_recovery_acknowledgement.sql` adds the server-enforced
initial recovery-code acknowledgement gate.

Migration `030_play_billing_reliability.sql` adds encrypted verification jobs,
organization generation heads/triggers, Play account hashes, shared provider
circuits, AI usage/budget evidence, and replacement metadata. It is additive
and does not activate acquisition, lifecycle processing, entitlements v2, or AI.

Migration `031_play_verification_leases.sql` adds the 120-second atomic claim
lease, reclaim evidence, stale-token protection fields, and one-child DLQ
requeue constraint. Migration `032_stable_identity_and_routing.sql` adds stable
Firebase-phone identities, resumable migration issues, organization routing,
and single-use phone-change challenges. Run the admin identity backfill in
bounded batches until `GET /api/admin/v1/identity/readiness` reports `ready=true`.
Keep `AUTH_IDENTITY_ENABLED=false` until then; rollback is the same flag.
Keep `PHONE_CHANGE_ENABLED=false` until Android UI/recovery receives separate
release approval.

Migration `033_auth_onboarding_v2.sql` adds hash-only resumable onboarding,
seller-private profiles, Passkey credentials and one-use WebAuthn challenges,
ten-minute recent-auth proofs, email-verification tokens, store
category/city fields, and GeoNames/FTS5 city-search tables. It is additive:
legacy `/api/v1/auth/session` and `/api/v1/register` remain intact. Keep
`ONBOARDING_ENABLED=false` and `PASSKEY_ENABLED=false` until Sections 6.3
and 6.4 are complete. After release-owner/legal approval, apply
`034_publish_legal_v3.sql` before enabling onboarding, so the versions accepted
on account step 1 match the updated Passkey/birth-year/private-email
disclosures.

Migration `039_add_private_birth_year.sql` is the required forward repair for
databases that recorded migration 033 before the approved birth-year fields
were added. Apply 039 before shipping the account form or enabling Auth V6.
The Worker still requires a valid year for every new onboarding profile; the
D1 column remains nullable only for compatibility with legacy rows.

Migration `039b_repair_email_schema_drift.sql` is an idempotent forward repair
for databases that recorded migration 004 without retaining its email tables.
It must run before migration 040 so the queued email consumer and bounded
retention indexes have the template/history/event schema they require.

Migration `040_cloudflare_scalability_hardening.sql` moves admin MFA and
enrollment challenges to atomic, single-use D1 rows; adds durable outbound
email jobs, export leases/retry counters, bounded-maintenance leases, and
retention/archive indexes. Apply it before deploying the Workers that consume
the email/export queues.

The current topology remains one physical D1. Before introducing a target
shard, follow [ADR-007](../decisions/adr-007-shard-ready-single-d1.md), rehearse
the [tenant migration runbook](../runbooks/tenant-shard-migration.md) twice, and
store completed evidence under `docs/governance/evidence/`.

### 3.4 Admin frontend and private Worker

Install and build the frontend from `apps/admin-web` with `npm ci`,
`npm run lint`, `npm test -- --run`, and `npm run build`. Deploy the API-only
Worker with `npm run deploy:production:admin` from `services/backend`, then run
`npm run deploy:production` from `apps/admin-web`. The Admin Edge Worker serves
`dist/` through Workers Static Assets and forwards only `/api/admin/v1/*` over
its `ADMIN_WORKER` service binding to `orderak-admin-worker`. Do not add a route
or enable `workers.dev`/preview URLs for the private Admin Worker.

Create the private R2 audit/export bucket and every Queue and DLQ named by the
Wrangler files: admin export, Play billing, and transactional email. Do not
reuse one workload's queue for another. Apply all pending migrations remotely,
including migrations 039b and 040, set every admin/provider secret,
then run the production smoke suite before issuing the owner handoff. AI,
billing, and provider gates remain `false` until their independent release
checks pass.

> **Canonical migration rule:** always apply schema changes with
> `npx wrangler d1 migrations apply`. It runs every file in
> `services/backend/migrations/` (currently `001_init` through
> `040_cloudflare_scalability_hardening`, including both intentionally distinct
> `015_*` files and the forward-repair migration `039b_repair_email_schema_drift`)
> exactly once and records them in the
> migrations ledger. **Never** run individual migration files with
> `wrangler d1 execute` — that bypasses the ledger and can cause a migration
> to run twice. Details: [`guides/database-migrations.md`](./database-migrations.md).

### 3.4 Run the test suite

```cmd
npm test
```

All tests must pass before you continue.

Install and validate the pre-release OpenAPI contracts from the repository root:

```cmd
cd contracts/openapi
npm ci
npm run check
```

For Android parallel development, start Prism from the repository root:

```cmd
npm run mock:seller-v1
```

Prism listens on `http://localhost:4010`; the Android `mockDebug` variant uses
`http://10.0.2.2:4010`. That flavor has no release variant, and cleartext is
enabled only by its manifest overlay.

### 3.5 Start the local Worker

```cmd
npx wrangler dev
```

The backend is now available at `http://localhost:8787`. When the `send_email`
binding is unavailable, the backend uses a no-op provider. The committed
configuration sets `send_email.remote=true`; with authenticated remote bindings,
local development can send real email. Use verified test recipients and remove
or override the remote binding when a no-send local session is required.

---

## 4. Cloudflare — Provisioning a Fresh Account

Skip this section if you only develop locally. For the first deployment from a
brand-new Cloudflare account:

### 4.1 Authenticate Wrangler

```cmd
cd services/backend
npx wrangler login
```

### 4.2 Create the cloud resources

The Workers (configured in
[`services/backend/wrangler.jsonc`](https://github.com/youo1/Orderak/blob/main/services/backend/wrangler.jsonc))
bind D1, R2, and dedicated queues. On a fresh account, create each one and copy the IDs
Wrangler prints into `wrangler.jsonc`:

```cmd
npx wrangler d1 create orderak-db
npx wrangler r2 bucket create orderak-media
npx wrangler r2 bucket create orderak-admin-audit
npx wrangler queues create orderak-admin-exports
npx wrangler queues create orderak-admin-exports-dlq
npx wrangler queues create orderak-play-billing
npx wrangler queues create orderak-play-billing-dlq
npx wrangler queues create orderak-email
npx wrangler queues create orderak-email-dlq
```

Update in `wrangler.jsonc`:

- `d1_databases[0].database_id` → the new D1 database ID
- (`r2_buckets` needs no ID — the bucket name `orderak-media` is enough)

> Changing resource IDs in `wrangler.jsonc` is a reviewed change under the
> protection notice at the top of this document.

### 4.3 Apply migrations to the remote database

```cmd
npx wrangler d1 migrations apply orderak-db --remote
```

### 4.4 Set production secrets

Production secrets are stored as Worker secrets, never in files:

```cmd
npx wrangler secret put ADMIN_API_KEY
npx wrangler secret put ADMIN_JWT_SECRET
npx wrangler secret put PAYMENT_WEBHOOK_SECRET
npx wrangler secret put FIREBASE_WEB_API_KEY
npx wrangler secret put FIREBASE_PROJECT_ID
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
npx wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY
npx wrangler secret put GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY
npx wrangler secret put GOOGLE_PLAY_PUBSUB_AUDIENCE
npx wrangler secret put GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL
:: Optional:
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put FORWARD_TO
```

Do not set `STRIPE_SECRET_KEY` for the current free-launch baseline. The runtime
ignores it because no Stripe gateway is implemented. Add a provider secret only
through the approved billing re-enable change.

### 4.5 Deploy

The committed production baseline in both Worker configurations sets
`BILLING_ENABLED="false"`, `GOOGLE_PLAY_LIFECYCLE_ENABLED="false"`,
`ENTITLEMENTS_ENABLED="false"`, `AUTH_IDENTITY_ENABLED="false"`,
`PHONE_CHANGE_ENABLED="false"`, `AI_ASSISTANT_ENABLED="false"`, and an AI
monthly budget of zero. These are launch controls, not secrets. Do not change a gate merely because a provider
secret is configured. Re-enablement requires the approved Phase 4 change,
complete downstream tests, and rollback/evidence capture described in
[ADR-004](../decisions/adr-004-free-launch-billing.md) and the
[launch PRD](../product/phase4-product-requirements.md).

Verify all default-off values in the deployment configuration before every
free-launch deployment.

```cmd
npm run deploy:production
```

#### 4.5.1 Account-level edge controls

Wrangler deploys the application resources, but zone-level controls still need
an explicit Cloudflare dashboard/API rollout:

- enable the Cloudflare Managed Ruleset for `orderak.app`, starting in log mode
  and reviewing false positives before blocking;
- add edge rate-limit rules for authentication, public checkout, media upload,
  and admin login. Keep the D1 limiter as the exact application-level control;
- configure `orderak-admin-audit` so `exports/` objects expire after one day and
  `audit/` objects retain the approved seven-year compliance lock. Verify the
  prefix filters on Staging before Production;
- alert on Queue backlog/oldest-message age and DLQ growth for email, exports,
  and Play billing, plus Worker exceptions and D1 error rate.

These are account-state changes and are not applied by a source deployment.
Capture screenshots or API output in the release evidence before promotion.

### 4.6 Custom domains (`orderak.app`)

The Worker is bound to these hostnames in `wrangler.jsonc`:

| Hostname | Purpose |
| -------- | ------- |
| `orderak.app`, `www.orderak.app` | Public site + store/category/product pages (`/<public_identifier>`) + media (`/media/*`) |
| `api.orderak.app` | Seller `/api/v1/*` and external `/api/integrations/v1/*`; no legacy aliases |
| `admin.orderak.app` | Admin dashboard (panel at root `/`) |

To make them live:

1. **Add `orderak.app` as a zone** in the Cloudflare dashboard (Add a site)
   and point the domain's nameservers at the ones Cloudflare assigns. Wait
   until the zone status is **Active**.
2. **Re-run the relevant Wrangler deployment** — this attaches the custom-domain routes,
   creates the DNS records, and provisions SSL automatically.

> If the zone is not Active yet, `wrangler deploy` warns that it cannot attach
> the custom domains. The public Worker can still deploy while DNS is pending,
> but the admin UI has no embedded or localhost fallback. Deploy
> `orderak-admin-edge` again after the zone becomes Active.

### 4.7 Regenerate types after any binding change

```cmd
npm run cf-typegen
npm run cf-types:check

cd ..\..\apps\admin-web
npm run cf-typegen
npm run cf-types:check
```

### 4.8 Staging environment

Staging is a separate runtime, not a flag that points test builds at production
data. The checked-in `env.staging` configurations use these isolated resources:

| Component | Staging resource |
| --------- | ---------------- |
| Public Worker | `orderak-worker-staging` |
| Public hosts | `staging.orderak.app`, `api.staging.orderak.app` |
| Admin Worker | `orderak-admin-worker-staging` |
| Admin Edge + Static Assets | `orderak-admin-edge-staging`, `admin.staging.orderak.app` |
| Primary and geo D1 | `orderak-db-staging`, `orderak-geo-staging` |
| Media and audit R2 | `orderak-media-staging`, `orderak-admin-audit-staging` |
| Queues | `orderak-admin-exports-staging` + DLQ, `orderak-play-billing-staging` + DLQ, `orderak-email-staging` + DLQ |

Billing, Google Play lifecycle processing, entitlements V2, AI, and the AI
budget remain fail-closed in the committed Staging baseline. Staging email uses
its own Queue and binding; keep its recipients restricted to approved test
addresses and never reuse Production Queue resources.

Apply the two migration streams and deploy:

```cmd
cd services/backend
npx wrangler d1 migrations apply orderak_db --env staging --remote
npx wrangler d1 migrations apply orderak_geo --env staging --remote
npm run deploy:staging
npm run deploy:staging:admin

cd apps\admin-web
npm install
npm run build
npm run deploy:staging
npm run deploy:staging:edge
```

Set Staging Worker secrets with `--env staging`; Admin Worker secrets also need
`--config wrangler.admin.jsonc`. Never copy production database contents,
service-account private keys, seller phone numbers, or admin sessions into
Staging.

GitHub contains separate `staging` and `production` Environments. A merge to
`main` runs the Staging deployment workflow after validation. Production is a
manual workflow that requires the exact tested commit/tag and the confirmation
text `DEPLOY_PRODUCTION`. The current repository plan does not expose GitHub
required-reviewer protection for private Environments, so manual dispatch is
the enforced approval boundary until the plan supports that control.
See the [Staging and Production workflow](./staging-production-workflow.md)
for the complete branch, test, promotion, verification, and rollback procedure.

---

## 5. Admin Panel — First Owner Bootstrap

1. Start the Worker (`npx wrangler dev` locally, or use the deployed URL).
2. Bootstrap the first owner account **once** via
   `POST /api/admin/v1/auth/bootstrap`, authenticated with `ADMIN_API_KEY`, as
   documented in [`api.md`](../reference/api.md).
3. Open the panel — `http://localhost:8787/admin` locally or
   `https://admin.orderak.app` in production — and sign in with the owner's
   email and password.

`ADMIN_API_KEY` is recovery/bootstrap credentials only; it is never entered
into the browser panel. From the panel you manage plans, coupons, affiliate
settings, ad campaigns, email templates, the inbox, and revenue stats.

---

## 6. Firebase — Phone Authentication

The Android app signs sellers in with Firebase Phone Auth. Each developer needs
git-ignored Firebase configuration obtained individually. Production uses
package `app.orderak.seller`; Staging uses `app.orderak.seller.staging` and must
belong to a separate Firebase project:

1. In the [Firebase console](https://console.firebase.google.com/), open the
   Orderak project (or create one on a fresh environment).
2. Add an **Android app** with package name **`app.orderak.seller`** for
   Production, or **`app.orderak.seller.staging`** in the separate Staging
   project.
3. Enable **Authentication → Sign-in method → Phone**.
4. Download **`google-services.json`**. Place Production configuration at
   `apps/seller-android/app/google-services.json` and Staging configuration at
   `apps/seller-android/app/src/staging/google-services.json`. Both paths are ignored
   by Git. **The matching variant build fails without its configuration.**
5. Add your debug signing SHA-1/SHA-256 fingerprints (printed by
   `gradlew.bat signingReport` from `apps/seller-android/`) to the Firebase Android
   app so Phone Auth works on your builds.
6. Give the backend the matching **Web API key** so the Worker can verify
   Firebase ID tokens on new-store registration and device restore — set
   `FIREBASE_WEB_API_KEY` in `.dev.vars` (local) and as a Worker secret
   (Production, Section 4.4) or with `--env staging`.

For automated account deletion, create a dedicated service account with only
Firebase Authentication user lookup and delete permissions
(`firebaseauth.users.get` and `firebaseauth.users.delete`). Store its project ID,
email, and PKCS#8 private key in the three Worker secrets listed above. Do not
reuse the Android client configuration or place this key in `google-services.json`.
Verify lookup, delete, already-absent retry, and credential-failure behavior in
staging before production activation.

Before sending real SMS or publishing a production build, follow the full
production checklist in
[`production-auth-plan.md`](../product/production-auth-plan.md): separate
dev/staging/production Firebase projects, release + Play App Signing
fingerprints, SMS region policy restricted to launch countries, console-side
fictional test numbers only, billing/quota alerts, Play Integrity and
reCAPTCHA fallback testing, and in-app plus public-web deletion request paths.

### 6.1 Immediate production-console actions

These settings are operational controls and cannot be supplied by app code:

1. Set **Authentication > Settings > SMS region policy** explicitly for the
   all-country launch. Do not leave the policy implicit. Enable Blaze billing,
   review Firebase's current per-region deliverability and limits, and keep a
   documented deny list for any destination that cannot be supported safely.
2. Enable the Phone provider and add only console-managed fictional test
   numbers for CI/manual testing. Never ship
   `setAppVerificationDisabledForTesting` or fixed OTP values.
3. Register debug, upload, and Google Play App Signing SHA-1 and SHA-256
   fingerprints in the correct Firebase environment.
4. Enable Play Integrity API and test both Play Integrity and reCAPTCHA
   fallback paths on physical devices.
5. Configure Google Cloud billing budgets, SMS quota alerts, and an owner/on-call
   notification route. Review usage before and after every release.
6. Confirm `ALLOW_UNVERIFIED_REGISTRATION` is absent from production and set
   `FIREBASE_WEB_API_KEY` only through `wrangler secret put`.
7. Publish approved Terms and Privacy versions in the Orderak admin system
   before accepting sign-ins. Repository copies are not proof of legal approval;
   clause-level Arabic/English parity and Egyptian counsel review remain release
   gates. See [legal-document status](../legal/README.md).

### 6.2 Phase 1 database rollout

Migration `021_legal_acceptances.sql` must be applied before deploying the
Phase 1 Worker:

```cmd
cd services/backend
npx wrangler d1 migrations apply orderak-db --remote
```

Verify the migration appears as applied before releasing the Android build. Do
not deploy Android first: `/api/v1/auth/session` intentionally fails if the legal
acceptance table or published legal versions are unavailable.

> **Production status (13 July 2026):** migrations 021–023 are applied and
> verified on `orderak-db`. Owner-confirmed version-2 Terms and Privacy content
> is published in Arabic and English, the deletion-request queue is live, and
> independent Egyptian legal review remains recommended.

### 6.3 Passkey domain and certificate setup

Passkeys use the production RP ID `orderak.app`. Before enabling the feature:

1. Obtain the SHA-256 fingerprints for the signed release artifact and Google
   Play App Signing certificate. Do not put a debug certificate in production.
2. Set `ANDROID_RELEASE_SHA256_CERT_FINGERPRINTS` with both approved
   fingerprints, and set the
   matching `WEBAUTHN_ANDROID_ORIGINS` values on the production Worker.
3. Deploy the Worker while both auth flags remain `false`, then verify
   `https://orderak.app/.well-known/assetlinks.json` from outside the account.
   The statement must name `app.orderak.seller` and only the approved
   production fingerprints.
4. Provision a separate staging Worker, hostname/D1/Firebase project, and RP ID
   `staging.orderak.app`. Point debug builds only at
   `https://api.staging.orderak.app`; publish the debug certificate only under
   the staging RP.
5. On a physical Android 9+ device, verify registration, sign-in, cancellation,
    no-credential handling, replay rejection, UV enforcement, revocation, and
    OTP fallback. Android 7–8 must show the OTP option without attempting
    Credential Manager Passkeys. Cancelling Credential Manager must return to
    Welcome without starting OTP.

Never copy a fingerprint or origin from logs. Compare it with Play Console and
the signed artifact. Orderak does not receive biometric templates; Android's
credential provider performs local user verification.

### 6.4 Static city catalogue, email, and guarded rollout

1. City search uses the public
   [Countries States Cities Database](https://github.com/dr5hn/countries-states-cities-database)
   under ODbL-1.0. It does not require Google Places, billing, an Android key,
   or a Worker secret. Keep the catalogue in the isolated `orderak-geo` D1
   database so it never mixes with account or seller data.

2. Apply the isolated schema and build the pinned, checksum-verified import:

   ```cmd
   npx wrangler d1 migrations apply orderak-geo --remote
   npm run geo:build-import
   npx wrangler d1 execute orderak-geo --remote --file generated/cities-v3.2-export.6.sql
   ```

   The importer downloads only the pinned release, verifies its SHA-256,
   records the source/version/license, and activates the new version only after
   every row is loaded. Generated SQL and source archives are reproducible and
   git-ignored. Verify `city_count` against `COUNT(*)` before rollout. Keep
   visible ODbL attribution in the city dropdown and Help. Retain the old
   GeoNames tables and `geo:build-geonames-rollback` only for rollback.
3. Onboard `orderak.app` in Cloudflare Email Sending and test the
   `account_email_verification` template in Arabic, English, and French.
   Verification is non-blocking, lasts 24 hours, and permits at most three
   resends per hour. It is not an account-recovery channel in V2.
4. Run the authentication, localization, and seller-API contract guards plus Android unit/lint/screenshot/instrumented
    suites, Worker Vitest/TypeScript/architecture verification, Firebase
    fictional-number tests, and physical-device Passkey tests. Include inline
    locked-phone OTP with Autofill/manual Verify, the three-row language sheet,
    bottom-safe-area/keyboard layouts, and the year-only 1900–current-UTC dialog.
5. Deploy the Worker first with onboarding/Passkey/static-city/taxonomy flags off.
   Release Android to a closed track, enable `ONBOARDING_ENABLED`, then
   `STATIC_CITY_CATALOG_ENABLED` and `BUSINESS_TAXONOMY_ENABLED`, then
   `PASSKEY_ENABLED`, and
   advance Play rollout gradually only after monitoring succeeds.
6. Monitor Passkey success/cancel/no-credential rates, OTP fallback, onboarding
   abandonment, verification-email failures, city-search failures, and
   Firebase SMS quota/cost. Logs must not contain phones, OTPs, raw onboarding
   tokens, raw email tokens, or WebAuthn credential IDs.
7. Roll back by setting `STATIC_CITY_CATALOG_ENABLED=false` and
   `BUSINESS_TAXONOMY_ENABLED=false`, then use the retained GeoNames/legacy
   category path. Auth rollback still uses its two existing flags. Leave all
   additive migration data in place; do not drop the additive tables.

---

## 7. Android App — Build and Run

1. Open **Android Studio** → **Open** → select the `apps/seller-android/` folder.
   Android Studio generates `local.properties` (the SDK path) automatically on
   first open; it is git-ignored and needs no manual step.
2. Ensure `app/google-services.json` from Section 6 is in place.
3. Build a debug APK — from Android Studio, or from CMD:

```cmd
cd apps/seller-android
gradlew.bat :app:assembleStagingDebug
```

The debug APK is written to `app/build/outputs/apk/debug/`. The project
targets compileSdk/targetSdk 35 with minSdk 24, and builds with the bundled
JDK 17 (Gradle 8.13 via the wrapper — never install Gradle manually).
Google Play requires new mobile apps and updates to target API 36 from
31 August 2026, so the current target is a time-bounded development baseline,
not the launch target. Recheck the
[official target API requirement](https://developer.android.com/google/play/requirements/target-sdk)
before submission.

For a clean diagnostic rebuild:

```cmd
gradlew.bat --stop
gradlew.bat clean
gradlew.bat :app:assembleStagingDebug --no-build-cache
```

Point the app at your running backend (`npx wrangler dev` from Section 3.5)
and exercise a flow end-to-end.

---

## 8. Email — Sending and Receiving

### 8.1 Outbound (transactional email)

The backend sends password resets, login alerts, and invoices through
**Cloudflare Email Sending** using the native `send_email` binding already
declared in `wrangler.jsonc` — no third-party email API key exists anywhere
in this setup.

One-time onboarding (requires the **Workers Paid** plan):

1. Cloudflare dashboard → **Compute → Email Service → Email Sending**.
2. Click **Onboard Domain** and choose `orderak.app`. Cloudflare adds the
   SPF, DKIM, DMARC, and `cf-bounce` MX records automatically. Click **Done**.
3. Redeploy and refresh binding types:

```cmd
cd services/backend
npx wrangler types
npx wrangler deploy
```

> Until the domain is onboarded you can only send to **verified destination
> addresses** on your account. New accounts start with a conservative daily
> quota that scales with sending reputation. Delivery, bounce, and complaint
> events appear under **Email Service → observability** — there is no
> delivery webhook to configure.

Default templates live in code (`services/backend/src/integrations/email/seeds.ts`) and work
immediately; admins can edit versioned Arabic/English overrides live from the
admin **Emails** tab (with `{{variable}}` / `{{variable|default}}` tokens,
preview, and test-send) — no redeploy needed.

### 8.2 Inbound (admin Inbox)

Incoming mail to addresses like `support@orderak.app` is delivered to the
Worker by **Cloudflare Email Routing**, stored in D1, and shown in the admin
**Inbox** tab:

1. Cloudflare dashboard → **`orderak.app` zone → Email → Email Routing** →
   **Enable Email Routing** (adds the MX + TXT records for you).
2. If you set `FORWARD_TO`, verify that address as a routing destination —
   each message is then re-forwarded there in addition to the in-app copy.
3. Under **Routing rules**, either add a custom address (e.g.
   `support@orderak.app`) with the action **Send to a Worker →
   `orderak-worker`**, or enable the **Catch-all** rule with the same action
   so every address at the domain lands in the Inbox with no code changes.

---

## 9. Verification Checklist

Run the full check before considering the environment ready, and again before
any production release:

```cmd
:: Backend
cd services/backend
npm test

:: Android
cd apps\seller-android
gradlew.bat :app:assembleStagingDebug
gradlew.bat testStagingDebugUnitTest lintStagingDebug assembleStagingDebugAndroidTest
gradlew.bat validateStagingDebugScreenshotTest
gradlew.bat verifyAuthPhase1Contract verifyLocalizationContract verifySellerApiContract
```

- `connectedStagingDebugAndroidTest` additionally runs the instrumented locale matrix
  (Arabic, English, French, `en-XA`, `ar-XB`) when an emulator or device is
  attached.
- Only run `updateStagingDebugScreenshotTest` after visually reviewing an intentional
  UI change — it replaces the approved golden screenshots.

For a production release: both `npm test` and the Android build must pass,
then apply pending remote migrations and deploy:

```cmd
cd services/backend
npx wrangler d1 migrations apply orderak-db --remote
npx wrangler deploy
```

---

## 10. Protected Architecture and Security Rules

These rules are part of the protected setup:

- **Never** put DeepSeek, OpenAI, Claude, Gemini, Cloudflare, Firebase server,
  Figma, Canva, payment, or any other API keys/secrets in the Android app or
  commit them to Git. Secrets live in Cloudflare Worker secrets (production)
  or `services/backend/.dev.vars` (local, git-ignored).
- The Android app calls **only** the Cloudflare backend; the backend calls AI
  providers, databases, and third-party APIs.
- [`localization-architecture.md`](../architecture/localization-architecture.md) is
  a **protected architecture contract** and the only localization master
  document. Do not change the default locale, supported locale set, per-app
  language APIs, App Bundle language-split policy, translation lifecycle
  schema, or screenshot baselines without explicit approval and an update to
  that document. Never restore a manual `locale_config.xml` (AGP generates
  LocaleConfig from `resources.properties` and the `values-*` directories).
  After localization-related edits, run `gradlew.bat verifyLocalizationContract`
  and never bypass or remove the guard.
- Apply database schema changes only through
  `npx wrangler d1 migrations apply` (see Section 3.3).
- Keep documentation in sync: [`api.md`](../reference/api.md) for endpoint changes,
  [`app-plan.md`](../product/app-plan.md) for product behavior, and this file for setup
  steps.

## 11. Tiered subscription setup (local/staging only)

1. Apply migrations `024_versioned_entitlements.sql`,
   `025_entitlement_catalog_seed.sql`, and `030_play_billing_reliability.sql`
   through Wrangler. Migration 025 is
   generated by `node services/backend/scripts/import-plan-catalog.mjs`; do not edit it
   manually.
2. Keep `ENTITLEMENTS_ENABLED=false`, `BILLING_ENABLED=false`, and
   `GOOGLE_PLAY_LIFECYCLE_ENABLED=false` in production until CHG-004 approvals
   and rollout evidence are complete. `BILLING_ENABLED` controls acquisition;
   the lifecycle flag controls verification, RTDN, reconciliation, restore, and
   acknowledgement. The D1 `billing_enabled` control can only narrow acquisition.
3. Create Play subscriptions `orderak_paid1`, `orderak_paid2`, and
   `orderak_paid3`, each with `monthly` and `annual` base plans. Prices remain
   authoritative in Play Console. Do not activate the seeded D1 mappings until
   product IDs, package name, test purchases, acknowledgements, RTDN, tax, legal,
   finance, security, QA, and release approvals are verified.
4. Store these only as Worker secrets:
   `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`,
   `GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY`,
   `GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY` (base64 32-byte AES-GCM key), and
   `GOOGLE_PLAY_PUBSUB_AUDIENCE`, and
   `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL` (the exact authenticated Pub/Sub
   push identity). The non-secret package name defaults to
   `app.orderak.seller`.
5. Give the service account the minimum Play Console permissions needed to read
   and acknowledge subscriptions. Configure Pub/Sub push with a verified Google
   OIDC identity and the exact audience stored above.
6. Create `orderak-play-billing` and `orderak-play-billing-dlq`; retain
   `orderak-admin-exports` exclusively for exports. Confirm the Admin Worker has
   a one-minute outbox sweep, a daily observed account-hash backfill job, and is
   the consumer for both billing queues.
7. Wait for `organizations.play_account_hash` backfill to reach zero remaining.
   Confirm no undispatched/dead-lettered jobs and validate the RBAC/fresh-auth
   DLQ requeue runbook in [`runbooks/play-billing-dlq.md`](../runbooks/play-billing-dlq.md).
8. Run the Worker tests, TypeScript check, Wrangler dry run, Android unit tests,
   the versioned authentication/localization/API guards, and a licensed Play tester lifecycle test
   before requesting production activation.
9. Roll out additively: migration; queues/DLQ/secrets; Workers with flags off;
   Android pending UX; internal Play testing; dashboards/runbook; lifecycle on;
   mappings active; limited acquisition. After the first real purchase, rollback
   disables acquisition but leaves lifecycle on.

### 11.1 Subscription Test Lab

In `admin.staging.orderak.app`, open **Plans & limits → Subscription Test Lab**.
Enter an Organization ID created only for testing, choose Free/Paid 1/Paid 2,
select a one-, four-, or 24-hour expiry, and record the test reason. The Worker
copies only implemented, admin-configurable entitlements into expiring
organization overrides; it does not create or acknowledge a Google Play
purchase.

Use **Reset** before ending a test session. Expiry is still mandatory so an
abandoned session self-cleans. Both apply and reset are audited. The endpoints
return `404` in Production, and Paid 3 is excluded because its custom-required
values cannot be safely inferred by the Test Lab.

### Reliability dashboards and initial alerts

Create log-based metrics for `d1_overload`, `order_number_conflict`,
`play_verification_*`, `play_stale_generation_rejected`,
`provider_circuit_*`, `play_queue_consumer_error`, `play_verification_dlq`, and
`ai_provider_failure`. Join these with Cloudflare Queue backlog/oldest-message
metrics and D1 query latency, query count, and storage. D1 does not expose an
internal queue depth; do not invent one.

Initial paging defaults are: any billing DLQ event or Play security conflict;
billing backlog over 100 or oldest message over five minutes; five D1 overload
errors in five minutes; order-number conflict rate over 1% for fifteen minutes;
and any provider circuit opening. AI budget alerts are emitted once per month at
50%, 80%, and 100%. Record finance, security, and release approvals before
activation and keep the dashboard/runbook links in the release evidence.

---

## 12. Generated design-system rollout

From `services/backend/`, install pinned dependencies, apply migrations 035 and 036,
deploy the public and admin Workers, then run the idempotent revision-1
bootstrap:

```cmd
npm.cmd install
npm.cmd run design-system:check
npx.cmd wrangler d1 migrations apply orderak-db --remote
npm.cmd run deploy
npm.cmd run deploy:admin
npm.cmd run design-system:seed
```

Revision 1 reads the effective `settings.theme_colors` projection so the
migration itself does not change production visuals. Do not remove the legacy
`theme` field until the first schema-v2 Android version code is the enforced
minimum in `app_version_policies` and its enforcement date has passed.
The first v2-capable build is version code `2`.

Migration 036 preserves all revision IDs, hashes, snapshots, active state, and
rollback ancestry while adding optional normalized names and `ON DELETE SET
NULL` ancestry. Deploy its D1 migration before the Workers, then deploy the
Admin Edge Worker with Static Assets. Verify **Apply as current**, naming,
activation, inactive deletion, and desktop/mobile navigation behavior after the
rollout.

Approved WOFF2 files and OFL license copies live in
`services/backend/assets/static/fonts/`. Regenerate the canonical fixture after an
intentional pinned generator change with:

```cmd
npm.cmd run design-system:generate
cd apps\seller-android
gradlew.bat verifyDesignSystemContract
```

Configure a Cloudflare log alert for repeated
`signal=design_system_fallback`; follow
[`runbooks/design-system-recovery.md`](../runbooks/design-system-recovery.md).

## 13. Companion Documents

| Document | Contents |
| -------- | -------- |
| [`index.md`](../index.md) | Documentation navigation hub |
| [`glossary.md`](../reference/glossary.md) | All domain terms with Arabic translations |
| [`api.md`](../reference/api.md) | Backend API reference, including admin bootstrap |
| [`app-plan.md`](../product/app-plan.md) | Product plan and behavior |
| [`guides/database-migrations.md`](./database-migrations.md) | Section-by-section explanation of every migration |
| [`production-auth-plan.md`](../product/production-auth-plan.md) | Production Firebase/auth console checklist |
| [`localization-architecture.md`](../architecture/localization-architecture.md) | Protected localization architecture contract |
| [Android README](https://github.com/youo1/Orderak/blob/main/apps/seller-android/README.md) | Android build, localization QA, and screenshot testing |
| [Backend README](https://github.com/youo1/Orderak/blob/main/services/backend/README.md) | Backend-specific notes |
| [Repository instructions](https://github.com/youo1/Orderak/blob/main/AGENTS.md) | Contributor and AI-assistant rules |
