import { jsonResponse } from "../http/shared";

export interface TenantContext {
	organizationId: string;
	shardKey: "primary";
	routingVersion: number;
	db: D1Database;
	migrationState: string;
}

export class TenantWriteFencedError extends Error {
	readonly retryAfterSeconds = 30;
	constructor() {
		super("tenant_write_fenced");
		this.name = "TenantWriteFencedError";
	}
}

/**
 * A store with no row in `organization_stores`.
 *
 * Typed rather than a bare Error because of where it surfaces. Every caller
 * catches TenantWriteFencedError and rethrows anything else, so a bare Error
 * here reached the Worker's onError handler — which meant a seller in this state
 * got a 500 on every non-GET request, and every buyer of that store got a 500
 * when placing an order. An unhandled crash is the wrong shape for a missing
 * row: it is a data-integrity gap, not a runtime fault, and it is repairable.
 *
 * Migration 024 backfilled every seller that existed then, and both account
 * creation paths write the row, so this should be unreachable. It is typed so
 * that if it ever is reached the response says so and the log names it, instead
 * of the failure arriving as an anonymous 500.
 */
export class TenantRouteMissingError extends Error {
	readonly retryAfterSeconds = 30;
	constructor(readonly storeId: string) {
		super("tenant_route_missing");
		this.name = "TenantRouteMissingError";
	}
}

export async function resolveTenantContext(env: Env, organizationId: string): Promise<TenantContext> {
	let route = await env.orderak_db.prepare(
		`SELECT shard_key,routing_version,migration_state
		 FROM organization_routing WHERE organization_id=?`,
	).bind(organizationId).first<{ shard_key: string; routing_version: number; migration_state: string }>();
	if (!route) {
		// Additive-rollout compatibility: a legacy organization that receives a
		// request before its bounded backfill reaches it is safely pinned to the
		// only physical database. Readiness still reports untouched missing rows.
		await env.orderak_db.prepare(
			`INSERT OR IGNORE INTO organization_routing(organization_id,shard_key,routing_version,migration_state)
			 VALUES(?,'primary',1,'stable')`,
		).bind(organizationId).run();
		route = await env.orderak_db.prepare(
			"SELECT shard_key,routing_version,migration_state FROM organization_routing WHERE organization_id=?",
		).bind(organizationId).first<{ shard_key: string; routing_version: number; migration_state: string }>();
	}
	if (!route) throw new Error("tenant_route_missing");
	if (route.shard_key !== "primary") throw new Error("tenant_shard_unavailable");
	return {
		organizationId,
		shardKey: "primary",
		routingVersion: Number(route.routing_version),
		db: env.orderak_db,
		migrationState: route.migration_state,
	};
}

/**
 * The tenant context for a store, in one read rather than two.
 *
 * This is the hottest path in the Worker — every seller write and every buyer
 * order calls it — and it used to cost two sequential D1 reads: one to map the
 * store to its organization, then resolveTenantContext() for the routing row.
 * Both are on the request's critical path, and the second one exists to learn a
 * value that is currently the same for every tenant.
 *
 * The join gets it to one read while leaving the sharding path fully live:
 * `shard_key` is still read and still checked, so the day a second shard exists
 * this keeps refusing to serve it from the wrong database.
 *
 * Deliberately NOT cached, in memory or anywhere else. `migration_state` is what
 * requireTenantWrite() fences writes on, so a stale "stable" would let writes
 * through a fence during a shard migration — losing exactly the writes the fence
 * exists to protect. A saved round trip is not worth that; a join is.
 *
 * LEFT JOIN, not INNER: an organization with no routing row yet must still reach
 * resolveTenantContext()'s backfill rather than looking like a missing store.
 */
export async function resolveTenantContextForStore(env: Env, storeId: string): Promise<TenantContext> {
	const row = await env.orderak_db.prepare(
		`SELECT s.organization_id, r.shard_key, r.routing_version, r.migration_state
		 FROM organization_stores s
		 LEFT JOIN organization_routing r ON r.organization_id = s.organization_id
		 WHERE s.store_id = ?`,
	).bind(storeId).first<{
		organization_id: string;
		shard_key: string | null;
		routing_version: number | null;
		migration_state: string | null;
	}>();
	if (!row) {
		// Logged as its own signal, because the previous bare throw arrived in
		// the error log as an anonymous stack from whichever route happened to
		// hit it, with nothing naming the store it was about.
		console.error(JSON.stringify({ signal: "tenant_route_missing", store_id: storeId }));
		throw new TenantRouteMissingError(storeId);
	}
	// No routing row: fall through to the slow path, which backfills it. Rare by
	// construction — migration 024 backfilled every organization that existed and
	// both account-creation paths write the row.
	if (row.shard_key === null || row.migration_state === null) {
		return resolveTenantContext(env, row.organization_id);
	}
	if (row.shard_key !== "primary") throw new Error("tenant_shard_unavailable");
	return {
		organizationId: row.organization_id,
		shardKey: "primary",
		routingVersion: Number(row.routing_version ?? 1),
		db: env.orderak_db,
		migrationState: row.migration_state,
	};
}

/**
 * The 503 for either tenancy refusal, or null when the error is something else.
 *
 * Shared so the three call sites cannot answer the same condition differently.
 * They each caught TenantWriteFencedError and rethrew everything else, which is
 * how a missing organization row became an anonymous 500 in three places at
 * once. A caller passes anything it caught; a null means "not mine, rethrow".
 */
export function tenantUnavailableResponse(error: unknown): Response | null {
	if (error instanceof TenantWriteFencedError) {
		return jsonResponse({ error: "tenant_write_fenced", retryable: true }, 503, {
			"retry-after": String(error.retryAfterSeconds),
		});
	}
	if (error instanceof TenantRouteMissingError) {
		return jsonResponse({ error: "tenant_unavailable", retryable: true }, 503, {
			"retry-after": String(error.retryAfterSeconds),
		});
	}
	return null;
}

export function requireTenantWrite(context: TenantContext): void {
	if (context.migrationState === "write_fenced" || context.migrationState === "copying") {
		throw new TenantWriteFencedError();
	}
}
