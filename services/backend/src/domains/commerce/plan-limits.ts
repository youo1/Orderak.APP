import { jsonResponse } from "../../platform/http/shared";
import { getIntegerEntitlement, planLimitRetryAfterSeconds, planLimitStatus } from "./entitlements";

export type PlanLimitKey =
	| "max_categories"
	| "max_products"
	| "max_orders_per_month"
	| "max_ai_requests_per_month";

/**
 * What a seller gets with no active subscription.
 *
 * Exported because config.ts serves the same numbers to the Android client for
 * in-app enforcement, and it used to carry its own copy. Two hardcoded copies of
 * a business rule do not stay equal — and the failure would have been quiet:
 * the app would enforce one limit while the server enforced another, so a
 * seller would be stopped by a message quoting a number the server disagreed
 * with, or allowed past a limit the server then rejected.
 */
export const FREE_LIMITS: Record<PlanLimitKey, number> = {
	max_categories: 5,
	max_products: 20,
	max_orders_per_month: 50,
	max_ai_requests_per_month: 20,
};

export async function getPlanLimit(env: Env, sellerId: string, key: PlanLimitKey): Promise<number | null> {
	if (env.ENTITLEMENTS_ENABLED === "true") {
		// null means "no ceiling" to every caller of this function, and the policy
		// for a value the catalogue does not carry is decided here rather than in
		// the resolver, because this is where the free-plan fallback already lives.
		const resolved = await getIntegerEntitlement(env, sellerId, key);
		switch (resolved.kind) {
			case "limit":
				return resolved.value;
			case "unlimited":
				return null;
			case "not_configured":
				// The catalogue says there is no enforceable number: either no server
				// code implements this entitlement, or its value is negotiated per
				// customer and is not in the table. This used to resolve to 0, which
				// as a ceiling refuses everything — so a paid seller was told their
				// plan allowed them none of something they were paying for.
				//
				// Not enforcing matches what the legacy path does with a plan column
				// that is NULL, which is the parity flipping ENTITLEMENTS_ENABLED is
				// supposed to preserve.
				return null;
			case "missing":
				// A declared absence is one thing; a key that is not in the snapshot
				// at all is a data error, and quietly removing the limit would hide
				// it. The free-plan allowance applies until someone looks.
				console.error(JSON.stringify({
					signal: "entitlement_missing_from_snapshot",
					entitlement_key: key,
					seller_id: sellerId,
				}));
				return FREE_LIMITS[key];
		}
	}
	const row = await env.orderak_db.prepare(
		`SELECT p.${key} AS value FROM subscriptions s
		 JOIN plans p ON p.id=s.plan_id
		 WHERE s.seller_id=? AND s.status='active' AND p.active=1
		 ORDER BY s.id DESC LIMIT 1`,
	).bind(sellerId).first<{ value: number | null }>();
	return row ? (row.value == null ? null : Number(row.value)) : FREE_LIMITS[key];
}
export function limitReached(key: PlanLimitKey, limit: number, used?: number): Response {
	const status = planLimitStatus(key);
	return jsonResponse({
		error: "plan_limit_reached",
		code: "PLAN_LIMIT_REACHED",
		entitlement_key: key,
		limit_key: key,
		limit,
		used: used ?? null,
		remaining: 0,
		message: `Your plan allows up to ${limit} ${key.replace("max_", "").replace("_per_month", " per month")}.`,
	}, status, status === 429 ? { "retry-after": String(planLimitRetryAfterSeconds()) } : {});
}
