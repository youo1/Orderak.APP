import { beforeEach, describe, expect, it } from "vitest";
import {
	BASE,
	SELF,
	authHeaders,
	createEntitlementSchema,
	createSchema,
	registerStore,
} from "./helpers";

beforeEach(async () => {
	await createSchema();
	await createEntitlementSchema();
});

describe("pre-release API route policy", () => {
	it("serves the first production seller contract only under v1", async () => {
		const response = await SELF.fetch(`${BASE}/api/v1/slug/check?slug=versioned-store`);
		const payload = await response.json<Record<string, unknown>>();

		expect(response.status).toBe(200);
		expect(payload).toMatchObject({ ok: true, available: true });
	});

	it("routes authenticated v1 paths without changing credentials or payloads", async () => {
		const seller = await registerStore({ store_name: "Versioned Store" });
		const response = await SELF.fetch(`${BASE}/api/v1/store`, {
			headers: authHeaders(seller),
		});
		const payload = await response.json<{ ok: boolean; store?: { store_name?: string } }>();

		expect(response.status).toBe(200);
		expect(payload.ok).toBe(true);
		expect(payload.store?.store_name).toBe("Versioned Store");
	});

	it("moves billing and entitlements into the clean v1 contract", async () => {
		const response = await SELF.fetch(`${BASE}/api/v1/billing/catalog`);

		expect(response.status).not.toBe(404);
	});

	it.each([
		"/api/store",
		"/api/slug/check?slug=legacy",
		"/api/v2/entitlements",
		"/api/v2/billing/catalog",
		"/api/v2/billing/google/verify",
		"/api/v1/webhooks/payment",
		"/api/v2/billing/google/rtdn",
	])("returns 404 for removed pre-release alias %s", async (path) => {
		const response = await SELF.fetch(`${BASE}${path}`);

		expect(response.status).toBe(404);
		expect(response.headers.get("location")).toBeNull();
	});

	it.each([
		["POST", "/api/integrations/v1/payment"],
		["POST", "/api/integrations/v1/google-play/rtdn"],
	])("mounts the %s integration route %s outside Seller v1", async (method, path) => {
		const response = await SELF.fetch(`${BASE}${path}`, { method });
		expect(response.status).not.toBe(404);
	});

	it("uses RFC 9457 for v1 errors and correlates every response", async () => {
		const response = await SELF.fetch(`${BASE}/api/v1/store`);
		const payload = await response.json<Record<string, unknown>>();

		expect(response.status).toBe(401);
		expect(response.headers.get("content-type")).toContain("application/problem+json");
		expect(response.headers.get("x-request-id")).toBeTruthy();
		expect(payload).toMatchObject({
			type: "https://developers.orderak.app/problems/auth",
			status: 401,
			code: "auth",
		});
		expect(payload).not.toHaveProperty("error");
	});
});
