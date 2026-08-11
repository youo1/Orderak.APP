---
description: React and TypeScript rules for the Orderak administration console.
applyTo: "apps/admin-web/**"
---

# Admin frontend instructions

- Use React and TypeScript and follow existing route, API, auth, query, component,
  styling, and test patterns.
- Treat browser-side role checks and hidden controls as usability only. The
  backend must authorize every privileged read and mutation.
- Never expose Worker secrets, tokens, private configuration, or production
  identifiers in browser bundles, fixtures, logs, or committed files.
- Preserve loading, empty, error, permission, confirmation, responsive,
  keyboard, accessible-name, focus, and right-to-left behavior when relevant.
- Add focused Vitest coverage and update Playwright coverage for material admin
  workflows.
- Run `pnpm test`, `pnpm run lint`, and `pnpm run build` from `apps/admin-web` when
  relevant.
- Update backend and documentation contracts when an API or trust boundary
  changes.
