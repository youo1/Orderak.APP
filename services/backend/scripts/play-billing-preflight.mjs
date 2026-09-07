#!/usr/bin/env node
// ============================================================
// Is this environment actually ready to have billing turned on?
//
//   node services/backend/scripts/play-billing-preflight.mjs --local
//   node services/backend/scripts/play-billing-preflight.mjs --remote --env staging
//
// READ-ONLY. It changes nothing, sets no flag and activates no mapping. Run it
// before touching BILLING_ENABLED, and again after, and once more after the
// first real purchase.
//
// WHY THIS EXISTS
//   Opening billing is two flag flips, and both are one-line changes that look
//   trivial. What is behind them is not: five Play credentials read at runtime,
//   six product mappings that must match products created by hand in the Play
//   Console, a queue binding, a D1 runtime control that can independently veto
//   the environment flag, and a token encryption key that must be exactly 32
//   bytes of base64.
//
//   None of those are declared in wrangler's `secrets.required`, and they
//   cannot be: requiring them would fail every staging deploy today, for an
//   environment that does not call Google. So nothing proves they are set. The
//   failure that produces is quiet — googleContext() throws
//   `google_play_credentials_missing` inside a queue consumer, the verification
//   job retries, and eventually dead-letters. The seller has paid and has no
//   plan, and the first anyone knows is a dead-letter alert.
//
//   A preflight that says "these four things are missing" before the flag moves
//   is worth more than any amount of care taken while moving it.
//
// WHAT IT CANNOT CHECK
//   Whether the products exist in the Play Console, whether their prices are
//   set, and whether the service account has been granted access to them. Those
//   need a live Android Publisher call with real credentials. This script tells
//   you whether you have the credentials to make that call; the test matrix in
//   docs/runbooks/play-billing-rollout.md is what proves the call works.
// ============================================================

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJsonc } from "../../../tooling/lib/jsonc.mjs";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const remote = args.includes("--remote");
const envIndex = args.indexOf("--env");
const environment = envIndex >= 0 ? args[envIndex + 1] : null;

const SAFE = /^[A-Za-z0-9_.-]+$/;
if (environment !== null && !SAFE.test(environment)) {
	console.error(`Refusing an environment name that is not a plain identifier: ${environment}`);
	process.exit(2);
}

/** Every credential google-play.ts reads at runtime, and what breaks without it. */
const REQUIRED_SECRETS = [
	["GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL", "no purchase can be verified — googleContext() throws google_play_credentials_missing"],
	["GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY", "same: the JWT for Android Publisher cannot be signed"],
	["GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY", "purchase tokens cannot be stored — must be exactly 32 bytes, base64"],
	["GOOGLE_PLAY_PUBSUB_AUDIENCE", "RTDN messages fail OIDC verification and are refused"],
	["GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL", "same: the Pub/Sub push identity cannot be checked"],
];

/**
 * Quote one argument for the shell wrangler is invoked through.
 *
 * Windows needs `shell: true`, because npx is a .cmd and Node 20+ refuses to
 * execFile one directly (it returns EINVAL — the fix for CVE-2024-27980). With a
 * shell in the way, every argument is re-parsed by cmd.exe, and SQL is full of
 * characters it treats as syntax: `<` and `>` are redirection, `(` and `)` are
 * grouping, `&` is a separator. An unquoted `HAVING unexplained <> 0` becomes a
 * redirect to a file called `0`, and wrangler is left with no --command at all.
 *
 * cmd.exe unescapes a doubled quote inside a quoted string, so that is the whole
 * escape. On POSIX no shell is used and the argument passes through untouched.
 */
function shellArgument(value) {
	if (process.platform !== "win32") return value;
	return `"${String(value).replace(/"/g, '""')}"`;
}

function wrangler(command) {
	return execFileSync("npx", ["wrangler", ...command].map(shellArgument), {
		cwd: backendRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		shell: process.platform === "win32",
	});
}

