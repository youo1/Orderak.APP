# Backend completion checklist

- Input shape, limits, normalization, and rejection behavior are explicit.
- Authentication is verified server-side.
- Tenant and resource ownership are checked before reads and writes.
- D1 queries are parameterized and return intentional empty/not-found behavior.
- Retries, duplicate requests, and partial provider failures are handled where
  material.
- Logs and errors do not expose secrets, tokens, personal data, or provider
  payloads unnecessarily.
- New environment bindings are reflected in types and redacted examples.
- Schema changes use the next forward-only numbered migration.
- Tests cover success, validation, authentication, authorization, tenant
  isolation, and important provider/database failures.
- `docs/reference/api.md` and migration/security/architecture documentation are updated
  when required.
- Focused tests, full Vitest run, type check, and architecture verification were
  run in proportion to risk.
