import { beforeEach, describe, expect, it } from "vitest";
import { env, BASE, createSchema, SELF, authHeaders, registerStore } from "./helpers";
import { handleGooglePlayRoutes } from "../src/integrations/google-play/google-play";

interface ConfigResponse {
	governance: { features: { billing: { enabled: boolean; source: string } } };
}

/**
 * `/api/v1/billing/google/verify` is where a purchase token is first verified
 * and its entitlement first granted — the acquisition kill switch has to cover
 * it, not just the catalogue and /subscribe.
 *
 * Before this test, the route checked only `GOOGLE_PLAY_LIFECYCLE_ENABLED`.
 * An admin closing `settings.billing_enabled` (or `BILLING_ENABLED`) as an
 * emergency stop did not stop an already-open app session — catalogue already
 * fetched client-side — from completing a real Play charge and having it
 * granted here.
 */

function verifyRequest(): Request {
	return new Request(`${BASE}/api/v1/billing/google/verify`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ purchase_token: "irrelevant-gate-closes-first" }),
	});
}

describe("billing.google.verify acquisition gate", () => {
	beforeEach(async () => {
		await createSchema();
	});

	it("refuses when BILLING_ENABLED is off, before touching auth or the database", async () => {
		const closedEnv = {
			...(env as unknown as Record<string, unknown>),
			GOOGLE_PLAY_LIFECYCLE_ENABLED: "true",
			BILLING_ENABLED: "false",
		} as never;

		const response = await handleGooglePlayRoutes(verifyRequest(), closedEnv, new URL(`${BASE}/api/v1/billing/google/verify`));
		expect(response).not.toBeNull();
		expect(response!.status).toBe(403);
		const body = await response!.json();
		expect(body).toMatchObject({ code: "feature_disabled", feature: "billing" });
	});

	it("refuses when the D1 runtime control is off even though BILLING_ENABLED is on", async () => {
		// This is the exact incident scenario: BILLING_ENABLED="true" (Wrangler var,
		// deploy-time) stays on while an admin flips the D1 `settings.billing_enabled`
		// row off mid-incident (runtime, no deploy). Both must be respected.
		await env.orderak_db.prepare(
			"INSERT OR REPLACE INTO settings(key,value_json) VALUES('billing_enabled','false')",
		).run();
		const openLifecycleClosedAcquisition = {
			...(env as unknown as Record<string, unknown>),
			GOOGLE_PLAY_LIFECYCLE_ENABLED: "true",
			BILLING_ENABLED: "true",
		} as never;

		const response = await handleGooglePlayRoutes(
			verifyRequest(),
			openLifecycleClosedAcquisition,
			new URL(`${BASE}/api/v1/billing/google/verify`),
		);
		expect(response).not.toBeNull();
		expect(response!.status).toBe(403);
		const body = await response!.json();
		expect(body).toMatchObject({ code: "feature_disabled", feature: "billing" });
	});
});

/**
 * `governance.features.billing` is the only signal the Android paywall reads
 * (`isPurchaseOpen()`). Before this, it was computed from `BILLING_ENABLED`
 * and the feature-flags table alone — never the D1 `settings.billing_enabled`
 * runtime control the two tests above prove the acquisition routes actually
 * enforce. An admin flipping that control mid-incident closed the routes but
 * left the client showing "purchase open" (or the reverse, if a `feature_flags`
 * rule enabled billing without anyone also flipping the D1 control on).
 */
describe("governance.features.billing tracks both acquisition gates", () => {
	beforeEach(async () => {
		// createSchema() clears every table it seeds, including the migration's
		// feature_flags rows (see the other suites in this file's package for
		// the same pattern) — so the 'billing' definition has to be re-seeded
		// per test, with default_value_json='true' rather than migration 028's
		// 'false', to model billing having been rolled out through the normal
		// flag mechanism, independent of the D1 emergency control under test
		// below. BILLING_ENABLED alone only ungates the flag; it does not by
		// itself make the flag's own value true.
		await createSchema();
		env.BILLING_ENABLED = "true";
		await env.orderak_db.prepare(
			"INSERT INTO feature_flags(flag_key,description,default_value_json,env_gate,runtime_consumer,risk,rollout_seed,status) " +
			"VALUES('billing','Paid billing availability','true','BILLING_ENABLED','backend/android','critical','billing-v1','published')",
		).run();
	});

	async function billingFeature(seller: Awaited<ReturnType<typeof registerStore>>) {
		const response = await SELF.fetch(`${BASE}/api/v1/config`, { headers: authHeaders(seller) });
		return (await response.json<ConfigResponse>()).governance.features.billing;
	}

	it("is open when BILLING_ENABLED is on and the D1 control is unset", async () => {
		const seller = await registerStore();
		expect((await billingFeature(seller)).enabled).toBe(true);
	});

	it("closes when the D1 runtime control is turned off, even though BILLING_ENABLED stays on", async () => {
		const seller = await registerStore();
		expect((await billingFeature(seller)).enabled).toBe(true);

		await env.orderak_db.prepare(
			"INSERT OR REPLACE INTO settings(key,value_json) VALUES('billing_enabled','false')",
		).run();

		const closed = await billingFeature(seller);
		expect(closed.enabled).toBe(false);
		expect(closed.source).toBe("runtime_control:billing_enabled");
	});
});
