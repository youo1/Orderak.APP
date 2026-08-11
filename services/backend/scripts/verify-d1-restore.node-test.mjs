// The .node-test suffix keeps Vitest from collecting this node:test suite.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "verify-d1-restore.mjs");

function runRestore(sql) {
	const directory = mkdtempSync(join(tmpdir(), "verify-d1-restore-test-"));
	const exportPath = join(directory, "backup.sql");
	writeFileSync(exportPath, sql);
	try {
		return spawnSync(process.execPath, [script, exportPath, "--min-tables", "1"], {
			encoding: "utf8",
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
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
