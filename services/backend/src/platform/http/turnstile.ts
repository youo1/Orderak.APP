// ============================================================
// Turnstile verification for the one unauthenticated write path.
//
// Storefront order creation is reachable by anyone with a store's public URL.
// The only control was `checkRateLimit(env, \`order:${store.id}:${ip}\`, 5, 60)`
// — five per minute keyed on store *and* IP, so rotating the IP resets the
// bucket entirely. That is enough to spend a free plan's whole monthly order
// allowance in minutes: real buyers then get plan_limit_reached, and the seller
// sees orders stop with nothing telling them the quota was the cause.
//
// OFF BY DEFAULT, AND WHY THAT IS NOT A HEDGE
//   TURNSTILE_ENABLED is "false" in both environments, because turning this on
//   without a site key and secret would refuse every order on every storefront.
//   The flag is the difference between "not configured yet" and "configured and
//   failing", and those must not look the same on a page that takes money.
//
//   It fails CLOSED once enabled, though — an enabled Turnstile with a missing
//   secret refuses the order rather than waving it through. A bot control that
//   degrades to "allow" under misconfiguration is not a control.
// ============================================================

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The script host the widget loads from; needed in the storefront CSP. */
export const TURNSTILE_SCRIPT_ORIGIN = "https://challenges.cloudflare.com";

export type TurnstileOutcome =
	| { ok: true }
	| { ok: false; reason: "missing_token" | "misconfigured" | "rejected" };

/**
 * Read a Turnstile var off whichever Env shape the caller has.
 *
 * `Env` is deliberately the *intersection* of the two Workers' bindings, so a
 * var declared only in wrangler.jsonc is not on it — see the CommonBindings
 * comment in env.d.ts, which exists so the public Worker cannot type-check
 * against admin MFA key material. These vars are public-Worker-only and
 * createOrder() takes the shared `Env`, so this narrows the read rather than
 * widening the type for everyone. Same shape as rateLimiterNamespace() in
 * shared.ts, for the same reason.
 *
 * Absent reads as unset, which is the safe direction: the challenge stays off.
 */
function turnstileVar(env: Env, name: "TURNSTILE_ENABLED" | "TURNSTILE_SITE_KEY"): string {
	return String((env as unknown as Record<string, unknown>)[name] ?? "").trim();
}

/** Whether the storefront should render a widget and the server should verify. */
export function turnstileEnabled(env: Env): boolean {
	return turnstileVar(env, "TURNSTILE_ENABLED") === "true";
}

/** The public site key, or "" when unset. Safe to embed — it is not a secret. */
export function turnstileSiteKey(env: Env): string {
	return turnstileVar(env, "TURNSTILE_SITE_KEY");
}

/**
 * Verify a Turnstile token with Cloudflare.
 *
 * `remoteip` is passed when known: Cloudflare uses it to correlate the
 * challenge, and omitting it weakens the signal on exactly the traffic this
 * exists to catch.
 *
 * A siteverify call that throws — DNS, timeout, an outage — is a refusal, not a
 * pass. That is a deliberate availability trade: if Cloudflare's own challenge
 * endpoint is unreachable from a Cloudflare Worker, something is wrong enough
 * that accepting unverified orders is the worse option.
 */
export async function verifyTurnstile(
	env: Env,
	token: string,
	remoteIp: string | null,
): Promise<TurnstileOutcome> {
	if (!turnstileEnabled(env)) return { ok: true };

	const secret = String(env.TURNSTILE_SECRET ?? "").trim();
	if (!secret) {
		// Enabled without a secret is a deployment mistake, and it is loud on
		// purpose: silently accepting would leave the storefront unprotected while
		// every dashboard said the control was on.
		console.error(JSON.stringify({ signal: "turnstile_misconfigured", reason: "secret_unset" }));
		return { ok: false, reason: "misconfigured" };
	}
	if (!token) return { ok: false, reason: "missing_token" };

	try {
		const response = await fetch(SITEVERIFY_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				secret,
				response: token,
				...(remoteIp && remoteIp !== "noip" ? { remoteip: remoteIp } : {}),
			}),
		});
		const verdict = await response.json<{ success?: boolean; "error-codes"?: string[] }>();
		if (verdict.success === true) return { ok: true };
		// Codes, never the token: the token is a bearer value for this one
		// challenge and has no business in a log line.
		console.log(JSON.stringify({
			signal: "turnstile_rejected",
			codes: verdict["error-codes"] ?? [],
		}));
		return { ok: false, reason: "rejected" };
	} catch (error) {
		console.error(JSON.stringify({
			signal: "turnstile_unavailable",
			message: error instanceof Error ? error.message : "unknown",
		}));
		return { ok: false, reason: "misconfigured" };
	}
}
