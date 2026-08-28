/**
 * Refuses hand-written colour in the Android app.
 *
 *   node tooling/repository/verify-no-hardcoded-colors.mjs
 *
 * Colour reaches the app through one route: generateDesignSystem() emits
 * GeneratedDesignSystem.kt, and that generator fails on any role pair below its
 * required contrast ratio. It is the only contrast gate in the system. A colour
 * written by hand does not merely break visual consistency — it arrives without
 * ever having been checked, and nothing downstream will notice.
 *
 * The admin panel is the worked example of what this prevents: 34 of its 51
 * distinct colours sit outside the design system, nineteen of them a blue-slate
 * ramp left over from an earlier design, and they accumulated one reasonable
 * exception at a time.
 *
 * Fails when a Kotlin file outside the generated theme sources declares a raw
 * ARGB literal or builds a Color from raw channel values.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const androidSrc = path.join(root, "apps/seller-android/app/src/main/java");
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");

/**
 * Files allowed to contain colour literals.
 *
 * `GeneratedDesignSystem.kt` is the generator's output and is regenerated, never
 * edited. `Color.kt` holds the extended-role data class; its literals are the
 * fallbacks the generator also produces. Nothing else qualifies: a screen that
 * needs a colour the system does not have is telling you the system is missing a
 * role, and the fix is to add the role.
 */
const ALLOWED = new Set([
  "apps/seller-android/app/src/main/java/app/orderak/seller/core/ui/theme/GeneratedDesignSystem.kt",
  "apps/seller-android/app/src/main/java/app/orderak/seller/core/ui/theme/Color.kt",
]);

/** 0xFF014D4E and friends, plus Color(r, g, b) built from raw channels. */
const PATTERNS = [
  { re: /0x[0-9A-Fa-f]{8}\b/g, what: "raw ARGB literal" },
  { re: /Color\(\s*(?:0x)?[0-9A-Fa-f]{6,8}\s*\)/g, what: "Color built from a literal" },
  { re: /Color\(\s*red\s*=|Color\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g, what: "Color built from raw channels" },
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
  if (ALLOWED.has(relative)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
    for (const { re, what } of PATTERNS) {
      re.lastIndex = 0;
      const match = re.exec(line);
      if (match) {
        problems.push(`${relative}:${index + 1}: ${what} — ${match[0].trim()}`);
        break;
      }
    }
  });
}

if (problems.length) {
  console.error(`Hand-written colour found in ${problems.length} place(s):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\n  Colour must come from MaterialTheme.colorScheme or LocalOrderakExtendedColors.\n" +
    "  If the role you need does not exist, add it to the generator in\n" +
    "  services/backend/src/domains/design/design-system.ts and regenerate:\n" +
    "  the contrast validation there is the only gate colour passes through.",
  );
  process.exit(1);
}

console.log("No hand-written colour: every value reaches the app through the generator.");
