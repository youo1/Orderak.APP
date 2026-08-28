// ============================================================
// Billing routes: subscriptions, coupons, referrals.
// Money is integer minor units plus an explicit currency (ADR-009). The minor
// unit is not always a hundredth: KWD, BHD and OMR have 1000 per major unit.
// Never floats, and never a bare /100.
// ============================================================

import {
	jsonResponse,
	authSeller,
	readCreds,
	ensureReferralCode,
	checkRateLimit,
	audit,
	applyDiscount,
	type AuthenticatedSeller,
} from "../../platform/http/shared";
import { getGateway, type CheckoutRequest, type CheckoutResult } from "./payments";
import { runtimeControlEnabled } from "../../platform/config/runtime-config";

type Body = Record<string, unknown>;

/**
 * Every acquisition route in this module, gated as one surface.
 *
 * It used to hold six. `/api/integrations/v1/payment` and `/api/v1/cancel` were
 * outside it, so `BILLING_ENABLED=false` — the state both environments are in —
 * closed the front door and left them open. The webhook is the one that
 * matters: it is a public POST that writes subscription status, and it was
 * reachable on an environment that had declared it was not doing billing. Both
 * stay closed.
 *
 * `/api/v1/subscription/status` was closed with them and is deliberately open
 * again. It is an authenticated GET that returns the caller's own state and
 * grants nothing, so closing it protected nothing while breaking the rule this
 * domain is written around: closing billing must not blind a merchant to what
 * they already have. A seller who cannot buy must still be able to see the plan
 * they are on. See docs/domains/billing.md.
 *
 * The Android client calls none of this surface — its paid path is Google Play
 * (`/api/v1/billing/catalog`, `/api/v1/billing/google/verify`), a different
 * module with authoritative server-side verification.
 */
const BILLING_ACQUISITION_ROUTES = new Set([
	"/api/v1/subscribe",
	"/api/v1/cancel",
	"/api/v1/coupons/validate",
	"/api/v1/coupons/apply",
	"/api/v1/referral/apply",
	"/api/v1/referral/stats",
	"/api/v1/plans",
	"/api/integrations/v1/payment",
]);

/**
 * Whether a real payment can be taken in this environment.
 *
 * A gateway that does not move money is fine for local development and for the
 * test suite, which is where the mock earns its keep. It is not fine on
 * production, where "checkout succeeded" is the fact that grants a paid plan.
 */
function gatewayCanCharge(env: Env): boolean {
	if (getGateway(env).takesRealPayments) return true;
	return env.DEPLOYMENT_ENVIRONMENT !== "production";
}

// ---- coupon validation core (shared by validate + apply + subscribe) ----

interface CouponResult {
	valid: boolean;
	reason?: string;
	code?: string;
	discount_type?: string;
	value?: number;
	original_minor?: number;
	discount_minor?: number;
	final_minor?: number;
}

/**
 * @param sellerId when known, also rejects a coupon this seller has already
 *   redeemed. Omitted by the unauthenticated pricing preview, which has no
 *   seller to check against.
 */
async function evaluateCoupon(
	env: Env,
	rawCode: string,
	planPricePiasters: number,
	sellerId?: string,
): Promise<CouponResult> {
	const code = rawCode.trim().toUpperCase();
	if (!code) return { valid: false, reason: "code_required" };

	const c = (await env.orderak_db
		.prepare("SELECT * FROM coupons WHERE code = ?")
		.bind(code)
		.first()) as Record<string, unknown> | null;

	if (!c) return { valid: false, reason: "not_found" };
	if (!c.active) return { valid: false, reason: "inactive" };
	if (c.expires_at && new Date(String(c.expires_at)).getTime() < Date.now()) {
		return { valid: false, reason: "expired" };
	}
	if (Number(c.max_uses) > 0 && Number(c.used_count) >= Number(c.max_uses)) {
		return { valid: false, reason: "max_uses_reached" };
	}
	// One redemption per seller. The schema has said so since 002_billing.sql —
	// `UNIQUE(coupon_code, seller_id)` on coupon_uses — but nothing enforced it
	// where it counted: this check lived only in /coupons/apply, which prices a
	// coupon and charges nothing, while /subscribe applied the discount and took
	// the money without ever consulting the table. Skipping the advisory call and
	// posting straight to /subscribe redeemed the same coupon on every purchase,
	// bounded only by the coupon's global max_uses.
	//
	// Here rather than in the callers because this function is the module's
	// single answer to "is this coupon valid", and a validity rule that only some
	// callers apply is not one.
	if (sellerId) {
		const used = await env.orderak_db
			.prepare("SELECT 1 FROM coupon_uses WHERE coupon_code = ? AND seller_id = ?")
			.bind(code, sellerId)
			.first();
		if (used) return { valid: false, reason: "already_used" };
	}

	const finalPiasters = applyDiscount(planPricePiasters, String(c.discount_type), Number(c.value));
	return {
		valid: true,
		code,
		discount_type: String(c.discount_type),
		value: Number(c.value),
		original_minor: planPricePiasters,
		discount_minor: planPricePiasters - finalPiasters,
		final_minor: finalPiasters,
	};
}

