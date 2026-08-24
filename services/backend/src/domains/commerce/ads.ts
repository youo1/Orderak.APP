// ============================================================
// Ads routes.
// The Android app calls GET /api/v1/ads/active?plan=free to fetch ads.
// Only Free-plan users receive ads; paid plans are ad-free.
// Impression/click tracking is optional (POST /api/v1/ads/track).
// ============================================================

import { jsonResponse, readCreds, authSeller, checkRateLimit, type AuthenticatedSeller } from "../../platform/http/shared";
import { pickI18n, pickLocale } from "../../platform/localization/i18n";

export async function handleAdsRoutes(
	request: Request,
	env: Env,
	url: URL,
	authenticatedSeller?: AuthenticatedSeller | null,
): Promise<Response | null> {
	const p = url.pathname;

	// -------- GET /api/v1/ads/active --------
	if (p === "/api/v1/ads/active" && request.method === "GET") {
		return activeAds(request, env, url, authenticatedSeller);
	}

	// -------- POST /api/v1/ads/track --------
	if (p === "/api/v1/ads/track" && request.method === "POST") {
		return trackAd(request, env, authenticatedSeller);
	}

	return null;
}

/**
 * Resolve the seller's plan. Priority:
 *   1. authenticated seller's active subscription plan
 *   2. ?plan= query hint
 *   3. default "free"
 */
async function resolvePlan(request: Request, env: Env, url: URL, authenticatedSeller?: AuthenticatedSeller | null): Promise<string | null> {
	const { phone, secret } = readCreds(request, url);
	if (phone && secret) {
		const seller = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
		if (seller) {
			const sub = (await env.orderak_db
				.prepare(
					`SELECT plan_id FROM subscriptions
					 WHERE seller_id = ? AND status = 'active'
					 ORDER BY id DESC LIMIT 1`,
				)
				.bind(seller.id)
				.first()) as Record<string, unknown> | null;
			if (sub) return String(sub.plan_id);
			return "free"; // authenticated but no active paid sub
		}
	}
	return null;
}

async function planForSeller(env: Env, sellerId: string): Promise<string> {
	const sub = await env.orderak_db.prepare(
		"SELECT plan_id FROM subscriptions WHERE seller_id=? AND status='active' ORDER BY id DESC LIMIT 1",
	).bind(sellerId).first<{ plan_id: string }>();
	return sub?.plan_id ?? "free";
}

async function activeAds(request: Request, env: Env, url: URL, authenticatedSeller?: AuthenticatedSeller | null): Promise<Response> {
	const planId = await resolvePlan(request, env, url, authenticatedSeller);
	if (!planId) return jsonResponse({ error: "unauthorized" }, 401);

	// Is this plan ad-supported?
	const plan = (await env.orderak_db
		.prepare("SELECT ads_enabled FROM plans WHERE id = ?")
		.bind(planId)
		.first()) as Record<string, unknown> | null;

	const adsEnabled = plan ? Boolean(plan.ads_enabled) : planId === "free";
	if (!adsEnabled) {
		// Paid plans → no ads.
		return jsonResponse({ ok: true, ads_enabled: false, ads: [] });
	}

	// Fetch active ads targeting this plan (or "all"/"free").
	const { results: ads } = await env.orderak_db
		.prepare(
			`SELECT id, title, title_i18n, image_url, image_url_i18n, click_url, type, frequency, weight
			 FROM ads
			 WHERE active = 1 AND target_plan IN (?, 'free', 'all')
			   AND (starts_at IS NULL OR starts_at <= datetime('now'))
			   AND (ends_at IS NULL OR ends_at >= datetime('now'))
			 ORDER BY weight DESC, id DESC
			 LIMIT 20`,
		)
		.bind(planId)
		.all();

	const lang = pickLocale(request, url);
	const localized = (ads ?? []).map((ad) => ({
		...ad,
		title: pickI18n(ad.title_i18n, lang, ad.title),
		image_url: pickI18n(ad.image_url_i18n, lang, ad.image_url),
	})).filter((ad) => {
		try { return new URL(String(ad.image_url)).protocol === "https:"; } catch { return false; }
	});
	return jsonResponse({ ok: true, ads_enabled: true, ads: localized });
}

async function trackAd(request: Request, env: Env, authenticatedSeller?: AuthenticatedSeller | null): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const adId = Number(body.ad_id);
	const kind = body.kind === "click" ? "click" : "impression";
	const eventKey = typeof body.event_key === "string" && /^[A-Za-z0-9:_-]{8,120}$/.test(body.event_key) ? body.event_key : null;
	if (!adId) return jsonResponse({ error: "ad_id_required" }, 400);

	// Require auth to prevent spoofed seller_id attribution.
	const { phone, secret } = readCreds(request, new URL(request.url));
	const seller = authenticatedSeller !== undefined
		? authenticatedSeller
		: phone && secret ? await authSeller(env, phone, secret) : null;
	if (!seller) return jsonResponse({ error: "unauthorized" }, 401);
	const sellerId = String(seller.id);
	const planId = await planForSeller(env, sellerId);
	const plan = await env.orderak_db.prepare("SELECT ads_enabled FROM plans WHERE id=?").bind(planId).first<{ ads_enabled: number }>();
	if (!(plan ? Boolean(plan.ads_enabled) : planId === "free")) return jsonResponse({ error: "ad_not_eligible" }, 404);

	const eligible = await env.orderak_db.prepare(
		`SELECT id FROM ads WHERE id=? AND active=1 AND target_plan IN (?,'free','all')
		 AND (starts_at IS NULL OR starts_at<=datetime('now'))
		 AND (ends_at IS NULL OR ends_at>=datetime('now'))`,
	).bind(adId, planId).first();
	if (!eligible) return jsonResponse({ error: "ad_not_found" }, 404);

	// Two bounds, because the row this writes is a billing-relevant metric and
	// the caller controls how many of them appear.
	//
	// `event_key` is the deduplication key, and it was optional: SQLite treats
	// NULLs as distinct in a unique index, so INSERT OR IGNORE inserted a fresh
	// row on every call that omitted it. A seller could inflate impressions and
	// clicks without limit, and ad_impressions grew without limit alongside.
	if (!eventKey) return jsonResponse({ error: "event_key_required" }, 400);
	// And a rate limit, because a unique key the caller chooses is not a bound —
	// it only stops the same event being counted twice, not a client generating
	// a million distinct ones. 120/hour is far above what a session that renders
	// ads at the configured frequency can legitimately produce.
	if (!(await checkRateLimit(env, `ads:track:${sellerId}`, 120, 3600))) {
		return jsonResponse({ error: "rate_limited" }, 429);
	}

	await env.orderak_db.prepare(
		"INSERT OR IGNORE INTO ad_impressions (ad_id,seller_id,kind,event_key) VALUES(?,?,?,?)",
	).bind(adId, sellerId, kind, eventKey).run();

	return jsonResponse({ ok: true });
}
