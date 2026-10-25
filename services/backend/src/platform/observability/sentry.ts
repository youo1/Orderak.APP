import type { CloudflareOptions } from "@sentry/cloudflare";

/**
 * The Sentry options both Workers use.
 *
 * Sentry 11 collects request and response bodies, every request header,
 * cookies, URL query values and the caller's IP address unless it is told not
 * to. Here those carry seller and buyer phone numbers (the app sends one in
 * `x-orderak-phone`), email addresses and order contents, so every category
 * that can hold them is switched off. D1 query data and queue messages are off
 * too: Sentry 11.8.0's D1 and queue instrumentation records neither, but an
 * upgrade that starts to should not be what decides it.
 *
 * Request headers are allowed by name. Sentry matches a substring of the
 * header name and still replaces anything that looks like a credential.
 * `x-request-id` is what joins a Crashlytics report to the Sentry event for
 * the same request, and the app version headers say which build sent it.
 *
 * The path is not covered by any of this, and it can be personal data:
 * `/api/v1/customers/{customer_key}` addresses a buyer by phone number, and
 * the Google Play calls put a purchase token in theirs. `beforeSend` and
 * `beforeSendSpan` reduce every path to its route shape first.
 *
 * test/sentry-data-collection.spec.ts sends a request carrying a phone number
 * in its path, its headers and its body through each Worker, and fails if the
 * number reaches Sentry.
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
export function sentryOptions(env: { SENTRY_DSN?: string }): CloudflareOptions {
	return {
		dsn: env.SENTRY_DSN,
		tracesSampleRate: 0.1,
		dataCollection: SENTRY_DATA_COLLECTION,
		// Without this, every outgoing call (Google, DeepSeek, Turnstile) carries
		// Sentry's trace headers, which name this project to someone else.
		tracePropagationTargets: [],
		beforeSend(event) {
			if (event.request?.url) event.request.url = redactUrl(event.request.url);
			if (event.transaction) event.transaction = redactUrl(event.transaction);
			for (const breadcrumb of event.breadcrumbs ?? []) {
				if (typeof breadcrumb.data?.url === "string") breadcrumb.data.url = redactUrl(breadcrumb.data.url);
			}
			return event;
		},
		beforeSendSpan(span) {
			span.name = redactUrl(span.name);
			const attributes = span.attributes as Record<string, unknown>;
			for (const [key, value] of Object.entries(attributes)) {
				if (typeof value === "string") {
					attributes[key] = redactUrl(value);
				} else if (value && typeof value === "object" && typeof (value as { value?: unknown }).value === "string") {
					(value as { value: string }).value = redactUrl((value as { value: string }).value);
				}
			}
			return span;
		},
	};
}

const FIXED_PREFIX = new Set(["api", "admin", "integrations", "v1", "v2"]);
const MAX_REPORTED_SEGMENTS = 8;

/**
 * Reduce a path to a route shape: `/api/v1/customers/%2B2010…` becomes
 * `/api/v1/customers/{id}`.
 *
 * The same rule as `redactRoute()` in the app's CrashReporter.kt, so the two
 * tools name a route the same way. It is deny-by-default: after the fixed
 * prefix, a segment survives only if it is a short lower-case route word.
 * Anything with a digit, a dot, an escape or a plus becomes `{id}`. The query
 * string is dropped whole.
 */
export function redactPath(path: string): string {
	const segments = path.split(/[?#]/, 1)[0].split("/").filter((segment) => segment !== "");
	if (segments.length === 0) return "/";

	let out = "";
	let pastPrefix = false;
	for (const segment of segments.slice(0, MAX_REPORTED_SEGMENTS)) {
		if (!pastPrefix && FIXED_PREFIX.has(segment)) {
			out += `/${segment}`;
			continue;
		}
		pastPrefix = true;
		out += /^[a-z_-]{1,24}$/.test(segment) ? `/${segment}` : "/{id}";
	}
	return segments.length > MAX_REPORTED_SEGMENTS ? `${out}/…` : out;
}

/**
 * Apply redactPath() to a path, a URL, or a span name such as
 * `GET /api/v1/orders/123` or `POST https://host/path`. Anything else is
 * returned unchanged.
 */
export function redactUrl(text: string): string {
	const space = text.indexOf(" ");
	const method = space > 0 ? text.slice(0, space + 1) : "";
	const rest = space > 0 ? text.slice(space + 1) : text;
	if (rest.startsWith("/")) return method + redactPath(rest);
	if (!/^https?:\/\//.test(rest)) return text;
	try {
		const url = new URL(rest);
		return method + url.origin + redactPath(url.pathname);
	} catch {
		return text;
	}
}
