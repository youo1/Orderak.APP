#!/usr/bin/env node
// ============================================================
// Emit CREATE INDEX statements missing from `wrangler d1 export`.
//
// WHY THIS EXISTS
//   `wrangler d1 export --table a --table b ...` exports each named table's
//   CREATE TABLE statement and its rows. It does not export any index —
//   confirmed empirically: exporting a live database and importing the
//   result into a scratch database, then diffing sqlite_master against the
//   live schema, found 146 missing indexes and zero missing tables. A
//   restore from an unpatched export is queryable but every query that used
//   to hit an index scans the whole table instead, until someone notices and
//   manually replays 146 CREATE INDEX statements from the migration files.
//   Found by the Phase 6 fresh-replay check this exists to fix.
//
// This script emits the CREATE INDEX statements the export is missing, for
// indexes belonging to tables the export actually included. Its output is
// appended to the export file after `wrangler d1 export` runs — see
// d1-backup.yml's "Append index definitions" step.
//
// Excludes:
//   - sqlite_autoindex_* entries: SQLite's own implicit indexes for UNIQUE
//     and PRIMARY KEY constraints. These have no CREATE INDEX statement of
//     their own (sql is NULL in sqlite_master) and are recreated
//     automatically by the CREATE TABLE statement the export already has.
//   - Indexes on FTS5 virtual tables or their shadow tables: those tables
//     are excluded from the export itself (see d1-exportable-tables.mjs),
//     so an index on one would reference a table the restore never creates.
//
// Usage:
//   wrangler d1 execute <db> --remote --json \
//     --command "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index')" \
//     | node scripts/d1-export-indexes.mjs >> export.sql
// ============================================================

import { readFileSync } from "node:fs";

/**
 * `wrangler --json` writes clean JSON to stdout today, but it has historically
 * prefixed output with a banner or update notice. Parse from the first
 * structural character so a future banner cannot silently empty the result —
 * matches the same defensive parse in d1-exportable-tables.mjs.
 */
export function parseWranglerJson(text) {
	const start = text.search(/[[{]/);
	if (start === -1) return null;
	try {
		return JSON.parse(text.slice(start));
	} catch {
		return null;
	}
}

/**
 * Returns { statements, emitted, skippedAuto, skippedFts5 } for the given
 * sqlite_master rows (type, name, tbl_name, sql), covering both 'table' and
 * 'index' rows in one pass.
 */
export function computeIndexStatements(results) {
	const isVirtual = (sql) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql ?? "");
	const virtualTables = results.filter((r) => r.type === "table" && isVirtual(r.sql)).map((r) => r.name);
	const isShadowOf = (name) => virtualTables.some((vtab) => name.startsWith(`${vtab}_`));
	const tableIsVirtual = (tblName) => {
		const owner = results.find((r) => r.type === "table" && r.name === tblName);
		return isVirtual(owner?.sql) || isShadowOf(tblName);
	};

	const indexes = results.filter((r) => r.type === "index");
	const statements = [];
	let skippedAuto = 0;
	let skippedFts5 = 0;
	let skippedNoSql = 0;

	for (const { name, sql, tbl_name: tblName } of indexes) {
		if (name.startsWith("sqlite_autoindex_")) {
			skippedAuto++;
			continue;
		}
		if (tableIsVirtual(tblName)) {
			skippedFts5++;
			continue;
		}
		if (!sql) {
			// Defensive: an index with no SQL of its own is not something this
			// script can replay. Not expected outside the autoindex case above,
			// which is already handled by name.
			skippedNoSql++;
			continue;
		}
		statements.push(`${sql};`);
	}

	return { statements, emitted: statements.length, skippedAuto, skippedFts5, skippedNoSql };
}

// Only run as a CLI when executed directly, so the functions above stay
// importable and testable without triggering stdin reads or process.exit.
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, "/") || import.meta.url === `file:///${process.argv[1]}`.replace(/\\/g, "/")) {
	const raw = readFileSync(0, "utf8");
	const parsed = parseWranglerJson(raw);
	if (parsed === null) {
		console.error("FAIL: could not parse wrangler JSON output.");
		process.exit(1);
	}

	const results = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) => entry?.results ?? []);
	if (results.length === 0) {
		console.error("FAIL: no schema rows found — refusing to silently append nothing.");
		process.exit(1);
	}

	const { statements, emitted, skippedAuto, skippedFts5, skippedNoSql } = computeIndexStatements(results);

	for (const statement of statements) process.stdout.write(`${statement}\n`);
	console.error(
		`appended ${emitted} index(es); skipped ${skippedAuto} sqlite autoindex(es), ${skippedFts5} fts5-owned, ${skippedNoSql} without sql`,
	);

	const totalIndexRows = results.filter((r) => r.type === "index").length;
	if (emitted === 0 && totalIndexRows > skippedAuto + skippedFts5) {
		console.error("FAIL: indexes existed but none were emitted — check the filter logic before trusting this backup.");
		process.exit(1);
	}
}
