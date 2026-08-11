# Orderak Cloudflare Audit — Easy Impact and Action Guide

> **Status:** Historical point-in-time review. Product limits, pricing, and
> maturity can change; current Cloudflare documentation and the live deployment
> inventory are authoritative.

**Reviewed:** 2026-07-27  
**Purpose:** Convert the broad Cloudflare documentation audit into decisions that apply to Orderak.

## The issue in plain language

The audit is useful, but some plan and pricing statements were inaccurate:

1. It said **Workers for Platforms requires Enterprise**. It actually has a separate self-service **$25/month** plan.
2. It said **Queues requires Workers Paid**. Queues now works on Free and Paid; Paid provides a larger monthly allowance and longer retention.
3. It classified **CASB, DLP, and DEX as entirely Enterprise-only**. Current Cloudflare One plans expose some limited capabilities and plan-specific quotas outside Enterprise.
4. It grouped **Images and Stream** with ordinary Workers usage. They have distinct product plans or purchasing models.
5. It did not give enough attention to **Email Sending**, even though Orderak uses it. Email Sending requires Workers Paid for arbitrary recipients, is currently Beta, and has monthly and dynamic daily sending limits.
6. It claimed broad evidence across 104 products, but the supplied archive contains only 67 saved per-product index files and no reproducible per-URL link-test manifest.

## How this affects Orderak

There is **no immediate project blocker** and no need to change application code because of these corrections.

The current **Workers Paid plan remains the right choice** for Orderak because outbound Email Sending to arbitrary recipients requires it. The audit errors could still cause three bad decisions:

- Paying for or contacting Enterprise sales when Orderak does not need Enterprise products.
- Assuming every Cloudflare developer product is included in the $5 Workers plan.
- Missing the real launch risks: Email Sending quotas/Beta maturity, Queue retries and DLQ activity, D1 operations, R2 retention, and observability costs.

## What Orderak actually uses

| Orderak component | Current plan decision | Main thing to monitor |
|---|---|---|
| Workers and Pages Functions | Keep Workers Paid; $5/month minimum currently includes 10M requests and 30M CPU-ms | Requests, CPU time, errors, and source-map/log volume |
| D1 | Keep current binding; usage follows D1 allowances and overages | Rows read/written, storage, query latency, and overload errors |
| R2 media, audit, and exports | Keep current buckets; usage-based after free allowance | Stored bytes, Class A/B operations, retention/lifecycle rules, and audit bucket lock |
| KV sessions/state | Included in the Workers plan subject to KV usage pricing | Reads, writes, list operations, and hot-key patterns |
| Queues and DLQ | Paid plan is appropriate but not required merely to access Queues | Operations, retry rate, backlog age, and every DLQ event |
| Email Sending | Workers Paid required for arbitrary recipients; currently Beta | Monthly sends, dynamic daily limit, bounces, complaints, suppressions, and provider errors |
| Email Routing | Available on Free and Paid | Inbound failures, forwarding failures, and handler CPU errors |
| Static assets and custom domains | Keep current configuration | Cache behavior, certificate/domain health, and deployment failures |
| Basic DNS/CDN/SSL/DDoS | Independent zone features; Free zone capabilities are sufficient unless requirements change | DNS/certificate alerts and attack traffic |

The checked-in schedules generate approximately **46,110 scheduled Worker invocations in a 30-day month** before user traffic: one public daily cron, one admin cron every minute, and one admin cron every 15 minutes. This is small compared with the Workers Paid request allowance, but the D1 work performed by those jobs still needs monitoring.

## Products Orderak does not currently need

Do not purchase these merely because they appear in the broad audit:

- Workers for Platforms
- Cloudflare Images storage or Stream
- Argo Smart Routing or Load Balancing
- Magic WAN, Magic Transit, BYOIP, or Network Interconnect
- Enterprise Bot Management, advanced DDoS, CASB, DLP, or Email Security
- Paid Zero Trust or Browser Isolation

Cloudflare Access Free may later be evaluated as an additional protection layer for `admin.orderak.app`, but that is a separate security-architecture decision—not a missing requirement for the current Worker deployment.

## Recommended operational actions

1. **Email:** Confirm `orderak.app` is onboarded for Email Sending, record the account's current daily limit, and alert on `E_RATE_LIMIT_EXCEEDED`, `E_DAILY_LIMIT_EXCEEDED`, bounces, complaints, and suppression events.
2. **Queues:** Alert on any billing DLQ message, oldest-message age over five minutes, backlog over the documented project threshold, and unusual retry growth.
3. **Workers:** Alert at 50%, 80%, and 100% of included monthly requests and CPU time; retain error-rate and CPU-limit alerts separately.
4. **D1/R2/KV:** Capture monthly usage and forecast overages. Validate R2 lifecycle/bucket-lock rules and D1 latency/row-operation trends.
5. **Audit evidence:** For future reruns, save a manifest containing every URL, product, retrieval time, HTTP status, redirect target, content hash, source last-updated date, and audit rule/result.
6. **Review frequency:** Recheck the Orderak service matrix monthly and before purchasing or enabling a new Cloudflare product. A full 104-product documentation audit is not needed for routine Orderak releases.

## Official sources used for corrections

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers for Platforms pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/)
- [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Cloudflare Images pricing](https://developers.cloudflare.com/images/pricing/)
- [Cloudflare Stream pricing](https://developers.cloudflare.com/stream/pricing/)
- [Cloudflare One plans](https://www.cloudflare.com/plans/zero-trust-services/)
- [Cloudflare One account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/)
- [Email Service overview and maturity](https://developers.cloudflare.com/email-service/)
- [Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)
- [Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/)

## Final decision

Keep **Workers Paid**. Do not buy an Enterprise or additional Cloudflare product based only on the original audit. Treat Email Sending readiness and usage monitoring—not subscription expansion—as the immediate operational priority.
