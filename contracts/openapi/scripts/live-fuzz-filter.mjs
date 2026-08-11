#!/usr/bin/env node
/**
 * Emits the --include-operation-id-regex for the nightly LIVE staging contract run,
 * built from contracts/openapi/live-fuzz-allowlist.json.
 *
 * Why an allowlist exists at all
 * -----------------------------
 * The nightly job runs schemathesis against https://api.staging.orderak.app with
 * `--phases examples,coverage,fuzzing,stateful --checks all`. The seller contract has
 * 68 operations, 37 of them mutating, including:
 *
 *   POST   /api/v1/account/deletion-request          - deletes the account
 *   POST   /api/v1/account/email/verification/resend - sends real email
 *   POST   /api/v1/auth/logout                       - destroys the session mid-run
 *   DELETE /api/v1/auth/passkeys/{id}                - deletes credentials
 *   DELETE /api/v1/categories/{category_code}        - deletes catalog data
 *   POST   /api/v1/billing/google/verify             - calls Google Play
 *   POST   /api/v1/chat                              - calls DeepSeek, costs money
 *   POST   /api/v1/media/upload                      - writes objects to R2
 *
 * Run unfiltered, a nightly fuzz can delete the test account and its catalog, send mail
 * to a real inbox, and bill us for AI calls. A synthetic seller does not prevent any of
 * that - it only decides whose data is destroyed.
 *
 * So live staging gets an opt-in allowlist of read-only operations. Full-spec coverage,
 * mutating operations included, belongs against the Prism mock where side effects have
 * nowhere to go (see openapi-ci.yml).
 *
 * What this script enforces
 * -------------------------
 * 1. Every allowlisted operationId still exists in the spec. A renamed or removed
 *    operation fails the build rather than silently shrinking coverage - a filter that
 *    quietly matches nothing is the same class of bug as a contract guard that skips.
 * 2. Only GET operations may be allowlisted. If a future edit adds a mutating operation
 *    to the list, this refuses, so the policy cannot be weakened by editing data alone.
 * 3. Redirect-only operations are rejected. Schemathesis follows their Location and
 *    validates the target response against the redirect operation, which is not a
 *    meaningful contract assertion.
 * 4. Operations absent from the allowlist are reported to stderr, so the untested
 *    surface stays visible instead of being forgotten.
 *
 * Usage: node contracts/openapi/scripts/live-fuzz-filter.mjs [path-to-spec] [shard] [total]
 * Prints the anchored regex on stdout; diagnostics go to stderr.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const openapiDir = dirname(dirname(fileURLToPath(import.meta.url)));
const specPath = process.argv[2] ? resolve(process.argv[2]) : join(openapiDir, "src", "seller-v1.json");
const specLabel = process.argv[2] ?? "contracts/openapi/src/seller-v1.json";
const rawShard = process.argv[3];
const rawTotal = process.argv[4];
const shard = rawShard === undefined ? null : Number(rawShard);
const total = rawTotal === undefined ? null : Number(rawTotal);
const allowlistPath = join(openapiDir, "live-fuzz-allowlist.json");

if ((shard === null) !== (total === null)) {
	throw new Error("Shard and total must be provided together.");
}
if (
	shard !== null
	&& (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 0 || total < 1 || shard >= total)
) {
	throw new Error("Shard and total must identify a valid zero-based shard.");
}

const spec = JSON.parse(readFileSync(specPath, "utf8"));
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/** operationId -> method, for every operation in the spec. */
const operations = new Map();
for (const [path, item] of Object.entries(spec.paths ?? {})) {
	for (const [method, operation] of Object.entries(item)) {
		if (!METHODS.has(method.toLowerCase())) continue;
		const id = operation?.operationId;
		if (id) operations.set(id, { method: method.toUpperCase(), path, responses: operation.responses ?? {} });
	}
}

const allow = allowlist.allow ?? [];
if (allow.length === 0) {
	console.error("live-fuzz allowlist is empty - refusing to emit a filter that matches nothing.");
	process.exit(1);
}

const missing = allow.filter((id) => !operations.has(id));
const mutating = allow.filter((id) => operations.get(id)?.method && operations.get(id).method !== "GET");
const redirectOnly = allow.filter((id) => {
	const codes = Object.keys(operations.get(id)?.responses ?? {});
	return codes.some((code) => /^3\d\d$/.test(code)) && !codes.some((code) => /^2\d\d$/.test(code));
});

if (missing.length > 0) {
	console.error(`Allowlisted operations no longer in ${specLabel}:`);
	for (const id of missing) console.error(`  ${id}`);
	console.error("Remove them from the allowlist, or restore the operationId.");
}
if (mutating.length > 0) {
	console.error("Allowlist contains non-GET operations, which policy forbids for live staging:");
	for (const id of mutating) console.error(`  ${operations.get(id).method} ${id} (${operations.get(id).path})`);
	console.error("Mutating operations belong against the Prism mock, not live staging.");
}
if (redirectOnly.length > 0) {
	console.error("Allowlist contains redirect-only operations, which cannot be validated meaningfully against live staging:");
	for (const id of redirectOnly) console.error(`  ${operations.get(id).method} ${id} (${operations.get(id).path})`);
	console.error("Test the redirect locally and allowlist its final target operation instead.");
}
if (missing.length > 0 || mutating.length > 0 || redirectOnly.length > 0) process.exit(1);

const notCovered = [...operations.keys()].filter((id) => !allow.includes(id)).sort();
console.error(
	`live-fuzz allowlist: ${allow.length} of ${operations.size} operations run against live staging.`,
);
if (notCovered.length > 0) {
	console.error(`${notCovered.length} operations are deliberately not fuzzed live:`);
	for (const id of notCovered) {
		const { method, path } = operations.get(id);
		console.error(`  ${method.padEnd(6)} ${path}`);
	}
}

// Anchored, with regex metacharacters escaped. operationIds are snake_case today, but
// escaping keeps this correct if that ever changes.
const selected = shard === null
	? allow
	: [...allow].sort().filter((_, index) => index % total === shard);
if (selected.length === 0) {
	console.error(`Live-fuzz shard ${shard}/${total} is empty - reduce the shard count.`);
	process.exit(1);
}
if (shard !== null) {
	console.error(`live-fuzz shard ${shard + 1}/${total}: ${selected.length} allowlisted operations.`);
}
const escaped = selected.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
process.stdout.write(`^(${escaped.join("|")})$`);
