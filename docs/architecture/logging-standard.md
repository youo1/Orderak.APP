# Logging and Audit Standard

> **Status:** Draft for review
> **Last updated:** 2026-08-01
> **References:** `docs/governance/retention-matrix.md` §1.7 for retention rules; `docs/architecture/data-classification.md` for field classification

## 1. Log Categories

| Category | Purpose | Location | Retention | Access |
|---|---|---|---|---|
| **Application logs** | Request/response flow, handler events | Cloudflare Workers Logs (platform) | Plan-dependent: 3 days on Free, 7 days on Paid (verify the active plan) | Engineering via Cloudflare dashboard |
| **Error logs** | Application errors with context | D1 `error_logs` | 30 days | Engineering via admin panel |
| **Security audit logs** | Admin actions, auth events | D1 `admin_audit` | IP scrubbed at 30d; rows deleted at 2 years | Security lead via admin panel |
| **Compliance logs** | Consent records, deletion requests, legal version history | D1 `legal_acceptances`, `deletion_requests`, `content_page_versions` | Permanent or account lifetime + 5 years | DPO / legal counsel via admin panel |
| **Operational telemetry** | Email/webhook events, rate limits, sessions | D1 `email_events`, `webhook_events`, `rate_limits`, `admin_sessions` | 30-90 days | Engineering via admin panel |

## 2. What Must NEVER Be Logged

The following data classifications must not appear in any log category:

| Data | Classification | Reason |
|---|---|---|
| Passwords (plaintext) | L3 | Credential exposure |
| OTP codes | L3 | Auth bypass risk |
| Full payment credentials (PAN, CVV) | L3 | PCI compliance |
| Private keys, signing secrets | L3 | Infrastructure compromise |
| JWT tokens, session tokens | L3 | Session hijacking |
| Firebase ID tokens | L3 | Auth bypass risk |
| Phone numbers (E.164) | L2 | PII — except in legal evidence tables where required |
| Buyer contact data | L2 | PII |
| IP addresses | L2 | PII — allowed in `admin_audit.ip` only, scrubbed at 30d |

## 3. What IS Logged (and Where)

### 3.1 Application Logs (Worker `console.log` / `console.error`)

| Content | Example | OK? |
|---|---|---|
| Request method + path, no PII | `POST /api/v1/auth/session` | ✅ |
| Handler lifecycle events | `[deletion] Fulfilling req_abc for phone +2010...` | ✅ — phone truncated |
| Error messages without data | `Stripe cancel failed for sub sub_xyz` | ✅ |
| Feature flag state | `BILLING_ENABLED=false, acquisition blocked` | ✅ |
| Retention cleanup summary | `[retention] Daily cleanup: error_logs:30d=142 ...` | ✅ |
| Phone numbers, OTP, tokens, passwords, raw errors with user data | — | ❌ |

### 3.2 Error Logs (`error_logs` table)

| Field | Description | Classification | Retention |
|---|---|---|---|
| `id` | Auto-increment | L1 | 30 days |
| `context` | Error description — must not contain PII | L1 | 30 days |
| `ip` | Source IP — allowed for debugging | L2 | 30 days (full row deletion) |
| `created_at` | Timestamp | L1 | 30 days |

**Rule**: Before writing to `error_logs`, strip phone numbers, tokens, and any L2/L3 data from the context string.

Android sends a fresh `x-request-id` for each HTTP request. It is safe to copy
into sanitized operational events, but it must never be treated as a credential,
seller identity, mutation idempotency key, or legal evidence. End-to-end Worker
response echo/storage is deferred until the logging pipeline implements the
same retention and access controls.

### 3.3 Security Audit Logs (`admin_audit` table)

Every sensitive admin action must produce an audit entry with:

| Field | Required | Description |
|---|---|---|
| `admin_id` | Yes | Admin performing the action |
| `action` | Yes | `<resource>:<action>` e.g., `seller:view`, `billing:cancel_subscription` |
| `entity` | Yes | Affected record identifier (seller UUID, order ID, etc.) |
| `previous` | Conditional | Previous value for update/delete actions |
| `new` | Conditional | New value for update/create actions |
| `reason` | Conditional | Required for destructive actions |
| `ip` | Auto | Request IP — scrubbed at 30d |
| `created_at` | Auto | Timestamp |

**Actions requiring audit:**

| Action Category | Examples | Reason Required? |
|---|---|---|
| View seller data | `seller:view` | No |
| Modify seller data | `seller:update`, `seller:suspend` | Yes |
| Delete data | `seller:delete`, `content:remove` | Yes |
| Billing changes | `billing:refund`, `billing:change_plan` | Yes |
| Role changes | `admin:change_role` | Yes |
| Break-glass access | `admin:bootstrap`, `admin:reset_password` | Yes |
| Config changes | `config:set_feature_flag` | Yes |
| Export data | `data:export_seller`, `data:export_audit` | Yes |

### 3.4 Compliance Logs

| Table | Content | Immutable? | Retention |
|---|---|---|---|
| `legal_acceptances` | Consent version, timestamp, locale, marketing choice | Yes (append-only) | Account lifetime + 5y; de-identified on deletion |
| `deletion_requests` | Request lifecycle, verification, completion evidence | Yes (append-only) | Permanent; de-identified on completion |
| `content_page_versions` | Policy version snapshots | Yes (append-only) | Permanent |

## 4. Log Access Controls

| Log Category | Who Can Read | Who Can Delete |
|---|---|---|
| Worker logs | Engineering (Cloudflare dashboard) | Cloudflare auto-rotation (3d Free / 7d Paid; verify the active plan) |
| `error_logs` | Engineering | cron only (`retention.ts`) |
| `admin_audit` | `owner`, security lead | cron only (2y) |
| `legal_acceptances` | `owner`, DPO, legal counsel | Never — append-only |
| `deletion_requests` | `owner`, DPO, legal counsel | Never — append-only |
| `content_page_versions` | `owner`, DPO, legal counsel | Never — append-only |

No role, including `owner`, may manually delete audit or compliance log rows.
All deletions are programmatic (retention cron) and must be logged.

## 5. Log Integrity

1. **Application logs** (Cloudflare Workers): Platform-managed retention reduces application-level deletion risk, but application code can still omit, falsify, or expose data in emitted events. Restrict dashboard access and export evidence promptly during incidents.
2. **D1 tables** (`admin_audit`, `legal_acceptances`, `deletion_requests`, `content_page_versions`): All inserts are append-only. No UPDATE that modifies historical values. IP scrubbing is the only permitted modification.
3. **Error logs and operational tables**: Deleted only by `retention.ts` cron; no manual deletion.

## 6. Monitoring and Alerting

| Condition | Alert Severity | Response |
|---|---|---|
| Sustained error rate increase | Warning → High | Investigate within 1 hour |
| Break-glass key usage | High | Immediate review; verify authorization |
| Multiple failed admin login attempts | High | Verify no brute-force attack |
| `admin_audit` row count anomaly | Warning | Review for unauthorized access |
| Rate limit sustained hits | Warning | Investigate potential abuse |
| Unusual deletion activity | High | Verify authorized deletion requests |

> **Approval:** This standard is ready for security lead review (Plan 7 Phase 2).
