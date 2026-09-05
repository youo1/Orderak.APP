/**
 * Refuses money that does not name its locale, or its exponent.
 *
 *   node tooling/repository/verify-money-locale.mjs
 *
 * TWO RULES, ONE FILE, BECAUSE THEY ARE THE SAME MISTAKE
 *   Both are an amount being handled as though its currency were already known.
 *   One drops the locale and renders the digits wrong; the other assumes two
 *   decimal places and renders the VALUE wrong.
 *
 * `formatAmount` and `formatMoney` default to `Locale.getDefault()`. That is the
 * right default for a library function and the wrong one for a screen: the app
 * switches language in-process, dates are formatted from the composition locale,
 * and an amount that reads the ambient default can end up in Latin digits beside
 * an Arabic-Indic date in the same row. It did — the order list shipped that way
 * until a greyscale screenshot put the two side by side.
 *
 * Fails when a call site outside the money package omits the locale argument,
 * and when one divides or multiplies a money-shaped value by a literal power of
 * ten.
 *
 * WHY THE SECOND RULE EXISTS
 *   PaymentVerifier.evaluate took `expectedTotalPiasters: Long` and divided by a
 *   literal 100 to decide whether a transfer receipt matched an order. Kuwait,
 *   Bahrain and Oman have three decimal places and are all in
 *   SUPPORTED_CURRENCIES, so in those markets a correct receipt was refused and
 *   one for a tenth of the amount was accepted. This guard could not see it:
 *   it counted arguments to formatAmount and formatMoney and nothing else.
 *
 *   Writing the rule found a second instance nobody had reported —
 *   ProductEditViewModel rendered its price field with `priceMinor / 100.0` and
 *   parsed it back as EGP, so the editor was wrong for the same three
 *   currencies in both directions.
 *
 * WHY IT IS NARROW ENOUGH TO KEEP
 *   The rule needs a money-shaped identifier AND a power-of-ten literal on the
 *   same line. Across the whole Android source that matched twice, and both were
 *   real. Matching every power-of-ten literal instead would have caught
 *   timeouts, percentages and byte counts, and a guard that cries wolf earns an
 *   ignore list that eventually swallows the case it was written for.
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

/**
 * An identifier that means "this is money", and a literal power of ten.
 *
 * The money package is exempt: minorUnitsPerMajor and pow10 are where the
 * conversion is supposed to live, and they are keyed on the currency.
 */
const MONEY_IDENTIFIER = /\b(?:[a-zA-Z]*[Mm]inor|[Pp]iasters?|[Ff]ils|amount|Amount|total|Total|price|Price)\b/;
const POWER_OF_TEN = /[*/]\s*100{1,2}(?:\.0+)?\b/;

const problems = [];
const exponentProblems = [];
for (const file of walk(androidSrc)) {
  const relative = rel(file);
  if (relative.startsWith(ALLOWED_DIR)) continue;
  const source = readFileSync(file, "utf8");

  source.split("\n").forEach((line, index) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    if (POWER_OF_TEN.test(line) && MONEY_IDENTIFIER.test(line)) {
      exponentProblems.push(`${relative}:${index + 1}: ${trimmed.slice(0, 100)}`);
    }
  });

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

if (exponentProblems.length) {
  console.error(`Money converted by a literal power of ten in ${exponentProblems.length} place(s):`);
  for (const p of exponentProblems) console.error(`  ${p}`);
  console.error(
    "\n  The number of minor units in a major unit is the currency's, not a constant.\n" +
    "  It is 100 in Egypt and 1000 in Kuwait, Bahrain and Oman, all of which the\n" +
    "  app already supports.\n" +
    "    minorUnitsPerMajor(currency)  to convert\n" +
    "    parseMinorUnits(text, currency)  to read a written amount\n" +
    "    majorUnitsText(money)  to render one into an editable field\n" +
    "  Better still, compare in minor units and do not convert at all.",
  );
  process.exit(1);
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

console.log("Money names its locale at every call site, and its exponent at every conversion.");
