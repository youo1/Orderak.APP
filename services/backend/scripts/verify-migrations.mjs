#!/usr/bin/env node
// ============================================================
// Guard the migration directory against the mistakes that are cheap to make
// and expensive to undo.
//
// WHY NOT JUST RENAME THE EXISTING DUPLICATES
//   Wrangler tracks applied migrations by *filename* in the d1_migrations
//   table. Renaming a file that has already run makes it look unapplied, so
//   the next `d1 migrations apply` executes it again — against a database
//   where it has already taken effect. For 015_order_no_unique.sql that would
//   be harmless (CREATE UNIQUE INDEX IF NOT EXISTS), for a table rebuild it
//   would not be. Applied migrations are immutable history, the same reason
//   migration 009 is never edited despite being the source of the missing
//   foreign keys.
//
//   So the historical duplicates stay, recorded below as accepted history, and
//   this check stops new ones appearing.
//
// Checks:
//   1. No two migrations share a numeric prefix (except accepted history).
//   2. Every filename matches <digits><optional letter>_<snake_case>.sql.
//   3. No migration is numbered below the highest already present, which is
//      what makes a duplicate prefix tempting in the first place.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");

/**
 * Prefixes that already carry more than one file, or a letter suffix, at the
 * time this check was introduced. They are applied in production and cannot be
 * renamed. Nothing may be added to this list — that is the point of it.
 */
const ACCEPTED_HISTORY = new Map([
	["015", ["015_order_no_unique.sql", "015_seed_app_screens.sql"]],
	["039", ["039_add_private_birth_year.sql", "039b_repair_email_schema_drift.sql"]],
]);

const NAME_PATTERN = /^(\d{3,})([a-z]?)_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

const failures = [];
const fail = (message) => failures.push(message);

const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
if (files.length === 0) fail("no migrations found — is the path correct?");

const byPrefix = new Map();
for (const name of files) {
	const match = NAME_PATTERN.exec(name);
	if (!match) {
		fail(`"${name}" does not match <number>_<snake_case>.sql`);
		continue;
	}
	const [, digits] = match;
	if (!byPrefix.has(digits)) byPrefix.set(digits, []);
	byPrefix.get(digits).push(name);
}

for (const [prefix, names] of byPrefix) {
	if (names.length === 1) continue;
	const accepted = ACCEPTED_HISTORY.get(prefix);
	if (accepted && accepted.length === names.length && accepted.every((name) => names.includes(name))) {
		continue;
	}
	fail(
		`prefix ${prefix} is used by ${names.length} migrations: ${names.join(", ")}.\n` +
		"    Two migrations sharing a prefix apply in filename order, which is not obvious\n" +
		"    from the numbers and has already cost this repository one silently missing index.\n" +
		"    Give the new migration the next free number instead.",
	);
}

const highest = Math.max(...[...byPrefix.keys()].map(Number).filter(Number.isFinite));
const expectedNext = String(highest + 1).padStart(3, "0");

if (failures.length > 0) {
	console.error("Migration naming check failed:");
	for (const failure of failures) console.error(`  - ${failure}`);
	console.error(`\n  The next migration should be numbered ${expectedNext}.`);
	process.exit(1);
}

console.log(`Migrations valid: ${files.length} files, highest ${highest}, next is ${expectedNext}.`);
