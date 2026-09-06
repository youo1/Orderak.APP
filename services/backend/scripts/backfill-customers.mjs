#!/usr/bin/env node
// ============================================================
// Build the customers table from the buyer phones already on orders.
//
//   node services/backend/scripts/backfill-customers.mjs --local
//   node services/backend/scripts/backfill-customers.mjs --local --apply
//   node services/backend/scripts/backfill-customers.mjs --remote --env staging --apply
//
// WHY THIS IS NOT IN THE MIGRATION
//   Classifying a stored value needs libphonenumber and the store's own country.
//   SQL has neither. A migration could only have applied a crude rule — strip
//   non-digits, assume a country — and its output would be indistinguishable
//   from a correct one afterwards: confident merges that nothing could later
//   tell apart from real ones. Merging two people's order histories is not
//   reversible, so the rule has to be the careful one and it has to run here.
//
// THE POLICY, WHICH IS THE POINT OF THE SCRIPT
//   Three outcomes, and a merge is never automatic:
//
//     valid      resolves to exactly one E.164 number, read against the store's
//                own country. Two spellings that resolve to the same number
//                become one customer — that is the whole benefit.
//     ambiguous  plausible, but the store's country does not explain it. Kept
//                verbatim, keyed to itself, flagged. It may well be a real
//                number from somewhere else; nothing here can say whose.
//     invalid    not a plausible number at all. Same treatment: kept, flagged,
//                never merged.
//
//   Nothing is deleted, nothing in `orders` is rewritten, and no unresolvable
//   value is ever attached to a resolvable one.
//
// TWO EXEMPTIONS IT MUST HONOUR
//   `deleted:<hash>` and `expired:<id>` sentinels are written into buyer_phone
//   by the buyer-privacy erasure path. They are not numbers. Creating a customer
//   from one would rebuild a record of the person whose record was just erased,
//   so they are skipped and counted.
//
//   `orders.buyer_phone` is never touched. Three admin console queries GROUP BY
//   it and one joins restrictions on its last four characters, so normalising in
//   place would silently split or merge groupings an operator relies on. The
//   normalised form lives beside the raw value, never instead of it.
//
// DRY RUN BY DEFAULT. Without --apply it reports what it would write and writes
// nothing. Read the ambiguous and invalid counts before applying: they are the
// rows a human has to look at, and they do not get smaller by being ignored.
// ============================================================

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const remote = args.includes("--remote");
const apply = args.includes("--apply");
const envIndex = args.indexOf("--env");
const environment = envIndex >= 0 ? args[envIndex + 1] : null;

const SAFE = /^[A-Za-z0-9_.-]+$/;
if (environment !== null && !SAFE.test(environment)) {
	console.error(`Refusing to pass ${JSON.stringify(environment)} to a shell.`);
	process.exit(2);
}

const database = environment === "staging" ? "orderak-db-staging" : "orderak-db";

function run(sql) {
	const command = ["d1", "execute", database, "--json", remote ? "--remote" : "--local"];
	if (environment) command.push("--env", environment);
	command.push("--command", sql);
	const output = execFileSync("npx", ["wrangler", ...command], {
		cwd: backendRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		// Windows needs shell:true — npx is a .cmd and Node will not execFile one.
		shell: process.platform === "win32",
		maxBuffer: 64 * 1024 * 1024,
	});
	return JSON.parse(output)[0]?.results ?? [];
}

