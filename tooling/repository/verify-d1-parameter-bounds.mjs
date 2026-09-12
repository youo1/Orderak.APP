/**
 * Refuses an `IN (...)` list whose length nothing bounds.
 *
 *   node tooling/repository/verify-d1-parameter-bounds.mjs
 *
 * WHY THIS RULE EXISTS
 *   D1 rejects a statement carrying more than 100 bound parameters. A query
 *   built as `IN (${keys.map(() => "?").join(",")})` therefore has a hard
 *   ceiling that is nowhere near the size of the arrays being passed to it, and
 *   the failure is a driver-level error that reads as a platform fault rather
 *   than as "too many rows".
 *
 *   Two of these shipped. The nightly media sweep selected 500 orphans, deleted
 *   all 500 objects from R2, and then bound 500 parameters into one DELETE: the
 *   objects were destroyed, the rows survived, the same 500 were re-selected the
 *   next night, and the sweep wedged permanently on its first full batch. The
 *   entitlement editor built one placeholder per key against a 242-row
 *   catalogue, so saving a plan revision's full value set — the ordinary
 *   operation, not an edge case — failed outright.
 *
 *   Both were written in a codebase that already knew the limit: api-store.ts
 *   had been chunking the identical pattern at 90 for months, with a comment
 *   saying why. Knowing it in one file did not stop it being rediscovered in
 *   two others, which is the argument for a guard rather than a third comment.
 *
 * WHAT COUNTS AS BOUNDED
 *   One of three things, within the ten lines above the query:
 *     - chunking by D1_IN_CHUNK, the single shared constant;
 *     - chunking by a numeric literal of 100 or less;
 *     - a `D1-BOUND:` comment stating the bound and where it is enforced.
 *
 *   The third exists because some of these lists are already bounded somewhere
 *   else — an order is capped at 50 lines, a page at 50 orders — and rewriting
 *   a correct query to satisfy a linter is how guards earn their ignore lists.
 *   What the annotation buys is that the bound is stated next to the query that
 *   depends on it, so relaxing the limit elsewhere is visibly a change to this
 *   code too.
 *
 * WHY IT IS NARROW ENOUGH TO KEEP
 *   It matches a template interpolation inside an `IN (` only. Across the whole
 *   backend that is six sites, and every one of them is a real instance of the
 *   pattern this is about. It reads no SQL and understands no queries; it asks
 *   one question about ten lines of context, and a false positive is answered by
 *   stating the bound, which is worth stating anyway.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const searchRoot = path.join(repoRoot, "services", "backend", "src");
const MAX_D1_PARAMS = 100;
const CONTEXT_LINES = 10;

/** Every .ts file under src/, except the generated environment declarations. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "generated") out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const findings = [];
let checked = 0;

for (const file of sourceFiles(searchRoot)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    // A template interpolation inside an IN list. Anything else is a literal
    // placeholder list, whose length is visible in the source.
    if (!/IN \(\$\{/.test(line)) return;
    checked += 1;

    const context = lines.slice(Math.max(0, index - CONTEXT_LINES), index + 1).join("\n");
    if (/D1-BOUND:/.test(context)) return;
    if (/D1_IN_CHUNK/.test(context)) return;

    // A chunk loop with a literal step, e.g. `offset += 90`.
    const step = context.match(/\+=\s*(\d+)\b/);
    if (step && Number(step[1]) <= MAX_D1_PARAMS) return;

    findings.push({
      file: path.relative(repoRoot, file).replaceAll("\\", "/"),
      line: index + 1,
      text: line.trim().slice(0, 110),
    });
  });
}

if (findings.length) {
  console.error(`\nUnbounded IN (...) list — D1 rejects more than ${MAX_D1_PARAMS} bound parameters per statement.\n`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}\n    ${f.text}\n`);
  console.error("Chunk by D1_IN_CHUNK, or state the existing bound in a `D1-BOUND:` comment above the query.");
  console.error("See tooling/repository/verify-d1-parameter-bounds.mjs for why this is a correctness bound.\n");
  process.exit(1);
}

console.log(`D1 parameter bounds: ${checked} dynamic IN list(s) checked, all bounded.`);
