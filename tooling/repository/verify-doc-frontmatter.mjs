#!/usr/bin/env node
// ============================================================
// Validate documentation frontmatter and the authoritative_for subject
// registry.
//
// WHAT THIS PROTECTS
//   Two documents each quietly claiming to be the source of truth on
//   authentication, with readers landing on whichever they found first and
//   getting different answers. Or a subject everyone assumes is documented
//   somewhere that has no owning document at all. Neither failure announces
//   itself; both are caught here.
//
// THE RULES
//   1. Every subject in `authoritative_for` must exist in the registry.
//      Free-text subjects cannot be validated, so they are rejected.
//   2. Each registered subject has EXACTLY ONE document with
//      `status: current` claiming it. Two claimants is a contradiction; zero
//      claimants is an unowned subject someone will assume is covered.
//   3. Frontmatter, where present, uses only known fields and values.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   It does not require frontmatter on every document. A mechanically
//   stamped `owner:` that nobody chose is metadata theatre - it looks like a
//   decision was made and records that nothing was. Documents gain
//   frontmatter as someone actually decides what it should say. The rules
//   above hold over whatever is present, and the registry's zero-claimant
//   check means an authority claim cannot be quietly dropped either.
//
// Usage: node tooling/repository/verify-doc-frontmatter.mjs
// ============================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const docsRoot = path.join(repositoryRoot, "docs");
const registryPath = path.join(docsRoot, "governance", "subject-registry.json");

const STATUS_VALUES = ["current", "draft", "superseded", "archived"];
const OWNER_VALUES = ["backend", "android", "admin", "security", "product", "legal", "governance"];
const APPLIES_TO_VALUES = ["production", "staging", "internal"];
const KNOWN_FIELDS = ["status", "generated", "owner", "last_verified", "applies_to", "authoritative_for"];

const problems = [];

/**
 * Minimal YAML frontmatter reader. Deliberately not a YAML dependency: the
 * shapes accepted here are a scalar, a bare list, or a [a, b] inline list,
 * and anything else should be rejected rather than silently coerced by a
 * permissive parser.
 */
function readFrontmatter(filePath) {
	const raw = readFileSync(filePath, "utf8");
	if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return null;

	const end = raw.indexOf("\n---", 4);
	if (end === -1) {
		problems.push(`${relative(filePath)}: frontmatter opens with --- but never closes`);
		return null;
	}

	const block = raw.slice(raw.indexOf("\n") + 1, end);
	const fields = {};
	let currentListKey = null;

	for (const line of block.split(/\r?\n/)) {
		if (line.trim() === "") continue;

		const listItem = /^\s*-\s+(.+)$/.exec(line);
		if (listItem && currentListKey) {
			fields[currentListKey].push(listItem[1].trim());
			continue;
		}

		const pair = /^([a-z_]+):\s*(.*)$/.exec(line);
		if (!pair) {
			problems.push(`${relative(filePath)}: unparseable frontmatter line: ${line.trim()}`);
			currentListKey = null;
			continue;
		}

		const [, key, rawValue] = pair;
		const value = rawValue.trim();

		if (value === "") {
			fields[key] = [];
			currentListKey = key;
			continue;
		}

		currentListKey = null;
		if (value.startsWith("[") && value.endsWith("]")) {
			fields[key] = value
				.slice(1, -1)
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean);
		} else {
			fields[key] = value;
		}
	}

	return fields;
}

function relative(filePath) {
	return path.relative(repositoryRoot, filePath).replace(/\\/g, "/");
}

function markdownFiles(directory) {
	const found = [];
	for (const entry of readdirSync(directory)) {
		const full = path.join(directory, entry);
		// docs/archive is historical by definition — its documents describe what was
		// true when written and must not be held to current-status rules.
		if (entry === "archive") continue;
		if (statSync(full).isDirectory()) found.push(...markdownFiles(full));
		else if (entry.endsWith(".md")) found.push(full);
	}
	return found;
}

const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const registeredSubjects = new Set(registry.subjects.map((subject) => subject.id));
if (registeredSubjects.size !== registry.subjects.length) {
	problems.push("subject-registry.json contains duplicate subject ids");
}

/** subject id -> [file paths claiming it with status: current] */
const currentClaimants = new Map();
for (const subject of registeredSubjects) currentClaimants.set(subject, []);

let withFrontmatter = 0;

for (const file of markdownFiles(docsRoot)) {
	const fields = readFrontmatter(file);
	if (fields === null) continue;
	withFrontmatter++;

	for (const key of Object.keys(fields)) {
		if (!KNOWN_FIELDS.includes(key)) {
			problems.push(`${relative(file)}: unknown frontmatter field "${key}"`);
		}
	}

	if (fields.status !== undefined && !STATUS_VALUES.includes(fields.status)) {
		problems.push(`${relative(file)}: status "${fields.status}" is not one of ${STATUS_VALUES.join(", ")}`);
	}
	if (fields.owner !== undefined && !OWNER_VALUES.includes(fields.owner)) {
		problems.push(`${relative(file)}: owner "${fields.owner}" is not one of ${OWNER_VALUES.join(", ")}`);
	}
	if (fields.generated !== undefined && !["true", "false"].includes(fields.generated)) {
		problems.push(`${relative(file)}: generated must be true or false, found "${fields.generated}"`);
	}
	if (fields.last_verified !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(fields.last_verified)) {
		problems.push(`${relative(file)}: last_verified must be YYYY-MM-DD, found "${fields.last_verified}"`);
	}
	for (const environment of fields.applies_to ?? []) {
		if (!APPLIES_TO_VALUES.includes(environment)) {
			problems.push(`${relative(file)}: applies_to "${environment}" is not one of ${APPLIES_TO_VALUES.join(", ")}`);
		}
	}

	// A document that claims to be the one place a reader goes to be *sure*
	// about something must say when that was last checked. Enforced only for
	// subject claimants, not every current document: governance registers are
	// event logs, legal policy is reviewed by counsel on its own cadence, and an
	// ADR's meaningful date is the one it was decided, not "last verified".
	// Requiring a date from those would buy fabricated dates, not accuracy.
	if (
		fields.status === "current" &&
		(fields.authoritative_for ?? []).length > 0 &&
		fields.last_verified === undefined
	) {
		problems.push(
			`${relative(file)}: claims authority for ${(fields.authoritative_for ?? []).join(", ")} but has no last_verified — ` +
				"verify it against the implementation and record the date, or drop the authority claim",
		);
	}

	for (const subject of fields.authoritative_for ?? []) {
		if (!registeredSubjects.has(subject)) {
			problems.push(
				`${relative(file)}: claims authority for unregistered subject "${subject}" — add it to docs/governance/subject-registry.json or correct the claim`,
			);
			continue;
		}
		// Only a current document holds authority. A draft or superseded one may
		// carry the field as history without competing for the subject.
		if (fields.status === "current") currentClaimants.get(subject).push(relative(file));
	}
}

for (const [subject, claimants] of currentClaimants) {
	if (claimants.length === 0) {
		problems.push(`subject "${subject}" is registered but no current document claims it`);
	} else if (claimants.length > 1) {
		problems.push(`subject "${subject}" has ${claimants.length} current claimants: ${claimants.join(", ")}`);
	}
}

console.log(
	`Checked ${registeredSubjects.size} registered subject(s) against ${withFrontmatter} document(s) carrying frontmatter.`,
);

if (problems.length > 0) {
	console.error(`\n${problems.length} problem(s):`);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log("Frontmatter valid; every registered subject has exactly one current claimant.");
