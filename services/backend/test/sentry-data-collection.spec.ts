import type * as RealSentry from "@sentry/cloudflare";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import adminWorker from "../src/entrypoints/admin-worker";
import publicWorker from "../src/entrypoints/public-worker";
import { callWorker, env } from "./helpers";

/**
 * What the Workers send to Sentry.
 *
 * Sentry 11 collects request bodies, every request header, D1 query
 * parameters, queue messages and the caller's IP address unless it is told
 * not to. Here those carry seller and buyer phone numbers (the app sends one
 * in `x-orderak-phone`), email addresses and order contents.
 *
 * The test keeps each Worker's own Sentry options and replaces only the
 * transport, so what it captures is what would have left for Sentry. It also
 * records an error inside each request, because the request body reaches
 * error events rather than spans.
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
					// A transport would send even without a DSN, so the no-DSN
					// case keeps the Worker's own options untouched.
					return options?.dsn ? { ...options, tracesSampleRate: 1, transport } : options;
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

const PHONE = "+201000000777";
const IP = "203.0.113.77";
const REQUEST_ID = "req-sentry-data-collection";
const DSN = "https://public@sentry.example.test/1";

const workers = [
	{ name: "public", worker: publicWorker, url: "https://api.orderak.app/api/v1/account/profile" },
	{ name: "admin", worker: adminWorker, url: "https://admin.orderak.app/api/admin/session" },
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
					method: "POST",
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
			expect(wire).toContain(REQUEST_ID);
			expect(wire).not.toContain(PHONE);
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
			expect(options?.dataCollection).toMatchObject({
				userInfo: false,
				cookies: false,
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

	it("is a no-op without SENTRY_DSN", async () => {
		const ctx = createExecutionContext();
		await callWorker(publicWorker, new Request(workers[0].url), { ...env, SENTRY_DSN: undefined } as unknown as typeof env, ctx);
		await waitOnExecutionContext(ctx);
		expect(optionsSeen).toEqual([{}]);
	});
});
