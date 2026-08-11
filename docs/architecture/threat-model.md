# Threat Model

> **Status:** Draft for review  
> **Last updated:** 2026-08-11 — T-009 corrected: the pnpm-side supply-chain controls this row described as missing were already live (`pnpm audit`, SBOM generation, Renovate); only the Gradle-side gap was real.  
> **Methodology:** Asset-based STRIDE-lite  
> **Scope:** Orderak seller Android app + Cloudflare Workers backend + public store pages

## 1. Assets

| Asset | Value | Location |
|---|---|---|
| Seller phone number | Auth identity; PII | D1 `sellers.phone`, `legal_acceptances.phone_e164`, Firebase Auth |
| Device secrets | Session credential | D1 `seller_devices.secret_hash` (hashed) |
| Buyer contact data | Order fulfillment; PII | D1 `orders.buyer_phone`, `orders.buyer_name` |
| Seller store data | Business records | D1 `sellers`, `products`, `categories`, `orders` |
| Payment events | Billing evidence | D1 `payment_events` (scrubbed of card data) |
| Admin credentials | Platform control | D1 `admin_users.password_hash`, `admin_users.totp_secret` |
| Admin opaque session | Session authority | HttpOnly cookie; token hash and expiry in D1 |
| R2 media | Seller images | R2 `stores/{uuid}/` |

## 2. Threat Catalog

### T-001: Account Takeover via OTP Interception

| Field | Detail |
|---|---|
| STRIDE | Spoofing |
| Asset | Seller phone number (auth identity) |
| Threat scenario | Attacker intercepts Firebase SMS OTP, registers/recovers as seller |
| Existing controls | Firebase SMS verification; server-side token validation; OTP expires; stale callbacks rejected; resend requires same phone number |
| Residual risk | Low — SMS is not end-to-end encrypted but Firebase handles transport; social engineering of OTP remains possible |
| Mitigation | Rate limit OTP attempts (15/5min); log failed attempts; consider Play Integrity API for app attestation in future |

### T-002: Unauthorized Cross-Store Access

| Field | Detail |
|---|---|
| STRIDE | Information Disclosure |
| Asset | Seller store data, buyer contact data |
| Threat scenario | Seller A reads/writes Seller B's products, orders, or customers |
| Existing controls | Every API query is store-scoped (`WHERE store_id = ?`); seller resolved from phone+secret headers; cross-store requests return 404 |
| Residual risk | Low |
| Mitigation | None required — server-side authorization is per-request |

### T-003: API Abuse / Brute Force

| Field | Detail |
|---|---|
| STRIDE | Denial of Service |
| Asset | Backend availability |
| Threat scenario | Attacker floods endpoints to exhaust resources or bypass rate limits |
| Existing controls | Per-endpoint rate limits (login 15/5min, register 10/min, upload 60/hr, chat 20/min); rate_limits table enforces window-based counting; Cloudflare DDoS protection at edge |
| Residual risk | Low — edge protection handles volumetric attacks; application rate limits prevent abuse |
| Mitigation | Monitor rate limit hit counts; alert on sustained spikes |

### T-004: Device Secret Theft from Compromised Device

| Field | Detail |
|---|---|
| STRIDE | Spoofing |
| Asset | Device secrets |
| Threat scenario | Attacker gains physical access to seller's unlocked device and extracts session credentials |
| Existing controls | Secret stored in Android DataStore (app-private); random high-entropy token stored server-side as `sha256$<hex>`; legacy PBKDF2/plaintext values migrate after successful verification; logout clears SessionStore; device removal invalidates the credential |
| Residual risk | Medium — physical device compromise is hard to prevent; single-device plan rotates credential on re-auth |
| Mitigation | Future: biometric lock on app launch; device attestation via Play Integrity |

### T-005: Privilege Escalation in Admin Panel

| Field | Detail |
|---|---|
| STRIDE | Elevation of Privilege |
| Asset | Admin credentials, platform control |
| Threat scenario | Support admin performs owner-only actions (delete seller, change billing) |
| Existing controls | RBAC (`owner/finance/support/readonly`); each route checks `<resource>:<action>`; break-glass requires `x-admin-key` header; all admin actions logged in `admin_audit` |
| Residual risk | Low |
| Mitigation | Periodic access review of admin roles; alert on break-glass key usage |

### T-006: Data Leakage Through Logs

| Field | Detail |
|---|---|
| STRIDE | Information Disclosure |
| Asset | All PII |
| Threat scenario | Phone numbers, OTP codes, payment data, or tokens appear in application logs, Cloudflare Worker logs, or error output |
| Existing controls | OTP codes and tokens must never be logged; IPs are scrubbed from `admin_audit` and `email_template_history` at 30 days; `error_logs` are deleted at 30 days; Cloudflare Workers Logs retention is plan-dependent (3 days Free / 7 days Paid) and must be verified for the active account |
| Residual risk | Very low |
| Mitigation | Annual log audit; verify no PII in log samples |

### T-007: Injection via User Input

