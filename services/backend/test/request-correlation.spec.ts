import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, createSchema } from "./helpers";

/**
 * X-Request-ID on every response.
 *
 * The contract declares this header on every status of every operation, but only
 * responses built by jsonResponse() ever carried one. Roughly 25 `new Response(...)`
 * sites across ten files did not, and neither did anything served from the edge cache.
 *
 * Nothing caught it. The first nightly contract run against staging did: k6 reported
 * http_req_failed 0.00% - every request succeeded - while failing the header check on
 * 1918 of 1918 responses, because GET /api/v1/theme is served through cachedPublicGet.
 *
 * These tests exist so the header cannot quietly disappear again from the paths that
 * do not go through jsonResponse, which is exactly where it went missing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(async () => {
	await createSchema();
});

describe("request correlation", () => {
	it("stamps a request id on a JSON response", async () => {
		const response = await SELF.fetch(`${BASE}/health`);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-request-id")).toMatch(UUID);
	});

	it("stamps a request id on the design system endpoint, which bypasses jsonResponse", async () => {
		// This is the endpoint that failed 1918 of 1918 header checks in the nightly:
		// it is served through cachedPublicGet, so its response never passed through
		// jsonResponse and had no id of its own.
		const response = await SELF.fetch(`${BASE}/api/v1/theme`);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-request-id")).toMatch(UUID);
	});

	it("stamps a request id on a redirect, which carries no body at all", async () => {
		// GET /api/theme.css always answers 302 to the content-addressed stylesheet.
		// Rebuilding a bodyless response is the case most likely to throw if the fix
		// is written carelessly, so it is asserted rather than assumed.
		const response = await SELF.fetch(`${BASE}/api/theme.css`, { redirect: "manual" });

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBeTruthy();
		expect(response.headers.get("x-request-id")).toMatch(UUID);
	});

	it("stamps a request id on an error response", async () => {
		const response = await SELF.fetch(`${BASE}/api/v1/definitely-not-a-route`);

		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(response.headers.get("x-request-id")).toMatch(UUID);
	});

	it("gives each request its own id rather than replaying one", async () => {
		// The point of the header is correlation. An implementation that set the id
		// inside a cached loader would pass every test above while returning one frozen
		// id for every hit - looking correct and correlating nothing.
		const ids = new Set<string>();
		for (let attempt = 0; attempt < 4; attempt++) {
			const response = await SELF.fetch(`${BASE}/api/v1/theme`);
			ids.add(response.headers.get("x-request-id") ?? "");
		}

		expect(ids.size).toBe(4);
	});

	it("does not echo a caller-supplied request id", async () => {
		// An inbound X-Request-ID is caller-controlled and this value reaches
		// problem+json bodies and the logs, so it is generated rather than trusted.
		const injected = "11111111-2222-3333-4444-555555555555";
		const response = await SELF.fetch(`${BASE}/health`, { headers: { "x-request-id": injected } });

		expect(response.headers.get("x-request-id")).toMatch(UUID);
		expect(response.headers.get("x-request-id")).not.toBe(injected);
	});
});

// Access-Control-Allow-Origin depends on the request, and jsonResponse() has no
// request — it called corsHeaders() with no argument, so the header reached the
// OPTIONS preflight and nothing else. Browsers saw the preflight pass and then
// blocked the response it was clearing, which made the origin allowlist inert.
describe("CORS", () => {
	const ALLOWED = "https://admin.orderak.app";

	it("echoes an allowed origin on a real response, not only on the preflight", async () => {
		const preflight = await SELF.fetch(`${BASE}/health`, {
			method: "OPTIONS",
			headers: { origin: ALLOWED },
		});
		expect(preflight.headers.get("access-control-allow-origin")).toBe(ALLOWED);

		const actual = await SELF.fetch(`${BASE}/health`, { headers: { origin: ALLOWED } });
		expect(actual.headers.get("access-control-allow-origin")).toBe(ALLOWED);
		expect(actual.headers.get("vary") ?? "").toContain("Origin");
	});

	it("omits the header entirely for an origin that is not allowlisted", async () => {
		const response = await SELF.fetch(`${BASE}/health`, {
			headers: { origin: "https://not-orderak.example" },
		});
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});

	// A handler that sets its own policy keeps it. /api/v1/theme serves public
	// design tokens to any client and says so with a wildcard; the middleware
	// must not narrow that to the allowlist.
	it("leaves a handler's own CORS policy alone", async () => {
		const response = await SELF.fetch(`${BASE}/api/v1/theme`, { headers: { origin: ALLOWED } });
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
	});

	it("covers error responses, which are built by the same helper", async () => {
		const response = await SELF.fetch(`${BASE}/api/v1/store`, { headers: { origin: ALLOWED } });
		expect(response.status).toBe(401);
		expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED);
	});
});
