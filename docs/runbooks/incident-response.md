---
status: current
generated: false
owner: security
applies_to: [production, staging]
---
# Incident-Response Plan

> **Status:** Pre-production draft — not operational until contacts, secure
> evidence storage, and notification channels are assigned and tested
>
> **Last updated:** 2026-07-19
>
> **Regulatory note:** Egypt PDPL No. 151/2020 Article 7 states a 72-hour
> notification period after awareness and notification of affected persons
> within three working days after reporting. Qualified Egyptian counsel must
> confirm applicability, current Executive Regulations, recipient/channel, and
> required content for each incident.

## 1. Severity Levels

| Level | Definition | Examples |
|---|---|---|
| **Critical (P0)** | Active data breach, unauthorized access to PII, or system compromise | Seller phone numbers exposed; admin account compromised; R2 bucket publicly accessible |
| **High (P1)** | Significant service degradation or data integrity issue | D1 unavailable; all orders failing; sync broken for all sellers |
| **Medium (P2)** | Localized failure or non-critical vulnerability | Single seller unable to sync; rate limit bug; known CVE in a non-critical dependency |
| **Low (P3)** | Minor issue, no user impact | Error log spike; cosmetic bug; expired certificate warning |

## 2. Detection

Incidents may be detected through:

| Source | What to monitor |
|---|---|
| Cloudflare Worker logs | Error rate spikes, authentication failure spikes, unusual request patterns |
| D1 metrics | Query latency, storage growth anomalies |
| Payment-provider dashboard | Failed charges and webhook delivery failures, when billing is enabled; no production Stripe gateway is currently wired |
| Firebase Console | Auth failures, suspicious sign-in patterns |
| Admin audit (`admin_audit`) | Unusual admin actions, break-glass key usage |
| User reports | Support tickets reporting data exposure or account issues |
| `error_logs` table | Unusual error patterns |
| `rate_limits` table | Sustained rate limit hits |

## 3. Response Procedure

### 3.1 Critical (P0) — Data Breach

| Step | Action | Owner | Timeline |
|---|---|---|---|
| 1 | **Containment**: Immediately revoke compromised credentials, rotate secrets, restrict affected endpoints | Security lead | Within 1 hour |
| 2 | **Preserve evidence**: Snapshot affected D1 tables, R2 objects, Worker logs, admin_audit entries before any cleanup | Engineering lead | Within 2 hours |
| 3 | **Assess scope**: Identify affected data categories, number of users, and time window of exposure | Security lead + DPO | Within 4 hours |
| 4 | **Determine awareness time**: When did Orderak first become aware? This starts the 72-hour regulatory clock | DPO + legal counsel | Within 4 hours |
| 5 | **Notify regulator**: Use the current channel and content confirmed by Egyptian counsel; the working statutory timer is 72 hours from awareness (PDPL Article 7) | DPO + legal counsel | < 72 hours |
| 6 | **Notify affected persons**: Via agreed communication method — within 3 business days after regulator notification | DPO + support lead | < 3 business days after step 5 |
| 7 | **Remediate root cause**: Fix vulnerability, deploy fix, verify | Engineering lead | As soon as possible |
| 8 | **Post-incident review**: Document timeline, root cause, impact, and corrective actions | All leads | Within 1 week |
| 9 | **Update incident register**: Record in secure incident register with all evidence | Security lead | Within 1 week |

### 3.2 High (P1) — Service Degradation

| Step | Action | Owner | Timeline |
|---|---|---|---|
| 1 | **Triage**: Determine affected components and user impact | Engineering lead | Within 30 minutes |
| 2 | **Contain**: If caused by a deploy, rollback to last known good version | Engineering lead | Within 1 hour |
| 3 | **Communicate**: Notify internal stakeholders; if user-visible, post status update | Engineering lead | Within 2 hours |
| 4 | **Recover**: Restore service to normal operation | Engineering lead | Within 4 hours |
| 5 | **Root-cause analysis**: Document and fix | Engineering lead | Within 3 days |

### 3.3 Medium (P2) / Low (P3)

