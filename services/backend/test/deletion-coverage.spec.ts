// Erasure must not be able to abort on a foreign key nobody remembered.
//
// fulfillDeletion() commits every DELETE as one env.orderak_db.batch(). D1
// enforces foreign keys, so a single child row referencing a parent the batch
// deletes aborts the whole thing — including the statement that marks the
// request completed. The request stays 'verified', the next run re-selects it
// and fails identically, and the only outward signal is a deletion_backlog line.
//
// That is exactly what support_messages did: its FK to support_tickets has no
// ON DELETE, the batch deleted the tickets and not the messages, and no test
// noticed because none of them had ever opened a support ticket. Any seller who
// had contacted support could never be erased, against a 90-day statutory
// deadline.
//
// The fix for that one row is one statement. The fix for the class is this file:
// the relationship is declared in the schema, so the coverage requirement can be
// derived from the schema rather than maintained by hand. A new table with a FK
// to anything erasure touches fails here on the day it is added.
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { createSchema } from "./helpers";
// `?raw` is typed now: test/env.d.ts references vite/client, which declares it.
// This carried a @ts-expect-error until then, with a comment saying it would
// fail loudly if the import ever did resolve. It did, and it did.
import deletionSource from "../src/domains/identity/deletion.ts?raw";

/** Every table named by a `DELETE FROM x` in the erasure path. */
function tablesDeletedByErasure(): Set<string> {
	return new Set(
		[...deletionSource.matchAll(/DELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)/gi)]
			.map((match) => match[1].toLowerCase()),
	);
}

/**
 * child -> parent for every foreign key in the live schema.
 *
 * Read from sqlite_master rather than PRAGMA foreign_key_list so this needs no
 * per-table round trip and sees exactly the DDL the migrations produced.
 */
async function foreignKeys(): Promise<{ child: string; parent: string; onDelete: boolean }[]> {
	const { results } = await env.orderak_db.prepare(
		"SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL",
	).all<{ name: string; sql: string }>();
	const edges: { child: string; parent: string; onDelete: boolean }[] = [];
	for (const table of results ?? []) {
		for (const fk of table.sql.matchAll(/REFERENCES\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)([^,)]*)/gi)) {
			edges.push({
				child: table.name.toLowerCase(),
				parent: fk[1].toLowerCase(),
				// ON DELETE CASCADE / SET NULL makes the parent delete safe on its own.
				onDelete: /ON\s+DELETE\s+(CASCADE|SET\s+NULL)/i.test(fk[2] ?? ""),
			});
		}
	}
	return edges;
}

beforeEach(async () => {
	await createSchema();
});

describe("account deletion foreign-key coverage", () => {
	it("deletes every child row that would block a parent it deletes", async () => {
		const deleted = tablesDeletedByErasure();
		expect(deleted.size).toBeGreaterThan(15); // the regex found the statements at all

		const blocking = (await foreignKeys()).filter((fk) =>
			// A child that survives a parent this batch deletes, with nothing in the
			// schema to clear it, is a constraint violation waiting for the first
			// seller who happens to have such a row.
			deleted.has(fk.parent) && !fk.onDelete && !deleted.has(fk.child) && fk.child !== fk.parent
		);

		expect(
			blocking.map((fk) => `${fk.child} -> ${fk.parent}`).sort(),
			"a table references one that account deletion removes, but is not itself deleted; "
			+ "erasure will abort with SQLITE_CONSTRAINT_FOREIGNKEY for any seller holding such a row",
		).toEqual([]);
	});

	it("reads the erasure statements it is asserting about", async () => {
		// Guards the guard: if deletion.ts is refactored so the DELETEs no longer
		// match the regex above, the first test would pass by finding nothing and
		// quietly stop protecting anything.
		const deleted = tablesDeletedByErasure();
		expect(deleted).toContain("support_tickets");
		expect(deleted).toContain("support_messages");
		expect(deleted).toContain("orders");
	});
});
