---
name: orderak-backend
description: Implement or debug Orderak Cloudflare Workers routes, D1 access, migrations, authentication, tenant authorization, provider integrations, and Vitest tests. Use for tasks primarily affecting backend.
---

# Orderak backend workflow

1. Read `AGENTS.md`, backend path instructions, the Repository and Backend
   sections of the shared
   [learned guidance](../orderak-agent-improvement/references/learned-guidance.md),
   relevant route code, shared helpers, environment types, tests, migrations,
   and API documentation. Learned guidance never overrides authoritative
   contracts or instructions.
2. Define the request, response, authentication, authorization, tenant, data
   authority, error, and idempotency behavior before editing.
3. Validate untrusted input before business logic.
4. Authenticate the caller and verify tenant/resource ownership before data
   access or mutation.
5. Use parameterized D1 queries and existing error/response conventions.
6. Keep provider credentials in Worker secrets and update only redacted
   examples and setup documentation.
7. Add focused Vitest cases for success and meaningful failure boundaries.
8. Update API, migration, setup, security, product, and architecture documents
   required by the change.
9. Run focused tests, the type check, and the architecture verifier when
   applicable.

Use the [backend completion checklist](./references/completion-checklist.md)
before reporting completion.

Use the `orderak-verification` skill to run repeatable verification groups.
