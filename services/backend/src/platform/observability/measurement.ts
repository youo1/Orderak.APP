/**
 * Lightweight measurement instrumentation for Stage 3 prerequisites.
 *
 * Records latency distributions for Cache API hits/misses and D1 reads so
 * Stage 3b (orderak_db read replication) can be decided on data, not intuition.
 *
 * Metrics are logged to console as structured JSON; in production they flow
 * into Cloudflare's observability pipeline (logs 10%, traces 5% per wrangler.jsonc).
 */

export interface LatencySample {
	/** Nanosecond timestamp of the observation. */
	t: number;
	/** Operation label, e.g. "cache", "db", "geo". */
	op: string;
	/** "hit" | "miss" | "read" — what happened. */
	outcome: string;
	/** Elapsed in milliseconds. */
	ms: number;
}

/**
 * Samples collected so far, emitted at the end of the request that produced
 * them.
 *
 * This used to accumulate across requests and emit only once fifty samples had
 * built up. In a Worker that loses data rather than saving work: isolates are
 * evicted routinely and without warning, so every partial batch was discarded.
 * The result was a systematic bias, not just a gap — a busy isolate reached
 * fifty and reported, a quiet one never did, so the surviving samples described
 * exactly the traffic least in need of measuring. This module exists to decide
 * whether orderak_db needs read replication; deciding that on data skewed
 * toward hot isolates is worse than deciding it on nothing, because it looks
 * like evidence.
 *
 * Batching within a request is still worth having — several samples become one
 * structured line — and is sound, because the flush happens while the request
 * is still alive.
 */
const samples: LatencySample[] = [];

/**
 * Emit everything collected and clear the buffer.
 *
 * Called from the Worker entrypoint at the end of each request. Safe to call
 * when nothing was recorded, and safe to call twice.
 */
export function flushLatencySamples(): void {
	if (samples.length === 0) return;
	const batch = samples.splice(0);
	console.log(JSON.stringify({
		signal: "latency_samples",
		count: batch.length,
		samples: batch,
	}));
}

/** Record a latency observation for the request in flight. */
export function recordLatency(op: string, outcome: string, ms: number): void {
	samples.push({ t: Date.now() * 1_000_000, op, outcome, ms });
}

/**
 * Measure the duration of an async operation and record it.
 *
 * Usage:
 *   const { result, ms } = await measured("db", "read", () => db.prepare("...").all());
 */
export async function measured<T>(
	op: string,
	outcome: string,
	fn: () => Promise<T>,
): Promise<{ result: T; ms: number }> {
	const start = performance.now();
	const result = await fn();
	const ms = performance.now() - start;
	recordLatency(op, outcome, Math.round(ms * 100) / 100);
	return { result, ms };
}
