#!/usr/bin/env node
// ============================================================
// Compare the Android client's response DTOs against the OpenAPI schemas that
// describe the same payloads.
//
// WHY THIS EXISTS
//   The 2026-09-11 audit found that `governance` — the block deciding whether
//   the app may sell, whether adverts render, and whether it force-updates —
//   was absent from the contract on both routes that carry it, and that the
//   whole `config` block piggybacked onto the orders pull was undocumented.
//   Separately, ConfigRes was missing `current_period_end` and
//   `subscription_status`, which the server had always sent and the contract had
//   always documented, so the app's subscription-expiry gate could fail open.
//
//   Three defects, one cause: no check in this repository ever compared a Kotlin
//   DTO to an OpenAPI schema. The CI job named `prism-android-contract` starts
//   no Prism and compares no schema — it runs the mock-flavour unit tests and a
//   string grep over four Kotlin files, which proves symbols exist and nothing
//   about payloads.
//
// WHAT IT CHECKS, IN BOTH DIRECTIONS
//   * A property the contract marks REQUIRED must exist on the DTO, or the
//     client cannot read something the server guarantees. (Missed
//     current_period_end.)
//   * A field the DTO declares must exist in the schema, or the client depends
//     on something the contract does not describe — which is how a server change
//     silently breaks an installed app while every contract gate stays green.
//     (Missed governance.)
//
//   Both directions matter and they fail for opposite reasons, so neither is
//   optional.
//
// WHY SOURCE PARSING RATHER THAN CODEGEN
//   Generating Kotlin from the schema would be stronger and is a larger change:
//   these DTOs are hand-written, carry documentation that earns its place, and
//   several have client-only conveniences that no schema should dictate. This
//   catches the drift that actually happened without asking the team to give up
//   the file.
//
// Usage: node tooling/repository/verify-dto-schema-parity.mjs
// ============================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const SPEC = JSON.parse(
	readFileSync(join(REPO, "contracts", "openapi", "dist", "seller-v1.json"), "utf8"),
);
const ANDROID = join(REPO, "apps", "seller-android", "app", "src", "main", "java", "app", "orderak", "seller");

const SOURCES = [
	join(ANDROID, "data", "remote", "BackendApi.kt"),
	join(ANDROID, "data", "remote", "BackendConfig.kt"),
].map((path) => readFileSync(path, "utf8")).join("\n");

/**
 * Field names of a Kotlin data class, by name.
 *
 * Reads the parameter list between the class's opening and closing parenthesis,
 * then takes each `val <name>:`. Default values, generics and trailing lambdas
 * are all ignored because only the names are being compared.
 */