// ---- referral qualification (credit the referrer after first paid payment) ----

async function qualifyReferral(env: Env, referredSellerId: string, planPricePiasters: number): Promise<void> {
	const ref = (await env.orderak_db
		.prepare("SELECT * FROM referrals WHERE referred_id = ? AND status = 'pending'")
		.bind(referredSellerId)
		.first()) as Record<string, unknown> | null;
	if (!ref) return;

	const settings = (await env.orderak_db
		.prepare("SELECT * FROM affiliate_settings WHERE id = 1")
		.first()) as Record<string, unknown> | null;
	if (!settings) return;

	const type = String(settings.commission_type);
	const value = Number(settings.commission_value);
	const commission =
		type === "percentage"
			? Math.floor((planPricePiasters * Math.max(0, value)) / 100)
			: Math.max(0, Math.floor(value));

	await env.orderak_db
		.prepare(
			`UPDATE referrals
			 SET status = 'qualified', commission_minor = ?, qualified_at = datetime('now')
			 WHERE id = ?`,
		)
		.bind(commission, ref.id)
		.run();

	audit("referral.qualified", {
		referral_id: ref.id,
		referrer_id: ref.referrer_id,
		referred_id: referredSellerId,
		commission,
	});
}

// ---- main router: returns Response if it handled the path, else null ----

export async function handleBillingRoutes(
	request: Request,
	env: Env,
	url: URL,
	authenticatedSeller?: AuthenticatedSeller | null,
): Promise<Response | null> {
	const p = url.pathname;
	if (BILLING_ACQUISITION_ROUTES.has(p) &&
		(env.BILLING_ENABLED !== "true" || !(await runtimeControlEnabled(env, "billing_enabled", true)))) {
		return jsonResponse({ error: "feature_disabled", feature: "billing" }, 403);
	}

	// -------- POST /api/v1/subscribe --------
	if (p === "/api/v1/subscribe" && request.method === "POST") {
		return subscribe(request, env, url, authenticatedSeller);
	}

	// -------- GET /api/v1/subscription/status --------
	if (p === "/api/v1/subscription/status" && request.method === "GET") {
		return subscriptionStatus(request, env, url, authenticatedSeller);
	}

	// -------- POST /api/v1/cancel --------
	if (p === "/api/v1/cancel" && request.method === "POST") {
		return cancelSubscription(request, env, url, authenticatedSeller);
	}

	// -------- POST /api/v1/coupons/validate --------
	if (p === "/api/v1/coupons/validate" && request.method === "POST") {
		return couponValidate(request, env, url);
	}

	// -------- POST /api/v1/coupons/apply --------
	if (p === "/api/v1/coupons/apply" && request.method === "POST") {
		return couponApply(request, env, url, authenticatedSeller);
	}

	// -------- POST /api/v1/referral/apply --------
	if (p === "/api/v1/referral/apply" && request.method === "POST") {
		return referralApply(request, env, url, authenticatedSeller);
	}

	// -------- GET /api/v1/referral/stats --------
	if (p === "/api/v1/referral/stats" && request.method === "GET") {
		return referralStats(request, env, url, authenticatedSeller);
	}

	// -------- POST /api/integrations/v1/payment --------
	if (p === "/api/integrations/v1/payment" && request.method === "POST") {
		return handleWebhook(request, env);
	}

	// -------- GET /api/v1/plans (public) --------
	if (p === "/api/v1/plans" && request.method === "GET") {
		return listPublicPlans(env);
	}

	return null;
}

