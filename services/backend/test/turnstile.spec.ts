// Bot verification on storefront order creation.
//
// This is the one unauthenticated write path in the system. The only control was
// five orders per minute keyed on store *and* IP, which an attacker resets by
// rotating the IP — enough to spend a free plan's whole monthly order allowance
// in minutes, after which real buyers get plan_limit_reached and the seller sees
// orders stop with nothing saying why.
//
// The tests that matter most here are the negative ones: the challenge must stay
// completely absent while it is off (or every storefront breaks on deploy), and
// it must fail CLOSED when it is on but misconfigured (or the control is
// decorative).
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { createSchema, registerStore, authHeaders, type Registered } from "./helpers";
import { verifyTurnstile } from "../src/platform/http/turnstile";

const SITE = "https://orderak.app";

function testEnv(overrides: Record<string, unknown> = {}) {
	return { ...(env as unknown as Record<string, unknown>), ...overrides } as never;
}

async function seedProduct(r: Registered): Promise<string> {
	const res = await SELF.fetch("https://api.orderak.app/api/v1/products/sync", {
		method: "POST",
		headers: authHeaders(r),
		body: JSON.stringify({ products: [{ app_id: 1, name: "Cola", price: { amount_minor: 1500, currency: "EGP" }, stock: 10, available: true }] }),
	});
	return (await res.json<{ products: { product_code: string }[] }>()).products[0].product_code;
}

beforeEach(async () => {
	await createSchema();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("turnstile verification", () => {
	it("is a no-op while disabled, so nothing has to be configured to deploy", async () => {
		expect(await verifyTurnstile(testEnv(), "", null)).toEqual({ ok: true });
	});

	it("fails closed when enabled without a secret", async () => {
		// The dangerous combination: a dashboard says the control is on and every
		// order sails through. Refusing is the only safe reading of "enabled but
		// unconfigured", and it is loud in the logs.
		const outcome = await verifyTurnstile(
			testEnv({ TURNSTILE_ENABLED: "true", TURNSTILE_SECRET: "" }), "any-token", "1.2.3.4",
		);
		expect(outcome).toEqual({ ok: false, reason: "misconfigured" });
	});

	it("rejects a request carrying no token when enabled", async () => {
		const outcome = await verifyTurnstile(
			testEnv({ TURNSTILE_ENABLED: "true", TURNSTILE_SECRET: "s" }), "", "1.2.3.4",
		);
		expect(outcome).toEqual({ ok: false, reason: "missing_token" });
	});

	it("accepts a token Cloudflare confirms, and sends the client IP", async () => {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ success: true }));
		vi.stubGlobal("fetch", fetchMock);

		const outcome = await verifyTurnstile(
			testEnv({ TURNSTILE_ENABLED: "true", TURNSTILE_SECRET: "shh" }), "tok", "9.9.9.9",
		);

		expect(outcome).toEqual({ ok: true });
		const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
		expect(body).toMatchObject({ secret: "shh", response: "tok", remoteip: "9.9.9.9" });
	});

	it("omits remoteip when the IP is the 'noip' placeholder", async () => {
		// Sending the literal string "noip" as an address would make siteverify's
		// correlation worse than omitting it.
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ success: true }));
		vi.stubGlobal("fetch", fetchMock);

		await verifyTurnstile(testEnv({ TURNSTILE_ENABLED: "true", TURNSTILE_SECRET: "s" }), "tok", "noip");

		expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).not.toHaveProperty("remoteip");
	});

	it("refuses when Cloudflare rejects the token", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] })));
		const outcome = await verifyTurnstile(
			testEnv({ TURNSTILE_ENABLED: "true", TURNSTILE_SECRET: "s" }), "bad", "1.2.3.4",
		);
		expect(outcome).toEqual({ ok: false, reason: "rejected" });
	});

	it("refuses rather than passes when siteverify is unreachable", async () => {
		// A deliberate availability trade: if a Worker cannot reach Cloudflare's own
		// challenge endpoint, accepting unverified orders is the worse option.
		vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
		const outcome = await verifyTurnstile(
			testEnv({ TURNSTILE_ENABLED: "true", TURNSTILE_SECRET: "s" }), "tok", "1.2.3.4",
		);
		expect(outcome).toEqual({ ok: false, reason: "misconfigured" });
	});
});

describe("storefront rendering while the challenge is off", () => {
	it("renders no widget, no loader and no Turnstile in the CSP", async () => {
		// The whole point of the default-off posture: a deploy must change nothing
		// about the page until a site key exists.
		const r = await registerStore({ store_name: "Fresh Market" });
		await seedProduct(r);

		const res = await SELF.fetch(`${SITE}/${r.public_identifier}`);
		const html = await res.text();
		const csp = res.headers.get("content-security-policy") ?? "";

		expect(html).not.toContain("cf-turnstile");
		expect(html).not.toContain("challenges.cloudflare.com");
		expect(csp).not.toContain("challenges.cloudflare.com");
		// The rest of the policy is untouched.
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("connect-src 'self'");
		expect(csp).not.toContain("frame-src");
	});

	it("renders the widget, the loader and the matching CSP once enabled", async () => {
		// Called directly rather than through SELF.fetch, because the vars reach the
		// Worker from the miniflare binding and cannot be overridden per request.
		const { renderStorePage } = await import("../src/domains/catalog/catalog");
		const r = await registerStore({ store_name: "Fresh Market" });
		await seedProduct(r);
		const store = await env.orderak_db.prepare("SELECT * FROM sellers WHERE public_identifier=?")
			.bind(r.public_identifier).first<Record<string, unknown>>();

		const res = await renderStorePage(
			testEnv({ TURNSTILE_ENABLED: "true", TURNSTILE_SITE_KEY: "0x4AAAAAAATestKey" }),
			store!,
			"en",
		);
		const html = await res.text();
		const csp = res.headers.get("content-security-policy") ?? "";

		expect(html).toContain('class="cf-turnstile" data-sitekey="0x4AAAAAAATestKey"');
		expect(html).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
		// All three directives the widget needs, or it fails silently in the browser.
		expect(csp).toContain("script-src");
		expect(csp).toContain("frame-src https://challenges.cloudflare.com");
		expect(csp).toContain("connect-src 'self' https://challenges.cloudflare.com");
		// connect-src must be replaced, not duplicated: a second one is ignored.
		expect(csp.match(/connect-src/g)).toHaveLength(1);
		// The external loader is not an inline script, so it must be permitted by
		// origin rather than by hash — and the inline block still gets its hash.
		const scriptSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src ")) ?? "";
		expect(scriptSrc).toContain("'sha256-");
		expect(scriptSrc).toContain("https://challenges.cloudflare.com");
		// Scoped to script-src: style-src legitimately carries 'unsafe-inline'.
		expect(scriptSrc).not.toContain("'unsafe-inline'");
	});

	it("still accepts an order with no token", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		const code = await seedProduct(r);

		const res = await SELF.fetch(`${SITE}/${r.public_identifier}`, {
			method: "POST",
			headers: { "content-type": "application/json", "idempotency-key": "off-1" },
			body: JSON.stringify({ items: [{ product_code: code, qty: 1 }], buyer_phone: "01012345678", pay_method: "COD" }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true });
	});
});
