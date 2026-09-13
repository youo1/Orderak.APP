#!/usr/bin/env node
// ============================================================
// Emit the CREATE VIRTUAL TABLE, CREATE INDEX and CREATE TRIGGER statements
// missing from `wrangler d1 export`, and rebuild the FTS5 search indexes.
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
//   - Indexes and triggers owned by FTS5 shadow tables: those are internal to
//     FTS5 and are recreated by the CREATE VIRTUAL TABLE statement this script
//     now emits, so restoring them by hand would collide with it.
//
// FTS5 SEARCH TABLES
//   `wrangler d1 export` cannot export a virtual table, and d1-exportable-
//   tables.mjs excludes both the virtual tables and their shadow tables from
//   the export. Until this script emitted them, that left the three search
//   tables (geo_city_search, business_taxonomy_search, city_catalog_search) in
//   no backup and in no rebuild path: a restore produced a database where
//   every search query failed with "no such table", and the restore drill
//   passed because the export and the restore were equally incomplete.
//
//   So each virtual table's CREATE statement is emitted from sqlite_master,
//   followed by its rebuild block from d1-search-index-rebuild.sql — the
//   indexes are all derived from ordinary tables the export already contains.
//   A virtual table with no rebuild block fails the backup rather than
//   producing another export that quietly omits something.
//
// Usage:
//   wrangler d1 execute <db> --remote --json \
//     --command "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index','trigger')" \
//     | node scripts/d1-export-schema-extras.mjs >> export.sql
// ============================================================

import { readFileSync } from "node:fs";

/**
 * Parse d1-search-index-rebuild.sql into { table -> sql } by its `-- @rebuild
 * <table>` markers. Comment lines are kept: the export is something a person
 * reads during a restore, and the reasoning for each derivation belongs next
 * to it there too.
 */
export function parseRebuildBlocks(text) {
	const blocks = new Map();
	let current = null;
	for (const line of text.split(/\r?\n/)) {
		const marker = /^--\s*@rebuild\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(line);
		if (marker) {
			current = marker[1];
			blocks.set(current, []);
			continue;
		}
		if (current) blocks.get(current).push(line);
	}
	return new Map([...blocks].map(([table, lines]) => [table, lines.join("\n").trim()]));
}

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
 * Returns { statements, counts, missingRebuilds } for the given sqlite_master
 * rows (type, name, tbl_name, sql), covering 'table', 'index' and 'trigger'
 * rows in one pass. `statements` runs virtual tables (each followed by its
 * rebuild block) before indexes and triggers, which SQLite does not require but
 * a person reading the tail of an export during a restore does.
 *
 * `rebuildBlocks` maps a virtual table name to the SQL that repopulates it, as
 * parsed from d1-search-index-rebuild.sql. A virtual table with no entry is
 * returned in `missingRebuilds` rather than emitted: half a search table —
 * created but empty, with no record that it should hold anything — is worse
 * than the loud failure, because it restores and then silently finds nothing.
 */
export function computeSchemaExtras(results, rebuildBlocks = new Map()) {
	const isVirtual = (sql) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql ?? "");
	const virtualRows = results.filter((r) => r.type === "table" && isVirtual(r.sql));
	const virtualTables = virtualRows.map((r) => r.name);
	const isShadowOf = (name) => virtualTables.some((vtab) => name.startsWith(`${vtab}_`));
	const tableIsVirtual = (tblName) => {
		const owner = results.find((r) => r.type === "table" && r.name === tblName);
		return isVirtual(owner?.sql) || isShadowOf(tblName);
	};

	const counts = { virtualTables: 0, indexes: 0, triggers: 0, skippedAuto: 0, skippedFts5: 0, skippedNoSql: 0 };
	const statements = [];
	const missingRebuilds = [];

	// Virtual tables first: their rebuild statements insert into them, and the
	// indexes and triggers emitted below may reference the tables they read.
	for (const { name, sql } of virtualRows) {
		const rebuild = rebuildBlocks.get(name);
		if (!rebuild) {
			missingRebuilds.push(name);
			continue;
		}
		statements.push(`${sql};`);
		statements.push(rebuild);
		counts.virtualTables++;
	}

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

	return { statements, counts, missingRebuilds };
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

	const rebuildBlocks = parseRebuildBlocks(
		readFileSync(new URL("./d1-search-index-rebuild.sql", import.meta.url), "utf8"),
	);
	const { statements, counts, missingRebuilds } = computeSchemaExtras(results, rebuildBlocks);

	// A search table with no rebuild block is the defect this script was changed
	// to end: it would be excluded from the export, recreated by nothing, and
	// noticed by nobody until a restore came up without it. Fail the backup.
	if (missingRebuilds.length > 0) {
		console.error(
			`FAIL: no rebuild block for virtual table(s): ${missingRebuilds.join(", ")}. ` +
				"Add a `-- @rebuild <table>` block to scripts/d1-search-index-rebuild.sql — " +
				"without one the search index is in no backup and nothing recreates it.",
		);
		process.exit(1);
	}

	for (const statement of statements) process.stdout.write(`${statement}\n`);
	console.error(
		`appended ${counts.virtualTables} virtual table(s) with rebuilds, ${counts.indexes} index(es) ` +
			`and ${counts.triggers} trigger(s); skipped ${counts.skippedAuto} sqlite autoindex(es), ` +
			`${counts.skippedFts5} fts5-owned, ${counts.skippedNoSql} without sql`,
	);

	const totalCandidates = results.filter((r) => r.type === "index" || r.type === "trigger").length;
	const totalEmitted = counts.indexes + counts.triggers;
	const totalSkipped = counts.skippedAuto + counts.skippedFts5 + counts.skippedNoSql;
	if (totalEmitted === 0 && totalCandidates > totalSkipped) {
		console.error("FAIL: indexes or triggers existed but none were emitted — check the filter logic before trusting this backup.");
		process.exit(1);
	}
}
