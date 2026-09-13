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
//                       table that lost rows or disappeared. A retention-pruned
//                       table may shrink, but only within --max-prune-drop.
//   --compare-exact     Every table in the compared manifest must restore to
//                       exactly the count it records. For drilling an object
//                       against its own manifest, where any difference is
//                       corruption rather than the passage of time.
//   --min-tables <n>    Fail if fewer than n tables are restored (default 1).
//                       With --compare the floor is raised to the number of
//                       tables the manifest carries, so it is derived from what
//                       the database actually had rather than guessed.
//   --max-prune-drop <f>  Largest fraction of its rows a retention-pruned table
//                       may lose between two backups before that is treated as
//                       loss rather than pruning (default 0.25).
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
	const options = { file, manifest: null, compare: null, minTables: 1, compareExact: false, maxPruneDrop: 0.25 };
	// `--compare-exact` is a flag, so the pair-wise walk below cannot be assumed:
	// consuming a value for it would swallow the next option's name.
	for (let i = 0; i < rest.length; ) {
		const flag = rest[i];
		if (flag === "--compare-exact") {
			options.compareExact = true;
			i += 1;
			continue;
		}
		const value = rest[i + 1];
		if (flag === "--manifest") options.manifest = value;
		else if (flag === "--compare") options.compare = value;
		else if (flag === "--min-tables") options.minTables = Number(value);
		else if (flag === "--max-prune-drop") options.maxPruneDrop = Number(value);
		else {
			console.error(`Unknown option: ${flag}`);
			process.exit(2);
		}
		i += 2;
	}
	if (!Number.isFinite(options.maxPruneDrop) || options.maxPruneDrop < 0 || options.maxPruneDrop > 1) {
		console.error(`--max-prune-drop must be a fraction between 0 and 1, got ${options.maxPruneDrop}.`);
		process.exit(2);
	}
	if (options.compareExact && !options.compare) {
		console.error("--compare-exact requires --compare.");
		process.exit(2);
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

	// The table floor, derived rather than asserted.
	//
	// `--min-tables 1` is a check that a restore produced *a* table, which every
	// non-empty export passes. The number of tables the database actually had is
	// recorded in the manifest this backup — or the previous one — already wrote,
	// so when one is supplied the floor comes from there. A restore missing
	// entire tables then fails on the count before the per-table comparison has
	// to notice each one.
	const previous = options.compare ? JSON.parse(readFileSync(options.compare, "utf8")) : null;
	const manifestTableCount = Object.keys(previous?.tables ?? {}).length;
	const tableFloor = Math.max(options.minTables, manifestTableCount);
	if (tables.length < tableFloor) {
		console.error(
			`FAIL: restored ${tables.length} tables, expected at least ${tableFloor}` +
				(manifestTableCount > options.minTables ? ` (from ${options.compare}, which records ${manifestTableCount}).` : "."),
		);
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

	if (previous) {
		const pruned = prunedTables();
		for (const [table, before] of Object.entries(previous.tables ?? {})) {
			const now = counts[table];
			if (now === undefined) {
				// A table vanishing is always wrong, pruned or not — retention
				// deletes rows, never the table.
				console.error(`FAIL: table "${table}" was in the previous backup and is missing now.`);
				failed = true;
			} else if (options.compareExact) {
				// Same bytes, same counts. Nothing legitimate moves between an
				// export and a drill of that same export, so pruning earns no
				// exemption here and a gain is as wrong as a loss.
				if (now !== before) {
					console.error(`FAIL: table "${table}" restored ${now} rows, the manifest for this object records ${before}.`);
					failed = true;
				}
			} else if (now < before) {
				// A pruned table is allowed to shrink, but not without limit.
				//
				// The exemption used to be unbounded: any table retention.ts names
				// could go to zero and the drill still passed, printing a note that
				// said the decrease was expected. admin_audit is on that list — it
				// is pruned at two years — so a statement that emptied the audit log
				// this morning was indistinguishable from retention doing its job,
				// and the one check that would have caught it said so out loud and
				// exited 0.
				//
				// Retention removes rows that have aged past a boundary, which for a
				// table with any spread of ages is a slice, not the body. A drop past
				// this fraction between two consecutive backups is not that shape,
				// and is worth a human deciding rather than a note.
				const dropped = before - now;
				const fraction = before === 0 ? 0 : dropped / before;
				if (!pruned.has(table)) {
					console.error(`FAIL: table "${table}" lost rows: ${before} -> ${now}.`);
					failed = true;
				} else if (fraction > options.maxPruneDrop) {
					console.error(
						`FAIL: table "${table}" lost ${dropped} of ${before} rows (${(fraction * 100).toFixed(1)}%) — ` +
							`retention prunes it, but not past ${(options.maxPruneDrop * 100).toFixed(0)}%. ` +
							`Confirm this was retention before re-running with a higher --max-prune-drop.`,
					);
					failed = true;
				} else {
					console.log(
						`  note: "${table}" ${before} -> ${now} (${(fraction * 100).toFixed(1)}%); retention prunes this table, so a decrease of this size is expected.`,
					);
				}
			}
		}
		if (!failed) {
			console.log(
				options.compareExact
					? `Compared against ${options.compare}: every table restored to the exact count this object recorded.`
					: `Compared against ${options.compare}: no durable table lost rows, and no pruned table lost more than ${(options.maxPruneDrop * 100).toFixed(0)}%.`,
			);
		}
	}
} finally {
	db?.close();
	rmSync(scratchDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log("RESTORE DRILL PASSED — this export is recoverable.");
