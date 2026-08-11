/**
 * Rate limiting Durable Object — strongly-consistent replacement for the
 * D1-backed `rate_limits` table.
 *
 * One instance per bucket (see rateLimiterStub() in platform/http/shared.ts),
 * so counters for different buckets never contend, and a single bucket's
 * increments are serialised by the runtime — which is the whole point of the
 * change. The D1 version used INSERT ... ON CONFLICT, which is atomic per
 * statement but offers no isolation across the read-modify-write that a
 * limiter actually needs.
 *
 * WINDOW SEMANTICS — deliberately identical to the D1 implementation it
 * replaces. That used a *calendar-aligned* fixed window:
 *
 *     windowStart = now - (now % windowSec)
 *
 * so every bucket rolls over on the same absolute boundary, not on the first
 * request. A rolling-from-first-request window would be a behaviour change,
 * and throttling semantics are named in docs/contracts/auth-phase1-contract.md.
 *
 * STORES NO IDENTIFIER. Buckets are things like `authfail:+201001234567` and
 * `delete-request:ip:1.2.3.4`, so the counter table used to hold a phone number
 * or an IP address in plaintext, in storage the D1 retention job cannot reach.
 * Because there is exactly one instance per bucket, the identifier was never
 * load-bearing: the object's identity *is* the bucket. The table now holds a
 * single anonymous row, and the caller hashes the bucket before deriving the
 * object id, so neither the object name nor its contents carry personal data.
 *
 * EXPIRES ITSELF. Nothing else can: a Durable Object is not reachable by a D1
 * cleanup job, so without an alarm a bucket created for one failed login would
 * persist forever. Every increment schedules an alarm shortly after the
 * current window ends; the alarm deletes the object's storage, and an unused
 * bucket costs nothing from then on. A bucket that is still being hit simply
 * pushes its alarm forward.
 */

import { DurableObject } from "cloudflare:workers";

export interface RateLimitResult {
	allowed: boolean;
	/** Requests left in the current window; 0 once the limit is reached. */
	remaining: number;
	/** Unix seconds at which the current window rolls over. */
	resetAt: number;
}

/**
 * Grace period between a window ending and the object deleting itself.
 *
 * Deleting exactly at the boundary would race a request arriving in the same
 * second, which would then start a fresh window and lose the count it should
 * have inherited. A minute is far longer than that race and still far shorter
 * than any retention obligation.
 */
const EXPIRY_GRACE_SECONDS = 60;

export class RateLimiter extends DurableObject<Env> {
	private sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		// The previous schema was a `counters` table keyed by the raw bucket, so
		// any object carried over from it still holds a phone number or an IP in
		// plaintext. Drop it on first touch rather than leaving the thing this
		// change exists to remove sitting in storage.
		//
		// Objects created before the naming change are not reachable through the
		// new digest-derived ids, so this only reclaims ones that are addressed
		// again. That is the whole population here: the RATE_LIMITER binding has
		// never been deployed to production — it arrived with the Stage 11 commit
		// on an unmerged branch — so the only objects that exist are on staging.
		this.sql.exec("DROP TABLE IF EXISTS counters");
		this.ensureTable();
	}

	/**
	 * Create the counter table if it is not there.
	 *
	 * Called before every access rather than only from the constructor, because
	 * deleteAll() drops the table out from under an instance that stays alive
	 * afterwards. A later alarm or peek on that same instance would otherwise
	 * fail with "no such table: counter" — the expiry path making the object
	 * unusable is exactly the opposite of what it is for. CREATE TABLE IF NOT
	 * EXISTS on an existing table is a no-op.
	 */
	private ensureTable(): void {
		// A single anonymous row. The CHECK makes "exactly one counter" a schema
		// property rather than a convention, so a future caller cannot smuggle a
		// second identity — and with it a second identifier — into this object.
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS counter (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				count INTEGER NOT NULL,
				window_start INTEGER NOT NULL,
				-- When this bucket may be deleted. Stored rather than recomputed
				-- because alarm() does not know the window length the caller used,
				-- and guessing it is how a live counter gets wiped early.
				expires_at INTEGER NOT NULL
			)
		`);
	}

	/**
	 * Count one request against this bucket and report whether it is allowed.
	 *
	 * Mirrors the D1 statement exactly: the counter resets when the aligned
	 * window changes, and the comparison is made *after* incrementing, so a
	 * limit of 5 permits five calls and rejects the sixth.
	 */
	async checkIncrement(limit: number, windowSec: number): Promise<RateLimitResult> {
		this.ensureTable();
		const now = Math.floor(Date.now() / 1000);
		const windowStart = now - (now % windowSec);

		const existing = this.sql
			.exec<{ count: number; window_start: number }>(
				"SELECT count, window_start FROM counter WHERE id = 1",
			)
			.toArray()[0];

		const count = existing && existing.window_start === windowStart ? existing.count + 1 : 1;

		const expiresAt = windowStart + windowSec + EXPIRY_GRACE_SECONDS;
		this.sql.exec(
			`INSERT INTO counter (id, count, window_start, expires_at) VALUES (1, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   count = excluded.count,
			   window_start = excluded.window_start,
			   expires_at = excluded.expires_at`,
			count, windowStart, expiresAt,
		);

		// Push expiry out to just past the end of the window this request landed
		// in. setAlarm replaces any pending alarm, so a busy bucket keeps
		// deferring its own deletion and an idle one is collected shortly after
		// it stops mattering.
		await this.ctx.storage.setAlarm(expiresAt * 1000);

		return {
			allowed: count <= limit,
			remaining: Math.max(0, limit - count),
			resetAt: windowStart + windowSec,
		};
	}

	/**
	 * Delete this object's storage once its window has passed.
	 *
	 * Re-checks the window rather than trusting the alarm: a request can arrive
	 * between the alarm being scheduled and firing, and deleting a live counter
	 * would hand an attacker a fresh allowance. In that case the pending alarm
	 * set by the newer request takes over.
	 */
	async alarm(): Promise<void> {
		this.ensureTable();
		const row = this.sql
			.exec<{ expires_at: number }>("SELECT expires_at FROM counter WHERE id = 1")
			.toArray()[0];
		if (!row) {
			await this.wipe();
			return;
		}
		if (Math.floor(Date.now() / 1000) >= row.expires_at) {
			await this.wipe();
		}
	}

	/**
	 * Drop every trace of this bucket.
	 *
	 * deleteAll() clears stored data but leaves any pending alarm scheduled, so
	 * the alarm is cancelled too — otherwise the runtime wakes an object that
	 * has nothing left to do.
	 */
	private async wipe(): Promise<void> {
		await this.ctx.storage.deleteAll();
		await this.ctx.storage.deleteAlarm();
	}

	/**
	 * Read the current counter without incrementing it — for administrative
	 * inspection and for tests that need to prove no increments were lost.
	 * Returns null when this bucket has never been used, or has expired.
	 */
	peek(): { count: number; windowStart: number } | null {
		this.ensureTable();
		const row = this.sql
			.exec<{ count: number; window_start: number }>(
				"SELECT count, window_start FROM counter WHERE id = 1",
			)
			.toArray()[0];
		return row ? { count: row.count, windowStart: row.window_start } : null;
	}

	/** Clear this bucket — for administrative overrides and tests. */
	async reset(): Promise<void> {
		this.ensureTable();
		this.sql.exec("DELETE FROM counter");
		await this.ctx.storage.deleteAlarm();
	}
}
