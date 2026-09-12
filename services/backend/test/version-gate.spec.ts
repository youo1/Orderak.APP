import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore, type Registered } from "./helpers";

/**
 * The app-version policy, as a control rather than a notice.
 *
 * WHAT THIS IS ABOUT
 *   `governance.version` has always carried a decision — ok, warning,
 *   force_update, blocked, maintenance — computed from the caller's
 *   `x-orderak-version-code` and the active app_version_policies row. Nothing
 *   acted on it. The Android client drew a blocking screen for three of those
 *   statuses and the API served every request regardless, so the kill switch
 *   was advice that a client could decline to take: an old build, a patched
 *   one, or anything that was not the app kept full write access during a
 *   maintenance window.
 *
 *   Two halves to fixing that, and the second is worthless without the first.
 *   The header was read with `Math.max(0, Number(...))`, so a garbage value
 *   became NaN, NaN failed every comparison in versionDecision, and the caller
 *   resolved to "ok" — the one input the policy is evaluated against was the one
 *   input nothing validated. Enforcing a decision derived from an unvalidated,
 *   client-supplied number would only have moved the hole.
 *
 * WHAT IS DELIBERATELY NOT ENFORCED
 *   Reads, and the pre-auth surface. Both are in the tests below, because both
 *   are the kind of thing a later change could tighten without noticing what it
 *   breaks: refusing reads would leave a blocked seller unable to see their own
 *   orders, and refusing pre-auth calls would lock every seller out of sign-in
 *   the moment any policy row existed — the app sends no device headers at all
 *   before it has a credential.
 */

beforeEach(createSchema);

async function setPolicy(fields: Record<string, unknown>): Promise<void> {
	const row = {
		id: crypto.randomUUID(),
		platform: "android",
		active: 1,
		reason: "version-gate spec",
		country_code: null,
		minimum_version_code: null,
		recommended_version_code: null,
		blocked_version_codes_json: "[]",
		maintenance_mode: 0,
		enforce_after: null,
		store_url: "https://play.google.com/store/apps/details?id=app.orderak.seller",
		warning_message_i18n: "{}",
		blocking_message_i18n: "{}",
		...fields,
	};
	const columns = Object.keys(row);
	await env.orderak_db.prepare(
		`INSERT INTO app_version_policies(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
	).bind(...columns.map((c) => (row as Record<string, unknown>)[c])).run();
}

function headers(r: Registered, versionCode?: string): Record<string, string> {
	return {
		...authHeaders(r),
		"x-orderak-platform": "android",
		...(versionCode === undefined ? {} : { "x-orderak-version-code": versionCode }),
	};
}

/** A write every seller makes, and the cheapest one to drive here. */
function writeStore(r: Registered, h: Record<string, string>): Promise<Response> {
	return SELF.fetch(`${BASE}/api/v1/store`, {
		method: "PUT", headers: h, body: JSON.stringify({ store_name: "Renamed" }),
	});
}

describe("version-code header validation", () => {
	it("refuses a malformed version code rather than reading it as zero", async () => {
		const r = await registerStore({ phone: "+201500009001", country_iso: "EG" });
		for (const value of ["abc", "-1", "1.5", "99999999999", ""]) {
			const res = await SELF.fetch(`${BASE}/api/v1/store`, { headers: headers(r, value) });
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ code: "invalid_version_code" });
		}
	});

	it("accepts an absent header and a well-formed one", async () => {
		const r = await registerStore({ phone: "+201500009002", country_iso: "EG" });
		expect((await SELF.fetch(`${BASE}/api/v1/store`, { headers: headers(r) })).status).toBe(200);
		expect((await SELF.fetch(`${BASE}/api/v1/store`, { headers: headers(r, "42") })).status).toBe(200);
	});
});

describe("version policy enforcement", () => {
	it("refuses a credentialed write from a blocked version", async () => {
		const r = await registerStore({ phone: "+201500009010", country_iso: "EG" });
		await setPolicy({ blocked_version_codes_json: "[7]" });

		const res = await writeStore(r, headers(r, "7"));
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({
			code: "client_version_refused",
			version_status: "blocked",
		});
	});

	it("refuses every credentialed write during maintenance, whatever the version", async () => {
		const r = await registerStore({ phone: "+201500009011", country_iso: "EG" });
		await setPolicy({ maintenance_mode: 1 });

		const res = await writeStore(r, headers(r, "999999"));
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ version_status: "maintenance" });
	});

	it("treats an unknown version as failing a minimum, not as meeting it", async () => {
		// The whole point of validating the header. A client that simply omits it
		// used to resolve to "ok" and walk past a minimum it could not prove it
		// met, which made stripping one header a complete bypass.
		const r = await registerStore({ phone: "+201500009012", country_iso: "EG" });
		await setPolicy({ minimum_version_code: 50 });

		expect((await writeStore(r, headers(r))).status).toBe(403);
		expect((await writeStore(r, headers(r, "49"))).status).toBe(403);
		expect((await writeStore(r, headers(r, "50"))).status).toBe(200);
	});

	it("respects the grace window before a minimum bites", async () => {
		const r = await registerStore({ phone: "+201500009013", country_iso: "EG" });
		await setPolicy({ minimum_version_code: 50, enforce_after: "2099-01-01 00:00:00" });
		expect((await writeStore(r, headers(r, "49"))).status).toBe(200);
	});

	it("does not refuse reads", async () => {
		// A blocked seller must still be able to see their own account. Refusing
		// reads would punish them for the update rather than gating the thing that
		// can do damage.
		const r = await registerStore({ phone: "+201500009014", country_iso: "EG" });
		await setPolicy({ maintenance_mode: 1 });

		expect((await SELF.fetch(`${BASE}/api/v1/store`, { headers: headers(r, "7") })).status).toBe(200);
		expect((await SELF.fetch(`${BASE}/api/v1/orders?since=0`, { headers: headers(r, "7") })).status).toBe(200);
	});

	it("does not refuse the pre-auth surface, which sends no device headers at all", async () => {
		// registerStore drives POST /api/v1/register, which carries its credentials
		// in the body and no x-orderak-* headers. Applying the gate there would
		// refuse sign-in for everyone the moment any policy row existed — the
		// lockout the credentialed-write scoping exists to prevent.
		await setPolicy({ maintenance_mode: 1 });
		const r = await registerStore({ phone: "+201500009015", country_iso: "EG" });
		expect(r.phone).toBe("+201500009015");

		expect((await SELF.fetch(`${BASE}/api/v1/plans`)).status).toBe(200);
	});

	it("leaves a policy for another platform alone", async () => {
		const r = await registerStore({ phone: "+201500009016", country_iso: "EG" });
		await setPolicy({ maintenance_mode: 1 });

		const res = await writeStore(r, { ...headers(r, "7"), "x-orderak-platform": "ios" });
		expect(res.status).toBe(200);
	});

	it("reports the same decision it enforces", async () => {
		// Client and server disagreeing about what "blocked" means is how this
		// became a notice in the first place, so the governance block a client
		// reads and the refusal it receives come from one computation.
		const r = await registerStore({ phone: "+201500009017", country_iso: "EG" });
		await setPolicy({ blocked_version_codes_json: "[7]" });

		const config = await SELF.fetch(`${BASE}/api/v1/config`, { headers: headers(r, "7") });
		expect(config.status).toBe(200);
		const body = await config.json() as { governance: { version: { status: string } } };
		expect(body.governance.version.status).toBe("blocked");

		expect((await writeStore(r, headers(r, "7"))).status).toBe(403);
	});
});