function d1(sql) {
	const argv = ["d1", "execute", "orderak-db", remote ? "--remote" : "--local", "--json", "--command", sql];
	if (environment) argv.push("--env", environment);
	const out = wrangler(argv);
	const parsed = JSON.parse(out.slice(out.indexOf("[")));
	return parsed[0]?.results ?? [];
}

function secretNames() {
	try {
		const argv = ["secret", "list", "--format", "json"];
		if (environment) argv.push("--env", environment);
		const out = wrangler(argv);
		return new Set(JSON.parse(out.slice(out.indexOf("["))).map((entry) => entry.name));
	} catch {
		return null;
	}
}

/**
 * This environment's Play package, read from the same file the Worker deploys
 * with.
 *
 * Parsed rather than assumed, because it is the value that decides which of the
 * two mapping sets the lookup can see. Reading it from wrangler.jsonc means the
 * preflight is checking the configuration that ships, not a copy of it.
 *
 * loadJsonc is the repository's one JSONC reader — verify-deployment-map grew a
 * stripper, and a second copy here would agree with it only until one was fixed.
 */
function expectedPackage() {
	try {
		const config = loadJsonc(path.join(backendRoot, "wrangler.jsonc"));
		const scope = environment ? config.env?.[environment] : config;
		return scope?.vars?.GOOGLE_PLAY_PACKAGE_NAME ?? config.vars?.GOOGLE_PLAY_PACKAGE_NAME ?? null;
	} catch {
		return null;
	}
}

const blockers = [];
const warnings = [];
const notes = [];

/* ---------- 1. secrets ---------- */
if (remote) {
	const present = secretNames();
	if (present === null) {
		warnings.push("could not list secrets (wrangler not authenticated?) — check the five Play credentials by hand");
	} else {
		for (const [name, consequence] of REQUIRED_SECRETS) {
			if (!present.has(name)) blockers.push(`secret ${name} is not set — ${consequence}`);
		}
	}
} else {
	notes.push("secrets are not checked against a local database; re-run with --remote --env staging before flipping anything");
}

/* ---------- 2. product mappings ---------- */
// null means "could not read", which is a different fact from "there are none"
// and must not be reported as one.
let mappings = null;
try {
	mappings = d1(
		"SELECT m.id, m.product_id, m.base_plan_id, m.package_name, m.active, p.plan_key " +
		"FROM play_product_mappings m LEFT JOIN subscription_plans p ON p.id = m.plan_id " +
		"ORDER BY p.sort_order, m.base_plan_id",
	);
} catch (error) {
	blockers.push(`could not read play_product_mappings: ${error.message.split("\n")[0]}`);
}

if (mappings === null) {
	// already reported above
} else if (mappings.length === 0) {
	blockers.push("play_product_mappings is empty — migration 024 seeds six rows; this database has none");
} else {
	const orphaned = mappings.filter((row) => row.plan_key == null);
	if (orphaned.length) {
		blockers.push(
			`${orphaned.length} mapping(s) point at a plan that does not exist: ` +
			orphaned.map((row) => `${row.product_id}/${row.base_plan_id}`).join(", "),
		);
	}
	// Two packages is the expected shape, not a problem: staging has its own
	// Play Console entry, so migration 054 carries a mapping set for each.
	// GOOGLE_PLAY_PACKAGE_NAME is what selects between them, and a mapping set
	// that does not match it is invisible to the lookup — a purchase would fail
	// with play_product_not_enabled and the mappings would look fine in a table.
	const expected = expectedPackage();
	const byPackage = new Map();
	for (const row of mappings) {
		const name = String(row.package_name);
		byPackage.set(name, (byPackage.get(name) ?? 0) + 1);
	}
	notes.push(`mapping sets: ${[...byPackage].map(([name, n]) => `${name} (${n})`).join(", ")}`);

	if (expected === null) {
		warnings.push("could not read GOOGLE_PLAY_PACKAGE_NAME from wrangler.jsonc — confirm by hand that a mapping set matches this environment's package");
	} else if (!byPackage.has(expected)) {
		blockers.push(
			`no mapping carries package ${expected}, which is this environment's GOOGLE_PLAY_PACKAGE_NAME — ` +
			"every purchase would fail with play_product_not_enabled",
		);
	} else {
		const matching = mappings.filter((row) => String(row.package_name) === expected);
		const matchingActive = matching.filter((row) => Number(row.active) === 1).length;
		notes.push(`this environment resolves against ${expected}: ${matching.length} mappings, ${matchingActive} active`);
		if (matchingActive === 0) {
			notes.push("none of them active yet — activate one product first, after confirming it exists in that Play Console entry");
		}
	}
}

