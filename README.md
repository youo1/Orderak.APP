# Orderak.APP

Orderak helps small sellers in Egypt manage stores, products, customers and
orders from an Android phone. This repository holds the complete system: the
Android app, the Cloudflare Workers backend, and the admin panel.

## Status: production

Production has deployed from this repository since **2026-08-16**. The
migration from `youo1/Orderak` is complete through Phase 9; that repository is
now private and superseded, and is retained only until **2026-09-15** because
it holds the sole age identity able to decrypt backups written before the
cutover.

Its links are deliberately not hyperlinked below: it is private, so they would
404 for anyone but the owner.

- **Freeze point:** the `pre-migration-freeze` tag in `youo1/Orderak`
- **Manifest:** `tooling/migration/manifests/pre-migration-freeze.json` — now carried **here**
- **Manifest tooling:** `tooling/migration/{build-manifest,verify-manifest}.mjs`
- **Migration record:** `docs/governance/` and `docs/governance/evidence/`

## Why a new repository

The source repository's history briefly contained a leaked third-party
credential and Cloudflare account identifiers, both since removed and
rotated. Rather than carry that history forward, this repository starts
clean: every file that moves here does so with a recorded reason, a content
hash verified against the frozen source commit, and — where the content was
corrected on the way over — evidence of what was wrong and how it was fixed.

## What's here now

The complete system. `services/backend` (Cloudflare Workers, D1, R2, Queues),
`apps/admin-web`, `apps/seller-android`, and `contracts/openapi`, alongside the
workspace manifest, docs tooling and repository governance.

Production deploys through `.github/workflows/production-deploy.yml`, which
requires a tested commit SHA, the typed confirmation `DEPLOY_PRODUCTION`, a
matching `DEPLOY_OWNER`, a successful staging deploy of that exact SHA, and a
reviewer approval on the `production` environment.

No application code yet. `pnpm-workspace.yaml` declares `apps/*`,
`services/*`, and `contracts/*` — those directories do not exist here yet.
They arrive as separate, reviewed deployable units.
