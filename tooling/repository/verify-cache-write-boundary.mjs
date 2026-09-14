/**
 * Keeps Room a cache by keeping its writers countable.
 *
 *   node tooling/repository/verify-cache-write-boundary.mjs
 *
 * THE DEFECT THIS GUARDS
 *   The catalogue used to travel as a mirror: the device sent the products it
 *   held and the server deleted the rest, so a device that had forgotten a
 *   product deleted it. ADR-012 replaced that with a rule — D1 is the system of
 *   record, Room is a cache of what D1 holds — and a rule of that shape is only
 *   as strong as the narrowest place it can be broken.
 *
 *   That place is one line. `productDao().upsert(entity)` in a view model,
 *   written a year from now by someone reasonably assuming the local database is
 *   where products live, and the app is treating a device as authoritative
 *   again. Nothing would fail. The seller would see their edit, and a later
 *   refresh would quietly replace it.
 *
 * WHY IT EXISTS
 *   So that becomes a build failure rather than a review finding. Every mutating
 *   call on the cached tables is forbidden outside the small set of files whose
 *   whole job is writing server responses into the cache.
 *
 * WHY IT IS NARROW ENOUGH TO KEEP
 *   It names specific DAO methods on three DAOs, and exempts four files. It does
 *   not police reads, does not police the order tables — orders are Class B and
 *   the device genuinely does own an unsent one — and does not care what a file
 *   is called. A new legitimate writer means adding one line here, which is the
 *   review conversation worth having.
 *
 * WHAT THIS CANNOT SEE
 *   Whether the value being written came from the server. `cache.put(response)`
 *   and `cache.put(somethingLocallyInvented)` are the same shape to any text
 *   scan, so this guard proves only WHO may write, never WHAT. The what is
 *   answered two other ways: the cache writers take wire types as parameters, so
 *   only a decoded response can produce one; and ProductWriteDecisionTest
 *   enumerates every failure a write can return and asserts none of them is
 *   storable. Both are load-bearing. A guard that claimed to cover the value
 *   question would be advertising a guarantee it cannot deliver, which is worse
 *   than not having it, because it would stop people looking.
 *
 *   It is also blind to indirection — a wrapper in `data/` called from a screen
 *   passes — and to reflection. Accepted, and stated rather than discovered.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const androidSrc = path.join(root, "apps/seller-android/app/src/main/java");
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");

const base = "apps/seller-android/app/src/main/java/app/orderak/seller";

/**
 * Files permitted to mutate a cached table.
 *
 * The three writers exist for this; `Daos.kt` is where the DAO methods are
 * declared, so it necessarily names them.
 */
const ALLOWED = new Set([
  `${base}/data/catalog/ProductCacheWriter.kt`,
  `${base}/data/catalog/CategoryCacheWriter.kt`,
  `${base}/data/customers/CustomerCacheWriter.kt`,
  `${base}/data/db/Daos.kt`,
]);

/**
 * Mutating calls on the cached tables.
 *
 * Matched on the receiver as well as the method so that an unrelated `upsert`
 * on an order DAO is not caught. Both spellings are listed because the DAO is
 * reached either through the database (`db.productDao().upsert`) or injected
 * directly (`productDao.upsert`).
 */
const MUTATORS = {
  productDao: ["upsert", "delete", "setImageUrl"],
  categoryDao: ["upsert", "delete", "replaceAll", "clear", "insertAll", "setCode"],
  customerDao: ["upsert", "applyEdit", "clearDirty"],
};

/**
 * Deliberately NOT listed above: the order-driven projections.
 *
 *   productDao.decrementStock / restoreStock / decrementStockByCode
 *   customerDao.insertIgnore / fillName
 *
 * These are the local effect of an order — stock coming off the shelf when a
 * sale is recorded and going back on when it is cancelled, and a buyer becoming
 * a customer row. Orders are Class B: the device genuinely owns one the server
 * has not acknowledged yet, and the contract describes Room as "a cache plus a
 * queue of commands" precisely so that this is expressible.
 *
 * The line this guard draws is about authority over what a product IS — its
 * name, price, existence — not about a counter moving as orders come and go. A
 * guard that caught both would have to exempt the order repository wholesale,
 * which is a larger hole than the one it closes.
 */