/* ---------- 3. the runtime control that can veto the flag ---------- */
// BILLING_ENABLED is necessary and not sufficient: handleBillingRoutes requires
// the environment flag AND a runtime control read from the `settings` table.
//
// The comparison there is `JSON.parse(value_json) === true`, which is stricter
// than it looks: the JSON string "true" is not the boolean true, so a row set to
// `"true"` reads as DISABLED. That is a flag flip that appears to do nothing,
// with no error anywhere, so it is worth checking the exact stored bytes rather
// than whether the word appears.
try {
	const control = d1("SELECT value_json FROM settings WHERE key = 'billing_enabled'");
	if (control.length === 0) {
		notes.push("settings.billing_enabled is absent — the code falls back to enabled, so BILLING_ENABLED alone will govern");
	} else {
		const raw = String(control[0].value_json ?? "");
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch {
			parsed = undefined;
		}
		if (parsed === true) {
			notes.push("settings.billing_enabled is the boolean true");
		} else {
			blockers.push(
				`settings.billing_enabled is ${JSON.stringify(raw)}, and the code requires the boolean true — ` +
				"setting BILLING_ENABLED=true will appear to do nothing",
			);
		}
	}
} catch {
	notes.push("settings not readable here — check the billing_enabled control in the admin console");
}

/* ---------- 4. plan catalogue ---------- */
try {
	const plans = d1("SELECT COUNT(*) AS n FROM subscription_plans WHERE active = 1");
	const published = d1(
		"SELECT COUNT(*) AS n FROM subscription_plans p " +
		"JOIN plan_revisions r ON r.id = p.current_revision_id AND r.status = 'published' WHERE p.active = 1",
	);
	const total = Number(plans[0]?.n ?? 0);
	const withRevision = Number(published[0]?.n ?? 0);
	if (total === 0) {
		blockers.push("no active subscription_plans — a purchase would map to no plan");
	} else if (withRevision < total) {
		blockers.push(`${total - withRevision} active plan(s) have no published revision — the plan comparison will omit them and a purchase cannot resolve entitlements`);
	} else {
		notes.push(`${total} active plans, each with a published revision`);
	}
} catch (error) {
	blockers.push(`could not read the plan catalogue: ${error.message.split("\n")[0]}`);
}

/* ---------- 5. dead-letter backlog ---------- */
// Opening billing on top of an existing backlog means the first real failure is
// indistinguishable from the ones already there.
try {
	const dead = d1("SELECT COUNT(*) AS n FROM play_verification_jobs WHERE status = 'dead_lettered'");
	const n = Number(dead[0]?.n ?? 0);
	if (n > 0) warnings.push(`${n} verification job(s) already dead-lettered — clear or triage them first, or the first real failure hides among them`);
	else notes.push("no dead-lettered verification jobs");
} catch {
	notes.push("play_verification_jobs not readable here");
}

/* ---------- report ---------- */
const scope = remote ? `remote${environment ? ` (${environment})` : ""}` : "local";
console.log(`Play billing preflight — ${scope}\n`);

for (const note of notes) console.log(`  ok       ${note}`);
for (const warning of warnings) console.log(`  warn     ${warning}`);
for (const blocker of blockers) console.log(`  BLOCKER  ${blocker}`);

console.log("");
if (blockers.length) {
	console.error(`${blockers.length} blocker(s). Do not enable billing in this environment yet.`);
	process.exit(1);
}
console.log(
	warnings.length
		? `No blockers, ${warnings.length} warning(s). Read them before enabling billing.`
		: "No blockers. The environment can carry billing; the test matrix decides whether it should.",
);
