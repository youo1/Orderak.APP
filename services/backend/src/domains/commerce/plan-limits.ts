import { jsonResponse } from "../../platform/http/shared";
import { getIntegerEntitlement } from "./entitlements";

export type PlanLimitKey =
	| "max_categories"
	| "max_products"
	| "max_orders_per_month"
	| "max_ai_requests_per_month";

const FREE_LIMITS: Record<PlanLimitKey, number> = {
	max_categories: 5,
	max_products: 20,
	max_orders_per_month: 50,
	max_ai_requests_per_month: 20,
};

export async function getPlanLimit(env: Env, sellerId: string, key: PlanLimitKey): Promise<number | null> {
	if (env.ENTITLEMENTS_ENABLED === "true") {
		return getIntegerEntitlement(env, sellerId, key);
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
	return jsonResponse({
		error: "plan_limit_reached",
		code: "PLAN_LIMIT_REACHED",
		entitlement_key: key,
		limit_key: key,
		limit,
		used: used ?? null,
		remaining: 0,
		message: `Your plan allows up to ${limit} ${key.replace("max_", "").replace("_per_month", " per month")}.`,
	}, 409);
}
