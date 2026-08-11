import { beforeEach, describe, expect, it } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import { createSchema } from "./helpers";
import { checkRateLimit, rateLimiterStub } from "../src/platform/http/shared";

/**
 * The rate limiter handles buckets that embed personal data — a phone number
 * for the failed-auth throttle, an IP address for the deletion-request form.
 * Durable Object storage is not reachable by the D1 retention job, so anything
 * identifying that lands there stays until the object deletes itself.
 *
 * These cover the two properties that keep that safe: nothing identifying is
 * stored, and an idle bucket expires.
 */
describe("rate limiter privacy and retention", () => {
	beforeEach(async () => {
		await createSchema();
	});

	it("names the Durable Object by a digest, never the raw bucket", async () => {
		const phone = "+201009998877";
		const bucket = `authfail:${phone}`;
		const namespace = env.RATE_LIMITER;

		const stub = await rateLimiterStub(env, bucket);
		expect(stub).not.toBeNull();

		// The object the caller reaches must NOT be the one named after the raw
		// bucket. If it were, the phone number would be the object's identity.
		const rawNamedId = namespace.idFromName(bucket).toString();
		expect(stub!.id.toString()).not.toBe(rawNamedId);
	});

	it("stores no identifying value inside the object", async () => {
		const phone = "+201007776655";
		const bucket = `authfail:${phone}`;
		await checkRateLimit(env, bucket, 5, 60);

		const stub = await rateLimiterStub(env, bucket);
		await runInDurableObject(stub!, async (_instance, state) => {
			// Read every row of every user table and assert the phone number does
			// not appear anywhere in the object's storage.
			const tables = state.storage.sql
				.exec<{ name: string }>(
					"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
				)
				.toArray();
			expect(tables.length).toBeGreaterThan(0);

			for (const { name } of tables) {
				const rows = state.storage.sql.exec(`SELECT * FROM "${name}"`).toArray();
				const dumped = JSON.stringify(rows);
				expect(dumped).not.toContain(phone);
				expect(dumped).not.toContain("authfail");
			}
		});
	});

	it("still counts correctly with the digest-named object", async () => {
		const bucket = "privacy:counting";
		const results = await Promise.all(
			Array.from({ length: 8 }, () => checkRateLimit(env, bucket, 3, 60)),
		);
		expect(results.filter(Boolean)).toHaveLength(3);

		const stub = await rateLimiterStub(env, bucket);
		expect((await stub!.peek())?.count).toBe(8);
	});

	it("schedules an alarm so an idle bucket deletes itself", async () => {
		const bucket = "privacy:expiry";
		await checkRateLimit(env, bucket, 5, 60);

		const stub = await rateLimiterStub(env, bucket);
		await runInDurableObject(stub!, async (_instance, state) => {
			// Nothing else can clean this object up, so an alarm must be pending.
			const alarm = await state.storage.getAlarm();
			expect(alarm).not.toBeNull();
			expect(alarm!).toBeGreaterThan(Date.now());
		});
	});

	it("wipes its storage when the alarm fires after the window", async () => {
		const bucket = "privacy:wipe";
		await checkRateLimit(env, bucket, 5, 1); // 1-second window
		const stub = await rateLimiterStub(env, bucket);

		expect(await stub!.peek()).not.toBeNull();

		await runInDurableObject(stub!, async (instance, state) => {
			// Move the stored expiry into the past, then run the alarm the way the
			// runtime would. expires_at is what alarm() consults — window_start
			// alone cannot tell it when the window ended.
			state.storage.sql.exec("UPDATE counter SET expires_at = ? WHERE id = 1", 1);
			await instance.alarm!();
			const remaining = state.storage.sql
				.exec("SELECT name FROM sqlite_master WHERE type='table' AND name = 'counter'")
				.toArray();
			expect(remaining).toHaveLength(0);
		});
	});

	it("keeps a bucket that is still inside its window", async () => {
		const bucket = "privacy:keep";
		await checkRateLimit(env, bucket, 5, 3600); // long window, still live
		const stub = await rateLimiterStub(env, bucket);

		await runInDurableObject(stub!, async (instance) => {
			// An alarm that fires while the window is live must not hand out a
			// fresh allowance by deleting the counter.
			await instance.alarm!();
		});
		expect((await stub!.peek())?.count).toBe(1);
	});
});
