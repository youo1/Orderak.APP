import { beforeEach, describe, expect, it } from "vitest";
import { SELF, BASE, createSchema, registerStore, authHeaders } from "./helpers";

beforeEach(async () => {
	await createSchema();
});

describe("PUT /api/v1/store city name input type", () => {
	it("rejects a non-string typed city name", async () => {
		const seller = await registerStore();
		const response = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(seller),
			body: JSON.stringify({ city_name: 123 }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "invalid_city" });
	});
});
