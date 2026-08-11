import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { createSchema, registerStore } from "./helpers";
import { authSeller, rateLimiterStub } from "../src/platform/http/shared";

/**
 * Regression cover for the failed-auth brute-force throttle.
 *
 * The throttle silently stopped working when checkRateLimit() moved to the
 * Durable Object: failures were written to the DO while the enforcement check
 * still read the D1 `rate_limits` table, so it could only ever see an absent
 * row and always allowed the next attempt. The full suite stayed green because
 * every existing test asserted on storage rows rather than on lockout
 * behaviour.
 *
 * These tests therefore assert only what a caller can observe — whether
 * authSeller() accepts a credential — so they survive the counter moving
 * stores again.
 */
describe("failed-auth throttle", () => {
	beforeEach(async () => {
		await createSchema();
	});

	it("locks a phone out after repeated wrong secrets, even with the correct one", async () => {
		const store = await registerStore();

		// The correct secret works before the throttle engages.
		expect(await authSeller(env, store.phone, store.secret)).not.toBeNull();

		// AUTH_FAIL_LIMIT is 20; go past it.
		for (let i = 0; i < 25; i++) {
			expect(await authSeller(env, store.phone, `wrong-${i}`)).toBeNull();
		}

		// The decisive assertion: once the limit is passed the *correct* secret
		// must be refused too. If the throttle is not enforcing, this returns the
		// seller and the test fails — which is precisely what happened while the
		// read and write paths pointed at different stores.
		expect(await authSeller(env, store.phone, store.secret)).toBeNull();
	});

	it("throttles each phone independently", async () => {
		const victim = await registerStore();
		const bystander = await registerStore();

		for (let i = 0; i < 25; i++) {
			await authSeller(env, victim.phone, `wrong-${i}`);
		}

		expect(await authSeller(env, victim.phone, victim.secret)).toBeNull();
		// A different phone must be unaffected by its neighbour's lockout.
		expect(await authSeller(env, bystander.phone, bystander.secret)).not.toBeNull();
	});

	it("counts failures where the enforcement check reads them", async () => {
		const store = await registerStore();
		for (let i = 0; i < 3; i++) {
			await authSeller(env, store.phone, `wrong-${i}`);
		}

		// Guards the specific defect: the counter must land in the store that
		// authFailuresExceeded() consults. With the DO binding present that is
		// the DO, and the D1 table stays untouched.
		const namespace = env.RATE_LIMITER;
		const bucket = `authfail:${store.phone}`;
		const counter = await (await rateLimiterStub(env, bucket))!.peek();
		expect(counter?.count).toBe(3);
	});
});
