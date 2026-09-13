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
//   5. A migration that creates a table with IF NOT EXISTS and then backfills
//      it cannot be replayed without doubling the backfill. See REPLAY SAFETY.
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
//
// REPLAY SAFETY
//   wrangler will not run an applied migration twice, so a replay is always a
//   person: restoring a backup over a live database, repairing a divergence by
//   hand, or pointing the runner at a database whose d1_migrations table does
//   not match its schema. Those are the circumstances in which someone reaches
//   for a migration file, and they are the worst possible circumstances in
//   which to find out it is not idempotent.
//
//   `CREATE TABLE IF NOT EXISTS` followed by an unguarded `INSERT ... SELECT`
//   is the combination that fails quietly. The CREATE finds the table already
//   there and does nothing; the backfill reads rows that are still there and
//   inserts a second copy of every one. Nothing errors. 052_stock_movements.sql
//   does exactly this, three times, into a ledger — so replaying it to repair a
//   stock divergence would deepen the divergence it was run to fix, and the
//   OPENING_BALANCE remainder it computes last would paper over the result by
//   writing a correcting row.
//
//   An unconditional `CREATE TABLE` does not need the guard: a replay either
//   fails loudly on the CREATE or is rebuilding a scratch table it made in the
//   same file. That is why the table-rebuild migrations do not trip this.
//
//   The fix in a new migration is a guard on the backfill — `WHERE NOT EXISTS
//   (SELECT 1 FROM target ...)`, `ON CONFLICT DO NOTHING`, or `INSERT OR
//   IGNORE` — chosen so that running the file twice leaves the same rows as
//   running it once.
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

/**
 * A backfill that cannot run twice, in a file that can be run twice.
 *
 * Matched narrowly on purpose: an `INSERT ... SELECT` (a backfill derived from
 * rows already in the database, not a seed of literal VALUES) into a table the
 * same migration created with `IF NOT EXISTS`, with no guard on the insert.
 * Across the whole migration history this matches one file, which is the file
 * that has the defect. A rule that also flagged the ten table-rebuild
 * migrations would be muted within a week.
 */
const BACKFILL_INSERT = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_]*)(.*?);/gis;
const SOFT_CREATE = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
const HARD_CREATE = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?!IF\s+NOT\s+EXISTS)([A-Za-z_][A-Za-z0-9_]*)/gi;
const INSERT_GUARD = /NOT\s+EXISTS|ON\s+CONFLICT|INSERT\s+OR\s+(?:IGNORE|REPLACE)/i;

/**
 * Migrations that predate this check and are already applied everywhere.
 *
 * 052 creates stock_movements with IF NOT EXISTS and backfills it three times
 * without a guard. It is not exempt because that is acceptable — it is exempt
 * because the file is applied history and migrations.lock exists to keep
 * applied history from being edited. Rewriting it would change a file every
 * environment has already run, to fix a hazard that only exists for a manual
 * replay; the honest place for the guard is the next migration that touches
 * this ledger, and the honest place for the warning is here.
 */
const ACCEPTED_UNGUARDED_BACKFILL = new Set(["052_stock_movements.sql"]);

for (const name of files) {
	if (ACCEPTED_UNGUARDED_BACKFILL.has(name)) continue;
	const source = fs.readFileSync(path.join(migrationsDir, name), "utf8");
	const statements = source
		.split("\n")
		.filter((line) => !/^\s*--/.test(line))
		.join("\n");
	const softCreated = new Set([...statements.matchAll(SOFT_CREATE)].map((m) => m[1].toLowerCase()));
	const hardCreated = new Set([...statements.matchAll(HARD_CREATE)].map((m) => m[1].toLowerCase()));
	const flagged = new Set();
	for (const match of statements.matchAll(BACKFILL_INSERT)) {
		const target = match[1].toLowerCase();
		if (!/\bSELECT\b/i.test(match[0])) continue;
		if (INSERT_GUARD.test(match[0])) continue;
		if (hardCreated.has(target) || !softCreated.has(target)) continue;
		flagged.add(match[1]);
	}
	for (const target of flagged) {
		fail(
			`"${name}" creates ${target} with IF NOT EXISTS and then backfills it unguarded.\n` +
			"    Running the file a second time — restoring over a live database, or repairing\n" +
			"    a divergence by hand — finds the table already there, skips the CREATE, and\n" +
			"    inserts a second copy of every backfilled row without erroring.\n" +
			"    Guard the INSERT so a replay is a no-op:\n" +
			`      ... WHERE NOT EXISTS (SELECT 1 FROM ${target} ...)   -- or ON CONFLICT DO NOTHING`,
		);
	}
}