| Step | Action | Owner | Timeline |
|---|---|---|---|
| 1 | **Record**: Create incident record with description and severity | Detector | Within 24 hours |
| 2 | **Triage**: Assess impact and assign owner | Engineering lead | Within 48 hours |
| 3 | **Fix**: Implement and deploy fix | Assigned owner | Per sprint priority |
| 4 | **Close**: Verify fix and document resolution | Assigned owner | After verification |

## 4. Escalation Contacts

**Release blocker:** every `TBD` below must be replaced by a tested primary and
backup contact before production. Store private phone numbers and secure
notification credentials in the restricted evidence/operations system, not in
this public repository.

| Role | Primary | Escalation |
|---|---|---|
| Security lead | TBD — assign before production | Executive sponsor |
| Privacy lead / DPO | TBD — assign before production | Egyptian legal counsel |
| Engineering lead | TBD — assign before production | CTO |
| Product lead | TBD — assign before production | CEO |
| Customer support lead | TBD — assign before production | Product lead |

## 5. Communication Templates

### 5.1 Internal Initial Alert

```text
INCIDENT: [P0/P1/P2/P3] — [Brief description]
Time detected: [ISO timestamp]
Detected by: [person/system]
Current status: [containing/investigating/resolved]
Affected components: [list]
Next update: [time]
```

### 5.2 Regulatory Notification Working Draft (PDPL Article 7)

This is an incident worksheet, not an approved statutory form. Counsel must
approve the content and submission channel.

```text
To: Personal Data Protection Center
Date: [date]
Subject: Breach Notification — Orderak

1. Nature of the breach: [description]
2. Categories and approximate number of data subjects affected: [count]
3. Categories and approximate number of personal data records affected: [count]
4. Likely consequences: [assessment]
5. Measures taken or proposed: [actions]
6. DPO contact: [name, phone, email]
7. Date and time of awareness: [ISO timestamp]
```

### 5.3 Affected Person Notification Working Draft (PDPL Article 7)

```text
Subject: Important Security Notice — Orderak

We are writing to inform you that on [date], we became aware of a security
incident involving [brief description of what happened].

What information was involved: [data categories]
What we are doing: [actions taken]
What you can do: [recommended user actions]

For more information, contact: [support email/phone]

Orderak
```

## 6. Evidence Preservation

During incident response, preserve:

- Worker logs for the affected time window (export before plan-dependent expiry:
  currently 3 days on Workers Free or 7 days on Workers Paid)
- `error_logs` table rows for the affected period
- `admin_audit` entries related to the incident
- `rate_limits` snapshot at time of detection
- Relevant `webhook_events` if payment data is involved
- R2 object metadata if media is affected
- D1 snapshot if data integrity is in question

Store preserved evidence in a secure, access-controlled location separate from
the production environment.

## 7. Post-Incident Review

Every P0 and P1 incident must undergo a post-incident review covering:

| Field | Description |
|---|---|
| Incident ID | Unique reference |
| Timeline | Detection → containment → recovery → closure |
| Root cause | Technical and process failures |
| Impact | Data subjects affected, data categories, duration |
| Detection | How was it found? Could it have been found sooner? |
| Response quality | What worked? What didn't? |
| Corrective actions | Specific changes to prevent recurrence |
| Regulatory follow-up | Were notifications completed on time? |
| Process updates | Changes to this incident-response plan |

## 8. Testing

- Tabletop exercise: at least annually, involving legal, privacy, security, engineering, support, and leadership
- The exercise must test the 72-hour regulatory notification path and the 3-business-day affected-person notification process
- Record exercise results and update this plan based on findings

> **Approval:** This plan is ready for security lead and privacy lead review (Plan 7 Gate 3; Plan 5 Phase 7).

## References

- [Egypt Personal Data Protection Law No. 151/2020 — English translation](https://eg.andersen.com/wp-content/uploads/2026/02/Law-No.-151-of-2020.pdf)
- [Egyptian PDPC DPO guidance](https://pdpc.gov.eg/assets/pdf-data/Guidelines/DPO.pdf)