// ===================== Handlers =====================

async function listPublicPlans(env: Env): Promise<Response> {
	const { results: plans } = await env.orderak_db
		.prepare("SELECT * FROM plans WHERE active = 1 ORDER BY sort_order")
		.all();
	const planRows = plans as Record<string, unknown>[];

	// Was N+1 (one plan_features query per plan). Fetch all features in one
	// query and group in JS.
	const featuresByPlan = new Map<unknown, Record<string, unknown>[]>();
	if (planRows.length) {
		const marks = planRows.map(() => "?").join(",");
		const { results: features } = await env.orderak_db
			.prepare(
				`SELECT plan_id, feature_key, name, description, enabled
				 FROM plan_features WHERE plan_id IN (${marks})`,
			)
			.bind(...planRows.map((p) => p.id))
			.all();
		for (const f of features as Record<string, unknown>[]) {
			const { plan_id, ...rest } = f;
			const list = featuresByPlan.get(plan_id) ?? [];
			list.push(rest);
			featuresByPlan.set(plan_id, list);
		}
	}
	const out = planRows.map((plan) => ({ ...plan, features: featuresByPlan.get(plan.id) ?? [] }));

	// Public, rarely-changing data — let the edge cache it for 5 min.
	const res = jsonResponse({ ok: true, plans: out });
	res.headers.set("cache-control", "public, max-age=300");
	return res;
}

