# Orderak Backend

Cloudflare Workers backend for Orderak. The Android app calls only this backend;
the backend owns the database (D1), media (R2), sessions (KV), billing, email,
and any AI/third-party calls.

## Hosts (one Worker, multiple routes)

| Host | Purpose |
| ---- | ------- |
| `api.orderak.app` | Android Seller API (`/api/v1/*`) and external integrations (`/api/integrations/v1/*`) |
| `orderak.app` / `www.orderak.app` | Public landing + store/category/product pages + `/media/*` |
| `admin.orderak.app` | Pages-hosted admin application, proxied to the separate Admin Worker |

## Local development

```bash
cd services/backend
cp .dev.vars.example .dev.vars   # then fill in secrets
npx wrangler dev                 # http://localhost:8787
```

- Health check: `GET /health`.
- AI chat: authenticated `POST /api/v1/chat`, deferred for the free launch.
  `AI_ASSISTANT_ENABLED` defaults to `false`, so the route fails closed before
  provider use. Paid acquisition similarly defaults off through
  `BILLING_ENABLED`. See the [API reference](../../docs/reference/api.md) and
  [ADR-004](../../docs/decisions/adr-004-free-launch-billing.md).

## Common commands

| Command | Purpose |
| ------- | ------- |
| `npx wrangler dev` | Run locally |
| `npm test` | Vitest (Workers pool) |
| `npx tsc --noEmit` | Type-check |
| `npx wrangler types` | Regenerate binding types after editing `wrangler.jsonc` |
| `npx wrangler deploy` | Deploy |
| `npx wrangler d1 migrations apply orderak-db --local` | Apply pending local D1 migrations |
| `npx wrangler d1 migrations apply orderak-db --remote` | Apply pending production D1 migrations |

## Layout

`src/entrypoints/` contains the public and admin Worker boundaries. Shared runtime
concerns live in `src/platform/`, business capabilities in `src/domains/`, and
third-party adapters in `src/integrations/`. The Admin and public entrypoints remain
separate even when they reuse domain and platform modules. See the
[API reference](../../docs/reference/api.md) for the full endpoint reference and the
[setup guide](../../docs/guides/setup.md) for migrations, secrets, domains, and email
setup.
