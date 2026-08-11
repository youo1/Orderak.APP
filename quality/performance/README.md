# Orderak API performance profiles

`k6/api-load.js` refuses the production API hostname. Use `PROFILE=smoke`,
`pilot`, `spike`, or `soak` with `BASE_URL` pointing to local Prism or Staging.
The absolute gates are error rate below 0.5%, p95 below 500 ms, and p99 below
1500 ms. Capture a k6 JSON summary before and after Cloudflare Schema
Validation, then run `node quality/performance/compare-schema-validation.mjs` to enforce
the additional 10% p95 overhead ceiling.

Mutation, idempotency, D1-locking, and tenant-isolation scenarios require seeded
staging identities and therefore belong to the protected pre-release workflow;
they must never target production.
