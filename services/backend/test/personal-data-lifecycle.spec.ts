import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { createSchema } from "./helpers";
import { RETENTION_EXEMPT_TABLES, retentionRuleTables } from "../src/domains/identity/retention";
import deletionSource from "../src/domains/identity/deletion.ts?raw";

/**
 * Every table holding a person's contact details must have a way to lose them.
 *
 * retention.ts already exports RETENTION_EXEMPT_TABLES and retentionRuleTables()
 * so a test can ask this, and retention.spec.ts uses them only to assert that
 * stock_movements is not named. That checks the exemptions are honoured; it
 * cannot see a table that is in neither list, which is the state a new table
 * arrives in and stays in silently.
 *
 * So this asks the inverse question: for every table whose columns say it holds
 * a phone number, an email address, a person's name or a purchase token, is
 * there anything at all that would ever remove it? Three answers count — account
 * deletion removes it, a retention rule ages it out, or it is named below with a
 * reason. Nothing else does, and "nobody has noticed yet" is not one of them.
 */

/**
 * Column names that mean a person, not a thing.
 *
 * Deliberately narrow. `name` alone matches plans, categories and products and
 * would turn this into a guard that everyone learns to add exemptions to; these
 * patterns match columns that only ever hold someone's contact details.
 */
const PERSONAL_COLUMN = /(^|_)(phone|email|msisdn)|_addr$|buyer_name|full_name|customer_name|alt_contact|purchase_token/i;

/**
 * Tables that hold personal data and deliberately have no lifecycle rule.
 *
 * A reason, not a note. If one of these ever gains a rule the last test below
 * fails, so the list cannot quietly outlive what it describes.
 */
const NO_LIFECYCLE_BY_DESIGN: Record<string, string> = {
	// Evidence for the account itself. retention-matrix.md §2 sets this at
	// "account lifetime + 5 years", and deletion.ts de-identifies rather than
	// deletes so the acceptance survives the account it belonged to.
	legal_acceptances: "Consent evidence, de-identified on deletion and kept as proof.",
	// The same shape: a completed erasure is kept, de-identified, as proof that
	// the erasure happened.
	deletion_requests: "Erasure evidence, de-identified on completion and kept as proof.",
	// The seller's own row. Not deleted but de-identified in place, because
	// orders and stock movements reference it and the ledger must stay readable.
	sellers: "De-identified in place by account deletion; the row anchors the ledger.",
	// Staff, not sellers or buyers. An administrator's account ends when an owner
	// deactivates it through /access/admins — a step-up-authorised, audited act —
	// and ageing one out on a timer would remove access nobody asked to remove.
	// The audit trail of what they did is governed separately, at admin_audit:2y.
	admin_users: "A staff account, removed by an owner through the access surface, not on a timer.",
};

function tablesDeletedByErasure(): Set<string> {
	return new Set(
		[...deletionSource.matchAll(/(?:DELETE\s+FROM|UPDATE)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)]
			.map((match) => match[1].toLowerCase()),
	);
}

/** Tables whose columns say they hold someone's contact details. */
async function tablesHoldingPersonalData(): Promise<Map<string, string[]>> {
	const { results } = await env.orderak_db.prepare(
		"SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
	).all<{ name: string; sql: string }>();

	const found = new Map<string, string[]>();
	for (const table of results ?? []) {
		// The column list, without the REFERENCES clauses that name other tables'
		// columns — those would attribute a parent's phone column to every child.
		const body = table.sql.slice(table.sql.indexOf("(") + 1).replace(/REFERENCES[^,]*/gi, "");
		const columns = [...body.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)/g)]
			.map((m) => m[1])
			.filter((column) => PERSONAL_COLUMN.test(column));
		if (columns.length) found.set(table.name.toLowerCase(), columns);
	}
	return found;
}

beforeEach(async () => {
	await createSchema();
});

describe("personal data lifecycle", () => {
	it("finds the tables it is asserting about", async () => {
		// Guards the guard: if the schema read or the column pattern stops
		// matching, every assertion below passes by finding nothing.
		const holders = await tablesHoldingPersonalData();
		expect(holders.size).toBeGreaterThan(10);
		expect([...holders.keys()]).toContain("customers");
	});

	it("gives every table holding contact details a way to lose them", async () => {
		const holders = await tablesHoldingPersonalData();
		const deleted = tablesDeletedByErasure();
		const aged = new Set(retentionRuleTables().map((t) => t.toLowerCase()));
		const exempt = new Set(RETENTION_EXEMPT_TABLES.map((t) => t.toLowerCase()));

		const orphaned = [...holders.entries()]
			.filter(([table]) =>
				!deleted.has(table) && !aged.has(table) && !exempt.has(table)
				&& !(table in NO_LIFECYCLE_BY_DESIGN))
			.map(([table, columns]) => `${table} (${columns.join(", ")})`)
			.sort();

		expect(
			orphaned,
			"these tables hold someone's phone, email, name or purchase token and nothing "
			+ "ever removes it: not account deletion, not a retention rule, and not a stated exemption",
		).toEqual([]);
	});

	it("keeps the by-design list honest", async () => {
		const holders = await tablesHoldingPersonalData();
		const stale = Object.keys(NO_LIFECYCLE_BY_DESIGN).filter((table) => !holders.has(table));
		expect(stale, `named as holding personal data but no longer does: ${stale.join(", ")}`).toEqual([]);
	});
});
