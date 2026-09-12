---
status: current
generated: false
owner: security
last_verified: 2026-09-12
applies_to: [production, staging]
---
# WAF rate-limiting rules runbook

> **Status:** The verifier exists and runs daily in `Infrastructure Drift`. The
> rules themselves must be created in the Cloudflare dashboard — **until they
> are, that job fails.** That is deliberate.

Two application controls document a WAF rule as the other half of their design.
Neither works properly without it, and until now nothing recorded whether the
rule existed.

## Why these rules exist

### `waf-auth-per-ip`

`shared.ts`'s auth-failure throttle is keyed on the **phone number alone**, with
no IP dimension, and its own comment says to "pair with a per-IP Cloudflare WAF
rate rule for defense in depth".

Store phone numbers are published: `STORE_PUBLIC_COLUMNS` includes `phone` and
`whatsapp`, and the storefront renders them as `wa.me` links. So roughly twenty
junk requests against a known seller's phone hold **every** legitimate device off
that account for the rest of a 300-second window, renewably — unauthenticated
account denial. The per-IP rule is what makes reaching twenty cost an attacker
something.

**Suggested shape:** on `(http.request.uri.path contains "/api/v1/")`, characteristic
`ip.src`, 300 requests / 60 seconds, action *block* for 60 seconds.

### `waf-order-per-ip`

`catalog.ts` limits storefront order creation to five per minute keyed on **store
and IP together**, so rotating the IP resets the bucket. Fifty products per
request against a free plan's 50-orders/month ceiling spends the seller's entire
month in minutes; real buyers then get `plan_limit_reached`.

**Suggested shape:** on the storefront order path, characteristic `ip.src`,
60 requests / 60 seconds, action *managed challenge*.

This one is defence in depth for Turnstile rather than a replacement: Turnstile
(`TURNSTILE_ENABLED`) is the primary control on that path and is off until a site
key exists.

## Creating them

1. Cloudflare dashboard → the `orderak.app` zone → **Security → WAF → Rate
   limiting rules**.
2. Create each rule with the shape above.
3. **Put the match string in the rule's description or ref** — `waf-auth-per-ip`
   and `waf-order-per-ip`. The verifier matches on that substring rather than
   on a rule id, so recreating a rule in the dashboard does not require a code
   change.
4. Confirm each rule is **enabled**. Present-but-disabled is treated as a failure
   on purpose: an inventory that says the control is there while nothing enforces
   it is worse than an obviously absent one.

## Configuring the check

`Infrastructure Drift` needs two things it does not have yet:

| Name | Where | Value |
| --- | --- | --- |
| `CLOUDFLARE_ZONE_ID` | repository variable, `production` environment | the `orderak.app` zone id |
| `ORDERAK_DRIFT_CHECK` | existing secret | must additionally carry **Zone → WAF → Read** |

The existing drift token is deliberately narrow (D1, R2, Queues list). Extend
that token's scope rather than introducing a second one — the workflow's own
comment records why a fallback chain of tokens was removed.

## Reading a failure

The check names exactly one condition per exit, because a check that fails
identically for "the rule is gone" and "I could not look" gets ignored:

| Message | Meaning |
| --- | --- |
| `CLOUDFLARE_ZONE_ID ... is not set` | Not configured yet. Not a statement about the rules. |
| `not permitted to read this zone's WAF rules` | Token scope, not a missing rule. |
| `the rate-limiting rule "..." does not exist` | The actual finding. Create it. |
| `exists but is DISABLED` | Present and not enforcing. |

## Related

- `services/backend/scripts/verify-waf-rules.mjs` — the verifier.
- `.github/workflows/infra-drift.yml` — runs it daily.
- `shared.ts` and `catalog.ts` — the two application controls whose comments
  name a WAF rule as the other half of their design.
