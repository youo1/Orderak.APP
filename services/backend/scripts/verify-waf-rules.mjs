#!/usr/bin/env node
// ============================================================
// Assert that the WAF rate-limiting rules the application depends on exist.
//
// WHY THIS IS NOT OPTIONAL DEFENCE IN DEPTH
//   Two controls in the codebase explicitly document a WAF rule as the other
//   half of their design, and neither works properly without it:
//
//   * shared.ts's auth-failure throttle. Its own comment says "pair with a
//     per-IP Cloudflare WAF rate rule for defense in depth". It is keyed on the
//     phone number alone, and store phone numbers are published on the seller's
//     own storefront — so roughly twenty junk requests lock a known seller out
//     of their account for the rest of a 300-second window, renewably. The
//     per-IP rule is what makes reaching twenty cost an attacker something.
//
//   * catalog.ts's storefront order limit, five per minute keyed on store *and*
//     IP. Rotating the IP resets it entirely.
//
//   A control that exists only in a dashboard is one console session away from
//   not existing, and nothing would report it. That is the same reasoning the
//   `secrets.required` blocks already apply to Worker secrets.
//
// THE STATES THIS DISTINGUISHES, WHICH IS THE POINT
//   A check that fails identically for "the rule is gone" and "I could not look"
//   trains everyone to ignore it. Each exit below names exactly one condition:
//
//     not configured   CLOUDFLARE_ZONE_ID unset — nothing has been set up yet
//     no permission    403/9109 — the token lacks Zone > WAF > Read
//     MISSING          the API answered and the rule is not there
//     ok               the rule is present and enabled
//
// Usage:
//   node scripts/verify-waf-rules.mjs
//
// Requires CLOUDFLARE_ZONE_ID and a CLOUDFLARE_API_TOKEN carrying
// Zone > WAF > Read for that zone. See docs/runbooks/waf-rate-rules.md.
// ============================================================

const API = "https://api.cloudflare.com/client/v4";

/**
 * The rules that must exist, matched on a stable substring of the rule's
 * description rather than on its id — an id changes when a rule is recreated in
 * the dashboard, and this should survive that without a code change.
 */
const REQUIRED_RULES = [
	{
		match: "waf-auth-per-ip",
		purpose: "Per-IP rate limit on /api/v1/* — the other half of the auth-failure "
			+ "throttle in shared.ts, which is keyed on the phone number alone and can "
			+ "otherwise be used to lock a seller out of their own account.",
	},
	{
		match: "waf-order-per-ip",
		purpose: "Per-IP rate limit on storefront order creation — the application limit "
			+ "is keyed on store and IP together, so it resets when the IP rotates.",
	},
];

const zoneId = process.env.CLOUDFLARE_ZONE_ID?.trim();
const token = process.env.CLOUDFLARE_API_TOKEN?.trim();

function fail(message) {
	console.error(`ERROR: ${message}`);
	process.exitCode = 1;
}

if (!zoneId || !token) {
	fail(
		"CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN is not set, so the WAF rules were not checked.\n"
		+ "  This is 'not configured', not 'the rules are missing' — the two are different and this\n"
		+ "  check refuses to report one as the other. See docs/runbooks/waf-rate-rules.md for the\n"
		+ "  zone id and the token scope (Zone > WAF > Read).",
	);
	process.exit(1);
}

/** Every rule across the zone's http_ratelimit phase entrypoint. */
async function rateLimitRules() {
	const response = await fetch(`${API}/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`, {
		headers: { authorization: `Bearer ${token}` },
	});
	const body = await response.json().catch(() => ({}));

	const codes = new Set((body?.errors ?? []).map((error) => error.code));

	if (response.status === 401 || response.status === 403 || codes.has(9109) || codes.has(10000)) {
		throw new Error(
			"the API token is not permitted to read this zone's WAF rules (needs Zone > WAF > Read).\n"
			+ "  This is a permissions problem, not a missing rule.",
		);
	}
	// 404 means two different things here, and collapsing them is exactly the
	// conflation this script exists to avoid:
	//
	//   7003 — Cloudflare could not route the request at all, so the zone id is
	//          wrong or the token cannot see that zone. Nothing was checked.
	//   otherwise — the zone is fine and simply has no rate-limiting entrypoint
	//          ruleset yet, which is a genuine "no rules configured".
	//
	// Testing this against a made-up zone id is what surfaced it: the script
	// happily reported both required rules as missing when it had never reached
	// the zone.
	if (response.status === 404 && codes.has(7003)) {
		throw new Error(
			`the Cloudflare API could not route to zone "${zoneId}" — the zone id is wrong, or the\n`
			+ "  token cannot see that zone. Nothing about the WAF rules was determined.",
		);
	}
	if (response.status === 404) return [];
	if (!response.ok) {
		throw new Error(`the Cloudflare API answered ${response.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
	}
	return body?.result?.rules ?? [];
}

try {
	const rules = await rateLimitRules();
	const describe = (rule) => `${rule.description ?? ""} ${rule.ref ?? ""}`.toLowerCase();

	for (const required of REQUIRED_RULES) {
		const found = rules.find((rule) => describe(rule).includes(required.match));
		if (!found) {
			fail(
				`the rate-limiting rule "${required.match}" does not exist in this zone.\n`
				+ `  ${required.purpose}\n`
				+ "  Create it in the dashboard (Security > WAF > Rate limiting rules) and give its\n"
				+ `  description or ref the text "${required.match}" so this check can find it again.\n`
				+ "  See docs/runbooks/waf-rate-rules.md.",
			);
		} else if (found.enabled === false) {
			// Present but switched off is the worse state: an inventory says it is
			// there and nothing is enforcing it.
			fail(`the rate-limiting rule "${required.match}" exists but is DISABLED.`);
		} else {
			console.log(`OK: ${required.match} — ${found.description ?? found.ref}`);
		}
	}
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}

if (process.exitCode) {
	console.error("\nWAF rate-rule verification failed.");
} else {
	console.log(`WAF rate rules verified (${REQUIRED_RULES.length} required).`);
}
