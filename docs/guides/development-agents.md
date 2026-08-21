---
status: current
generated: false
owner: backend
applies_to: [production, staging]
---
# Local development agents

Orderak includes optional repository-local agent instructions under `.github/`.
They help contributors apply the same architecture, security, documentation,
and verification rules across Android, backend, Admin, and planning work.

## Safe use

- Treat repository instructions as development guidance, not runtime code.
- Keep secrets out of prompts, generated files, logs, and commits.
- Review every generated change before committing it.
- Preserve the protected authentication and localization contracts.
- Run the checks required by the files and areas that changed.

## Scope

The local agents do not receive production authority and do not replace code
review, security review, legal approval, or release approval. Generated
artifacts such as `*.artifact.md` are working notes and are intentionally
excluded from documentation lint and publication.
