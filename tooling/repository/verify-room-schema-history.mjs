// Room's declared version, its exported schemas, and what a migration may remove.
//
//   node tooling/repository/verify-room-schema-history.mjs
//
// THE DEFECT THIS GUARDS
//   The seller app is about to perform its first real Room migration. Every
//   schema change before version 10 was covered by
//   `fallbackToDestructiveMigrationFrom(1..9)` — Room threw the database away
//   and rebuilt it, which was fine while the database held nothing the server
//   did not already have. It no longer is: Room now holds orders the server has
//   not acknowledged, and throwing those away loses a sale that was made.
//
//   Room is strict at open and silent otherwise. A `@Database(version = 11)`
//   with no `11.json` beside it builds, ships, and fails on a phone; so does a
//   migration that drops a column nobody meant to drop. Neither is visible in a
//   diff unless someone reads the exported JSON, which nobody does.
//
// WHAT IS CHECKED
//   1. The declared version has an exported schema.
//   2. No version is skipped, so `N.json` exists for every version from the
//      oldest exported one to the declared one.
//   3. The destructive fallback is scoped. A bare
//      `fallbackToDestructiveMigration(` deletes a seller's unsent orders on any
//      mismatch; only the `From(...)` form, which names the versions it covers,
//      is allowed.
//   4. Between consecutive schemas, every column that disappears is named in
//      REMOVALS below. A column leaving is a decision; a column leaving quietly
//      is a defect.
//   5. `orders` and `payments` never lose a column at all. That is the
//      machine-checkable form of "a migration cannot touch the command log":
//      an unsent order is the one thing in this database with no copy anywhere
//      else.
//
// WHY IT IS NARROW ENOUGH TO KEEP
//   One declared version, one exported schema and one allowlist. It reads two
//   files plus the schema directory, and the allowlist is empty today — the
//   first migration is what fills it, and filling it is a line in a diff that
//   says exactly which columns are going.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");

const databaseFile = path.join(
  root,
  "apps/seller-android/app/src/main/java/app/orderak/seller/data/db/OrderakDatabase.kt",
);
const schemaDir = path.join(
  root,
  "apps/seller-android/app/schemas/app.orderak.seller.data.db.OrderakDatabase",
);

/**
 * Columns a migration is allowed to remove, as "version: table.column".
 *
 * Each entry is a deliberate statement that a column is going and that whatever
 * read it has stopped reading it. The evidence is written beside it, because
 * "nothing reads this" is a claim that ages, and an entry nobody can re-derive
 * is an entry nobody can safely question later.
 */
const REMOVALS = new Set([
  // Its only query, ProductDao.byRemoteUuid, had no callers. `productCode` is
  // the identity every route addresses a product by; the uuid was the mirror's.
  "11: products.remoteUuid",
  // A local foreign key to categories.id. Nothing read it: the server's
  // `categoryCode` is what travels, and the cache writer only copied it forward.
  "11: products.categoryId",
  // The flag that marked a customer edit the server had not acknowledged. A
  // customer edit is a Class A write since the cutover — it reaches the server
  // or it does not happen — so applyEdit, dirty() and clearDirty() lost their
  // last callers and went with it.
  "11: customers.dirty",
]);

/** Tables whose columns may never be removed, whatever the allowlist says. */
const PROTECTED_TABLES = new Set(["orders", "payments"]);

const problems = [];

const source = readFileSync(databaseFile, "utf8");

const declared = Number(source.match(/@Database\s*\(\s*[\s\S]*?version\s*=\s*(\d+)/)?.[1]);
if (!Number.isInteger(declared)) {
  problems.push(`${rel(databaseFile)}: could not read the declared @Database version`);
}

if (/\bfallbackToDestructiveMigration\s*\(/.test(source)) {
  problems.push(
    `${rel(databaseFile)}: bare fallbackToDestructiveMigration( deletes unsent orders on any ` +
      "schema mismatch — only the scoped fallbackToDestructiveMigrationFrom(...) form is allowed",
  );
}

const exported = existsSync(schemaDir)
  ? readdirSync(schemaDir)
      .filter((name) => /^\d+\.json$/.test(name))
      .map((name) => Number(name.replace(".json", "")))
      .sort((a, b) => a - b)
  : [];

if (exported.length === 0) {
  problems.push(`${rel(schemaDir)}: no exported schemas — exportSchema must stay on`);
}

if (Number.isInteger(declared) && !exported.includes(declared)) {
  problems.push(
    `${rel(schemaDir)}/${declared}.json is missing. Room compares the running database against ` +
      "the exported schema at open; without it the mismatch is found on a phone, not here",
  );
}

for (let version = exported[0]; version < declared; version += 1) {
  if (!exported.includes(version)) {
    problems.push(`${rel(schemaDir)}/${version}.json is missing — a migration cannot skip a version`);
  }
}

const columnsOf = (version) => {
  const file = path.join(schemaDir, `${version}.json`);
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const tables = new Map();
  for (const entity of parsed.database.entities) {
    tables.set(entity.tableName, new Set(entity.fields.map((field) => field.columnName)));
  }
  return tables;
};

for (let index = 1; index < exported.length; index += 1) {
  const from = exported[index - 1];
  const to = exported[index];
  const before = columnsOf(from);
  const after = columnsOf(to);

  for (const [table, columns] of before) {
    const now = after.get(table);
    if (!now) continue; // A dropped table is its own decision; columns are this check.
    for (const column of columns) {
      if (now.has(column)) continue;
      const entry = `${to}: ${table}.${column}`;
      if (PROTECTED_TABLES.has(table)) {
        problems.push(
          `${entry} — ${table} holds commands the server has not acknowledged. A column may ` +
            "not be removed from it, and no allowlist entry makes that acceptable",
        );
      } else if (!REMOVALS.has(entry)) {
        problems.push(
          `${entry} removed without being named. Add "${entry}" to REMOVALS in ${rel(
            path.join(here, "verify-room-schema-history.mjs"),
          )} once whatever read it has stopped`,
        );
      }
    }
  }
}

if (problems.length) {
  console.error(`Room schema history verification failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\n  Room throws at open when the database it finds does not match the schema it\n" +
      "  expects, and this app's database now holds orders that exist nowhere else.\n" +
      "  Run the app's assemble task to regenerate the exported schema, or name the\n" +
      "  removal deliberately. Do not bypass this guard.",
  );
  process.exit(1);
}

console.log(
  `Room schema history verified: version ${declared} declared, ` +
    `${exported.length} schema(s) exported (${exported.join(", ")}), ` +
    `${REMOVALS.size} named column removal(s), destructive fallback scoped.`,
);
