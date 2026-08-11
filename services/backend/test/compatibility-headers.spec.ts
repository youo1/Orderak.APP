import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, createSchema } from "./helpers";

beforeEach(async () => {
	await createSchema();
});

describe("Seller compatibility headers", () => {
	it("rejects an unknown client platform before every Seller route", async () => {
		for (const path of [
			"/api/v1/theme",
			"/api/v1/billing/catalog",
			"/api/v1/catalog/business-categories",
			"/api/v1/slug/check",
		]) {
			const response = await SELF.fetch(`${BASE}${path}`, {
				headers: { "x-orderak-platform": "AAA" },
			});
			expect(response.status, path).toBe(400);
			expect(await response.json(), path).toMatchObject({ code: "invalid_client_platform" });
		}
	});

	it("accepts every documented platform value", async () => {
		for (const platform of ["android", "ios", "desktop"]) {
			const response = await SELF.fetch(`${BASE}/api/v1/theme`, {
				headers: { "x-orderak-platform": platform },
			});
			expect(response.status, platform).toBe(200);
		}
	});

	it("enforces the documented app-version and request-id bounds", async () => {
		const emptyVersion = await SELF.fetch(`${BASE}/api/v1/theme`, {
			headers: { "x-orderak-app-version": "" },
		});
		expect(emptyVersion.status).toBe(400);
		expect(await emptyVersion.json()).toMatchObject({ code: "invalid_app_version" });

		const longVersion = await SELF.fetch(`${BASE}/api/v1/theme`, {
			headers: { "x-orderak-app-version": "v".repeat(65) },
		});
		expect(longVersion.status).toBe(400);

		const longRequestId = await SELF.fetch(`${BASE}/api/v1/theme`, {
			headers: { "x-request-id": "r".repeat(129) },
		});
		expect(longRequestId.status).toBe(400);
		expect(await longRequestId.json()).toMatchObject({ code: "invalid_request_id" });
	});
});
