# Firebase Authentication Outage

> **Status:** Current operational procedure; verify Firebase quotas, billing,
> and console state at incident time
>
> **Last verified:** 2026-07-19

## Symptom

- All new-store registrations (`POST /api/v1/register`) return `401 auth` or
  `503 firebase_not_configured`.
- Device restore requests (`POST /api/v1/auth/session`) fail with the same
  errors.
- Existing sellers with valid device secrets can still use the app (ongoing
  requests don't call Firebase).
- The admin panel is unaffected (it uses its own email+password auth).

## Diagnosis

### Step 1: Check the Worker health endpoint

```cmd
curl https://api.orderak.app/health
```

If the Worker is up and healthy, the problem is specific to Firebase.

### Step 2: Check the FIREBASE_WEB_API_KEY secret

```cmd
cd services/backend
npx wrangler secret list
```

Confirm `FIREBASE_WEB_API_KEY` is present. If it's missing:

- The Worker was deployed without it.
- A redeploy or environment change may have dropped it (secrets are per-Worker;
  they don't transfer automatically).

### Step 3: Check the Firebase project status

1. Open the [Firebase console](https://console.firebase.google.com/).
2. Navigate to **Authentication → Sign-in method → Phone**.
3. Confirm Phone sign-in is enabled.
4. Check the **Usage** and billing views for quota exhaustion. Phone-auth SMS
   requires a billing-linked project; standard Firebase Authentication is
   currently limited to 3,000 sent SMS/day, while Identity Platform quotas can
   differ. Treat the console and current Google documentation as authoritative.
5. Check the [Firebase Status Dashboard](https://status.firebase.google.com/)
   for ongoing incidents.

### Step 4: Test the identity toolkit endpoint directly

Use a dedicated test project/device and a secret-masking API client to call
`accounts:lookup` with the project Web API key and a fresh test ID token. Do not
paste a real token or key into a shared terminal, ticket, screenshot, or shell
history. Compare the HTTP status and Google error code with the Worker's
server-side verification result; one failure alone does not prove an outage.

### Step 5: Check the Worker error logs

Open the admin panel → **Errors** tab. Look for:

- `firebase_not_configured` — the Worker couldn't load the secret.
- `firebase_verification_failed` — the token was invalid.
- `firebase_service_error` — the Identity Toolkit returned an error.

### Possible causes

| Scenario | Clues |
|----------|-------|
| Secret missing | `503 firebase_not_configured` in errors |
| Wrong Web API key | Identity Toolkit returns `API_KEY_INVALID` |
| Firebase project deleted/suspended | Console shows project state |
| SMS quota exhausted | Firebase console Usage tab |
| Firebase service outage | Status dashboard |
| Firebase API key restrictions | Key restricted to wrong APIs/referrers |

## Fix

### If the secret is missing

```cmd
cd services/backend
npx wrangler secret put FIREBASE_WEB_API_KEY
# Enter the Web API key from Firebase console → Project settings → Web API Key
npx wrangler deploy
```

### If the key is wrong

1. In the Firebase console, go to **Project settings → General**.
2. Copy the **Web API Key**.
3. Update the secret:

```cmd
npx wrangler secret put FIREBASE_WEB_API_KEY
# Paste the correct key
npx wrangler deploy
```

### If the Firebase project is suspended or deleted

1. Restore the project from the Firebase console if possible.
2. If the project is unrecoverable, create a new Firebase project, enable
   Phone Auth, add the Android app (`app.orderak.seller`), and update
   `FIREBASE_WEB_API_KEY`.
3. Existing sellers will need to re-authenticate if the project changes
   (their old ID tokens were signed by the old project).

### If SMS quota is exhausted

1. Confirm that the project is linked to billing and is on Blaze; phone-auth SMS
   requires billing. Standard Firebase Authentication is currently limited to
   3,000 sent SMS/day. If that is insufficient, evaluate the Identity Platform
   upgrade and request quota support early.
2. Use Firebase fictional test phone numbers for tests. Any production country
   restriction is a product/auth-contract change and needs explicit approval.

### Emergency bypass (testing only — NEVER in production)

For emergency testing when Firebase is down and you need to test registration
locally:

1. Add to `.dev.vars`:

   ```text
   ALLOW_UNVERIFIED_REGISTRATION=true
   ```

2. Restart `wrangler dev`.
3. This skips Firebase ID token verification — registration accepts any phone
   number with a device secret.

**This must never be set in production.** It removes the only server-side
guard against phone number spoofing.

## Rollback

- Redeploy the previous Worker version if a code regression broke Firebase
  integration:

```cmd
npx wrangler versions list
npx wrangler rollback <previous-version-id>
```

- The isolated `accounts:lookup` verification call is stateless, but the full
  registration/session flows can write seller, device, legal-acceptance, and
  session-related records. Inspect D1 for partial application before deciding
  that no database remediation is required.

## Prevention

- Set a billing budget alert in the Firebase console to notify before SMS
  quota exhaustion.
- Monitor the admin Errors tab for `firebase_*` errors.
- Review the Firebase Status Dashboard after any authentication incidents.
- Test registration flow after every `FIREBASE_WEB_API_KEY` rotation.
- Review API-key restrictions with the deployed Worker architecture. Do not
  assume a browser-referrer rule or one fixed Worker egress IP is appropriate;
  test the selected restriction without weakening server-side token checks.

## References

- [Firebase Authentication limits](https://firebase.google.com/docs/auth/limits)
- [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Firebase status dashboard](https://status.firebase.google.com/)
