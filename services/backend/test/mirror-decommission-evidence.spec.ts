import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, SELF, authHeaders, createSchema, registerStore } from "./helpers";

/**
 * The evidence the mirror's deletion is gated on.
 *
 * WHY THIS SUITE EXISTS
 *   `POST /api/v1/products/sync` is being decommissioned. Route coverage can
 *   prove that no code in this repository calls it; it cannot prove that no
 *   *installed app* does, and those are different questions. A phone running
 *   last month's build is invisible to a grep, and a deletion decided on the
 *   first question while believing it answered the second is how a working app
 *   stops working.
 *
 *   So the endpoint announces every call with the build that made it, and the
 *   deletion waits on silence. This asserts the announcement actually happens —
 *   because a signal nobody emits looks exactly like a signal nobody triggers,
 *   and the whole decision would then rest on a log line that was never written.
 *
 * WHY NOT `catalog_version = 0`
 *   That was the first proposal and it is not evidence. It cannot distinguish a
 *   seller with no products from a seller whose products exist only on a phone.
 *   Silence on this signal means exactly what it appears to mean.
 */

beforeEach(createSchema);
afterEach(() => vi.restoreAllMocks());

function signalsFrom(log: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
	return log.mock.calls
		.map(([first]) => {
			try {
				return JSON.parse(String(first)) as Record<string, unknown>;
			} catch {
				return null;
			}
		})
		.filter((entry): entry is Record<string, unknown> => entry?.signal === "catalog_mirror_called");
}

async function pushMirror(r: Awaited<ReturnType<typeof registerStore>>, extraHeaders: Record<string, string> = {}) {
	return SELF.fetch(`${BASE}/api/v1/products/sync`, {
		method: "POST",
		headers: { ...authHeaders(r), ...extraHeaders },
		body: JSON.stringify({ products: [] }),
	});
}

describe("catalogue mirror decommission evidence", () => {
	it("announces every call with the build that made it", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const r = await registerStore();

		await pushMirror(r, {
			"x-orderak-platform": "android",
			"x-orderak-app-version": "0.3.0-staging",
			"x-orderak-version-code": "412",
		});

		const signals = signalsFrom(log);
		expect(signals).toHaveLength(1);
		expect(signals[0]).toMatchObject({
			platform: "android",
			app_version: "0.3.0-staging",
			version_code: "412",
		});
	});

	it("still announces a call that sends no version headers", async () => {
		// The build most worth hearing about is an old one, and an old one is
		// exactly what might not send these headers. Recording the call with null
		// versions is strictly better than recording nothing: it says something is
		// out there, which is the part that blocks the deletion.
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const r = await registerStore();

		await pushMirror(r);

		const signals = signalsFrom(log);
		expect(signals).toHaveLength(1);
		expect(signals[0]).toMatchObject({ platform: null, app_version: null, version_code: null });
	});

	it("announces the call before deciding whether to accept it", async () => {
		// A refused push is still a caller. If the signal only fired on success,
		// a fleet of old apps failing their baseline check would look like silence
		// — which reads as "nothing uses this" and is the opposite of the truth.
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const r = await registerStore();

		const refused = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST",
			headers: { ...authHeaders(r), "x-orderak-app-version": "0.1.0-ancient" },
			body: JSON.stringify({}),
		});
		expect(refused.status).toBe(400);

		const signals = signalsFrom(log);
		expect(signals).toHaveLength(1);
		expect(signals[0]).toMatchObject({ app_version: "0.1.0-ancient" });
	});

	it("says nothing when the product routes are used instead", async () => {
		// The other half of the claim: silence has to mean the mirror is unused,
		// not that the signal is broken. A store created and edited entirely
		// through the product routes must produce none of these.
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const r = await registerStore();

		const created = await SELF.fetch(`${BASE}/api/v1/products`, {
			method: "POST",
			headers: authHeaders(r),
			body: JSON.stringify({ name: "Cola", price: { amount_minor: 1500, currency: "EGP" } }),
		});
		expect(created.status).toBe(201);

		expect(signalsFrom(log)).toHaveLength(0);
	});
});
