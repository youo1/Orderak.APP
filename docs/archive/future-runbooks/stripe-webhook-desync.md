# Stripe Webhook Desync

> **Archived future procedure — do not execute.** The current launch is free,
> `BILLING_ENABLED=false`, Stripe is not an approved production gateway, and
> the backend does not implement Stripe's native event/signature contract.
> Recreate and test this runbook from the approved billing design before paid
> acquisition is enabled. The SQL below is retained as historical planning
> material only and must not be run against any environment.

## Symptom

- A seller's subscription is stuck in `pending` status even though they
  completed payment (confirmed in the Stripe dashboard).
- The admin panel shows the subscription as `pending` in the Stores view.
- No recent errors appear in the admin Errors tab.
- The seller cannot use paid-plan features.

## Diagnosis

### Step 1: Check the subscription in D1

```cmd
cd backend
npx wrangler d1 execute orderak-db --local --command \
  "SELECT id, seller_id, plan_id, status, gateway_sub_id, idempotency_key,
   created_at, updated_at FROM subscriptions WHERE status = 'pending';"
```

For production, use `--remote` instead of `--local`.

### Step 2: Check the Stripe dashboard

1. Open the [Stripe Dashboard](https://dashboard.stripe.com/).
2. Find the payment intent or checkout session by the `gateway_sub_id` from
   the subscription row.
3. Confirm the payment succeeded on Stripe's side.

### Step 3: Check the webhook event ledger

```cmd
npx wrangler d1 execute orderak-db --remote --command \
  "SELECT event_id, gateway, type, processed_at FROM webhook_events
   ORDER BY processed_at DESC LIMIT 20;"
```

Look for the expected `checkout.session.completed` event for this subscription.

### Possible causes

| Scenario | Clues |
|----------|-------|
| Webhook never arrived | No matching event in `webhook_events`. Check Stripe webhook logs for delivery failures. |
| Webhook arrived but was replayed | Event exists in `webhook_events` with an earlier `processed_at`. The replay was skipped by idempotency but the original may have failed silently. |
| Wrong webhook secret | `PAYMENT_WEBHOOK_SECRET` on the Worker doesn't match Stripe's signing secret. Webhook is rejected with 401. |
| Worker error during processing | Event may not be recorded if the Worker crashed before the ledger insert. Check admin Errors tab. |

## Fix

### If the webhook never arrived

1. Verify webhook endpoint in Stripe dashboard is `https://api.orderak.app/api/webhooks/payment`.
2. Check Stripe webhook logs for delivery attempts and failures.
3. If Stripe shows successful delivery but no event in D1, check Worker logs.
4. Manually update the subscription:

```cmd
npx wrangler d1 execute orderak-db --remote --command \
  "UPDATE subscriptions SET status = 'active', updated_at = datetime('now')
   WHERE id = '<subscription_id>';"
```

1. Insert a ledger entry for traceability:

```cmd
npx wrangler d1 execute orderak-db --remote --command \
  "INSERT INTO webhook_events (event_id, gateway, type)
   VALUES ('manual-reconcile-<timestamp>', 'stripe', 'checkout.session.completed');"
```

### If the webhook was replayed

1. Re-deliver the event from Stripe's dashboard. The idempotency ledger will
   skip it — this is expected.
2. Manually update the subscription as above.

### If the webhook secret is wrong

1. In the Stripe dashboard, copy the signing secret for the webhook endpoint.
2. Update the Worker secret:

```cmd
cd backend
npx wrangler secret put PAYMENT_WEBHOOK_SECRET
# Paste the new secret
npx wrangler deploy
```

1. Retry the failed webhook delivery from Stripe's dashboard.

## Rollback

- Redeploy the previous Worker version if a code regression caused the
  webhook handler to fail:

```cmd
npx wrangler versions list
npx wrangler rollback <previous-version-id>
```

- Do **not** undo D1 writes. The subscription status fix is additive.

## Prevention

- Monitor the admin Errors tab for webhook verification failures.
- Set up Stripe dashboard alerts for webhook delivery failures.
- Verify webhook functionality after every `PAYMENT_WEBHOOK_SECRET` rotation
  by sending a test webhook from Stripe's dashboard.
