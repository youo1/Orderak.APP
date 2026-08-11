import { beforeEach, describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";
import { createSchema, registerStore } from "./helpers";

/**
 * One Worker answers on several hostnames. These pin which surface each one is
 * allowed to serve, so a future route change cannot quietly reintroduce
 * storefronts on the API host or a second canonical origin under www.
 */
describe("canonical host enforcement", () => {
	beforeEach(async () => {
		await createSchema();
	});

	it("redirects www to the apex origin, preserving the path and query", async () => {
		const response = await SELF.fetch("https://www.orderak.app/some-store?ref=x", { redirect: "manual" });
		expect(response.status).toBe(301);
		expect(response.headers.get("location")).toBe("https://orderak.app/some-store?ref=x");
	});

	it("does not redirect an unsafe method, which would drop its body", async () => {
		const response = await SELF.fetch("https://www.orderak.app/anything", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
			redirect: "manual",
		});
		expect(response.status).not.toBe(301);
	});

	it("serves the API on the API host", async () => {
		const response = await SELF.fetch("https://api.orderak.app/health");
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true });
	});

	it("still serves the API on the apex host, which the Android client uses", async () => {
		const response = await SELF.fetch("https://orderak.app/health");
		expect(response.status).toBe(200);
	});

	it("does not serve a storefront on the API host", async () => {
		const store = await registerStore();
		const identifier = String(store.public_identifier ?? store.store_code);

		const onWebsite = await SELF.fetch(`https://orderak.app/${identifier}`);
		expect(onWebsite.status).toBe(200);

		// Same path, API host: the page must not exist there.
		const onApi = await SELF.fetch(`https://api.orderak.app/${identifier}`);
		expect(onApi.status).toBe(404);
	});

	it("does not serve the marketing landing page on the API host", async () => {
		const onApi = await SELF.fetch("https://api.orderak.app/");
		expect(onApi.status).toBe(404);
	});
});