function kotlinFields(className) {
	const start = SOURCES.indexOf(`data class ${className}(`);
	if (start === -1) throw new Error(`data class ${className} not found`);
	let depth = 0;
	let index = SOURCES.indexOf("(", start);
	const open = index;
	for (; index < SOURCES.length; index++) {
		if (SOURCES[index] === "(") depth += 1;
		else if (SOURCES[index] === ")") {
			depth -= 1;
			if (depth === 0) break;
		}
	}
	const body = SOURCES.slice(open + 1, index);
	const fields = new Set();
	for (const match of body.matchAll(/\bval\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
		fields.add(match[1]);
	}
	// `@SerialName("x") val y` puts `x` on the wire, not `y`.
	for (const match of body.matchAll(/@SerialName\("([^"]+)"\)\s*val\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
		fields.delete(match[2]);
		fields.add(match[1]);
	}
	return fields;
}

function schemaAt(path) {
	return path.reduce((node, key) => {
		if (node === undefined || node === null) {
			throw new Error(`Missing spec path: ${path.join(" -> ")}`);
		}
		return node[key];
	}, SPEC);
}

/**
 * The pairings, and what each is allowed to differ by.
 *
 * `clientOnly` names fields the DTO carries that the wire does not — a decoded
 * convenience, or a value the client synthesises. Every entry is a deliberate
 * exception, which is the point of listing them rather than loosening the check.
 */
const PAIRS = [
	{
		dto: "EntitlementSnapshotRes",
		pointer: ["components", "schemas", "EntitlementSnapshot"],
		clientOnly: [
			// Present on every DTO: the problem+json `code`, mapped to `error`.
			// Error bodies are a different schema from success bodies.
			"code",
			// Sent only by the legacy projection, which shares this DTO.
			"plan_id",
		],
	},
	{
		dto: "ConfigRes",
		pointer: ["components", "schemas", "ClientConfig"],
		clientOnly: ["code"],
	},
	{
		dto: "BackendConfig",
		pointer: ["components", "schemas", "ClientConfig"],
		// BackendConfig is the merged client model: it holds everything
		// ClientConfig has plus the snapshot fields, because one object feeds
		// every gate whichever endpoint filled it.
		clientOnly: [
			"code", "schema_version", "organization_id", "plan_revision_id",
			"plan_version", "pending_revision_id", "pending_effective_at",
			"server_time", "etag",
		],
		// BackendConfig is never decoded straight off the wire — it is built from
		// either response by toBackendConfig() or the orders fallback — so the
		// envelope's success marker has no meaning on it.
		ignoreRequired: ["ok"],
	},
	{
		dto: "GovernanceConfig",
		pointer: ["components", "schemas", "Governance"],
		clientOnly: [],
	},
	{
		dto: "AppVersionPolicy",
		pointer: ["components", "schemas", "AppVersionPolicy"],
		clientOnly: [],
	},
	{
		dto: "GovernedFeature",
		pointer: ["components", "schemas", "GovernedFeature"],
		clientOnly: [],
	},
	{
		dto: "ConfigLimits",
		pointer: ["components", "schemas", "PlanLimits"],
		clientOnly: [],
	},
	{
		dto: "ConfigFeatures",
		pointer: ["components", "schemas", "PlanFeatures"],
		clientOnly: [],
	},
	{
		dto: "EntitlementDto",
		pointer: ["components", "schemas", "Entitlement"],
		clientOnly: [],
	},
	{
		dto: "OrdersRes",
		pointer: ["paths", "/api/v1/orders", "get", "responses", "200", "content", "application/json", "schema"],
		clientOnly: ["code"],
	},
	{
		dto: "RemoteOrder",
		pointer: ["components", "schemas", "Order"],
		clientOnly: [],
	},
	{
		dto: "RemoteItem",
		pointer: ["components", "schemas", "OrderItem"],
		clientOnly: [],
	},
	{
		dto: "CustomerDto",
		pointer: ["components", "schemas", "Customer"],
		clientOnly: [],
	},
	{
		dto: "ProductCodeDto",
		pointer: ["components", "schemas", "SyncedProductIdentity"],
		clientOnly: [],
	},
];

const problems = [];

for (const pair of PAIRS) {
	let schema;
	try {
		schema = schemaAt(pair.pointer);
	} catch (error) {
		problems.push(`${pair.dto}: ${error.message}`);
		continue;
	}
	if (!schema?.properties) {
		problems.push(`${pair.dto}: ${pair.pointer.join("/")} has no properties to compare against.`);
		continue;
	}
	const documented = new Set(Object.keys(schema.properties));
	const required = new Set(schema.required ?? []);
	const declared = kotlinFields(pair.dto);
	const allowed = new Set(pair.clientOnly);

	const ignoreRequired = new Set(pair.ignoreRequired ?? []);
	for (const property of required) {
		if (!declared.has(property) && !ignoreRequired.has(property)) {
			problems.push(
				`${pair.dto} does not declare "${property}", which the contract marks required. `
				+ "The client cannot read something the server guarantees.",
			);
		}
	}
	for (const field of declared) {
		if (!documented.has(field) && !allowed.has(field)) {
			problems.push(
				`${pair.dto} declares "${field}", which ${pair.pointer.join("/")} does not describe. `
				+ "Either document it, or add it to clientOnly with a reason. An undocumented "
				+ "field the client depends on is invisible to Schemathesis, Prism and every "
				+ "generated client.",
			);
		}
	}
}

if (problems.length) {
	console.error("Android DTOs and the seller contract disagree:\n");
	for (const problem of problems) console.error(`  - ${problem}`);
	console.error(
		"\nThe contract lives in contracts/openapi/src/seller-v1.json; run `pnpm openapi:bundle`"
		+ "\nafter editing it so dist/ matches.",
	);
	process.exit(1);
}

console.log(`${PAIRS.length} Android DTOs match the seller contract in both directions.`);
