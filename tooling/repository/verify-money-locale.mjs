/**
 * Refuses money formatting that does not name its locale.
 *
 *   node tooling/repository/verify-money-locale.mjs
 *
 * `formatAmount` and `formatMoney` default to `Locale.getDefault()`. That is the
 * right default for a library function and the wrong one for a screen: the app
 * switches language in-process, dates are formatted from the composition locale,
 * and an amount that reads the ambient default can end up in Latin digits beside
 * an Arabic-Indic date in the same row. It did — the order list shipped that way
 * until a greyscale screenshot put the two side by side.
 *
 * Fails when a call site outside the money package omits the locale argument.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const androidSrc = path.join(root, "apps/seller-android/app/src/main/java");
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");

/** The money package defines the functions and their defaults. */
const ALLOWED_DIR = "apps/seller-android/app/src/main/java/app/orderak/seller/core/money";

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

/**
 * Counts arguments at depth 0 of a call, so a nested call in an argument does
 * not fool the count.
 */
function argumentCount(source, openIndex) {
  let depth = 0;
  let args = 1;
  for (let i = openIndex; i < source.length; i += 1) {
    const c = source[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return args;
    } else if (c === "," && depth === 1) args += 1;
  }
  return args;
}

const problems = [];
for (const file of walk(androidSrc)) {
  const relative = rel(file);
  if (relative.startsWith(ALLOWED_DIR)) continue;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bformat(?:Amount|Money)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const count = argumentCount(source, open);
    const needed = match[0].startsWith("formatAmount") ? 3 : 2;
    if (count < needed) {
      const line = source.slice(0, match.index).split("\n").length;
      problems.push(`${relative}:${line}: ${match[0].slice(0, -1)} called without a locale`);
    }
  }
}

if (problems.length) {
  console.error(`Money formatted without a locale in ${problems.length} place(s):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\n  Pass the locale the screen is drawing with:\n" +
    "    val locale = LocalConfiguration.current.locales[0]\n" +
    "  Outside Compose, use context.resources.configuration.locales[0].\n" +
    "  Reading the ambient default leaves money on a different numeral system\n" +
    "  from the dates beside it.",
  );
  process.exit(1);
}

console.log("Money formatting names its locale at every call site.");
