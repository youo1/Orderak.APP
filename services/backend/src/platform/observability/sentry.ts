import type { CloudflareOptions } from "@sentry/cloudflare";

/**
 * The Sentry options both Workers use.
 *
 * Sentry 11 collects request and response bodies, every request header, D1
 * query parameters, queue messages and the caller's IP address unless it is
 * told not to. Here those carry seller and buyer phone numbers (the app sends
 * one in `x-orderak-phone`), email addresses and order contents, so every
 * category that can hold them is switched off.
 *
 * Headers are the one exception, by name: `x-request-id` is what joins a
 * Crashlytics report to the Sentry event for the same request, and the app
 * version headers say which build sent it. Sentry still replaces anything
 * that looks like a credential, even when it is allowed here.
 *
 * test/sentry-data-collection.spec.ts sends a request carrying a phone number
 * and an IP address through each Worker and fails if either reaches Sentry.
 */
export const SENTRY_DATA_COLLECTION: NonNullable<CloudflareOptions["dataCollection"]> = {
	userInfo: false,
	cookies: false,
	httpHeaders: {
		request: {
			allow: [
				"x-request-id",
				"x-orderak-app-version",
				"x-orderak-version-code",
				"x-orderak-platform",
				"user-agent",
				"content-type",
				"content-length",
			],
		},
		response: false,
	},
	httpBodies: [],
	urlQueryParams: false,
	graphQL: { document: false, variables: false },
	genAI: { inputs: false, outputs: false },
	databaseQueryData: false,
	queues: false,
	stackFrameVariables: false,
};

// SENTRY_DSN is a Wrangler secret — set via `npx wrangler secret put SENTRY_DSN`.
// When missing, Sentry is a no-op.
export function sentryOptions(env: unknown): CloudflareOptions {
	const dsn = (env as { SENTRY_DSN?: unknown }).SENTRY_DSN;
	return typeof dsn === "string" && dsn ? { dsn, tracesSampleRate: 0.1, dataCollection: SENTRY_DATA_COLLECTION } : {};
}
