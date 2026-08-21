---
status: current
generated: false
owner: backend
applies_to: [production, staging]
---
# ADR-001: Cloudflare Workers + D1 as the backend platform

**Status:** accepted

**Date:** 2026-07-07

## Context

Orderak needed a backend for an Android app serving small sellers in Egypt and
the Arab region. The backend must:

- Have minimal operational overhead (a 1–2 person team cannot manage servers).
- Provide low latency to users in the Middle East.
- Include an integrated relational database.
- Support file storage (product images).
- Integrate with email sending and receiving.
- Call AI providers (DeepSeek).
- Be cost-predictable at small scale.

Alternatives evaluated:

1. **Firebase (Firestore + Cloud Functions):** strong Android integration but
   NoSQL is a poor fit for a relational domain (billing, orders, inventory);
   Cloud Functions have cold starts and the Functions emulator is fragile;
   vendor lock-in is high.
2. **Self-hosted Node.js + PostgreSQL on a VPS:** full control but requires
   OS patching, backups, monitoring, and scaling — unacceptable for a small
   team.
3. **Cloudflare Workers + D1:** serverless, global edge, integrated SQLite
   database, R2 object storage, native email bindings, and KV for sessions.

## Decision

We will use **Cloudflare Workers (TypeScript) + D1** as the sole backend
platform. The Worker is a modular monolith — a single deployable that routes
to domain-specific modules.

## Consequences

### Positive

- **Low infrastructure operations**: no operating systems to provision or
  patch, while application monitoring, backups, restore tests, access control,
  and incident response remain Orderak responsibilities.
- **Edge reach**: Workers execute on Cloudflare's network, including regional
  edge presence. Worker placement does not imply the D1 primary is in Cairo;
  D1 placement/replication is a separate concern, and read replication does not
  scale primary writes.
- **Integrated stack**: D1 (SQLite), R2 (media), KV (sessions), Email Sending,
  Email Routing — all in one dashboard.
- **Cost**: free tier covers development; Workers Paid enables email.
- **TypeScript end-to-end**: same language from Worker to D1 queries.

### Negative

- **Plan-dependent runtime limits**: Workers Free has a small per-request CPU
  allowance; Workers Paid defaults to 30 seconds and can be configured up to
  five minutes. Network wait time is not CPU time. AI calls that produce the
  response must be awaited; post-response work may use `ctx.waitUntil()` within
  its execution limit. Email sends must be awaited unless a `waitUntil()`-backed
  transport explicitly owns the promise.
- **D1 is SQLite**: no PostgreSQL features (no `ALTER COLUMN TYPE`, no stored
  procedures). Schema migrations must use table-rebuild patterns.
- **Wrangler migration ledger**: schema changes go through `wrangler d1
  migrations apply`. Running SQL files directly bypasses the ledger and causes
  drift.
- **Vendor lock-in**: the Worker uses Cloudflare-specific bindings (D1, R2,
  KV, `send_email`, `email()`). Moving to another platform would require
  significant rework.

## Alternatives considered

| Alternative | Rejected because |
|------------|-----------------|
| Firebase (Firestore + Functions) | NoSQL unsuitable for billing/orders; cold starts; emulator fragility |
| Self-hosted Node + PostgreSQL | Operations burden unacceptable for team size |
| AWS Lambda + RDS | Higher latency to MENA; more complex IAM; no integrated email |
