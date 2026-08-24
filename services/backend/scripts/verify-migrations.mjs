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
//   4. A migration that removes or renames schema the running Worker may still
//      be reading has to say that it knows it does. See ROLLOUT SAFETY below.
//
// ROLLOUT SAFETY
//   production-deploy.yml applies migrations and *then* deploys the Workers.
//   Between those two steps the previous release is serving live traffic
//   against the new schema, so a migration is only safe to run unattended if
//   the old code still works after it.
//
//   Additive changes are: CREATE TABLE, CREATE INDEX, ALTER TABLE ADD COLUMN,
//   INSERT. The old code does not know the new column exists and carries on.
//
//   Renames, drops and table rebuilds are not. Migration 044 renamed nine money
//   columns; had there been traffic, every query naming `price_piasters` would
//   have failed from the moment it applied until the new Worker finished
//   uploading. It was safe because the system had no users, which is a fact
//   about that day rather than a property of the migration.
//
//   So a migration containing one of those statements must carry the marker
//   below, which is a statement by its author that the pairing was considered:
//
//     -- rollout: expand-contract  (why this is safe to apply before the deploy)
//
//   The marker does not make anything safe. It makes the question unskippable,
//   and it puts the answer next to the SQL where the next person will find it.
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

/**
 * Statements that leave the previously deployed Worker reading schema that is
 * no longer there. A table rebuild shows up as DROP TABLE plus RENAME TO, so
 * both are listed and either one is enough to require the marker.
 */
const CONTRACTING_STATEMENT = /\b(?:RENAME\s+COLUMN|DROP\s+COLUMN|DROP\s+TABLE|RENAME\s+TO)\b/i;
const ROLLOUT_MARKER = /^\s*--\s*rollout:\s*expand-contract\b/im;

/**
 * Migrations that predate this check and are already applied everywhere.
 *
 * Not exempt because they are safe — 009, 041 and 044 all rebuild or rename —
 * but because they are history: wrangler tracks migrations by filename, the
 * files cannot be meaningfully revised, and each already carries a written
 * safety analysis in its own header. Listed rather than pattern-matched so the
 * set cannot grow without someone editing this line.
 */
const ACCEPTED_UNMARKED = new Set([
	"009_uuid_public_urls.sql",
	"036_design_system_revision_management.sql",
	"041_restore_referential_integrity.sql",
	"044_money_minor_units_with_currency.sql",
]);

for (const name of files) {
	if (ACCEPTED_UNMARKED.has(name)) continue;
	const source = fs.readFileSync(path.join(migrationsDir, name), "utf8");
	// Comments explain these statements as often as they perform them, so only
	// non-comment lines count towards needing the marker.
	const statements = source
		.split("\n")
		.filter((line) => !/^\s*--/.test(line))
		.join("\n");
	if (!CONTRACTING_STATEMENT.test(statements)) continue;
	if (ROLLOUT_MARKER.test(source)) continue;
	fail(
		`"${name}" renames or drops schema the running Worker may still be reading.\n` +
		"    Migrations apply before the Workers deploy, so the previous release serves\n" +
		"    live traffic against the new schema for the length of the upload.\n" +
		"    Add a line explaining why that is safe here:\n" +
		"      -- rollout: expand-contract  <reason>",
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
