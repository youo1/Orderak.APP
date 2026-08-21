---
status: archived
generated: false
owner: backend
last_verified: 2026-08-13
applies_to: [production, staging]
---
# Browser Cache TTL set to "Respect Existing Headers"

Changed 2026-08-13 by the repository owner, in the Cloudflare dashboard, on the
`orderak.app` zone. **This is a production-affecting change**, made outside the
migration's staging-only scope because it corrects a live divergence between
what the application asks for and what clients were told.

## What was wrong

`publicDesignSystemResponse` sets, deliberately:

```text
cache-control:     public, no-cache
cdn-cache-control: public, max-age=60, stale-while-revalidate=60
```

Two different audiences: the **edge** may hold the response for 60 seconds; the
**client** must revalidate every time. That split is the point — a design-system
publish should reach clients quickly, while the edge absorbs the read volume.

Responses actually arrived carrying:

```text
Cache-Control: public, max-age=14400
```

Four hours. A zone-level Browser Cache TTL was overriding the origin header, so
a client that had fetched the theme was instructed not to revalidate for four
hours. After a design-system publish, that client would keep rendering the old
theme for up to that long — not because of a bug in the publish path, but
because it had been told not to ask.

Confirmed identical on Production and Staging before the change, so this was a
long-standing zone setting, not migration drift. An earlier reading suggested
Production behaved differently; that was a cache miss being misread, and
repeating the probe five times showed both environments matching.

## After

Both environments now return the application's own header on cached responses:

```text
staging     CF-Cache-Status: HIT   Age: 0   Cache-Control: public, no-cache
production  CF-Cache-Status: HIT   Age: 1   Cache-Control: public, no-cache
```

**Edge caching was not lost.** `CF-Cache-Status: HIT` persists, because the edge
is governed by `cdn-cache-control`, which was never the thing being overridden.
The change affects only what clients are told. This is worth stating plainly
because "stop caching in the browser" reads like "stop caching", and it is not:
the CDN still absorbs the reads.

## Cost

None measured. Twenty sequential requests before and after, same client, same
network:

| | min | median | max |
| --- | --- | --- | --- |
| Before | 0.322 s | 0.343 s | 0.648 s |
| After | 0.322 s | 0.342 s | 0.413 s |

A latency increase was expected on the theory that clients would now revalidate
rather than serve from browser cache. It did not appear here, and would not:
this measurement is a fresh client each time, which never had a browser cache
entry to skip. The real effect is on returning clients over time and shows up
as Worker request volume, not as latency. **Not yet measured** — it needs
traffic over a longer window than this session covers, and staging has none.

## Interaction with the soak

The change was made while the corrected 60-minute soak was running, which had
been advised against. It does not contaminate that run: the soak uses
`CACHE_BUST=1`, giving every iteration a unique query string, so it misses the
edge and reaches the Worker regardless of any header directive. Browser Cache
TTL alters a response header's value; it does not alter whether a Worker is
invoked.

Held to that rather than assumed — the soak's final p95 is compared against the
pre-change cache-busted baseline of 131.4 ms recorded the same day, and agreement
is what rules contamination out.
