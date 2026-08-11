# Repository restructure archive manifest

This manifest records how non-current files were handled during the 2026-08-01
repository reorganization. Git history remains the recovery mechanism for
deleted code and generated artifacts.

| Source | Disposition | Reason or successor |
| --- | --- | --- |
| `outputs/cloudflare-docs-audit/ORDERAK-IMPACT-AND-ACTIONS.md` | Archive | Curated as `history/cloudflare-platform-audit-2026-07-27.md` |
| Other `outputs/cloudflare-docs-audit/` files | Delete | Raw indexes and superseded intermediate reports |
| `outputs/onboarding-taxonomy/` | Summarize then delete | Durable conclusions preserved in `history/onboarding-taxonomy-audit-2026-07-28.md` |
| UUID inspection output and `cf_llms*.txt` | Delete | Reproducible generated inspection/download data |
| Root `_temp_*`, `path/`, `pmcp/` | Delete | Temporary probes and placeholders |
| `services/backend/src/__synctest.txt` (formerly `backend/src/__synctest.txt`) | Delete | Sync probe with no runtime consumer |
| Android `*.artifact.md` and `.artifacts/` | Delete | Tool-generated walkthrough and task artifacts |
| Root `static/` | Delete | Duplicate of the Worker-served `services/backend/assets/static/` tree |
| Root `scripts/fetch_android_guides.js` and empty contrast checker | Delete | One-off or empty tooling with no active consumer |
| Tracked root `node_modules/` files | Delete | Generated dependency/cache state |

Executable historical code is intentionally not copied into `docs/archive/`.
Use Git history when an old implementation must be inspected.
