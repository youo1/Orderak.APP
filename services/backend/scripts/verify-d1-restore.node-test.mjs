// The .node-test suffix keeps Vitest from collecting this node:test suite.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "verify-d1-restore.mjs");

function runRestore(sql, previousTables) {
	const directory = mkdtempSync(join(tmpdir(), "verify-d1-restore-test-"));
	const exportPath = join(directory, "backup.sql");
	writeFileSync(exportPath, sql);
	const args = [script, exportPath, "--min-tables", "1"];
	if (previousTables) {
		const previousPath = join(directory, "previous.json");
		writeFileSync(previousPath, JSON.stringify({ tables: previousTables }));
		args.push("--compare", previousPath);
	}
	try {
		return spawnSync(process.execPath, args, {
			encoding: "utf8",
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

// The shape 060_retire_dead_tables.sql leaves behind: the table renamed with the
// zz_retired_ prefix, and its old name recorded in retired_tables.
function retiredItems(rowsKept) {
	const inserts = Array.from({ length: rowsKept }, (_, index) => `INSERT INTO zz_retired_items (id) VALUES (${index + 1});`).join("\n");
	return `
		CREATE TABLE retired_tables (table_name TEXT PRIMARY KEY, retired_at TEXT NOT NULL, migration TEXT NOT NULL, reason TEXT NOT NULL);
		INSERT INTO retired_tables VALUES ('items', '2026-09-26', '060_retire_dead_tables.sql', 'Superseded by products.');
		CREATE TABLE zz_retired_items (id INTEGER PRIMARY KEY);
		${inserts}
	`;
}

test("accepts a restorable export with valid foreign keys", () => {
	const result = runRestore(`
		PRAGMA foreign_keys=OFF;
		CREATE TABLE parents (id INTEGER PRIMARY KEY);
		CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id));
		INSERT INTO parents (id) VALUES (1);
		INSERT INTO children (id, parent_id) VALUES (1, 1);
	`);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /RESTORE DRILL PASSED/);
});

test("fails a restored export that contains foreign-key violations", () => {
	const result = runRestore(`
		PRAGMA foreign_keys=OFF;
		CREATE TABLE parents (id INTEGER PRIMARY KEY);
		CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id));
		INSERT INTO children (id, parent_id) VALUES (1, 999);
	`);

	assert.notEqual(result.status, 0, "foreign_key_check violations must fail the restore drill");
	assert.match(result.stderr, /FAIL: PRAGMA foreign_key_check reported 1 violation/);
	assert.match(result.stderr, /table="children"/);
});

test("accepts a table a migration retired on purpose when its renamed copy kept every row", () => {
	const result = runRestore(retiredItems(3), { items: 3 });

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /note: "items" was retired by 060_retire_dead_tables\.sql on 2026-09-26; its rows are in "zz_retired_items" \(3 -> 3\)/);
	assert.match(result.stdout, /RESTORE DRILL PASSED/);
});

test("fails a retired table whose renamed copy holds fewer rows than the previous backup", () => {
	const result = runRestore(retiredItems(2), { items: 3 });

	assert.notEqual(result.status, 0, "a rename must not hide lost rows");
	assert.match(result.stderr, /FAIL: table "items" was retired by 060_retire_dead_tables\.sql, but "zz_retired_items" holds 2 rows, fewer than the 3/);
});

test("fails a recorded retirement whose renamed copy is gone", () => {
	const result = runRestore(`
		CREATE TABLE retired_tables (table_name TEXT PRIMARY KEY, retired_at TEXT NOT NULL, migration TEXT NOT NULL, reason TEXT NOT NULL);
		INSERT INTO retired_tables VALUES ('items', '2026-09-26', '060_retire_dead_tables.sql', 'Superseded by products.');
	`, { items: 3 });

	assert.notEqual(result.status, 0, "a record alone does not prove the rows survived");
	assert.match(result.stderr, /FAIL: table "items" was retired by 060_retire_dead_tables\.sql, but "zz_retired_items" is missing\./);
});

test("still fails a table that vanished with no retirement record", () => {
	const result = runRestore(`
		CREATE TABLE products (id INTEGER PRIMARY KEY);
		CREATE TABLE zz_retired_items (id INTEGER PRIMARY KEY);
		INSERT INTO zz_retired_items (id) VALUES (1), (2), (3);
	`, { items: 3, products: 0 });

	assert.notEqual(result.status, 0, "only a recorded retirement excuses a missing table");
	assert.match(result.stderr, /FAIL: table "items" was in the previous backup and is missing now\./);
});
