# Orderak.APP

Clean-history migration target for [youo1/Orderak](https://github.com/youo1/Orderak).

## Status: Phase 2 — foundation only, no product code yet

This repository is being populated in stages, tracked file-by-file against a
generated manifest, not copied wholesale. See the source repository for the
full plan and current state:

- **Freeze point:** [`pre-migration-freeze`](https://github.com/youo1/Orderak/releases/tag/pre-migration-freeze) tag in `youo1/Orderak`
- **Manifest:** `tooling/migration/manifests/pre-migration-freeze.json` in `youo1/Orderak`
- **Manifest tooling:** `tooling/migration/{build-manifest,verify-manifest}.mjs` in `youo1/Orderak`

## Why a new repository

The source repository's history briefly contained a leaked third-party
credential and Cloudflare account identifiers, both since removed and
rotated. Rather than carry that history forward, this repository starts
clean: every file that moves here does so with a recorded reason, a content
hash verified against the frozen source commit, and — where the content was
corrected on the way over — evidence of what was wrong and how it was fixed.

## What's here now

Foundation only: editor and lint configuration, the workspace manifest
(`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`),
docs tooling (`mkdocs.yml`), and repository governance (`CODEOWNERS`, PR
template, Renovate config, a gitleaks config with no legacy allowlist).

No application code yet. `pnpm-workspace.yaml` declares `apps/*`,
`services/*`, and `contracts/*` — those directories do not exist here yet.
They arrive as separate, reviewed deployable units.
