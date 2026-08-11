# Repository and platform baseline - 18 July 2026

## Evidence metadata

| Field | Value |
| --- | --- |
| Evidence ID | `EVD-20260718-001` |
| Owner | Acting program lead |
| Reviewer | Pending QA / release lead appointment |
| Scope | Repository, Android build configuration, protected contracts, Cloudflare storage metadata, and prior automated checks |
| Classification | Internal; sanitized; no secrets or personal data |
| Related items | `REQ-GOV-002`, `FND-001` through `FND-007`, `R-003`, `R-004`, `R-005` |
| Status | Recorded; specialist review still required |

## Repository baseline

- Branch observed: `main`.
- The integrated roadmap and source plans are preserved as non-authoritative,
  unpublished evidence.
- Phase 0 governance artifacts are maintained under `docs/governance/`.
- The Android application ID is `app.orderak.seller`.
- The architecture is an Android seller app calling a Cloudflare Worker, with
  D1, R2, KV, Firebase Phone Authentication, Cloudflare Email, and optional
  DeepSeek/Stripe configuration.

## Android baseline

| Check | Observed result | Evidence source |
| --- | --- | --- |
| Compile SDK | 35 | `apps/seller-android/app/build.gradle.kts` |
| Target SDK | 35 | `apps/seller-android/app/build.gradle.kts` |
| Minimum SDK | 24 | `apps/seller-android/app/build.gradle.kts` |
| Version | `0.2.0-fullmvp`, version code 1 | `apps/seller-android/app/build.gradle.kts` |
| Source manifest permission | `android.permission.INTERNET` only | `apps/seller-android/app/src/main/AndroidManifest.xml` |
| Package visibility | WhatsApp and WhatsApp Business packages queried | Source manifest |
| Protected auth guard | `verifyAuthPhase1Contract` wired to `preBuild` | App build script |
| Protected localization guard | `verifyLocalizationContract` wired to `preBuild` | App build script |
| Billing client | Present in app code; backend entitlement completion remains a gate | Version catalog and `BillingManager.kt` |
| Firebase | Phone Auth and Analytics dependencies present | Version catalog and app build script |
| Other data-touching SDKs | ML Kit OCR and osmdroid/OpenStreetMap present | Version catalog and source code |

The integrated roadmap sets an internal 14 August 2026 target to complete the
API 36 upgrade and regression work before the Google Play policy deadline.

## Cloudflare baseline

Read-only Wrangler metadata was checked on 18 July 2026:

| Resource | Observed result | Reproduction command |
| --- | --- | --- |
| D1 `orderak-db` | Running in `WEUR`; jurisdiction `null`; 43 tables at observation | `npx wrangler d1 info orderak-db --json` |
| R2 `orderak-media` | Location `WEUR`; 0 objects at observation | `npx wrangler r2 bucket info orderak-media` |
| Worker | D1, R2, KV, Email, custom domains, cron, and observability configured | `services/backend/wrangler.jsonc` |

This is not evidence of Egypt data residency or approved cross-border
processing. The hosting, transfer, vendor, and access-country decision remains
a public-launch blocker.

## Policy and contract baseline

| Artifact | Observed state |
| --- | --- |
| English and Arabic Terms | Last updated 13 July 2026; current documents identify the existing operator and require Egypt-specific legal reconciliation after entity decision |
| English and Arabic Privacy Notice | Last updated 13 July 2026; DPO, transfer countries, controller/processor roles, and final operator require review |
| Authentication contract | Version 1, protected since 13 July 2026; owner approval required |
| Localization contract | Protected architecture; Arabic/English/French seller UI and Arabic/English public content scope |
| Production auth plan | Repository phase complete; release/Play fingerprints and physical-device SMS evidence remain gates |

## Prior automated baseline

The following checks completed successfully during the integrated-roadmap
assessment on 18 July 2026:

```powershell
cd services/backend
npm.cmd test -- --run

cd apps\seller-android
gradlew.bat testStagingDebugUnitTest lintStagingDebug verifyAuthPhase1Contract verifyLocalizationContract
```

This summary records the observed result but is not a substitute for retained
CI output tied to a commit. Before G0 evidence acceptance, the QA/release owner
must attach durable command output or rerun the checks in CI.

## Baseline limitations

- No statement here proves company incorporation, tax registration, DPO
  appointment, legal advice, or regulatory approval.
- Source-manifest review does not replace merged release-manifest review.
- Automated tests do not replace penetration testing, restore testing,
  incident exercises, policy-to-practice testing, or console evidence.
- Provider configuration and actual production data flows must be reconciled
  against live consoles at the applicable gate.