async function subscribe(request: Request, env: Env, url: URL, authenticatedSeller?: AuthenticatedSeller | null): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { phone, secret } = readCreds(request, url, body);
	const seller = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
	if (!seller) return jsonResponse({ error: "auth" }, 401);

	const planId = String(body.plan_id ?? "").trim();
	const plan = (await env.orderak_db
		.prepare("SELECT * FROM plans WHERE id = ? AND active = 1")
		.bind(planId)
		.first()) as Record<string, unknown> | null;
	if (!plan) return jsonResponse({ error: "plan_not_found" }, 404);

	await ensureReferralCode(env, seller);

	// Idempotency key: client-provided header wins; else derive a stable one.
	const idempotencyKey =
		request.headers.get("x-idempotency-key") ||
		String(body.idempotency_key ?? "") ||
		`${seller.id}:${planId}:${crypto.randomUUID()}`;

	// If we already processed this idempotency key, return the same subscription.
	// Scoped to the seller: a client-supplied key is attacker-choosable, so an
	// unscoped lookup would let one seller replay another's key and read their
	// subscription row.
	const existing = (await env.orderak_db
		.prepare("SELECT * FROM subscriptions WHERE idempotency_key = ? AND seller_id = ?")
		.bind(idempotencyKey, String(seller.id))
		.first()) as Record<string, unknown> | null;
	if (existing) {
		return jsonResponse({ ok: true, idempotent: true, subscription: existing });
	}

	let amount = Number(plan.price_minor);
	let couponCode: string | null = null;

	// -------- Free plan: activate immediately, no charge --------
	if (amount === 0) {
		const sub = await createOrReplaceSubscription(env, {
			sellerId: String(seller.id),
			planId,
			status: "active",
			gateway: "none",
			gatewaySubId: null,
			amount: 0,
			couponCode: null,
			idempotencyKey,
			currentPeriodEnd: null, // free never expires
		});
		audit("subscription.free_activated", { seller_id: seller.id, plan_id: planId });
		return jsonResponse({ ok: true, subscription: sub, requires_payment: false });
	}

	// -------- Paid plan: refuse outright if nothing can actually charge --------
	//
	// MockGateway reports every checkout as `active` without taking a payment, and
	// getGateway() returns it unconditionally because no real gateway is written
	// yet. On production that combination hands out any paid plan for free to
	// anyone who can call this endpoint — the plan is activated, the entitlements
	// follow, and no money moves.
	//
	// BILLING_ENABLED=false is what stands between that and a live system today,
	// and it is one variable. This is the second lock, and it is the one that
	// depends on a fact about the gateway rather than on a flag someone may flip
	// while reasoning about something else. Non-production keeps the mock, which
	// is what it is for.
	if (!gatewayCanCharge(env)) {
		console.error(JSON.stringify({ signal: "paid_checkout_without_gateway", plan_id: planId }));
		return jsonResponse({
			error: "payment_gateway_unavailable",
			message: "Paid plans cannot be purchased until a payment gateway is configured.",
		}, 503, { "retry-after": "3600" });
	}

	// -------- Paid plan: apply coupon + referral bonus, then charge --------
	if (body.coupon_code) {
		const res = await evaluateCoupon(env, String(body.coupon_code), amount, String(seller.id));
		if (!res.valid) return jsonResponse({ error: "coupon_invalid", reason: res.reason }, 400);
		amount = res.final_minor!;
		couponCode = res.code!;
	}

	// Referred users get a configurable bonus discount on their first paid plan.
	const pendingReferral = (await env.orderak_db
		.prepare("SELECT * FROM referrals WHERE referred_id = ? AND status = 'pending'")
		.bind(seller.id)
		.first()) as Record<string, unknown> | null;
	if (pendingReferral) {
		const settings = (await env.orderak_db
			.prepare("SELECT referral_bonus_type, referral_bonus_value FROM affiliate_settings WHERE id = 1")
			.first()) as Record<string, unknown> | null;
		if (settings) {
			amount = applyDiscount(
				amount,
				String(settings.referral_bonus_type),
				Number(settings.referral_bonus_value),
			);
		}
	}

	// Atomically claim a coupon use BEFORE charging: the old check-then-increment
	// let concurrent subscribes overshoot max_uses. `meta.changes === 0` means the
	// cap was hit between evaluateCoupon() and now.
	if (couponCode) {
		const claim = await env.orderak_db
			.prepare(
				`UPDATE coupons SET used_count = used_count + 1
				 WHERE code = ? AND (max_uses <= 0 OR used_count < max_uses)`,
			)
			.bind(couponCode)
			.run();
		if (!claim.meta?.changes) {
			return jsonResponse({ error: "coupon_invalid", reason: "max_uses_reached" }, 400);
		}
	}

	// -------- Charge via gateway (idempotent) --------
	const gateway = getGateway(env);
	const checkoutReq: CheckoutRequest = {
		sellerId: String(seller.id),
		planId,
		amountPiasters: amount,
		currency: String(plan.currency),
		couponCode,
		idempotencyKey,
	};
	let result: CheckoutResult;
	try {
		result = await gateway.createCheckout(checkoutReq);
	} catch (e) {
		// Roll back the claimed coupon use if the charge never happened.
		if (couponCode) {
			await env.orderak_db
				.prepare("UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE code = ?")
				.bind(couponCode)
				.run();
		}
		throw e;
	}

	const sub = await createOrReplaceSubscription(env, {
		sellerId: String(seller.id),
		planId,
		status: result.status,
		gateway: result.gateway,
		gatewaySubId: result.gatewaySubId,
		amount,
		couponCode,
		idempotencyKey,
		currentPeriodEnd: result.currentPeriodEnd,
	});

	// Record which seller used the coupon (the count was claimed pre-charge).
	if (couponCode) {
		await env.orderak_db
			.prepare(
				`INSERT OR IGNORE INTO coupon_uses (coupon_code, seller_id, subscription_id)
				 VALUES (?, ?, ?)`,
			)
			.bind(couponCode, seller.id, (sub as Record<string, unknown>).id)
			.run();
		audit("coupon.used", { code: couponCode, seller_id: seller.id });
	}

	// Mock gateway activates immediately → qualify any pending referral now.
	if (result.status === "active") {
		await qualifyReferral(env, String(seller.id), Number(plan.price_minor));
	}

	audit("subscription.created", {
		seller_id: seller.id,
		plan_id: planId,
		amount,
		status: result.status,
	});

	return jsonResponse({
		ok: true,
		subscription: sub,
		requires_payment: true,
		checkout_url: result.checkoutUrl ?? null,
		amount_charged_minor: amount,
	});
}

