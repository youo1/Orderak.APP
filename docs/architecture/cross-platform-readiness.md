---
status: current
generated: false
owner: android
last_verified: 2026-08-01
applies_to: [production, staging]
---
# Cross-Platform Readiness

**Status:** architecture boundary

**Last verified:** 2026-08-01

## Shared contracts

- `contracts/openapi/` is the transport contract for Android and future iOS/Desktop clients.
- `contracts/typescript/` contains web/backend shared types; it is not a mobile runtime dependency.
- `design/` owns platform-neutral token data. Compose, SwiftUI, and desktop renderers adapt it.
- Localization outcomes and lifecycle schemas remain platform-neutral; each client gets a
  separately versioned platform profile under `docs/platforms/`.
- Seller requests document optional `x-orderak-platform` and
  `x-orderak-app-version` headers. They are telemetry/compatibility context and never authorization.

## Platform adapters

Each platform owns adapters for authentication UI, passkeys, secure credential
storage, device identity, background work, billing presentation, networking, and
accessibility. The backend continues to verify identity, tokens, entitlements, tenant
scope, and all durable mutations.

| Concern | Shared authority | Android today | Future platform requirement |
|---|---|---|---|
| API | `contracts/openapi/` | OkHttp adapter | Generated or hand-written adapter passing contract tests |
| Authentication | Backend auth contracts | Firebase/Android Credentials adapter | Separate iOS/Desktop provider and passkey adapter |
| Platform context | OpenAPI headers | `ClientContextProvider` | Platform-specific provider and version source |
| Design | JSON tokens in `design/` | Compose theme adapter | Native renderer without Compose coupling |
| Localization | Invariants and server schemas | Android resource profile | Independent locale APIs, bundles, and screenshot baselines |
| Billing | Backend-verified entitlements | Google Play UI adapter | Store-specific UI; backend remains authoritative |

No cross-platform framework is selected by this document. A future platform starts
with its own profile, contract suite, secure-storage threat model, and release pipeline;
it does not copy Android implementation details into the shared contract.
