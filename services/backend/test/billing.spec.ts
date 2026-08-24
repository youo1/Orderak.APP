// Legacy gateway billing: coupons, referrals, subscriptions, and the public
// payment webhook.
//
// This module had no tests. It is 700 lines that price discounts, decide
// whether a paid plan is active, and expose an unauthenticated POST that writes
// subscription status — the highest-consequence surface in the repository with
// the least coverage. The cases below are the ones an audit found broken.

import { beforeEach, describe, expect, it } from "vitest";
import { env, BASE, createSchema, registerStore, authHeaders, type Registered } from "./helpers";
import { handleBillingRoutes } from "../src/domains/commerce/billing";

/**
 * The environment the Workers actually run in, which the test env is not.
 *
 * Spread rather than Object.create(env): the bindings are own enumerable
 * properties of the test env, and a prototype-chain copy does not carry the
 * plain `vars` the way the handlers read them.
 */
function deployedEnv(overrides: Partial<TestEnv> = {}): TestEnv {
	return { ...(env as TestEnv), DEPLOYMENT_ENVIRONMENT: "staging", ...overrides };
}

async function call(
	path: string,
	init: RequestInit,
	testEnv: TestEnv = env as TestEnv,
): Promise<Response> {
	const request = new Request(`${BASE}${path}`, init);
	const response = await handleBillingRoutes(request, testEnv, new URL(request.url));
	if (!response) throw new Error(`billing route not handled: ${path}`);
	return response;
}

async function seedPaidPlan(): Promise<void> {
	await env.orderak_db.prepare(
		"INSERT INTO plans(id,name,price_minor,currency,active,sort_order) VALUES('growth','Growth',50000,'EGP',1,1)",
	).run();
}

async function subscribe(seller: Registered, body: Record<string, unknown>, testEnv?: TestEnv): Promise<Response> {
	return call("/api/v1/subscribe", {
		method: "POST",
		headers: authHeaders(seller),
		body: JSON.stringify(body),
	}, testEnv);
}

beforeEach(async () => {
	await createSchema();
});

describe("coupon redemption", () => {
	// coupon_uses has carried UNIQUE(coupon_code, seller_id) since 002_billing.sql,
	// and /coupons/apply checked it — but /coupons/apply only prices a coupon.
	// /subscribe, which applies the discount and creates the subscription, never
	// consulted the table, so posting straight to it redeemed the same coupon on
	// every purchase up to the coupon's global max_uses.
	it("refuses a coupon the same seller has already redeemed", async () => {
		const seller = await registerStore();
		await seedPaidPlan();
		await env.orderak_db.prepare(
			"INSERT INTO coupons(code,discount_type,value,max_uses,active) VALUES('WELCOME20','percentage',20,0,1)",
		).run();

		const first = await subscribe(seller, { plan_id: "growth", coupon_code: "WELCOME20" });
		expect(first.status).toBe(200);
		expect(await first.json()).toMatchObject({ ok: true, amount_charged_minor: 40000 });

		const second = await subscribe(seller, { plan_id: "growth", coupon_code: "WELCOME20" });
		expect(second.status).toBe(400);
		expect(await second.json()).toMatchObject({ code: "coupon_invalid", reason: "already_used" });

		// The global counter moved exactly once, so a refused redemption did not
		// silently consume one of a limited coupon's uses either.
		expect(await env.orderak_db.prepare("SELECT used_count FROM coupons WHERE code='WELCOME20'").first())
			.toMatchObject({ used_count: 1 });
	});

	it("still lets a different seller redeem the same coupon", async () => {
		const first = await registerStore();
		const second = await registerStore();
		await seedPaidPlan();
		await env.orderak_db.prepare(
			"INSERT INTO coupons(code,discount_type,value,max_uses,active) VALUES('SHARED','fixed',10000,0,1)",
		).run();

		expect((await subscribe(first, { plan_id: "growth", coupon_code: "SHARED" })).status).toBe(200);
		expect((await subscribe(second, { plan_id: "growth", coupon_code: "SHARED" })).status).toBe(200);
	});

	// The validate endpoint is unauthenticated and reports whether a code exists,
	// so its rate limit is the only thing between it and a coupon-code oracle.
	// The bucket was `phone || ip`, and `phone` comes from a request header the
	// caller sets — so rotating it gave every attempt a fresh bucket and the IP
	// branch was never reached.
	it("rate-limits coupon probing per source, not per caller-supplied phone", async () => {
		await seedPaidPlan();
		// The IP window allows 30/minute. Fired together rather than in sequence:
		// forty sequential round trips through the limiter Durable Object is slow
		// enough to time out when the whole suite is running.
		const probe = (attempt: number) => call("/api/v1/coupons/validate", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				// A different phone every time — previously enough to evade the
				// limit entirely, because the bucket was `phone || ip` and the
				// phone comes from a header the caller sets.
				"x-orderak-phone": `+2010000${String(attempt).padStart(5, "0")}`,
				"cf-connecting-ip": "203.0.113.77",
			},
			body: JSON.stringify({ plan_id: "growth", code: `GUESS${attempt}` }),
		});
		const responses = await Promise.all(Array.from({ length: 40 }, (_, index) => probe(index)));
		expect(responses.some((response) => response.status === 429)).toBe(true);
	});
});