/** Insert a new subscription, superseding any previous active one for the seller. */
async function createOrReplaceSubscription(
	env: Env,
	s: {
		sellerId: string;
		planId: string;
		status: string;
		gateway: string;
		gatewaySubId: string | null;
		amount: number;
		couponCode: string | null;
		idempotencyKey: string;
		currentPeriodEnd: string | null;
	},
): Promise<Record<string, unknown>> {
	// Cancel previous active/pending subscriptions for this seller.
	await env.orderak_db
		.prepare(
			`UPDATE subscriptions SET status = 'canceled', updated_at = datetime('now')
			 WHERE seller_id = ? AND status IN ('active', 'pending', 'past_due')`,
		)
		.bind(s.sellerId)
		.run();

	const sub = await env.orderak_db
		.prepare(
			`INSERT INTO subscriptions
			   (seller_id, plan_id, status, gateway, gateway_sub_id, amount_minor,
			    coupon_code, idempotency_key, current_period_end)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			 RETURNING *`,
		)
		.bind(
			s.sellerId,
			s.planId,
			s.status,
			s.gateway,
			s.gatewaySubId,
			s.amount,
			s.couponCode,
			s.idempotencyKey,
			s.currentPeriodEnd,
		)
		.first();
	return sub as Record<string, unknown>;
}

async function subscriptionStatus(request: Request, env: Env, url: URL, authenticatedSeller?: AuthenticatedSeller | null): Promise<Response> {
	const { phone, secret } = readCreds(request, url);
	const seller = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
	if (!seller) return jsonResponse({ error: "auth" }, 401);

	let sub = (await env.orderak_db
		.prepare(
			`SELECT * FROM subscriptions
			 WHERE seller_id = ? AND status IN ('active', 'pending', 'past_due')
			 ORDER BY id DESC LIMIT 1`,
		)
		.bind(seller.id)
		.first()) as Record<string, unknown> | null;

	// Default everyone with no subscription to the Free plan (implicit).
	let planId = sub ? String(sub.plan_id) : "free";
	const plan = (await env.orderak_db
		.prepare("SELECT * FROM plans WHERE id = ?")
		.bind(planId)
		.first()) as Record<string, unknown> | null;

	const { results: features } = await env.orderak_db
		.prepare("SELECT feature_key, name, description, enabled FROM plan_features WHERE plan_id = ?")
		.bind(planId)
		.all();

	const adsEnabled = plan ? Boolean(plan.ads_enabled) : true;

	return jsonResponse({
		ok: true,
		// Don't create a referral code on this GET (was a write on a read path).
		// It's lazily ensured by /api/v1/referral/stats and /api/v1/subscribe, which is
		// where the code is actually needed.
		referral_code: seller.referral_code ?? null,
		subscription: sub ?? { plan_id: "free", status: "active", amount_minor: 0 },
		plan,
		features,
		ads_enabled: adsEnabled,
	});
}

async function cancelSubscription(request: Request, env: Env, url: URL, authenticatedSeller?: AuthenticatedSeller | null): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { phone, secret } = readCreds(request, url, body);
	const seller = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
	if (!seller) return jsonResponse({ error: "auth" }, 401);

	const sub = (await env.orderak_db
		.prepare(
			`SELECT * FROM subscriptions
			 WHERE seller_id = ? AND status IN ('active', 'pending', 'past_due')
			 ORDER BY id DESC LIMIT 1`,
		)
		.bind(seller.id)
		.first()) as Record<string, unknown> | null;

	if (!sub) return jsonResponse({ error: "no_active_subscription" }, 404);

	if (sub.gateway_sub_id) {
		const gateway = getGateway(env);
		await gateway.cancelSubscription(String(sub.gateway_sub_id));
	}

	await env.orderak_db
		.prepare("UPDATE subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE id = ?")
		.bind(sub.id)
		.run();

	audit("subscription.canceled", { seller_id: seller.id, subscription_id: sub.id });
	return jsonResponse({ ok: true, canceled: true });
}

