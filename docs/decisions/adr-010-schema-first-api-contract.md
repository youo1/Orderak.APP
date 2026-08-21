---
status: current
generated: false
owner: backend
applies_to: [production, staging]
---
# ADR-010: Model API payloads with Zod at the route boundary

**Status:** proposed

**Date:** 2026-08-21

**Supersedes:** none

**Superseded by:** none

## Context

The repository has a large, well-maintained OpenAPI apparatus: four surfaces,
244 operations, Redocly and Spectral linting, a Prism mock, Schemathesis
fuzzing with an allowlist, k6 performance smoke, route-coverage checks, and a
published portal. Underneath it, the contract models no data.

Measured 2026-08-21 against the built specs:

| Surface | Operations | Responses | Success schema |
| --- | --- | --- | --- |
| seller-v1 | 68 | 412 | `GenericSuccess` ×66 |
| admin-v1 | 176 | 1056 | `GenericSuccess` ×176 |

`components.schemas` contains exactly two entries on every surface: `Problem`
and `GenericSuccess`. `GenericSuccess` is:

```json
{ "type": "object", "properties": { "ok": { "type": "boolean", "const": true } },
  "additionalProperties": true }
```

A raw text search across the 517 KB seller spec and the 1.3 MB admin spec finds
zero occurrences of `price`, `amount`, `total`, `piaster`, or `currency`.

The error modelling is genuinely good — 1224 `Problem` references — and route
coverage is enforced. It is only the success payloads that are unmodelled.

### What this means for the checks built on top

- **Schemathesis validates nothing about data.** `additionalProperties: true`
  on an object whose only property is `ok` accepts any payload.
- **The Prism mock returns `{"ok": true}` for every endpoint**, so
  `prism-android-contract` verifies that the Android client tolerates
  `{"ok": true}` — not that it agrees with the server about any field.
- **`BackendApi.kt` types are unverified.** Nothing compares the client's
  expected shape to what the server sends.

### Why the contract is empty

`bootstrap-specs.mjs` generates the specs from `discoverRoutes()`, which reads
Hono route registrations. A route registration carries a method and a path; it
does not carry a response shape. The generator emits the only success schema it
can infer, and `writeFileSync` at line 177 overwrites `src/*.json` wholesale —
so a hand-written schema is destroyed on the next run.

The backend has no schema library. `services/backend/package.json` lists `hono`
and no validator: no Zod, no Valibot, no TypeBox, no Ajv. There is no artefact
in the code from which a payload schema could be derived.

## Decision

Payload schemas are defined with **Zod at the route boundary** using
`@hono/zod-openapi`, and the OpenAPI document is generated from them.

Verified empirically on 2026-08-21 against `@hono/zod-openapi@1.6.1`:

```text
OpenAPIHono instanceof Hono   →  true
app.routes                     →  GET /plain | GET /modeled     (both forms coexist)
getOpenAPIDocument().paths     →  /modeled only
generated schema               →  {"amount_minor":{"type":"integer"},
                                   "currency":{"type":"string"}}
```

This gives one definition per payload that simultaneously produces runtime
validation, the TypeScript type, and the OpenAPI schema — so the three cannot
drift from each other.

**Adoption is incremental.** `OpenAPIHono` extends `Hono`, plain `.get()`
routes keep working beside `.openapi()` routes, and `getOpenAPIDocument()`
emits only the modelled ones. The existing generator therefore stays as the
coverage backstop for routes that have not migrated yet, and the two are
complementary rather than competing.

**Money-bearing endpoints migrate first**, because [ADR-009](adr-009-minor-units-with-explicit-currency.md)
cannot be enforced without them: it requires money to travel as
`{amount_minor, currency}`, and today there is no field in the contract to
carry a currency.

### Prerequisites, in order

1. **`hono-inventory.mjs` must learn the new registration shape.** Route
   discovery is AST-based over the TypeScript compiler and matches
   `ROUTE_METHODS = {get, post, put, patch, delete, all, on}`, reading the path
   from the call's first argument. `@hono/zod-openapi` registers as
   `app.openapi(createRoute({ method, path }), handler)` — `openapi` is not in
   that set, and the path lives inside an object literal. **The first migrated
   route would vanish from route coverage**, and `bootstrap-specs.mjs` would
   report it as a spec operation with no implementation. This must be fixed
   before any route migrates, not after.

2. **A Worker startup-time and size guard must exist in CI.** There is none
   today: `apk-size` guards the Android bundle and nothing guards the Workers.
   Bundle size is not the concern — the backend is 442.26 KiB gzipped against a
   10 MB paid-plan limit. Startup time is: the limit is 1 second, and Cloudflare
   documents "generating or consuming a large schema at the top level" as a
   common cause of exceeding it. Schema construction across 244 operations runs
   in global scope. `wrangler deploy` reports `startup_time_ms`, so this is
   measurable and must be measured before Zod enters the runtime path, not after
   a deployment is rejected.

3. **`bootstrap-specs.mjs` must merge rather than overwrite**, so generated
   schemas survive a regeneration.

## Consequences

### Positive

- Schemathesis begins testing data instead of confirming `{"ok": true}`.
- The Prism mock returns realistic payloads, which makes
  `prism-android-contract` a real contract test.
- Request validation arrives with response modelling, from the same definition.
- ADR-009 becomes enforceable at the boundary rather than by convention.
- Client types can be generated from the contract instead of hand-written.

### Negative

- 244 operations to migrate. Incremental, but the tail is long, and a
  half-migrated contract is harder to reason about than either end state.
- Zod enters the Worker runtime bundle and the global scope.
- Two registration styles coexist for the duration.

### Risks

- **The startup-time limit is the binding constraint, and it fails at deploy
  time.** A rejected deployment (`error 10021`) is discovered when deploying,
  which is the worst moment. Prerequisite 2 exists to move that discovery into
  CI. If schema construction proves too expensive in global scope, the fallback
  is lazy schema construction or build-time-only document generation with
  runtime validation limited to the endpoints that need it.
- **`zod@4` is required** by `@hono/zod-openapi@1.6.1`. The repository currently
  resolves `zod@3.25.76`, but only as a transitive devDependency of
  `@cloudflare/vitest-pool-workers`; nothing in the runtime path imports Zod, so
  adding `zod@4` as a direct dependency does not create a conflict.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Stop generating; hand-author the specs | Loses the route-coverage guarantee that `route-coverage.mjs` is built on, and reintroduces code/spec drift — the exact failure the AST inventory was written to eliminate |
| A side-car schema registry merged by the generator | Keeps coverage and is incremental, but leaves the schema in a second place that nothing forces to match the handler. Drift becomes possible again, silently |
| Generate schemas from TypeScript types | No runtime validation, and the backend's response types are inline object literals rather than named types, so there is little to generate from |
| Do nothing until after launch | Every client integration written against `{"ok": true}` hardens an unverified assumption, and ADR-009 stays unenforceable |
