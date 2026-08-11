import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src/entrypoints/public-worker";
import { callWorker, createSchema, registerStore, authHeaders } from "./helpers";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Orderak worker", () => {
	// An unknown path is now treated as a possible store identifier, so the
	// `sellers` table must exist for the lookup to resolve (to null -> 404).
	beforeEach(async () => {
		await createSchema();
	});

	it("responds to the health check", async () => {
		const request = new IncomingRequest("http://example.com/health");
		const ctx = createExecutionContext();
		const response = await callWorker(worker, request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			service: "orderak-worker",
			// The test enables the feature path, but no provider key is set.
			aiConfigured: false,
		});
	});

	it("applies baseline security headers to every public response", async () => {
		const response = await SELF.fetch("https://api.orderak.app/health");

		expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
		expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
	});

	it("does not let hardening clobber a handler's own caching policy", async () => {
		// hardenPublic() must leave cache-control alone: the public cache
		// strategy in cachedPublicGet() depends on it surviving intact.
		const response = await SELF.fetch("https://api.orderak.app/api/v1/theme");

		expect(response.headers.get("strict-transport-security")).not.toBeNull();
		expect(response.headers.get("cache-control")).toMatch(/public/);
	});

	it("reflects CORS only for allowlisted origins", async () => {
		const allowed = await SELF.fetch("https://api.orderak.app/api/v1/theme", {
			method: "OPTIONS",
			headers: { Origin: "https://orderak.app" },
		});
		expect(allowed.headers.get("access-control-allow-origin")).toBe("https://orderak.app");
		expect(allowed.headers.get("vary")).toBe("Origin");

		const denied = await SELF.fetch("https://api.orderak.app/api/v1/theme", {
			method: "OPTIONS",
			headers: { Origin: "https://evil.example" },
		});
		expect(denied.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("fails closed when the AI assistant launch flag is disabled", async () => {
		const disabledEnv = { ...env, AI_ASSISTANT_ENABLED: "false" } as TestEnv;
		const request = new IncomingRequest("https://example.com/api/v1/chat", {
			method: "POST",
			body: JSON.stringify({ message: "hello" }),
		});
		const ctx = createExecutionContext();
		const response = await callWorker(worker, request, disabledEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			code: "feature_disabled",
			feature: "ai_assistant",
		});
	});

	it("fails closed on billing acquisition when the launch flag is disabled", async () => {
		const disabledEnv = { ...env, BILLING_ENABLED: "false" } as TestEnv;
		const request = new IncomingRequest("https://example.com/api/v1/plans");
		const ctx = createExecutionContext();
		const response = await callWorker(worker, request, disabledEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			code: "feature_disabled",
			feature: "billing",
		});
	});

	it("fails closed without retry when the Play lifecycle is disabled", async () => {
		const disabledEnv = { ...env, GOOGLE_PLAY_LIFECYCLE_ENABLED: "false" } as TestEnv;
		const request = new IncomingRequest("https://example.com/api/v1/billing/verifications/0");
		const ctx = createExecutionContext();
		const response = await callWorker(worker, request, disabledEnv, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code: "billing_lifecycle_disabled" });
	});

	// /api/v1/chat requires seller auth (the AI proxy is metered/abuse-guarded),
	// so these tests register a store first and send its credentials.
	it("returns a stable temporary-unavailable response when no AI key is configured", async () => {
		const store = await registerStore();
		const response = await SELF.fetch("https://example.com/api/v1/chat", {
			method: "POST",
			headers: authHeaders(store),
			body: JSON.stringify({ message: "I want chicken and rice" }),
		});

		expect(response.status).toBe(503);
		expect(response.headers.get("retry-after")).toBe("60");
		expect(await response.json()).toMatchObject({ code: "ai_temporarily_unavailable" });
	});

	it("rejects an empty message", async () => {
		const store = await registerStore();
		const response = await SELF.fetch("https://example.com/api/v1/chat", {
			method: "POST",
			headers: authHeaders(store),
			body: JSON.stringify({ message: "   " }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "message_is_required" });
	});

	it("rejects an invalid JSON body", async () => {
		const store = await registerStore();
		const response = await SELF.fetch("https://example.com/api/v1/chat", {
			method: "POST",
			headers: authHeaders(store),
			body: "not json",
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "invalid_json_body" });
	});

	it("returns 404 for unknown routes", async () => {
		const response = await SELF.fetch("https://example.com/nope");
		expect(response.status).toBe(404);
	});

	it("does not expose the retired embedded admin shell", async () => {
		const response = await SELF.fetch("https://admin.orderak.app/");
		const html = await response.text();
		expect(html).not.toContain("Orderak Admin");
		expect(html).not.toContain("/api/admin/v1/");
	});

	it("blocks admin routes on non-admin hosts", async () => {
		const shell = await SELF.fetch("https://api.orderak.app/admin");
		expect(shell.status).toBe(404);
		const auth = await SELF.fetch("https://api.orderak.app/api/admin/v1/auth/me");
		expect(auth.status).toBe(404);
	});

	it("does not mount admin UI or API on the public Worker in local development", async () => {
		for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
			const shell = await SELF.fetch(`http://${host}:8787/admin`);
			expect(shell.status).toBe(404);

			const auth = await SELF.fetch(`http://${host}:8787/api/admin/v1/auth/me`);
			expect(auth.status).toBe(404);
		}
	});
});
