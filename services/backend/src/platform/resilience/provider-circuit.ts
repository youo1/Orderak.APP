export type ProviderName = "google_play" | "deepseek";

interface CircuitRow {
	state: "closed" | "open" | "half_open";
	failure_count: number;
	window_started_at: number | null;
	cooldown_until: number | null;
	cooldown_seconds: number;
	probe_lease_until: number | null;
}

export interface ProviderPermit {
	provider: ProviderName;
	probe: boolean;
}

export class ProviderCircuitOpenError extends Error {
	readonly retryAfterSeconds: number;

	constructor(provider: ProviderName, retryAfterSeconds: number) {
		super(`${provider}_circuit_open`);
		this.name = "ProviderCircuitOpenError";
		this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
	}
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

async function ensureRow(env: Env, provider: ProviderName): Promise<void> {
	await env.orderak_db.prepare(
		"INSERT OR IGNORE INTO provider_circuit_state(provider) VALUES(?)",
	).bind(provider).run();
}

/**
 * Allows normal traffic while closed and exactly one leased probe after an
 * open circuit cools down. D1 is the shared authority across Worker isolates.
 */
export async function acquireProviderPermit(env: Env, provider: ProviderName): Promise<ProviderPermit> {
	await ensureRow(env, provider);
	const now = nowSeconds();
	const row = await env.orderak_db.prepare(
		`SELECT state,failure_count,window_started_at,cooldown_until,cooldown_seconds,probe_lease_until
		 FROM provider_circuit_state WHERE provider=?`,
	).bind(provider).first<CircuitRow>();
	if (!row || row.state === "closed") return { provider, probe: false };

	if (row.state === "open" && (row.cooldown_until ?? 0) <= now) {
		const claimed = await env.orderak_db.prepare(
			`UPDATE provider_circuit_state
			 SET state='half_open',probe_lease_until=?,updated_at=datetime('now')
			 WHERE provider=? AND state='open' AND cooldown_until<=?`,
		).bind(now + 30, provider, now).run();
		if ((claimed.meta.changes ?? 0) === 1) {
			console.info(JSON.stringify({ signal: "provider_circuit_half_open", provider }));
			return { provider, probe: true };
		}
	}

	if (row.state === "half_open" && (row.probe_lease_until ?? 0) <= now) {
		const claimed = await env.orderak_db.prepare(
			`UPDATE provider_circuit_state
			 SET probe_lease_until=?,updated_at=datetime('now')
			 WHERE provider=? AND state='half_open' AND COALESCE(probe_lease_until,0)<=?`,
		).bind(now + 30, provider, now).run();
		if ((claimed.meta.changes ?? 0) === 1) return { provider, probe: true };
	}

	const retryAfter = Math.max(1, (row.cooldown_until ?? row.probe_lease_until ?? now + 60) - now);
	throw new ProviderCircuitOpenError(provider, retryAfter);
}

export async function recordProviderSuccess(env: Env, permit: ProviderPermit): Promise<void> {
	const result = await env.orderak_db.prepare(
		`UPDATE provider_circuit_state
		 SET state='closed',failure_count=0,window_started_at=NULL,opened_at=NULL,cooldown_until=NULL,
		     cooldown_seconds=60,probe_lease_until=NULL,updated_at=datetime('now')
		 WHERE provider=?`,
	).bind(permit.provider).run();
	if (permit.probe && (result.meta.changes ?? 0) === 1) {
		console.info(JSON.stringify({ signal: "provider_circuit_closed", provider: permit.provider }));
	}
}

export async function recordProviderFailure(env: Env, permit: ProviderPermit): Promise<void> {
	await ensureRow(env, permit.provider);
	const now = nowSeconds();
	const row = await env.orderak_db.prepare(
		`SELECT state,failure_count,window_started_at,cooldown_until,cooldown_seconds,probe_lease_until
		 FROM provider_circuit_state WHERE provider=?`,
	).bind(permit.provider).first<CircuitRow>();
	if (!row) return;

	const inWindow = row.window_started_at !== null && row.window_started_at >= now - 60;
	const failureCount = permit.probe ? 5 : (inWindow ? row.failure_count + 1 : 1);
	const shouldOpen = permit.probe || failureCount >= 5;
	const nextCooldown = permit.probe ? Math.min(900, Math.max(60, row.cooldown_seconds * 2)) : Math.max(60, row.cooldown_seconds);
	await env.orderak_db.prepare(
		`UPDATE provider_circuit_state
		 SET state=?,failure_count=?,window_started_at=?,opened_at=?,cooldown_until=?,cooldown_seconds=?,
		     probe_lease_until=NULL,updated_at=datetime('now')
		 WHERE provider=?`,
	).bind(
		shouldOpen ? "open" : "closed",
		failureCount,
		inWindow ? row.window_started_at : now,
		shouldOpen ? now : null,
		shouldOpen ? now + nextCooldown : null,
		nextCooldown,
		permit.provider,
	).run();
	if (shouldOpen) {
		console.error(JSON.stringify({
			signal: "provider_circuit_open",
			provider: permit.provider,
			cooldown_seconds: nextCooldown,
			failure_count: failureCount,
		}));
	}
}