describe("payment webhook", () => {
	const body = JSON.stringify({ type: "subscription.active", gatewaySubId: "sub_1", eventId: "evt_1" });

	// /api/integrations/v1/payment is a public POST that writes subscription
	// status. Signature verification was skipped entirely when no secret was
	// configured, and staging did not require PAYMENT_WEBHOOK_SECRET — so on a
	// deployed environment an unset secret made it an unauthenticated endpoint.
	it("refuses an unsigned body on a deployed environment", async () => {
		const testEnv = deployedEnv();
		testEnv.PAYMENT_WEBHOOK_SECRET = undefined;
		const response = await call("/api/integrations/v1/payment", { method: "POST", body }, testEnv);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "invalid_webhook" });
	});

	it("refuses a wrong signature when a secret is configured", async () => {
		const testEnv = deployedEnv();
		testEnv.PAYMENT_WEBHOOK_SECRET = "webhook-secret";
		const response = await call("/api/integrations/v1/payment", {
			method: "POST",
			headers: { "x-webhook-signature": "00".repeat(32) },
			body,
		}, testEnv);
		expect(response.status).toBe(400);
	});

	it("accepts a correctly signed body", async () => {
		const secret = "webhook-secret";
		const key = await crypto.subtle.importKey(
			"raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
		);
		const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
		const signature = [...mac].map((byte) => byte.toString(16).padStart(2, "0")).join("");

		const testEnv = deployedEnv();
		testEnv.PAYMENT_WEBHOOK_SECRET = secret;
		const response = await call("/api/integrations/v1/payment", {
			method: "POST",
			headers: { "x-webhook-signature": signature },
			body,
		}, testEnv);
		expect(response.status).toBe(200);
		// No subscription carries that gateway id, so the event is acknowledged
		// and ignored rather than applied — the point is that it got past the gate.
		expect(await response.json()).toMatchObject({ ok: true, ignored: "unknown_subscription" });
	});

	// BILLING_ENABLED=false is the state both environments ship in. It used to
	// close six of this module's nine routes and leave the public webhook open.
	it("is closed with the rest of the surface when billing is disabled", async () => {
		const testEnv = deployedEnv();
		testEnv.BILLING_ENABLED = "false";
		for (const path of ["/api/integrations/v1/payment", "/api/v1/cancel", "/api/v1/subscription/status"]) {
			const response = await call(path, { method: path === "/api/v1/subscription/status" ? "GET" : "POST", body: path === "/api/v1/subscription/status" ? undefined : body }, testEnv);
			expect(response.status, path).toBe(403);
			expect(await response.json()).toMatchObject({ code: "feature_disabled" });
		}
	});
});

describe("paid checkout without a real gateway", () => {
	// getGateway() returns MockGateway unconditionally, and MockGateway reports
	// every checkout as active without charging. On production that hands out any
	// paid plan for free; BILLING_ENABLED is the only thing standing in the way,
	// and it is one variable.
	it("is refused on production", async () => {
		const seller = await registerStore();
		await seedPaidPlan();
		const testEnv = deployedEnv();
		testEnv.DEPLOYMENT_ENVIRONMENT = "production";

		const response = await subscribe(seller, { plan_id: "growth" }, testEnv);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ code: "payment_gateway_unavailable" });
		expect(await env.orderak_db.prepare("SELECT id FROM subscriptions").first()).toBeNull();
	});

	// The free plan takes no payment, so it is unaffected — a seller can still be
	// put on Free while paid checkout is closed.
	it("does not block the free plan", async () => {
		const seller = await registerStore();
		await env.orderak_db.prepare(
			"INSERT INTO plans(id,name,price_minor,currency,active) VALUES('free','Free',0,'EGP',1)",
		).run();
		const testEnv = deployedEnv();
		testEnv.DEPLOYMENT_ENVIRONMENT = "production";

		const response = await subscribe(seller, { plan_id: "free" }, testEnv);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true, requires_payment: false });
	});
});
