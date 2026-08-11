import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, authHeaders, createSchema, registerStore } from "./helpers";

beforeEach(async () => {
	await createSchema();
});

describe("405 Method Not Allowed", () => {
	it("advertises the only supported method before feature and auth checks", async () => {
		const response = await SELF.fetch(`${BASE}/api/v1/chat`, { method: "GET" });

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
		expect(response.headers.get("content-type")).toContain("application/problem+json");
		expect(response.headers.get("x-request-id")).toBeTruthy();
	});

	it("advertises every method implemented by an authenticated resource", async () => {
		const seller = await registerStore();
		const response = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PATCH",
			headers: authHeaders(seller),
			body: "{}",
		});

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET, PUT");
	});

	it("keeps nested seller-operation routing precise", async () => {
		const seller = await registerStore();
		const response = await SELF.fetch(`${BASE}/api/v1/support/tickets`, {
			method: "DELETE",
			headers: authHeaders(seller),
		});

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET, POST");
	});
});
