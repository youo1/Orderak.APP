import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { createSchema, registerStore } from "./helpers";
import { authSeller, rateLimiterStub } from "../src/platform/http/shared";

/**
 * Regression cover for the failed-auth brute-force throttle.
 *
 * Two distinct defects are guarded here, and they pull in opposite directions.
 *
 * The first: the throttle silently stopped working when checkRateLimit() moved
 * to the Durable Object — failures were written to the DO while the enforcement
 * check still read the D1 `rate_limits` table, so it could only ever see an
 * absent row and always allowed the next attempt.
 *
 * The second: the counter was keyed on the phone alone. A seller's phone number
 * is published on their own storefront, so twenty junk requests from anywhere
 * locked every one of that seller's devices out of their account. The control
 * meant to stop an attacker denied service to the account it was protecting,
 * and it needed no credential to fire.
 *
 * Fixing the second must not reintroduce the first, which is why both the
 * "still locks" and the "no longer locks the victim" cases are asserted
 * together. Both assert only what a caller can observe — whether authSeller()
 * accepts a credential — so they survive the counter moving stores again.
 */
const ATTACKER = "203.0.113.7";
const SELLER = "198.51.100.22";

describe("failed-auth throttle", () => {
	beforeEach(async () => {
		await createSchema();
	});

	it("locks one address out after repeated wrong secrets, even with the correct one", async () => {
		const store = await registerStore();

		// The correct secret works before the throttle engages.
		expect(await authSeller(env, store.phone, store.secret, ATTACKER)).not.toBeNull();

		// AUTH_FAIL_LIMIT is 20; go past it.
		for (let i = 0; i < 25; i++) {
			expect(await authSeller(env, store.phone, `wrong-${i}`, ATTACKER)).toBeNull();
		}

		// Load shedding is the property being kept: past the limit this address is
		// refused before any crypto or devices-table work, correct secret or not.
		// If the throttle is not enforcing, this returns the seller — precisely
		// what happened while the read and write paths pointed at different stores.
		expect(await authSeller(env, store.phone, store.secret, ATTACKER)).toBeNull();
	}, 20000);

	it("does not lock the seller's own device out of their own account", async () => {
		const store = await registerStore();

		// An unauthenticated attacker, who needs nothing but the phone number that
		// the storefront already publishes, burns the limit and then some.
		for (let i = 0; i < 25; i++) {
			expect(await authSeller(env, store.phone, `wrong-${i}`, ATTACKER)).toBeNull();
		}
		expect(await authSeller(env, store.phone, store.secret, ATTACKER)).toBeNull();

		// The decisive assertion. The seller, on their own connection, signs in
		// with their own correct secret. Before the key was scoped this returned
		// null — a complete account denial that any stranger could trigger and
		// renew for twenty requests per five minutes.
		expect(await authSeller(env, store.phone, store.secret, SELLER)).not.toBeNull();
	}, 20000);

	it("throttles each phone independently", async () => {
		const victim = await registerStore();
		const bystander = await registerStore();

		for (let i = 0; i < 25; i++) {
			await authSeller(env, victim.phone, `wrong-${i}`, ATTACKER);
		}

		expect(await authSeller(env, victim.phone, victim.secret, ATTACKER)).toBeNull();
		// A different phone must be unaffected by its neighbour's lockout.
		expect(await authSeller(env, bystander.phone, bystander.secret, ATTACKER)).not.toBeNull();
	}, 20000);

	it("counts failures where the enforcement check reads them", async () => {
		const store = await registerStore();
		for (let i = 0; i < 3; i++) {
			await authSeller(env, store.phone, `wrong-${i}`, ATTACKER);
		}

		// Guards the specific defect: the counter must land in the store that
		// authFailuresExceeded() consults, under the key it consults. With the DO
		// binding present that is the DO, and the D1 table stays untouched.
		const bucket = `authfail:${store.phone}:${ATTACKER}`;
		const counter = await (await rateLimiterStub(env, bucket))!.peek();
		expect(counter?.count).toBe(3);
	});

	it("does not throttle a caller that has no address to charge", async () => {
		const store = await registerStore();

		// provisionDeviceSecret() authenticates an already-authenticated seller to
		// ask whether a secret is already on file. A null address must mean "not a
		// throttled gate" rather than "share one bucket with every other unknown",
		// which would be the original unscoped defect under a different key.
		for (let i = 0; i < 25; i++) {
			expect(await authSeller(env, store.phone, `wrong-${i}`, null)).toBeNull();
		}
		expect(await authSeller(env, store.phone, store.secret, null)).not.toBeNull();
	}, 20000);
});
