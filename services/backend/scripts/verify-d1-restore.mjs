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
		for (const [table, before] of Object.entries(previous.tables ?? {})) {
			const now = counts[table];
			if (now === undefined) {
				console.error(`FAIL: table "${table}" was in the previous backup and is missing now.`);
				failed = true;
			} else if (now < before) {
				console.error(`FAIL: table "${table}" lost rows: ${before} -> ${now}.`);
				failed = true;
			}
		}
		if (!failed) console.log(`Compared against ${options.compare}: no table lost rows.`);
	}
} finally {
	db?.close();
	rmSync(scratchDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log("RESTORE DRILL PASSED — this export is recoverable.");
