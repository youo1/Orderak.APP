// ============================================================
// Payment gateway abstraction.
//
// The billing logic (subscriptions, coupons, referrals) never talks to a
// specific provider directly — it talks to this `PaymentGateway` interface.
// For the MVP we ship a `MockGateway`. To go live you write a `StripeGateway`
// (or Paymob/Fawry) implementing the same interface and swap `getGateway()`.
//
// All amounts are integer piasters (EGP * 100). Never floats.
// ============================================================

export interface CheckoutRequest {
	sellerId: string; // store UUID
	planId: string;
	amountPiasters: number; // amount after coupon/discount
	currency: string; // "EGP"
	couponCode?: string | null;
	idempotencyKey: string; // callers MUST provide this
	metadata?: Record<string, string>;
}

export interface CheckoutResult {
	gateway: string;
	gatewaySubId: string; // provider subscription/charge id
	status: "active" | "pending" | "past_due";
	checkoutUrl?: string; // where to redirect for real gateways
	currentPeriodEnd: string; // ISO datetime
}

export interface WebhookEvent {
	// Provider's unique event id. Used to dedupe: gateways RETRY webhooks, so
	// the same event may arrive several times. When present, we process once.
	eventId?: string;
	type: string; // e.g. "subscription.active" | "invoice.paid" | "subscription.canceled"
	gatewaySubId: string;
	sellerId?: string; // store UUID
	status?: "active" | "past_due" | "canceled";
}


export interface PaymentGateway {
	readonly name: string;
	createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
	cancelSubscription(gatewaySubId: string): Promise<void>;
	/** Verify signature and parse a raw webhook body into a normalized event. */
	parseWebhook(rawBody: string, signature: string | null, secret?: string): Promise<WebhookEvent>;
}

/** Verify an HMAC-SHA256 hex signature over a raw body (constant-time). */
async function verifyHmacHex(rawBody: string, signatureHex: string, secret: string): Promise<boolean> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
	);
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
	const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
	const given = signatureHex.trim().toLowerCase();
	if (given.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
	return diff === 0;
}

/** Add one month (30 days) to now — used for the mock period end. */
function oneMonthFromNow(): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + 30);
	return d.toISOString();
}

/**
 * MockGateway — simulates a real provider for the MVP.
 * - createCheckout immediately "activates" the subscription (no redirect needed).
 * - parseWebhook accepts a JSON body describing the event (for testing status changes).
 */
export class MockGateway implements PaymentGateway {
	readonly name = "mock";

	async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
		// A deterministic-ish id so repeated idempotency keys are traceable.
		const gatewaySubId = `mock_${req.sellerId}_${req.idempotencyKey.slice(0, 12)}`;
		return {
			gateway: this.name,
			gatewaySubId,
			// Free (amount 0) or paid — mock treats both as immediately active.
			status: "active",
			currentPeriodEnd: oneMonthFromNow(),
		};
	}

	async cancelSubscription(_gatewaySubId: string): Promise<void> {
		// Nothing to call for the mock. In Stripe this would hit the API.
		return;
	}

	async parseWebhook(rawBody: string, signature: string | null, secret?: string): Promise<WebhookEvent> {
		// SECURITY: /api/integrations/v1/payment is a public POST. When a webhook secret
		// is configured, require a valid HMAC-SHA256 signature over the raw body —
		// otherwise anyone who learns/guesses a gateway_sub_id could flip
		// subscription statuses (e.g. activate a paid plan for free). Only when no
		// secret is configured (local dev / tests) do we trust the body as before.
		if (secret) {
			if (!signature || !(await verifyHmacHex(rawBody, signature, secret))) {
				throw new Error("bad_signature");
			}
		}
		const body = JSON.parse(rawBody) as Partial<WebhookEvent> & { data?: Record<string, unknown> };
		return {
			eventId: body.eventId ? String(body.eventId) : undefined,
			type: String(body.type ?? "subscription.active"),
			gatewaySubId: String(body.gatewaySubId ?? ""),
			sellerId: body.sellerId ? String(body.sellerId) : undefined,
			status: (body.status as WebhookEvent["status"]) ?? "active",
		};

	}
}

/**
 * Return the active gateway. Swap this to StripeGateway when going live.
 * (Kept as a function so we can read secrets/config from env later.)
 */
export function getGateway(_env: Env): PaymentGateway {
	// if (_env.STRIPE_SECRET_KEY) return new StripeGateway(_env.STRIPE_SECRET_KEY);
	return new MockGateway();
}