const PATTERNS = [];
for (const [dao, methods] of Object.entries(MUTATORS)) {
  for (const method of methods) {
    PATTERNS.push({
      re: new RegExp(`${dao}\\s*\\(\\s*\\)\\s*\\.${method}\\s*\\(|\\b${dao}\\.${method}\\s*\\(`),
      what: `${dao}.${method}() outside a cache writer`,
    });
  }
}

/**
 * Who may hold a cached DAO at all.
 *
 * The method patterns above match on the receiver's name, so a DAO bound to a
 * differently-named variable slips past them — `dao.upsert(product)` reads as
 * nothing in particular. That hole was found by trying it rather than by
 * reasoning about it, which is the only way these are ever found.
 *
 * Closing it at the call site is not possible without type inference, so it is
 * closed at the source instead: a file that cannot obtain a cached DAO cannot
 * call one under any name. The exempt files are the three writers, the two
 * read-only helpers that legitimately hold one, and the database package itself.
 *
 * `OrderakDatabase` is deliberately not covered. Reaching a DAO through it is
 * still caught by the receiver patterns, because `db.productDao().upsert(` names
 * the DAO in the expression.
 */
const DAO_HOLDERS = new Set([
  ...ALLOWED,
  // Reads only; its writes moved to ProductWriteRepository in the cutover.
  `${base}/data/catalog/CatalogRepository.kt`,
  // One-time migration job. Reads the catalogue and writes only through
  // ProductWriteRepository, which goes to the server first.
  //
  // LegacyCatalogueReconciler used to be here and no longer is: it takes narrow
  // ports now rather than a DAO, so it cannot reach one at all. A name leaving
  // this list is the direction it is supposed to move in.
  `${base}/data/catalog/StockDrain.kt`,
]);

// The bare type name, wherever it appears - a parameter, an import, or a
// fully-qualified reference. Matching `: ProductDao` was the first attempt
// and it missed `: app.orderak.seller.data.db.ProductDao?`, which is exactly
// what someone writes when they have not imported it. A type you cannot name
// is a type you cannot call, so the name itself is the boundary.
const DAO_TYPES = [/\bProductDao\b/, /\bCategoryDao\b/, /\bCustomerDao\b/];

/**
 * Raw SQL outside the database package.
 *
 * `execSQL` and `@RawQuery` bypass every method name above, so forbidding the
 * methods without forbidding these would be a guard with a door next to it.
 */
const RAW_SQL = [
  { re: /\bexecSQL\s*\(/, what: "execSQL outside data/db" },
  { re: /@RawQuery\b/, what: "@RawQuery outside data/db" },
];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "build") continue;
      walk(p, acc);
    } else if (entry.name.endsWith(".kt")) acc.push(p);
  }
  return acc;
}

const problems = [];
for (const file of walk(androidSrc)) {
  const relative = rel(file);
  const inDbPackage = relative.startsWith(`${base}/data/db/`);
  const lines = readFileSync(file, "utf8").split("\n");

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;

    if (!ALLOWED.has(relative)) {
      for (const { re, what } of PATTERNS) {
        if (re.test(line)) {
          problems.push(`${relative}:${index + 1}: ${what} — ${trimmed}`);
          return;
        }
      }
    }
    if (!DAO_HOLDERS.has(relative) && !inDbPackage) {
      for (const re of DAO_TYPES) {
        if (re.test(line)) {
          problems.push(`${relative}:${index + 1}: holds a cached DAO directly — ${trimmed}`);
          return;
        }
      }
    }
    if (!inDbPackage) {
      for (const { re, what } of RAW_SQL) {
        if (re.test(line)) {
          problems.push(`${relative}:${index + 1}: ${what} — ${trimmed}`);
          return;
        }
      }
    }
  });
}

if (problems.length) {
  console.error(`Cache written from ${problems.length} place(s) that may not write it:`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\n  D1 is the system of record and Room is a cache of what it holds (ADR-012).\n" +
    "  A product, category or customer row is written from a server response and\n" +
    "  from nothing else, which is why exactly three files may write one.\n\n" +
    "  Call the matching cache writer, or — if this really is a new legitimate\n" +
    "  writer — add it to ALLOWED here and say in the pull request why the rule\n" +
    "  needed another exception. Do not bypass this guard.",
  );
  process.exit(1);
}

console.log(
  `Cache write boundary holds: ${ALLOWED.size} files may write a cached row, ` +
  "and every other path goes through them.",
);