/** SQL string literal. Every value written below passes through this. */
const quote = (value) =>
	(value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`);

/**
 * The three-outcome rule, imported rather than reimplemented.
 *
 * This is the same module the running server uses. A backfill that classified
 * differently from the server would write rows under keys the server then could
 * not find, and nothing would notice until a seller reported a customer that had
 * vanished — so the two must not be separate implementations that merely agree
 * today. Node strips the types; the module imports nothing but libphonenumber-js
 * and touches no Workers global.
 */
const { normalizeBuyerPhone } = await import(
	new URL("../src/domains/identity/phone.ts", import.meta.url).href
);

// ---- Read ------------------------------------------------------------------

const rows = run(`
  SELECT o.store_id,
         o.buyer_phone,
         s.country_code,
         COUNT(*) AS orders,
         MAX(o.created_at) AS last_order_at,
         (SELECT o2.buyer_name FROM orders o2
           WHERE o2.store_id = o.store_id AND o2.buyer_phone = o.buyer_phone
             AND o2.buyer_name IS NOT NULL AND o2.buyer_name <> ''
           ORDER BY o2.created_at DESC LIMIT 1) AS buyer_name
    FROM orders o
    LEFT JOIN sellers s ON s.id = o.store_id
   GROUP BY o.store_id, o.buyer_phone
`);

// ---- Classify --------------------------------------------------------------

const counts = { valid: 0, ambiguous: 0, invalid: 0, sentinel: 0 };

/** store_id -> Map(customer_key -> the row we intend to write). */
const planned = new Map();

/**
 * store_id -> Map(customer_key -> Set of raw spellings) for keys reached more
 * than once: the merges this run actually achieves.
 *
 * Nested rather than keyed by a joined string. A phone_raw can hold a space —
 * "010 1234 5678" survives exactly as typed — so any single-character separator
 * could occur inside the values it was separating.
 */
const merges = new Map();

for (const row of rows) {
	const storeId = String(row.store_id);
	const raw = String(row.buyer_phone ?? "");
	const lastOrderAt = String(row.last_order_at ?? "");
	const result = normalizeBuyerPhone(raw, row.country_code);
	counts[result.outcome] += 1;
	if (result.outcome === "sentinel") continue;

	const forStore = planned.get(storeId) ?? new Map();
	planned.set(storeId, forStore);

	const existing = forStore.get(result.key);
	if (existing) {
		// A second spelling of a number already seen. Recorded so the report can
		// say how many customers this joined up rather than implying it.
		const storeMerges = merges.get(storeId) ?? new Map();
		merges.set(storeId, storeMerges);
		const spellings = storeMerges.get(result.key) ?? new Set([existing.raw]);
		spellings.add(result.raw);
		storeMerges.set(result.key, spellings);
		// The most recent order's name wins; the raw form stays the first seen.
		if (lastOrderAt > existing.lastOrderAt) {
			existing.name = row.buyer_name ?? existing.name;
			existing.lastOrderAt = lastOrderAt;
		}
		continue;
	}

	forStore.set(result.key, {
		storeId,
		key: result.key,
		e164: result.e164,
		raw: result.raw,
		status: result.outcome,
		name: row.buyer_name ?? null,
		lastOrderAt,
	});
}

const toWrite = [...planned.values()].flatMap((forStore) => [...forStore.values()]);
const mergedPairs = [...merges].flatMap(([storeId, byKey]) =>
	[...byKey].map(([key, spellings]) => ({ storeId, key, spellings: [...spellings] })),
);

// ---- Report ----------------------------------------------------------------

const target = `${remote ? "remote" : "local"} ${database}${environment ? ` (${environment})` : ""}`;
console.log(`Customer backfill — ${target}${apply ? "" : "  [DRY RUN]"}\n`);
console.log(`  distinct (store, buyer_phone) pairs   ${rows.length}`);
console.log(`  customers to write                    ${toWrite.length}`);
console.log("");
console.log("  Classification:");
console.log(`    valid — resolved to one E.164       ${counts.valid}`);
console.log(`    ambiguous — kept, flagged           ${counts.ambiguous}`);
console.log(`    invalid — kept, flagged             ${counts.invalid}`);
console.log(`    privacy sentinels — skipped         ${counts.sentinel}`);
console.log("");
console.log(`  Spellings joined into one customer:   ${mergedPairs.length}`);
for (const merged of mergedPairs.slice(0, 20)) {
	console.log(`    ${merged.key}  <-  ${merged.spellings.join(", ")}`);
}
if (mergedPairs.length > 20) console.log(`    ...and ${mergedPairs.length - 20} more`);

if (counts.ambiguous + counts.invalid > 0) {
	console.log("");
	console.log(`  ${counts.ambiguous + counts.invalid} value(s) could not be resolved and were NOT merged.`);
	console.log("  They are written verbatim with phone_status flagged, and need a human.");
	console.log("  Find them with:");
	console.log("    SELECT store_id, phone_raw, phone_status FROM customers WHERE phone_status <> 'valid';");
}

if (!apply) {
	console.log("\nDry run: nothing was written. Re-run with --apply once the counts above look right.");
	process.exit(0);
}

// ---- Write -----------------------------------------------------------------
//
// INSERT ... ON CONFLICT DO NOTHING, so a re-run is safe and a customer the
// order path has created since is left exactly as it is — including any name the
// seller has typed, which this script has no business replacing.

const BATCH = 200;
let written = 0;
for (let index = 0; index < toWrite.length; index += BATCH) {
	const slice = toWrite.slice(index, index + BATCH);
	const values = slice
		.map((row) => `(${[
			quote(row.storeId), quote(row.key), quote(row.e164), quote(row.raw),
			quote(row.status), quote(row.name),
		].join(",")})`)
		.join(",");
	run(
		`INSERT INTO customers (store_id, customer_key, phone_e164, phone_raw, phone_status, name)
		 VALUES ${values}
		 ON CONFLICT(store_id, customer_key) DO NOTHING`,
	);
	written += slice.length;
	console.log(`  wrote ${written} / ${toWrite.length}`);
}

const total = run("SELECT COUNT(*) AS c FROM customers")[0]?.c ?? 0;
console.log(`\nDone. customers now holds ${total} row(s).`);
