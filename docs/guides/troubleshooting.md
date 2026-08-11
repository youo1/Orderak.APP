# Troubleshooting Guide

Common issues and their fixes during development and production operation.

## Backend

### `admin.orderak.app` is unreachable ("site can't be reached")

**Cause:** The `orderak.app` Cloudflare zone was not **Active** when the
Worker was first deployed, so the custom domain routes were never attached.

**Fix:**

1. Confirm the zone is Active in the Cloudflare dashboard (DNS → Zones).
2. Redeploy the Worker:

```cmd
cd services/backend
npx wrangler deploy
```

1. Wait ~1 minute for DNS records and SSL to provision.

**Workaround:** Use `http://localhost:8787/admin` locally while DNS is
being fixed.

### Email: no mail is sent locally (no-op provider)

**Cause:** The `send_email` binding is available only in deployed Staging and
Production Workers (Cloudflare Email Sending is a deployed service).

**Fix:** This is expected behavior. The backend automatically uses a
**no-op provider** locally: sends are logged and appear in the admin
Emails tab event log, but no real mail leaves your machine. Test email through
the Staging admin panel's **Send test** feature with an approved test recipient.
Do not use production contacts in Staging.

### All D1 migrations appear as pending

**Cause:** The `d1_migrations` ledger table is empty or missing. This
happens when individual migration files were executed with
`wrangler d1 execute` instead of `wrangler d1 migrations apply`.

**Fix:** Follow the [D1 Migration Drift runbook](../runbooks/d1-migration-drift.md).
Do not re-run `migrations apply` blindly — it would replay historical
table-rebuild migrations against production data.

### `wrangler dev` fails with network errors on Windows

**Cause:** Windows loopback restrictions may block `wrangler dev`.

**Fix:**

1. Run Command Prompt as Administrator.
2. Enable loopback for Wrangler if prompted by Windows Defender Firewall.
3. Try `npx wrangler dev --ip 0.0.0.0` if you need to reach the Worker
   from another device on the network.

### `npm test` fails after a dependency update

**Cause:** Vitest or Wrangler dependency mismatch.

**Fix:**

```cmd
cd services/backend
npm ci
npm test
```

## Android

### Build fails: `google-services.json` is missing

**Cause:** The `google-services.json` file was not downloaded from the
Firebase console.

**Fix:**

1. Open the [Firebase console](https://console.firebase.google.com/).
2. Go to **Project settings → Your apps → Android app**.
3. Download `google-services.json`.
4. Place it at `apps/seller-android/app/google-services.json`.
5. Rebuild.

Each developer must obtain their own file (it is git-ignored).

### Clean rebuild still uses stale output

**Cause:** Gradle daemon caches or build cache is serving stale artifacts.

**Fix:**

```cmd
cd apps/seller-android
gradlew.bat --stop
gradlew.bat clean
gradlew.bat :app:assembleStagingDebug --no-build-cache
```

### `verifyLocalizationContract` task fails

**Cause:** The localization architecture has drifted from the protected
contract. Common triggers:

- A string was added in one language but not the others.
- `unqualifiedResLocale` was changed.
- A manual `locale_config.xml` was restored.
- Language splits were re-enabled in `build.gradle.kts`.
- Resource names don't match across language directories.

**Fix:** Read
[`../localization-architecture.md`](../architecture/localization-architecture.md) for
the protected contract. The guard's error message identifies the specific
drift. Do **not** bypass the guard — resolve the conflict.

### Phone Auth fails on a debug build

**Cause:** The debug signing SHA-1/SHA-256 fingerprints are not registered
in the Firebase console.

**Fix:**

1. Get your debug fingerprints:

```cmd
cd apps/seller-android
gradlew.bat signingReport
```

1. Look for the `debug` variant's SHA-1 and SHA-256.
2. Add them in Firebase console → **Project settings → Android app →
   Add fingerprint**.
3. Wait a few minutes for the change to propagate, then retry.

### Connected tests fail to install the APK

**Cause:** The emulator or device may not match the APK's ABI.

**Fix:**

1. Check the emulator architecture (x86_64 vs arm64).
2. Ensure `assembleStagingDebugAndroidTest` was run first to build the test APK.
3. Try a clean build:

```cmd
gradlew.bat clean
gradlew.bat assembleStagingDebug assembleStagingDebugAndroidTest
gradlew.bat connectedStagingDebugAndroidTest
```

## Registration / Auth

### `503 firebase_not_configured` on registration

**Cause:** `FIREBASE_WEB_API_KEY` is not set as a Worker secret.

**Fix:** See the [Firebase Auth Outage runbook](../runbooks/firebase-auth-outage.md).

### `401 auth` on every Android API call

**Cause:** Device secret mismatch between the app and the backend.

**Possible fixes:**

1. The app was reinstalled — the device secret changed. Sign in again
   with Firebase Phone OTP.
2. The backend D1 data was reset — the stored hash no longer matches.
   Re-register the seller.
3. The phone number format differs (e.g. `01012345678` vs `+201012345678`).
   Ensure the app always sends the same format for a given phone number.

## Admin panel

### Cannot sign in to the admin panel

**Checklist:**

1. **First time?** The first owner must be bootstrapped via
   `POST /api/admin/v1/auth/bootstrap` with `ADMIN_API_KEY`. See
   [`../setup.md`](./setup.md) Section 5.
2. **Forgot password?** Use the break-glass reset endpoint:

```http
POST /api/admin/v1/auth/password/reset
x-admin-key: <ADMIN_API_KEY>
{ "email": "you@orderak.app", "new_password": "..." }
```

1. **Lost 2FA device?** Add `"clear_totp": true` to the reset request above.

### Admin session expires unexpectedly

**Cause:** `ADMIN_JWT_SECRET` was rotated, invalidating all existing
sessions.

**Fix:** Sign in again. All admins must re-authenticate after a JWT
secret rotation.

## Production

### Worker deploy fails with route conflict

**Cause:** Another Worker already has routes for `orderak.app` domains.

**Fix:** Remove the conflicting routes from the other Worker in the
Cloudflare dashboard, or transfer them to this Worker's `wrangler.jsonc`.

### `wrangler deploy` warns about custom domains

**Cause:** The `orderak.app` zone is not Active yet.

**Fix:** See "admin.orderak.app is unreachable" above. The Worker still
deploys and is reachable at its `*.workers.dev` URL.
