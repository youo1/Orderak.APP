import type * as RealSentry from "@sentry/cloudflare";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import adminWorker from "../src/entrypoints/admin-worker";
import publicWorker from "../src/entrypoints/public-worker";
import { redactPath, redactUrl } from "../src/platform/observability/sentry";
import { callWorker, env } from "./helpers";

/**
 * What the Workers send to Sentry.
 *
 * Sentry 11 collects request bodies, every request header, URL query values
 * and the caller's IP address unless it is told not to, and no option covers
 * the path. Here those carry seller and buyer phone numbers: the app sends one
 * in `x-orderak-phone`, and `/api/v1/customers/{customer_key}` addresses a
 * buyer by phone number.
 *
 * The test keeps each Worker's own Sentry options and replaces only the
 * transport, so what it captures is what would have left for Sentry. It also
 * records an error inside each request, so both the error event and the
 * request's spans are checked.
 */

// Only ever serialised, so its shape does not matter here.
type Envelope = unknown;

const sent: Envelope[] = [];
const optionsSeen: (RealSentry.CloudflareOptions | undefined)[] = [];

vi.mock("@sentry/cloudflare", async (importOriginal) => {
	const real = await importOriginal<typeof import("@sentry/cloudflare")>();
	const transport = () => ({
		send: async (envelope: Envelope) => {
			sent.push(envelope);
			return {};
		},
		flush: async () => true,
	});
	return {
		...real,
		withSentry: ((optionsCallback: (env: unknown) => RealSentry.CloudflareOptions | undefined, handler: ExportedHandler) =>
			real.withSentry(
				(env: unknown) => {
					const options = optionsCallback(env);
					optionsSeen.push(options);
					// Sentry keeps one client per isolate and reuses its options for
					// every later request. Both Workers run in this one test isolate,
					// so without `cacheClient: false` the second would be sent with
					// the first one's options.
					return { ...options, tracesSampleRate: 1, transport, cacheClient: false };
				},
				{
					...handler,
					async fetch(request, env, ctx) {
						const response = await handler.fetch!(request, env, ctx);
						real.captureException(new Error("sentry-data-collection probe"));
						return response;
					},
				} satisfies ExportedHandler,
			)) as unknown as typeof real.withSentry,
	};
});

const PHONE_DIGITS = "201000000777";
const PHONE = `+${PHONE_DIGITS}`;
const IP = "203.0.113.77";
const REQUEST_ID = "req-sentry-data-collection";
const DSN = "https://public@sentry.example.test/1";

const workers = [
	{ name: "public", worker: publicWorker, url: `https://api.orderak.app/api/v1/customers/${encodeURIComponent(PHONE)}` },
	{ name: "admin", worker: adminWorker, url: `https://admin.orderak.app/api/admin/customers/${encodeURIComponent(PHONE)}` },
];

beforeEach(() => {
	sent.length = 0;
	optionsSeen.length = 0;
});

