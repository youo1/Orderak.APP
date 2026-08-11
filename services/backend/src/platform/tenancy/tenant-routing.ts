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

export async function resolveTenantContextForStore(env: Env, storeId: string): Promise<TenantContext> {
	const row = await env.orderak_db.prepare(
		"SELECT organization_id FROM organization_stores WHERE store_id=?",
	).bind(storeId).first<{ organization_id: string }>();
	if (!row) throw new Error("tenant_route_missing");
	return resolveTenantContext(env, row.organization_id);
}

export function requireTenantWrite(context: TenantContext): void {
	if (context.migrationState === "write_fenced" || context.migrationState === "copying") {
		throw new TenantWriteFencedError();
	}
}