| Field | Detail |
|---|---|
| STRIDE | Tampering |
| Asset | D1 database integrity |
| Threat scenario | SQL injection through product names, order notes, or store descriptions |
| Existing controls | User values are bound through parameterized statements. Dynamic placeholder lists and identifiers are generated from fixed counts or validated allowlists rather than raw user input |
| Residual risk | Very low |
| Mitigation | Static analysis to enforce parameterized queries; dependency scanning for SQLite vulnerabilities |

### T-008: Lost or Stolen Device

| Field | Detail |
|---|---|
| STRIDE | Information Disclosure |
| Asset | Seller store data, device secret |
| Threat scenario | Seller loses phone; finder accesses app and data |
| Existing controls | Room DB + DataStore cleared on logout; secret hashed on server; single-device plan revocation on Firebase re-auth rotates credential |
| Residual risk | Low — data cleared on logout but app may have active session if unlocked |
| Mitigation | Future: app-level lock (PIN/biometric); session timeout for background state |

### T-009: Dependency and Supply-Chain Risk

| Field | Detail |
|---|---|
| STRIDE | Tampering |
| Asset | All systems |
| Threat scenario | Malicious update to an npm dependency, Android library, or Cloudflare Worker runtime |
| Existing controls | `pnpm-lock.yaml` pins the Node dependency graph for the whole workspace (this is a pnpm monorepo — there is no `package-lock.json`); `pnpm audit --audit-level high` runs in CI (`supply-chain.yml`, `backend-ci.yml`) and fails the build on high/critical advisories; a CycloneDX SBOM is generated on every run; Renovate is configured (`renovate.json`) with `vulnerabilityAlerts` enabled; Android direct versions are centralized in the Gradle version catalog; the Gradle wrapper is pinned; Cloudflare manages the Workers runtime |
| Residual risk | Medium — Gradle transitive dependencies have no equivalent vulnerability scan yet; the pnpm-side controls above do not cover `apps/seller-android/**` |
| Mitigation | Add a Gradle-side scanner (e.g. OSV-Scanner or `gradle dependencyCheckAnalyze`) to close the Android gap; the npm/pnpm side and Renovate are already in place, not still to be added |

### T-010: Administrative Misuse

| Field | Detail |
|---|---|
| STRIDE | Repudiation |
| Asset | All data |
| Threat scenario | Authorized admin accesses seller data outside approved support scope without audit trail |
| Existing controls | All sensitive admin actions logged in `admin_audit` (action, admin_id, entity, timestamp, IP); JWT identifies admin per request |
| Residual risk | Low — audit trail exists but no real-time alerting on anomalous access patterns |
| Mitigation | Monitor `admin_audit` for unusual access patterns; quarterly access review |

### T-011: API Contract or Documentation Leakage

| Field | Detail |
|---|---|
| STRIDE | Information Disclosure / Tampering |
| Asset | Personal data, credentials, Admin and integration contracts |
| Threat scenario | A sensitive example or L1-L3 operation reaches the public bundle, or implementation drifts from its reviewed schema |
| Existing controls | Per-operation classification; L0-only public builder; leakage scan; route/spec coverage; Spectral/Redocly; contract tests; Staging-first Schema Validation |
| Residual risk | Medium while operations remain `draft` and domain schemas are still being refined |
| Mitigation | Privacy/Security release approval, reviewed domain schemas, sanitized CI evidence, and no stable promotion while classifications are pending |

## 3. Risk Matrix

| Threat | Likelihood | Impact | Risk Level | Status |
|---|---|---|---|---|
| T-001 OTP interception | Low | High | Medium | Acceptable with current controls |
| T-002 Cross-store access | Low | High | Low | Mitigated |
| T-003 API abuse | Medium | Medium | Low | Mitigated |
| T-004 Device theft | Medium | Medium | Medium | Acceptable; future biometric lock |
| T-005 Privilege escalation | Low | High | Low | Mitigated |
| T-006 Log data leakage | Low | High | Very Low | Mitigated |
| T-007 Injection | Low | High | Very Low | Mitigated |
| T-008 Lost device | Medium | Low | Low | Mitigated |
| T-009 Supply chain | Low | High | Medium | pnpm side scanned in CI; Gradle side open |
| T-010 Admin misuse | Low | Medium | Low | Acceptable; add monitoring |
| T-011 Contract/documentation leakage | Low | High | Medium | Release gate open |

## 4. Open Risks Requiring Action

| # | Risk | Action | Priority |
|---|---|---|---|
| 1 | T-009: Gradle dependencies unscanned | pnpm side is already scanned (`supply-chain.yml`); add a Gradle-side scanner for `apps/seller-android/**` | Medium |
| 2 | T-004: No app-level lock | Evaluate biometric/PIN lock for app launch | Low — post-MVP |
| 3 | T-010: No anomalous access detection | Add periodic review of `admin_audit` for unusual patterns | Low — quarterly |

| 4 | T-011: Draft schemas and classifications remain | Complete domain schemas plus Privacy/Security approval before stable/public release | High |

> **Approval:** This threat model is ready for security lead review (Plan 7 Gate 2).