describe("Sentry data collection", () => {
	for (const { name, worker, url } of workers) {
		it(`the ${name} Worker sends no phone number, IP address or request body`, async () => {
			const ctx = createExecutionContext();
			await callWorker(
				worker,
				new Request(url, {
					method: "PATCH",
					headers: {
						"content-type": "application/json",
						"x-orderak-phone": PHONE,
						"cf-connecting-ip": IP,
						"x-forwarded-for": IP,
						"x-request-id": REQUEST_ID,
					},
					body: JSON.stringify({ phone: PHONE, email: "seller@example.test" }),
				}),
				{ ...env, SENTRY_DSN: DSN } as typeof env,
				ctx,
			);
			await waitOnExecutionContext(ctx);

			const wire = JSON.stringify(sent);
			// Something did leave, and it names the request: the request id is
			// what joins a Crashlytics report to its Sentry event.
			expect(sent.length).toBeGreaterThan(0);
			expect(wire).toContain("sentry-data-collection probe");
			expect(wire).toContain(REQUEST_ID);
			expect(wire).toContain("/customers/{id}");
			// The digits, not the number: the path carries it as %2B…
			expect(wire).not.toContain(PHONE_DIGITS);
			expect(wire).not.toContain(IP);
			expect(wire).not.toContain("seller@example.test");
		});
	}

	it("both Workers switch off every category that can carry personal data", async () => {
		for (const { worker, url } of workers) {
			const ctx = createExecutionContext();
			await callWorker(worker, new Request(url), { ...env, SENTRY_DSN: DSN } as typeof env, ctx);
			await waitOnExecutionContext(ctx);
		}
		expect(optionsSeen).toHaveLength(2);
		for (const options of optionsSeen) {
			expect(options?.dsn).toBe(DSN);
			expect(options?.tracePropagationTargets).toEqual([]);
			expect(options?.traceLifecycle).toBe("stream");
			expect(options?.dataCollection).toMatchObject({
				userInfo: false,
				cookies: false,
				httpHeaders: { response: false },
				httpBodies: [],
				urlQueryParams: false,
				databaseQueryData: false,
				queues: false,
				stackFrameVariables: false,
				genAI: { inputs: false, outputs: false },
				graphQL: { document: false, variables: false },
			});
		}
	});

	it("sends nothing without SENTRY_DSN", async () => {
		const ctx = createExecutionContext();
		await callWorker(publicWorker, new Request(workers[0].url), { ...env, SENTRY_DSN: undefined } as unknown as typeof env, ctx);
		await waitOnExecutionContext(ctx);
		expect(optionsSeen).toHaveLength(1);
		expect(optionsSeen[0]?.dsn).toBeUndefined();
		expect(sent).toEqual([]);
	});
});

// The same cases as CrashReporterTest.kt in the app, which applies the same
// rule before a route reaches Crashlytics.
describe("redactPath", () => {
	it("keeps a static route", () => {
		expect(redactPath("/api/v1/config")).toBe("/api/v1/config");
		expect(redactPath("/api/v1/auth/phone-change/challenges")).toBe("/api/v1/auth/phone-change/challenges");
	});

	it("replaces a phone number, raw or escaped", () => {
		expect(redactPath("/api/v1/customers/+201012345678")).toBe("/api/v1/customers/{id}");
		expect(redactPath("/api/v1/customers/%2B201012345678")).toBe("/api/v1/customers/{id}");
	});

	it("replaces ids and codes but keeps the words around them", () => {
		expect(redactPath("/api/v1/orders/42/status")).toBe("/api/v1/orders/{id}/status");
		expect(redactPath("/api/v1/categories/c-A1B2C3")).toBe("/api/v1/categories/{id}");
	});

	it("drops the query string whole", () => {
		expect(redactPath("/api/v1/orders?since=2026-09-01&phone=%2B2010")).toBe("/api/v1/orders");
	});

	it("treats an unexpectedly long segment as an identifier", () => {
		expect(redactPath(`/api/v1/${"a".repeat(40)}`)).toBe("/api/v1/{id}");
	});

	it("handles a path with nothing in it", () => {
		expect(redactPath("")).toBe("/");
		expect(redactPath("/")).toBe("/");
	});

	it("truncates a pathologically deep path", () => {
		expect(redactPath(`/api/v1/${Array(20).fill("seg").join("/")}`)).toMatch(/\/…$/);
	});
});

describe("redactUrl", () => {
	it("redacts the path of a URL or a span name and keeps the rest", () => {
		expect(redactUrl("https://api.orderak.app/api/v1/customers/%2B2010?x=1")).toBe("https://api.orderak.app/api/v1/customers/{id}");
		expect(redactUrl("PATCH /api/v1/customers/%2B2010")).toBe("PATCH /api/v1/customers/{id}");
		expect(
			redactUrl("GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/app.orderak.seller/purchases/subscriptionsv2/tokens/abc.DEF-123"),
		).toBe("GET https://androidpublisher.googleapis.com/androidpublisher/{id}/applications/{id}/purchases/{id}/tokens/{id}");
	});

	it("leaves text that is not a path or a URL alone", () => {
		expect(redactUrl("GET")).toBe("GET");
		expect(redactUrl("SELECT id FROM stores WHERE id = ?")).toBe("SELECT id FROM stores WHERE id = ?");
		expect(redactUrl("Mozilla/5.0 (Linux; Android 15)")).toBe("Mozilla/5.0 (Linux; Android 15)");
		expect(redactUrl("okhttp/4.12.0")).toBe("okhttp/4.12.0");
	});
});
