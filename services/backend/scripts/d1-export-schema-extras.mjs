#!/usr/bin/env node
// ============================================================
// Emit CREATE INDEX and CREATE TRIGGER statements missing from
// `wrangler d1 export`.
//
// WHY THIS EXISTS
//   `wrangler d1 export --table a --table b ...` exports each named table's
//   CREATE TABLE statement and its rows. It exports neither indexes nor
//   triggers — confirmed empirically: exporting a live database, restoring
//   the result into a scratch database, and diffing sqlite_master against
//   the live schema found 128 missing indexes and 6 missing triggers, with
//   zero missing or altered tables. A restore from an unpatched export is
//   queryable but silent in two ways: every query that used to hit an index
//   scans the whole table instead, and every trigger-driven side effect
//   (stock claims, subscription-generation bookkeeping, verification state)
//   simply stops happening. Found by the Phase 6 fresh-replay check this
//   script exists to satisfy.
//
// This script emits the CREATE INDEX / CREATE TRIGGER statements the export
// is missing, for objects that belong to tables the export actually
// included. Its output is appended to the export file after
// `wrangler d1 export` runs — see d1-backup.yml's "Append index and trigger
// definitions" step.
//
// Excludes:
//   - sqlite_autoindex_* entries: SQLite's own implicit indexes for UNIQUE
//     and PRIMARY KEY constraints. These have no CREATE INDEX statement of
//     their own (sql is NULL in sqlite_master) and are recreated
//     automatically by the CREATE TABLE statement the export already has.
//   - Indexes and triggers owned by FTS5 virtual tables or their shadow
//     tables: those tables are excluded from the export itself (see
//     d1-exportable-tables.mjs), so an index or trigger on one would
//     reference a table the restore never creates.
//
// Usage:
//   wrangler d1 execute <db> --remote --json \
//     --command "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index','trigger')" \
//     | node scripts/d1-export-schema-extras.mjs >> export.sql
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
 * Returns { statements, counts } for the given sqlite_master rows
 * (type, name, tbl_name, sql), covering 'table', 'index' and 'trigger' rows
 * in one pass. `statements` preserves index-then-trigger order, which does
 * not matter to SQLite but makes the appended SQL easier to read.
 */
export function computeSchemaExtras(results) {
	const isVirtual = (sql) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql ?? "");
	const virtualTables = results.filter((r) => r.type === "table" && isVirtual(r.sql)).map((r) => r.name);
	const isShadowOf = (name) => virtualTables.some((vtab) => name.startsWith(`${vtab}_`));
	const tableIsVirtual = (tblName) => {
		const owner = results.find((r) => r.type === "table" && r.name === tblName);
		return isVirtual(owner?.sql) || isShadowOf(tblName);
	};

	const counts = { indexes: 0, triggers: 0, skippedAuto: 0, skippedFts5: 0, skippedNoSql: 0 };
	const statements = [];

	for (const kind of ["index", "trigger"]) {
		for (const { name, sql, tbl_name: tblName } of results.filter((r) => r.type === kind)) {
			if (kind === "index" && name.startsWith("sqlite_autoindex_")) {
				counts.skippedAuto++;
				continue;
			}
			if (tableIsVirtual(tblName)) {
				counts.skippedFts5++;
				continue;
			}
			if (!sql) {
				counts.skippedNoSql++;
				continue;
			}
			statements.push(`${sql};`);
			counts[kind === "index" ? "indexes" : "triggers"]++;
		}
	}

	return { statements, counts };
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

	const { statements, counts } = computeSchemaExtras(results);

	for (const statement of statements) process.stdout.write(`${statement}\n`);
	console.error(
		`appended ${counts.indexes} index(es) and ${counts.triggers} trigger(s); ` +
			`skipped ${counts.skippedAuto} sqlite autoindex(es), ${counts.skippedFts5} fts5-owned, ${counts.skippedNoSql} without sql`,
	);

	const totalCandidates = results.filter((r) => r.type === "index" || r.type === "trigger").length;
	const totalEmitted = counts.indexes + counts.triggers;
	const totalSkipped = counts.skippedAuto + counts.skippedFts5 + counts.skippedNoSql;
	if (totalEmitted === 0 && totalCandidates > totalSkipped) {
		console.error("FAIL: indexes or triggers existed but none were emitted — check the filter logic before trusting this backup.");
		process.exit(1);
	}
}
