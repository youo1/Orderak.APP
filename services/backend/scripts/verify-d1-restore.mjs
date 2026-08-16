#!/usr/bin/env node
// ============================================================
// Verify that a D1 SQL export can actually be restored.
//
// A backup that has never been restored is not a backup. This replays an
// export into a throwaway SQLite database (D1 is SQLite), then reports the
// schema and row counts it produced, so a scheduled backup can prove it is
// recoverable rather than merely non-empty.
//
// Usage:
//   node scripts/verify-d1-restore.mjs <export.sql> [options]
//
//   --manifest <path>   Write a JSON manifest of table row counts.
//   --compare <path>    Compare against a previous manifest and fail on any
//                       table that lost rows or disappeared.
//   --min-tables <n>    Fail if fewer than n tables are restored (default 1).
//
// Exit code 0 means the export restored cleanly; non-zero means the backup is
// not recoverable and the run should fail loudly.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tables the retention job deliberately prunes, read from the job itself.
 *
 * The row-loss check treats any decrease as data loss, which is right for
 * durable tables and wrong for tables the system is designed to empty. On
 * 2026-08-16 a production backup failed with:
 *
 *   FAIL: table "admin_auth_challenges" lost rows: 1 -> 0.
 *
 * That table holds MFA challenges with `expires_at` and `consumed_at`, and
 * retention.ts deletes them a day after either. The row went to zero because
 * the system worked. A guard that cannot tell that apart from real loss will
 * eventually be muted, and then it protects nothing.
 *
 * Derived from `retention.ts` rather than copied into a list here, so adding a
 * table to the retention job cannot leave this stale.
 *
 * On any problem — file moved, format changed, nothing matched — this returns
 * an empty set, which restores the strict behaviour. Failing closed on a
 * spurious backup failure is recoverable; silently exempting a table that
 * genuinely lost rows is not.
 */
function prunedTables() {
	try {
		const source = readFileSync(new URL("../src/domains/identity/retention.ts", import.meta.url), "utf8");
		const found = new Set([...source.matchAll(/DELETE FROM\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]));
		if (found.size === 0) console.error("WARNING: retention.ts matched no DELETE FROM — every table will be treated as durable.");
		return found;
	} catch (error) {
		console.error(`WARNING: could not read retention.ts (${error.message}); every table will be treated as durable.`);
		return new Set();
	}
}

function parseArgs(argv) {
	const [file, ...rest] = argv;
	const options = { file, manifest: null, compare: null, minTables: 1 };
	for (let i = 0; i < rest.length; i += 2) {
		const value = rest[i + 1];
		if (rest[i] === "--manifest") options.manifest = value;
		else if (rest[i] === "--compare") options.compare = value;
		else if (rest[i] === "--min-tables") options.minTables = Number(value);
		else {
			console.error(`Unknown option: ${rest[i]}`);
			process.exit(2);
		}
	}
	return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options.file) {
	console.error("Usage: verify-d1-restore.mjs <export.sql> [--manifest p] [--compare p] [--min-tables n]");
	process.exit(2);
}

const sql = readFileSync(options.file, "utf8");
if (!sql.trim()) {
	console.error(`FAIL: ${options.file} is empty — nothing to restore.`);
	process.exit(1);
}

// Restore into a scratch database on disk rather than :memory: so the exercise
// matches a real restore, including anything that touches file-backed pages.
const scratchDir = mkdtempSync(join(tmpdir(), "d1-restore-drill-"));
const scratchDb = join(scratchDir, "restored.sqlite");
let db;
let failed = false;

try {
	db = new DatabaseSync(scratchDb);
	try {
		db.exec(sql);
	} catch (error) {
		console.error(`FAIL: the export did not replay cleanly — the backup is NOT restorable.`);
		console.error(`  ${error.message}`);
		process.exit(1);
	}

	const tables = db
		.prepare(
			`SELECT name FROM sqlite_master
			 WHERE type='table' AND name NOT LIKE 'sqlite_%'
			 ORDER BY name`,
		)
		.all()
		.map((row) => row.name);

	if (tables.length < options.minTables) {
		console.error(`FAIL: restored ${tables.length} tables, expected at least ${options.minTables}.`);
		process.exit(1);
	}

	const counts = {};
	let totalRows = 0;
	for (const table of tables) {
		// Table names come from sqlite_master of a database we just built, so
		// they cannot be attacker-controlled here; quote them anyway.
		const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "${table.replace(/"/g, '""')}"`).get();
		counts[table] = n;
		totalRows += n;
	}

	// Integrity + referential checks: a restore that produces a corrupt or
	// dangling database is a failed restore even if every statement ran.
	const integrity = db.prepare("PRAGMA integrity_check").get();
	const integrityResult = integrity?.integrity_check ?? "unknown";
	if (integrityResult !== "ok") {
		console.error(`FAIL: PRAGMA integrity_check returned "${integrityResult}".`);
		failed = true;
	}

	const orphans = db.prepare("PRAGMA foreign_key_check").all();
	if (orphans.length > 0) {
		console.error(`FAIL: PRAGMA foreign_key_check reported ${orphans.length} violation(s) in the restored data.`);
		for (const orphan of orphans) {
			console.error(
				`  table=${JSON.stringify(orphan.table)} rowid=${JSON.stringify(orphan.rowid)} parent=${JSON.stringify(orphan.parent)} fk=${JSON.stringify(orphan.fkid)}`,
			);
		}
		failed = true;
	}

	console.log(`Restored ${tables.length} tables, ${totalRows} rows, integrity_check=${integrityResult}`);
	for (const table of tables) console.log(`  ${table}: ${counts[table]}`);

	if (options.manifest) {
		writeFileSync(
			options.manifest,
			JSON.stringify({ generatedAt: new Date().toISOString(), tables: counts, totalRows }, null, 2),
		);
		console.log(`Manifest written: ${options.manifest}`);
	}

	if (options.compare) {
		const previous = JSON.parse(readFileSync(options.compare, "utf8"));
		const pruned = prunedTables();
		for (const [table, before] of Object.entries(previous.tables ?? {})) {
			const now = counts[table];
			if (now === undefined) {
				// A table vanishing is always wrong, pruned or not — retention
				// deletes rows, never the table.
				console.error(`FAIL: table "${table}" was in the previous backup and is missing now.`);
				failed = true;
			} else if (now < before) {
				if (pruned.has(table)) {
					console.log(`  note: "${table}" ${before} -> ${now}; retention prunes this table, so a decrease is expected.`);
				} else {
					console.error(`FAIL: table "${table}" lost rows: ${before} -> ${now}.`);
					failed = true;
				}
			}
		}
		if (!failed) console.log(`Compared against ${options.compare}: no durable table lost rows.`);
	}
} finally {
	db?.close();
	rmSync(scratchDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log("RESTORE DRILL PASSED — this export is recoverable.");
