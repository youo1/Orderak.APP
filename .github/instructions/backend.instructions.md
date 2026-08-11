---
description: TypeScript and Cloudflare Workers rules for Orderak APIs, persistence, and integrations.
applyTo: "services/backend/**"
---

# Backend instructions

- Use TypeScript and existing Worker routing, validation, authorization, and
  error-response patterns.
- Validate all untrusted input at the boundary.
- Verify authentication and tenant ownership before accessing or mutating data.
- Keep secrets in Worker secrets or local environment variables; update only
  redacted example files when documenting configuration.
- Use parameterized D1 queries and preserve migration ordering and idempotency
  conventions.
- Add focused Vitest coverage for success, authorization failure, validation
  failure, and material edge cases.
- When endpoints change, update `docs/reference/api.md`.
- When migrations change, update `docs/guides/database-migrations.md`.
- When trust boundaries or data authority change, synchronize both architecture
  documents required by `AGENTS.md`.
- Run `pnpm test -- --run` and `pnpm run test:types` when relevant.
