---
status: current
generated: false
owner: android
last_verified: 2026-09-06
applies_to: [production, staging]
---
# Android release pipeline

How a signed Orderak seller build is produced, what decides its version code,
and what a person still has to do by hand.

## Branch to artifact

| Branch | Workflow | Variant | Destination |
|---|---|---|---|
| any pull request | `android-ci.yml` → `release-build` | `stagingRelease` bundle | CI only — proves R8 and size |
| `develop` | `android-staging-distribution.yml` (manual) | `stagingRelease` APK, signed | Firebase App Distribution |
| `main` | `android-release.yml` (manual) | `productionRelease` bundle, signed | workflow artifact → Play Console by hand |

Neither distribution workflow has a push trigger. Producing an artifact that
real people install is a decision someone makes, not a side effect of merging.

Publishing to Play is deliberately not automated. Building the bundle and
shipping it are separate decisions, and the first has to be proven repeatedly
before automating the second is worth anything.

## Version code

**A developer never edits `versionCode`.** It comes from
`-PorderakVersionCode`, which CI sets to `github.run_number`. The local default
is `1`, below every value CI can produce, so a developer build cannot be
mistaken for a released one.

This matters more than tidiness. The app sends the value as
`x-orderak-version-code`; the backend reads it in `platform/config/config.ts`
and uses it for three things:

- `app_version_policies.minimum_version_code` — force-update
- `blocked_version_codes_json` — kill switches for a specific build
- feature-flag targeting by version range

A build whose code landed *beneath* a minimum already stored in D1 would be
refused by the server it was built to talk to, and a non-monotonic scheme would
mis-evaluate block lists written against the old numbering.

`github.run_number` was chosen because it is monotonic per workflow and stable
across re-runs of an older commit — a re-run must never publish a value below
one already released. Commit count would also have been monotonic, but all five
Android checkouts use `actions/checkout` at the default `fetch-depth: 1`, so
`git rev-list --count HEAD` returns `1`.

### The mapping from the old numbering

| Version code | Origin |
|---|---|
| `1` | local developer builds, from the Gradle default |
| `2` | the hand-edited literal in `build.gradle.kts`, never published anywhere |
| `3`+ | `android-release.yml` run numbers, from the first release onward |

Nothing was ever published at `2`, so no stored `minimum_version_code` or
blocked-version entry refers to it and the switch strands nothing. Record any
future change to the source here before making it.

## Signing

Four values, all from the environment, never from the tree:

- `ORDERAK_KEYSTORE_PATH` — written to `RUNNER_TEMP` by the workflow
- `ORDERAK_KEYSTORE_PASSWORD`
- `ORDERAK_KEY_ALIAS`
- `ORDERAK_KEY_PASSWORD`

With any of them missing the release variant builds **unsigned**. That is what
a local build wants, and it is deliberate that the fallback is "obviously
unreleasable" rather than "debug-signed", which would look shippable.

`.gitignore` refuses `*.jks`, `*.keystore`, `*.p12`, `*.pepk`,
`keystore.properties` and `signing.properties`. A leaked upload key cannot be
rotated without Google's involvement; the app-signing key Play holds cannot be
rotated at all.

## Crashlytics

`debug` forces `crashlyticsCollectionEnabled` to `"false"`, and until this
pipeline existed the only build anyone was given was `stagingDebug` — so every
tester the app has ever had ran it with crash reporting off, and the reporting
path had never been exercised. Staging distribution now ships `stagingRelease`,
which has it on, is minified, and is signed with the same key as production.

`app/build/outputs/mapping/**` is uploaded as a workflow artifact on both
release paths. Without the mapping a crash from a minified build is an
unreadable stack.

## Database migrations

Schema 10 is the release baseline. `fallbackToDestructiveMigrationFrom` covers
versions 1–9 only — every schema that existed while the app was unpublished.

**From version 10 onward a schema change requires a real `Migration`.** The
local database holds a seller's catalogue, their customers, and orders recorded
offline that have not reached the server yet; that last part is not recoverable
by syncing. A blanket destructive fallback would have destroyed all of it on the
next schema change, silently, as a routine app update.

Room exports each schema to `app/schemas/`, so a migration can be written and
tested against the shipped schema rather than a description of it.

## What is still manual

These need a physical device and a Play Console, and none of them can be
asserted from CI:

1. Install the signed build and complete one order end to end.
2. Trigger a non-fatal and confirm it arrives in Crashlytics, symbolicated
   against the uploaded mapping.
3. Register the upload and app-signing certificate fingerprints with the
   Firebase project, or Phone Auth and passkeys will not resolve.
4. Publish Digital Asset Links for the production package.

Items 3 and 4 are prerequisites of opening production sign-in — see
`docs/product/production-auth-plan.md`.