async function couponValidate(request: Request, env: Env, url: URL): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { phone } = readCreds(request, url, body);

	// Rate-limit on the phone AND the IP, never one falling back to the other.
	//
	// This is an unauthenticated endpoint that reports whether a coupon code
	// exists, so without a working limit it is a coupon-code oracle. The bucket
	// used to be `phone || ip`: `phone` is read from the x-orderak-phone header,
	// which the caller sets, so sending a different value on each request put
	// every attempt in its own fresh bucket and the IP branch — the only part an
	// attacker cannot change — was never reached. docs/reference/api.md
	// documents this endpoint as rate-limited per phone; now it is, and per
	// source as well.
	const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
	const [phoneAllowed, ipAllowed] = await Promise.all([
		phone ? checkRateLimit(env, `coupon:validate:phone:${phone}`, 10, 60) : Promise.resolve(true),
		checkRateLimit(env, `coupon:validate:ip:${ip}`, 30, 60),
	]);
	if (!phoneAllowed || !ipAllowed) {
		return jsonResponse({ error: "rate_limited" }, 429);
	}

	const planId = String(body.plan_id ?? "").trim();
	const plan = (await env.orderak_db
		.prepare("SELECT price_minor FROM plans WHERE id = ?")
		.bind(planId)
		.first()) as Record<string, unknown> | null;
	if (!plan) return jsonResponse({ error: "plan_not_found" }, 404);

	const res = await evaluateCoupon(env, String(body.code ?? ""), Number(plan.price_minor));
	return jsonResponse(res, res.valid ? 200 : 400);
}

async function couponApply(request: Request, env: Env, url: URL, authenticatedSeller?: AuthenticatedSeller | null): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { phone, secret } = readCreds(request, url, body);
	const seller = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
	if (!seller) return jsonResponse({ error: "auth" }, 401);

	// Rate-limit: 5 apply attempts / minute per seller.
	const bucket = `coupon:apply:${seller.id}`;
	if (!(await checkRateLimit(env, bucket, 5, 60))) {
		return jsonResponse({ error: "rate_limited" }, 429);
	}

	const planId = String(body.plan_id ?? "").trim();
	const plan = (await env.orderak_db
		.prepare("SELECT price_minor FROM plans WHERE id = ?")
		.bind(planId)
		.first()) as Record<string, unknown> | null;
	if (!plan) return jsonResponse({ error: "plan_not_found" }, 404);

	// The already-redeemed check now lives inside evaluateCoupon, so this
	// endpoint and /subscribe cannot disagree about what "valid" means.
	const res = await evaluateCoupon(env, String(body.code ?? ""), Number(plan.price_minor), String(seller.id));
	if (!res.valid) return jsonResponse({ error: "coupon_invalid", reason: res.reason }, 400);

	// This endpoint only PRICES the coupon; the charge happens in /api/v1/subscribe.
	return jsonResponse({ ...res, note: "Pass this coupon code to /api/v1/subscribe to charge the discounted amount." });
}

async function referralApply(request: Request, env: Env, url: URL, authenticatedSeller?: AuthenticatedSeller | null): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { phone, secret } = readCreds(request, url, body);
	const seller = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
	if (!seller) return jsonResponse({ error: "auth" }, 401);

	const code = String(body.code ?? "").trim().toUpperCase();
	if (!code) return jsonResponse({ error: "code_required" }, 400);

	// Find the referrer that owns this code.
	const referrer = (await env.orderak_db
		.prepare("SELECT id FROM sellers WHERE referral_code = ?")
		.bind(code)
		.first()) as Record<string, unknown> | null;
	if (!referrer) return jsonResponse({ error: "invalid_code" }, 404);
	if (String(referrer.id) === String(seller.id)) {
		return jsonResponse({ error: "cannot_refer_self" }, 400);
	}

	// A seller can only be referred once (UNIQUE referred_id).
	const already = await env.orderak_db
		.prepare("SELECT 1 FROM referrals WHERE referred_id = ?")
		.bind(seller.id)
		.first();
	if (already) return jsonResponse({ error: "already_referred" }, 400);

	await env.orderak_db
		.prepare(
			`INSERT INTO referrals (referrer_id, referred_id, code, status)
			 VALUES (?, ?, ?, 'pending')`,
		)
		.bind(referrer.id, seller.id, code)
		.run();

	audit("referral.applied", { referrer_id: referrer.id, referred_id: seller.id, code });
	return jsonResponse({ ok: true, applied: true, message: "Referral applied. Discount will show at checkout." });
}

