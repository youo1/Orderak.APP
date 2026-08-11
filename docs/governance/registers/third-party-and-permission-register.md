# Third-party, SDK, and Android permission register

This is the Phase 0 runtime and data-touching inventory. It is not yet a
complete SBOM or approved processor register. Exact versions remain sourced
from `services/backend/package.json`, the workspace-root `pnpm-lock.yaml`,
`apps/seller-android/gradle/libs.versions.toml`, and Gradle dependency output.

## Providers, vendors, and data-touching SDKs

| ID | Provider / component | Purpose and possible data | Observed state | Location / transfer state | Owner | Required next action |
| --- | --- | --- | --- | --- | --- | --- |
| `TP-001` | Cloudflare Workers, D1, R2, Queues, Email, DNS/CDN | API processing, seller/buyer records, media, sessions, logs, email, edge/security metadata | Production configuration present | D1/R2 observed `WEUR`; D1 jurisdiction `null`; Workers/Queues/support countries not fully mapped | Cloud + privacy lead | Complete DPA/sub-processor/access-country/retention map and approve hosting decision |
| `TP-002` | Google Firebase Phone Authentication / Identity Toolkit | Phone number, OTP/auth metadata, ID token, device/app-verification signals | Active auth path; protected contract | Countries, sub-processors, retention, and support access not recorded here | Mobile + privacy lead | Complete vendor/DPA/transfer entry and reconcile Privacy/Data Safety |
| `TP-003` | Firebase Analytics | App/device/usage analytics depending on runtime configuration | Dependency present; actual production events and consent/config not verified | Not approved in this register | Product + privacy lead | Inventory events, defaults, identifiers, consent, retention, countries, and disable unnecessary collection |
| `TP-004` | Google Play Billing | Merchant SaaS subscription purchase and purchase token | Client integration present; complete server entitlement not evidenced | Google processing not mapped here | Product + finance | Approve billing ADR; implement full lifecycle or disable paid entry points |
| `TP-005` | DeepSeek API | AI chat and cached product translation prompts/content | Backend code path present when secret is configured; public seller AI screen deferred | Provider transfer/DPA/retention/training/support state not approved | Product + privacy + CTO | Verify production enablement; keep gated; complete provider assessment before any personal data |
| `TP-006` | Cloudflare Email Sending/Routing | Transactional/inbound email content, addresses, delivery and security metadata | Worker binding configured | Included in Cloudflare mapping; exact routes/access/retention require review | Operations + privacy lead | Inventory templates/routes/forwarding/support, retention, suppression, and incident controls |
| `TP-007` | OpenStreetMap/osmdroid Mapnik tiles | Map tile requests; IP/network/device metadata may reach tile service | Runtime component used | External network destination and policy not yet approved | Mobile + privacy lead | Confirm user journey, endpoint, terms/attribution, caching, minimization, and transfer disclosure |
| `TP-008` | Google ML Kit Text Recognition | Payment-proof image/text processed for OCR | On-device SDK used; model/network behavior to verify | Data-transfer state not yet evidenced | Mobile + privacy lead | Verify bundled/on-device behavior, image lifecycle, logs, retention, and Data Safety mapping |
| `TP-009` | Stripe | Potential SaaS payment gateway | Environment field exists; runtime gateway call is commented and mock path is used | Dormant/unapproved | Product + finance + counsel | Remove misleading live configuration or complete legal/vendor/payment approval before activation |
| `TP-010` | WhatsApp / WhatsApp Business | User-initiated catalog sharing through installed apps | Package visibility entries present; no Android permission | User-selected external app | Product + privacy lead | Verify exact shared fields, chooser behavior, disclosure, and no silent transmission |
| `TP-011` | `postal-mime` | Local parsing of inbound email content in Worker | Backend runtime dependency | Executes within Worker environment | Engineering + security | Record licence/version, parsing limits, patch owner, and malformed-content tests |
| `TP-012` | AndroidX, Compose, Hilt, Room, WorkManager, Coil, OkHttp, libphonenumber and test tooling | Local app/runtime functions; some libraries can make network calls as configured | Version catalog present | Service transfer depends on actual endpoints, not library publisher | Engineering + security | Generate SBOM/licence inventory, identify network/data behavior, assign patch cadence |

## Android manifest and permission baseline

| ID | Capability | Source state | Purpose | Decision | Verification / next action |
| --- | --- | --- | --- | --- | --- |
| `PRM-001` | `android.permission.INTERNET` | Declared in main manifest | Cloudflare API, Firebase auth, map tiles, media and approved network services | Accepted baseline; must remain purpose-limited | Review final endpoints and merged release manifest |
| `VIS-001` | Package visibility for `com.whatsapp` and `com.whatsapp.w4b` | Declared under `<queries>` | Detect/select WhatsApp share target | Not a runtime permission; retain only if journey requires it | Confirm minimum visibility and Play declaration impact |
| `PRM-002` | Contacts, precise/approximate location, camera, microphone, SMS, phone state, storage/media, notifications | Not declared in source main manifest | No approved launch need established | Prohibited without change approval | Confirm merged release manifest contains none unless approved |
| `MRG-001` | SDK-added merged-manifest permissions/components | Not yet recorded for final release | Dependencies may contribute components or permissions | Release blocker until reviewed | Export merged release manifest; compare to source; record owner and disposition |

## Approval checklist for a new vendor, SDK, or permission

Before implementation:

1. create a `CHG-NNN` and link the product requirement;
2. document purpose, data fields, users, lawful basis, countries, recipients,
   sub-processors, retention, support access, deletion, incident terms, and exit;
3. compare a no-data/no-permission/first-party alternative;
4. review security, licence, maintenance, size/performance, and accessibility;
5. update ROPA, data flow, vendor register, privacy notice, consent, Data Safety,
   target audience, retention/deletion, and tests as applicable;
6. obtain the approval matrix in the temporary freeze;
7. verify the final binary/merged manifest and production configuration.
