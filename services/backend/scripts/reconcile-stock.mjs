#!/usr/bin/env node
// ============================================================
// Report products whose stock the ledger cannot explain.
//
//   node services/backend/scripts/reconcile-stock.mjs --local
//   node services/backend/scripts/reconcile-stock.mjs --remote --env staging
//
// WHAT IT CHECKS
//   Every product's `stock` should equal the sum of its rows in
//   `stock_movements`. Migration 052 makes that true at the moment it runs, by
//   writing one opening balance per product that absorbs whatever came before,
//   and every movement since is written by the statement that made it — the
//   order triggers, the mirror's opening balance for a new product, and the
//   seller's own adjustment.
//
//   So a difference is not a rounding artefact or a race. It means stock moved
//   through a path that does not record itself, which is the class of defect
//   this table was built to make visible. Work item 06's acceptance is that the
//   count of these stops growing.
//
// WHY IT IS A SCRIPT AND NOT A GUARD
//   It reads deployed data. There is nothing for CI to check on a pull request:
//   the answer lives in staging and production and changes with traffic, not
//   with the diff. Running it is an operational act, and the numbers belong in
//   a runbook entry rather than a build log.
//
// READ-ONLY. Every statement is a SELECT. It reports; it does not repair.
// A correcting entry is a deliberate act with a cause of its own —
// LEGACY_UNATTRIBUTED exists in the vocabulary for exactly that — and writing
// one automatically would let a reconciliation quietly paper over the defect it
// was run to find.
// ============================================================

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvironment, databaseFor } from "./_wrangler-args.mjs";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const remote = args.includes("--remote");
let environment;
try {
	environment = parseEnvironment(args);
} catch (error) {
	console.error(error.message);
	process.exit(2);
}

const database = databaseFor(environment);

/**
 * Quote one argument for the shell wrangler is invoked through.
 *
 * Windows needs `shell: true`, because npx is a .cmd and Node 20+ refuses to
 * execFile one directly (it returns EINVAL — the fix for CVE-2024-27980). With a
 * shell in the way, every argument is re-parsed by cmd.exe, and SQL is full of
 * characters it treats as syntax: `<` and `>` are redirection, `(` and `)` are
 * grouping, `&` is a separator. An unquoted `HAVING unexplained <> 0` becomes a
 * redirect to a file called `0`, and wrangler is left with no --command at all.
 *
 * cmd.exe unescapes a doubled quote inside a quoted string, so that is the whole
 * escape. On POSIX no shell is used and the argument passes through untouched.
 */
function shellArgument(value) {
	if (process.platform !== "win32") return value;
	return `"${String(value).replace(/"/g, '""')}"`;
}

function query(sql) {
	const command = ["d1", "execute", database, "--json", remote ? "--remote" : "--local"];
	if (environment) command.push("--env", environment);
	// Collapsed to one line. The queries below are written multi-line for
	// readability, and cmd.exe cannot carry a newline inside a quoted argument —
	// it ends the command there, so wrangler saw no --command at all. SQL does
	// not care about the whitespace; the shell does.
	command.push("--command", sql.replace(/\s+/g, " ").trim());
	const output = execFileSync("npx", ["wrangler", ...command].map(shellArgument), {
		cwd: backendRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		shell: process.platform === "win32",
		maxBuffer: 32 * 1024 * 1024,
	});
	const parsed = JSON.parse(output);
	return parsed[0]?.results ?? [];
}

const drift = query(`
  SELECT p.store_id, p.product_code, p.name, p.stock,
         COALESCE(SUM(m.delta), 0) AS ledger,
         p.stock - COALESCE(SUM(m.delta), 0) AS unexplained
  FROM products p
  LEFT JOIN stock_movements m ON m.product_id = p.id
  GROUP BY p.id
  HAVING unexplained <> 0
  ORDER BY ABS(unexplained) DESC
  LIMIT 200
`);

const summary = query(`
  SELECT
    (SELECT COUNT(*) FROM products) AS products,
    (SELECT COUNT(*) FROM stock_movements) AS movements,
    (SELECT COUNT(*) FROM stock_movements WHERE reconstructed = 1) AS reconstructed,
    (SELECT COUNT(*) FROM stock_movements WHERE reconstructed = 0) AS observed
`)[0] ?? {};

// The three counts that say how much of the pre-ledger history could not be
// recovered. They do not change after migration 052 and are worth recording
// once, because they are the size of what the opening balances absorbed.
const legacy = query(`
  SELECT
    (SELECT COUNT(*) FROM order_items WHERE product_id IS NULL) AS lines_without_product,
    (SELECT COUNT(*) FROM orders WHERE status = 'CANCELLED') AS cancelled_orders,
    (SELECT COUNT(*) FROM orders WHERE status = 'CANCELLED' AND status_changed_at IS NULL) AS cancellations_without_a_date
`)[0] ?? {};

const target = `${remote ? "remote" : "local"} ${database}${environment ? ` (${environment})` : ""}`;
console.log(`Stock reconciliation — ${target}\n`);
console.log(`  products                ${summary.products ?? 0}`);
console.log(`  movements recorded      ${summary.movements ?? 0}`);
console.log(`    observed as they ran  ${summary.observed ?? 0}`);
console.log(`    reconstructed by 052  ${summary.reconstructed ?? 0}`);
console.log("");
console.log("  What the backfill could not recover, and the opening balances absorbed:");
console.log(`    order lines whose product was deleted   ${legacy.lines_without_product ?? 0}`);
console.log(`    cancelled orders                        ${legacy.cancelled_orders ?? 0}`);
console.log(`    ...of those, with no cancellation date  ${legacy.cancellations_without_a_date ?? 0}`);
console.log("");

if (drift.length === 0) {
	console.log("Every product's stock is explained by its movements.");
	process.exit(0);
}

console.log(`UNEXPLAINED — ${drift.length} product(s) whose stock the ledger does not account for:\n`);
for (const row of drift) {
	const sign = row.unexplained > 0 ? "+" : "";
	console.log(`  ${row.product_code}  ${String(row.name).slice(0, 40)}`);
	console.log(`      stock ${row.stock}, ledger ${row.ledger}, unexplained ${sign}${row.unexplained}`);
}
console.log("\n  Each of these means stock moved through a path that does not record itself.");
console.log("  Find the path before writing a correcting entry: a LEGACY_UNATTRIBUTED row");
console.log("  makes the number reconcile and leaves the defect in place.");

// Deliberately exit 0. This reports the state of deployed data; a non-zero exit
// would read as "the run failed" and, wired into anything, would turn a finding
// about production into a broken pipeline.
process.exit(0);
