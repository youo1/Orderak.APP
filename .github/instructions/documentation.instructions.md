---
description: Documentation synchronization and writing rules for Orderak.
applyTo: "docs/**"
---

# Documentation instructions

- Describe implemented behavior, not intended or speculative behavior.
- Keep commands copyable on Windows and state the working directory.
- Redact secrets, tokens, private URLs, account identifiers, and production
  values.
- Keep API, setup, product, security, migration, and architecture documents
  synchronized with the code change that requires them.
- Treat internal architecture diagrams as internal unless the user explicitly
  approves publication.
- Do not silently change protected authentication or localization contracts.
- Preserve useful history and rationale in ADRs; add a new ADR when reversing a
  material architectural decision.
