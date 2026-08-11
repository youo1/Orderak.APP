#!/usr/bin/env node
// ============================================================
// Emit the `--table` arguments for a backup of a D1 database.
//
// WHY THIS EXISTS
//   `wrangler d1 export` refuses to export a database that contains FTS5
//   virtual tables:
//
//     D1_ERROR: cannot export databases with Virtual Tables (fts5)
//
//   orderak-db has geo_city_search and business_taxonomy_search; orderak-geo
//   has city_catalog_search. A plain `wrangler d1 export` of either database
//   therefore fails outright, which is why the scheduled backup never produced
//   an artifact. Passing an explicit table allowlist is the supported way
//   around it.
//
//   Excluding those tables is also correct on the merits: an FTS5 index is
//   derived data, rebuildable from its source table. The restore runbook
//   re-creates them (see docs/runbooks/d1-restore.md) rather than restoring
//   them.
//
// The allowlist is computed from the live schema rather than hardcoded, so a
// table added tomorrow is backed up automatically instead of being silently
// dropped from the backup.
//
// Usage:
//   wrangler d1 execute <db> --remote --json \
//     --command "SELECT name, sql FROM sqlite_master WHERE type='table'" \
//     | node scripts/d1-exportable-tables.mjs
//
// Prints: --table a --table b ...   (and the excluded set to stderr)
// ============================================================

import { readFileSync } from "node:fs";

const raw = readFileSync(0, "utf8");

/**
 * `wrangler --json` writes clean JSON to stdout today, but it has historically
 * prefixed output with a banner or update notice. Parse from the first
 * structural character so a future banner cannot silently empty the allowlist
 * — which would produce a backup missing every table.
 */
function parseWranglerJson(text) {
	const start = text.search(/[[{]/);
	if (start === -1) return null;
	try {
		return JSON.parse(text.slice(start));
	} catch {
		return null;
	}
}

const parsed = parseWranglerJson(raw);
if (parsed === null) {
	console.error("FAIL: could not parse wrangler JSON output.");
	process.exit(1);
}

// `wrangler d1 execute --json` returns [{ results: [...] }].
const results = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) => entry?.results ?? []);
if (results.length === 0) {
	console.error("FAIL: no tables found in schema query — refusing to emit an empty allowlist.");
	process.exit(1);
}

const isVirtual = (sql) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql ?? "");

const virtualTables = results.filter((row) => isVirtual(row.sql)).map((row) => row.name);

/**
 * FTS5 keeps its internal state in shadow tables named `<vtab>_data`,
 * `_idx`, `_content`, `_docsize` and `_config`. They are ordinary tables in
 * sqlite_master, so they must be filtered by their owning virtual table
 * rather than by type. Matching on the `<vtab>_` prefix covers the current
 * suffixes and any FTS5 adds later.
 */
const isShadowOf = (name) => virtualTables.some((vtab) => name.startsWith(`${vtab}_`));

const excluded = [];
const included = [];
for (const { name, sql } of results) {
	if (name.startsWith("sqlite_")) excluded.push([name, "sqlite internal"]);
	else if (isVirtual(sql)) excluded.push([name, "virtual table (fts5)"]);
	else if (isShadowOf(name)) excluded.push([name, "fts5 shadow table"]);
	else included.push(name);
}

if (included.length === 0) {
	console.error("FAIL: every table was excluded — refusing to emit an empty allowlist.");
	process.exit(1);
}

for (const [name, reason] of excluded) console.error(`excluded: ${name} (${reason})`);
console.error(`including ${included.length} table(s) in the export`);

process.stdout.write(included.map((name) => `--table ${name}`).join(" "));
