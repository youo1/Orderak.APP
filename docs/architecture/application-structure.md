# Orderak Application Structure

**Status:** active repository contract
**Last verified:** 2026-08-11 — corrected the seller-v1.json path (was missing `/src/`)

Orderak is a multi-client product with one currently implemented seller client. The
repository contains only real, buildable applications:

| Path | Status | Responsibility |
|---|---|---|
| `apps/seller-android/` | Active | Kotlin and Jetpack Compose seller application |
| `apps/admin-web/` | Active | React administration application and Admin Edge Worker |
| `apps/seller-ios/` | Reserved name only | Future seller iOS application after the technology decision |
| `apps/seller-desktop/` | Reserved name only | Future seller desktop application after the technology decision |

The reserved paths are documented names, not empty directories. Adding either app
requires an architecture decision covering its framework, authentication adapter,
secure storage, release pipeline, accessibility, localization profile, and ownership.

All seller clients consume `contracts/openapi/src/seller-v1.json`. Product rules, data
authority, authorization, billing decisions, and tenant isolation remain in
`services/backend/`; no client is allowed to become an independent source of truth.

Android remains one Gradle application module during this reorganization. Kotlin
Multiplatform, Swift, Compose Desktop, and other sharing frameworks are explicitly
outside this change.
