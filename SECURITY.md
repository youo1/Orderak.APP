# Security Policy

## Supported versions

- The currently deployed public and admin Cloudflare Workers
- The currently deployed admin web application
- The latest published Android release

Older versions are not actively supported. Always update to the latest release
before reporting an issue.

## Reporting a vulnerability

If you discover a security vulnerability, do **not** open a public issue.
Send details to the project maintainers directly at the private security contact
configured for this repository.

Include:

- A clear description of the vulnerability
- Steps to reproduce it
- Affected components (Android app, Cloudflare Worker, admin panel, email)
- Any suggested fixes or mitigations

We will acknowledge receipt within 48 hours and provide a timeline for
resolution within 5 business days.

## Safe harbor

Good-faith security research is welcome. We will not pursue legal action against
researchers who:

- Act in good faith to identify vulnerabilities
- Do not access, modify, or delete data that does not belong to them
- Do not degrade the service for other users
- Report findings promptly and do not disclose them before resolution

## Secret handling

All secrets in this project follow these rules:

| Location | Storage |
|----------|---------|
| Production | Cloudflare Worker secrets (`wrangler secret put`) |
| Local development | `services/backend/.dev.vars` (git-ignored, never committed) |
| CI / testing | Runner secrets, never in configuration files |

**Never:**

- Store API keys, tokens, or signing secrets in the Android app
- Commit secrets to the repository (any branch)
- Hardcode secrets in `wrangler.jsonc`, `build.gradle.kts`, or any source file
- Log or echo secret values in build output

Secrets in use:

- `ADMIN_API_KEY` — bootstrap key for creating the first admin owner
- `ADMIN_JWT_SECRET` — signing secret for admin session tokens
- `PAYMENT_WEBHOOK_SECRET` — payment gateway webhook HMAC verification
- `DEEPSEEK_API_KEY` — AI provider (OpenAI-compatible)
- `FIREBASE_WEB_API_KEY` — Firebase Identity Toolkit verification
- `FORWARD_TO` — optional inbound-mail forwarding address

`STRIPE_SECRET_KEY` is a reserved future configuration name. No Stripe gateway
is currently implemented or approved, and the value must not be configured for
the free-launch baseline.

## Key rotation

If a secret is suspected compromised:

1. **`ADMIN_JWT_SECRET`** — generate a new long random string, update it with
   `npx wrangler secret put`, and redeploy. All existing admin sessions will be
   invalidated (admins must log in again).
2. **`ADMIN_API_KEY`** — update and immediately verify the bootstrap endpoint
   still works with the new key. This key is only used for break-glass recovery.
3. **`PAYMENT_WEBHOOK_SECRET`** — update in Cloudflare, then update the
   corresponding secret in the payment gateway dashboard. Test with a sandbox
   event before promoting to production.
4. **`DEEPSEEK_API_KEY`** — revoke the old key in the DeepSeek dashboard, create
   a new one, update the Worker secret, and redeploy.

If a Stripe integration is approved in the future, its key-rotation procedure
must be added together with the provider implementation, threat review,
environment mapping, and rollback plan. There is no active Stripe key to rotate
in the current baseline.

## Dependency updates

- Backend: Dependabot (`.github/dependabot.yml`) opens grouped version-update
  pull requests on a schedule, and security updates when an advisory is
  published; `pnpm audit --audit-level high` runs in CI (`supply-chain.yml`) on
  every pull request, on pushes to `main`, and weekly.
  This entry previously named Renovate (`renovate.json`) as "the actual
  mechanism" and stated there was no Dependabot configuration. Both were true
  when written and neither is now: that file configured a Renovate App which was
  never installed on this repository, and it has been replaced.
- Repository-level controls, verified enabled on 2026-08-24: Dependabot alerts,
  Dependabot security updates, secret scanning, and secret scanning push
  protection.
- Android: review the Android Studio dependency analyzer and Firebase BoM
  releases monthly.
- Apply security patches within 7 days of release.

## Architecture security overview

See [`docs/architecture/security-model.md`](./docs/architecture/security-model.md)
for the full security architecture.
