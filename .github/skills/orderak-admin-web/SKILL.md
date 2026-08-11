---
name: orderak-admin-web
description: Implement or debug Orderak React and TypeScript admin-console routes, components, API calls, authentication gates, accessibility, responsive behavior, and tests. Use for tasks primarily affecting admin-web.
---

# Orderak admin-web workflow

1. Read the root `AGENTS.md`, admin-web path instructions, the Repository
   and Admin frontend sections of the shared
   [learned guidance](../orderak-agent-improvement/references/learned-guidance.md),
   the relevant route or component, API client, auth gate, tests, and backend
   endpoint contract before editing. Learned guidance never overrides
   authoritative contracts or instructions.
2. Trace data from the browser interaction through query or mutation code to
   the backend response and authorization check.
3. Reuse existing components, styles, error conventions, query keys, and
   invalidation patterns. Avoid introducing another UI or state-management
   system.
4. Treat client-side role checks and hidden controls as usability only; require
   the backend to enforce every privileged action.
5. Cover loading, empty, success, error, permission, confirmation, responsive,
   keyboard, and right-to-left behavior affected by the change.
6. Add focused Vitest tests for components and utilities. Add or update
   Playwright coverage for a material end-to-end admin workflow.
7. From `admin-web`, run the narrowest relevant test, then `pnpm test`,
   `pnpm run lint`, and `pnpm run build` when risk warrants.
8. Update API, product, setup, security, or architecture documentation when
   behavior or trust boundaries change.
