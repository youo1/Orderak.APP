# Orderak.APP

Orderak helps small sellers in Egypt manage stores, products, customers and
orders from an Android phone. This repository holds the complete system: the
Android app, the Cloudflare Workers backend, and the admin panel.

## Status: production

Production has deployed from this repository since **2026-08-16**. This is the
only repository the system is built, deployed and governed from; there is no
upstream, and no other repository holds credentials, environments or history
for it.

## What's here

The complete system: `services/backend` (Cloudflare Workers, D1, R2, Queues),
`apps/admin-web`, `apps/seller-android`, and `contracts/openapi`, alongside the
workspace manifest, docs tooling and repository governance.

Production deploys through `.github/workflows/production-deploy.yml`, which
requires a tested commit SHA, the typed confirmation `DEPLOY_PRODUCTION`, a
matching `DEPLOY_OWNER`, a successful staging deploy of that exact SHA, and a
reviewer approval on the `production` environment.