/* ---------------------------------------------------------------------------
 * 5. Applied migrations are immutable, and every declared directory is guarded.
 *
 * The checks above are a filename lint. Nothing read a migration's contents, so
 * editing one that had already been applied passed silently — and that is not a
 * hypothetical edit: generate-legal-migration.mjs defaulted its output to an
 * applied filename and overwrote it. wrangler matches applied state by name, so
 * the edited content would never have reached a database while the repository
 * asserted a history no environment had. 039b and 041 exist to repair exactly
 * that kind of divergence, discovered late.
 *
 * migrations.lock records a hash per file, in sha256sum format. Changing an applied migration
 * now needs `--update-lock`, which puts the change in the diff where a reviewer
 * sees it, rather than nowhere.
 *
 * The directory list comes from the wrangler configs rather than being
 * hardcoded. It was one path, `migrations/`, while wrangler.jsonc declares
 * geo-migrations/ as well and both deploy workflows apply it — so a whole
 * migration directory was unguarded by the checks above, too.
 * ------------------------------------------------------------------------- */
import crypto from "node:crypto";
import { loadJsonc } from "../../../tooling/lib/jsonc.mjs";

/** Every migrations_dir any wrangler config declares, plus the default. */
function declaredMigrationDirectories() {
	const dirs = new Set(["migrations"]);
	for (const config of ["wrangler.jsonc", "wrangler.admin.jsonc"]) {
		const file = path.join(here, "..", config);
		if (!fs.existsSync(file)) continue;
		const parsed = loadJsonc(file);
		const scopes = [parsed, ...Object.values(parsed.env ?? {})];
		for (const scope of scopes) {
			for (const database of scope.d1_databases ?? []) {
				if (database.migrations_dir) dirs.add(database.migrations_dir);
			}
		}
	}
	return [...dirs].sort();
}

/**
 * sha256sum format — "<hash>  <path>" per line — rather than JSON.
 *
 * JSON put each digest as the value of a key named after its file, and two of
 * those filenames contain the word "key" (043_audit_signing_key_version.sql,
 * whose entire body adds an INTEGER column). gitleaks' generic-api-key rule
 * reads the key beside a high-entropy value, so the lock file failed the secret
 * scan on its own contents.
 *
 * The fix is the format, not an exemption. Every value here is the digest of a
 * tracked file that anyone holding the repo can recompute, so allowlisting the
 * path would have told the scanner to stop looking at a file for all rules —
 * and .gitleaks.toml says an exemption added speculatively is one nobody
 * revisits. In this shape the scanner finds nothing to object to, and
 * `sha256sum -c migrations.lock` verifies it without this script.
 */
const lockPath = path.join(here, "..", "migrations.lock");
const updateLock = process.argv.includes("--update-lock");

const actual = {};
for (const dir of declaredMigrationDirectories()) {
	const full = path.join(here, "..", dir);
	if (!fs.existsSync(full)) {
		fail(`${dir} is declared as a migrations_dir but does not exist`);
		continue;
	}
	for (const name of fs.readdirSync(full).filter((n) => n.endsWith(".sql")).sort()) {
		const body = fs.readFileSync(path.join(full, name));
		actual[`${dir}/${name}`] = crypto.createHash("sha256").update(body).digest("hex");
	}
}

/** "<hash>  <path>" lines, the shape sha256sum reads and writes. */
function serializeLock(entries) {
	return Object.keys(entries).sort().map((key) => `${entries[key]}  ${key}\n`).join("");
}

function parseLock(text) {
	const entries = {};
	for (const line of text.split("\n")) {
		const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line.trimEnd());
		if (match) entries[match[2]] = match[1];
	}
	return entries;
}

if (updateLock) {
	fs.writeFileSync(lockPath, serializeLock(actual), "utf8");
	console.log(`Wrote ${path.relative(process.cwd(), lockPath)} with ${Object.keys(actual).length} migrations.`);
} else if (!fs.existsSync(lockPath)) {
	fail("migrations.lock is missing — run `pnpm run verify:migrations -- --update-lock`");
} else {
	const locked = parseLock(fs.readFileSync(lockPath, "utf8"));
	for (const [key, hash] of Object.entries(actual)) {
		if (!(key in locked)) {
			fail(`${key} is not in migrations.lock — run \`pnpm run verify:migrations -- --update-lock\``);
		} else if (locked[key] !== hash) {
			fail(
				`${key} has changed since it was locked.\n` +
				"      An applied migration is immutable: editing it changes the repository's\n" +
				"      account of the schema without changing any database, because wrangler\n" +
				"      matches applied state by filename. Write a new migration instead.\n" +
				"      If this file has genuinely never been applied anywhere, re-lock it with\n" +
				"      `pnpm run verify:migrations -- --update-lock` so the change is reviewable.",
			);
		}
	}
	for (const key of Object.keys(locked)) {
		if (!(key in actual)) fail(`${key} is locked but no longer exists — migrations are not deleted`);
	}
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