async function referralStats(request: Request, env: Env, url: URL, authenticatedSeller?: AuthenticatedSeller | null): Promise<Response> {
	const { phone, secret } = readCreds(request, url);
	const seller = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
	if (!seller) return jsonResponse({ error: "auth" }, 401);

	const code = await ensureReferralCode(env, seller);

	const { results: referrals } = await env.orderak_db
		.prepare(
			`SELECT id, referred_id, status, commission_minor, created_at, qualified_at
			 FROM referrals WHERE referrer_id = ? ORDER BY id DESC`,
		)
		.bind(seller.id)
		.all();

	const summary = (await env.orderak_db
		.prepare(
			`SELECT
			   COUNT(*) AS total,
			   SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
			   SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS qualified,
			   SUM(CASE WHEN status = 'paid'      THEN 1 ELSE 0 END) AS paid,
			   COALESCE(SUM(CASE WHEN status IN ('qualified','paid') THEN commission_minor ELSE 0 END), 0) AS earned_minor
			 FROM referrals WHERE referrer_id = ?`,
		)
		.bind(seller.id)
		.first()) as Record<string, unknown>;

	const settings = (await env.orderak_db
		.prepare("SELECT min_payout_minor, payout_info FROM affiliate_settings WHERE id = 1")
		.first()) as Record<string, unknown> | null;

	return jsonResponse({
		ok: true,
		referral_code: code,
		summary,
		min_payout_minor: settings?.min_payout_minor ?? 0,
		payout_info: settings?.payout_info ?? null,
		referrals,
	});
}

// -------- Payment webhook (status updates from the gateway) --------

async function handleWebhook(request: Request, env: Env): Promise<Response> {
	const raw = await request.text();
	const signature = request.headers.get("x-webhook-signature");
	const gateway = getGateway(env);

	// Any deployed environment must have a webhook secret. Only an undeployed
	// one — local dev, the test runner — may process an unsigned body, and it
	// says so by not being production or staging rather than by happening to
	// have left a secret unset.
	const deployed = ["production", "staging"].includes(env.DEPLOYMENT_ENVIRONMENT ?? "");

	let event;
	try {
		event = await gateway.parseWebhook(raw, signature, env.PAYMENT_WEBHOOK_SECRET, deployed);
	} catch (e) {
		console.error("Webhook parse failed:", e);
		return jsonResponse({ error: "invalid_webhook" }, 400);
	}

	if (!event.gatewaySubId) return jsonResponse({ error: "missing_sub_id" }, 400);

	// Idempotency: gateways RETRY webhooks, so the same event can arrive more
	// than once. If the provider gave us an event id, record it and skip any
	// replay — this prevents double-crediting referrals / duplicate updates.
	if (event.eventId) {
		try {
			const res = await env.orderak_db
				.prepare(
					`INSERT OR IGNORE INTO webhook_events (event_id, gateway, type)
					 VALUES (?, ?, ?)`,
				)
				.bind(event.eventId, gateway.name, event.type)
				.run();
			// D1 reports rows written; 0 means the id already existed → replay.
			if (!res.meta?.changes) {
				return jsonResponse({ ok: true, idempotent: true });
			}
		} catch (e) {
			console.error("webhook dedupe insert failed:", e);
			// Fail-safe: continue processing rather than dropping a real event.
		}
	}

	const sub = (await env.orderak_db

		.prepare("SELECT * FROM subscriptions WHERE gateway_sub_id = ? ORDER BY id DESC LIMIT 1")
		.bind(event.gatewaySubId)
		.first()) as Record<string, unknown> | null;
	if (!sub) return jsonResponse({ ok: true, ignored: "unknown_subscription" });

	// Map webhook event types → subscription status.
	let newStatus = sub.status as string;
	if (event.type === "subscription.canceled") newStatus = "canceled";
	else if (event.type === "invoice.payment_failed" || event.status === "past_due") newStatus = "past_due";
	else if (event.type === "invoice.paid" || event.type === "subscription.active" || event.status === "active")
		newStatus = "active";

	await env.orderak_db
		.prepare("UPDATE subscriptions SET status = ?, updated_at = datetime('now') WHERE id = ?")
		.bind(newStatus, sub.id)
		.run();

	// First successful paid payment → qualify referral.
	if (newStatus === "active" && Number(sub.amount_minor) > 0) {
		const plan = (await env.orderak_db
			.prepare("SELECT price_minor FROM plans WHERE id = ?")
			.bind(sub.plan_id)
			.first()) as Record<string, unknown> | null;
		await qualifyReferral(env, String(sub.seller_id), Number(plan?.price_minor ?? sub.amount_minor));
	}

	audit("webhook.processed", { type: event.type, sub_id: sub.id, new_status: newStatus });
	return jsonResponse({ ok: true, status: newStatus });
}
