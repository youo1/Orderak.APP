# Orderak Admin Web

React and TypeScript administration application hosted by a Cloudflare Worker
with Static Assets. Same-origin `/api/admin/v1/*` requests are forwarded through
the `ADMIN_WORKER` service binding; the browser never receives Worker secrets or
direct database access.

## Structure

- `src/app/` — bootstrap, routing, layout, and application configuration.
- `src/features/` — auth, commerce, governance, operations, stores, support, and theme features.
- `src/shared/` — API client, utilities, and reusable UI components.
- `src/edge/` — canonical-host Worker, Static Assets entrypoint, and private
  Admin Worker proxy.
- `wrangler.edge*.jsonc` — isolated Production and Staging assets/service bindings.

Theme preview code lives entirely under `src/features/theme/preview/`. Authentication,
session state, login, and account-security gates live under `src/features/auth/`.

## Verification

```cmd
npm ci
npm test -- --run
npm run lint
npm run build
npm run cf-types:check
npx wrangler deploy --config wrangler.edge.staging.jsonc --dry-run
```

Production and Staging names are governed by
[`../../docs/architecture/deployment-environment-map.md`](../../docs/architecture/deployment-environment-map.md).
Do not rename or deploy a live resource as part of a repository refactor.
