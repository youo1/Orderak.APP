#!/usr/bin/env node
// ============================================================
// Keep the admin panel's own stylesheets on the design system.
//
// WHY THIS EXISTS
//   `docs/domains/design-system-reference.md` states the rule for every screen in
//   this product: "Never invent a colour, spacing value, type size, radius,
//   duration or shadow. A literal outside `orderak-tokens.css` is a bug."
//
//   The admin panel breaks that rule in its own stylesheet. Colour was fixed —
//   `verify-no-hardcoded-colors.mjs` guards the Android client and the admin
//   panel's colour is genuinely token-bound. Geometry and typography were not.
//   The panel carries dozens of hand-picked font sizes and radii, and eight of
//   those sizes are below the system's own 12px floor for Latin text a user has
//   to read. The smallest is 9.9px.
//
//   Nothing detected it. A screen that invents `font-size: .68rem` looks
//   deliberate in review, renders fine on the reviewer's display, and is
//   invisible to every existing check.
//
// THE RULE
//   Every count is zero, so this is an absolute rule rather than a budget: a new
//   literal fails immediately. It began as a ratchet, because a guard that fails
//   on the current state cannot land and one that tolerates any number records
//   nothing. The migration closed the gap in two moves — 71 font sizes bound to
//   type roles, 55 radii snapped onto the shape set — and the ceilings came down
//   with it. Raising one needs a reason in the pull request.
//
//   Both moves changed pixels deliberately. Eight font sizes sat below the
//   system's own 12px floor for text a user reads; the smallest was 9.9px. The
//   panel carried eighteen distinct radii, five of them inside a 3px band. Those
//   were not a hierarchy, they were a habit.
//
//   Weight closed in a third move. The type scale says "Weight is 400 or 500 —
//   there is no bold display type in this product" and "Never mix one role's size
//   with another's weight", and the panel had 21 rules at 650/700/800/900 plus
//   five Tailwind `font-semibold` classes in the component kit. That last part is
//   what made it worth guarding rather than tidying: a role claimed to be applied
//   while `th`, `.status` and `.eyebrow` each kept their own `font-weight: 800`,
//   so the table header, the status chip and the eyebrow were three different
//   bolds that no role had chosen.
//
// WHAT IS CHECKED (and what is deliberately not)
//   1. `font-size` must resolve to `var(--orderak-type-*-size)`.
//   2. `border-radius` and its corner variants must resolve to
//      `var(--orderak-shape-*)`.
//   3. `transition` / `animation` must resolve to a duration or motion token.
//   4. `var(--x)` must name a custom property that is declared somewhere in the
//      app or supplied at runtime by the theme builder's preview script.
//   5. `font-weight` must resolve to `var(--orderak-type-*-weight)`, and a
//      Tailwind weight utility in a component must be `font-normal` or
//      `font-medium`.
//
//   Spacing is NOT checked here. A length in `padding` or `gap` is often
//   structural — matching a fixed 74px header, a 268px brand rail — and a check
//   that cannot tell those from an invented rhythm would be ignored within a week.
//   Line-height is not checked either: it belongs to the role, and every element
//   that takes a role's size and weight should take the role's leading in the same
//   pass, which is the next migration.
//
//   One non-stylesheet check lives here because it protects the same thing from
//   the other direction: `components.json` claimed the kit lived at
//   `@/components/ui`, `@/lib` and `@/hooks`, and none of those directories
//   existed. The kit is `src/shared/ui`. Left uncorrected, the next `shadcn add`
//   would have written a third parallel component set into `src/components/ui`,
//   which is precisely the defect this guard exists to close.
//
// Usage: node tooling/repository/verify-admin-token-conformance.mjs
//         --report   list every literal instead of only the ones over budget
// ============================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const adminSrc = path.join(repositoryRoot, "apps", "admin-web", "src");
const reportMode = process.argv.includes("--report");

/**
 * The generated bundle is the token source, not a consumer: it declares the
 * literals every other file is supposed to reference.
 */
const GENERATED = new Set(["orderak-tokens.css"]);

/**
 * All zero: the migrations are done and nothing is grandfathered. Raising one of
 * these needs a stated reason, because every raise is a value the design system
 * does not know about.
 */
const CEILING = {
	"type-size": 0,
	radius: 0,
	duration: 0,
	weight: 0,
	"weight-class": 0,
	"unknown-var": 0,
};

/**
 * Custom properties the theme builder's preview script sets at runtime. The
 * preview stylesheet no longer needs the short shape names, but they are kept
 * here so a future preview-only property does not have to be argued for as a
 * special case.
 */
const RUNTIME_PROPERTIES = new Set([
	"--preview-font",
	"--gap",
	"--touch",
]);

const RULES = [
	{
		kind: "type-size",
		find: /\bfont-size\s*:\s*([^;{}]+)/g,
		isToken: (value) => value.includes("var(--orderak-type-") || value.includes("inherit") || value.includes("100%"),
		remedy: "use a type role: var(--orderak-type-<role>-size)",
	},
	{
		kind: "radius",
		find: /(?:^|[\s;{])(border(?:-[a-z]+)*-radius)\s*:\s*([^;{}]+)/g,
		valueIndex: 2,
		isToken: (value) =>
			value.includes("var(--orderak-shape-") || value.includes("inherit") || value.trim() === "0" || value.includes("50%"),
		remedy: "use a shape token: var(--orderak-shape-<size>)",
	},
	{
		kind: "duration",
		find: /(?:^|[\s;{])(transition|animation)(?:-duration)?\s*:\s*([^;{}]+)/g,
		valueIndex: 2,
		isToken: (value) =>
			value.includes("var(--orderak-duration-") || value.includes("var(--orderak-motion-") || value.includes("none"),
		remedy: "use var(--orderak-motion-*) or var(--orderak-duration-*)",
	},
	{
		kind: "weight",
		find: /(?:^|[\s;{])(font-weight)\s*:\s*([^;{}]+)/g,
		valueIndex: 2,
		isToken: (value) => value.includes("var(--orderak-type-") || value.includes("inherit"),
		remedy: "use the weight the element's own type role declares: var(--orderak-type-<role>-weight)",
	},
];

function stylesheets(directory) {
	const found = [];
	for (const entry of readdirSync(directory)) {
		const full = path.join(directory, entry);
		if (entry === "node_modules" || entry === "dist") continue;
		if (statSync(full).isDirectory()) found.push(...stylesheets(full));
		else if (entry.endsWith(".css") && !GENERATED.has(entry)) found.push(full);
	}
	return found;
}

/** Components, for the checks that live in a class name rather than a rule. */
function components(directory) {
	const found = [];
	for (const entry of readdirSync(directory)) {
		const full = path.join(directory, entry);
		if (entry === "node_modules" || entry === "dist") continue;
		if (statSync(full).isDirectory()) found.push(...components(full));
		else if (entry.endsWith(".tsx")) found.push(full);
	}
	return found;
}

const files = stylesheets(adminSrc);
const source = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));

/** Every custom property declared anywhere in the app, or supplied at runtime. */
const declared = new Set(RUNTIME_PROPERTIES);
for (const text of source.values()) {
	for (const match of text.matchAll(/(^|[\s;{])--([a-z0-9-]+)\s*:/g)) declared.add(`--${match[2]}`);
}
// The generated bundle declares the whole token set.
const generated = readFileSync(path.join(adminSrc, "orderak-tokens.css"), "utf8");
for (const match of generated.matchAll(/(^|[\s;{])--([a-z0-9-]+)\s*:/g)) declared.add(`--${match[2]}`);

const counts = {};
const details = {};
for (const [kind, rule] of RULES.entries()) {
	void kind;
}
for (const rule of RULES) {
	counts[rule.kind] = 0;
	details[rule.kind] = [];
	for (const [file, text] of source) {
		for (const match of text.matchAll(rule.find)) {
			const value = (rule.valueIndex ? match[rule.valueIndex] : match[1]).trim();
			if (rule.isToken(value)) continue;
			counts[rule.kind] += 1;
			const line = text.slice(0, match.index).split(/\r?\n/).length;
			details[rule.kind].push(`${path.relative(repositoryRoot, file).replace(/\\/g, "/")}:${line} ${value}`);
		}
	}
}

counts["unknown-var"] = 0;
details["unknown-var"] = [];
for (const [file, text] of source) {
	// The theme builder's preview stylesheet is the one place a property name is
	// built at runtime: `preview.ts` loops over the snapshot's colour roles and
	// sets `--md-<role>` for each. No file declares that family, and no static
	// check can enumerate it, so a name that cannot be resolved here is expected
	// rather than wrong. The allowance is confined to that directory — the panel
	// itself uses the generated `--md-sys-color-*` names, which must be declared,
	// so a typo there is still caught.
	const previewRuntime = file.includes(path.join("theme", "preview"));
	for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
		if (declared.has(match[1])) continue;
		if (previewRuntime && match[1].startsWith("--md-")) continue;
		counts["unknown-var"] += 1;
		const line = text.slice(0, match.index).split(/\r?\n/).length;
		details["unknown-var"].push(`${path.relative(repositoryRoot, file).replace(/\\/g, "/")}:${line} ${match[1]}`);
	}
}

// The component kit expresses weight as a Tailwind utility rather than a
// declaration, so it needs its own pass. Only two of the nine utilities exist in
// this system: `font-medium` (500) and `font-normal` (400). `font-semibold` is
// 600 — close enough to look right in review, and not a weight the type scale has.
counts["weight-class"] = 0;
details["weight-class"] = [];
const ALLOWED_WEIGHT_CLASSES = new Set(["font-normal", "font-medium"]);
for (const file of components(adminSrc)) {
	const text = readFileSync(file, "utf8");
	text.split(/\r?\n/).forEach((line, index) => {
		for (const match of line.matchAll(/\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/g)) {
			if (ALLOWED_WEIGHT_CLASSES.has(match[0])) continue;
			counts["weight-class"] += 1;
			details["weight-class"].push(`${path.relative(repositoryRoot, file).replace(/\\/g, "/")}:${index + 1} ${match[0]}`);
		}
	});
}

// ---- The component kit has to be where the config says it is ---------------

const componentsJson = path.join(repositoryRoot, "apps", "admin-web", "components.json");
const aliases = JSON.parse(readFileSync(componentsJson, "utf8")).aliases ?? {};
const kitProblems = [];
for (const [name, alias] of Object.entries(aliases)) {
	if (!alias.startsWith("@/")) {
		kitProblems.push(`aliases.${name} is "${alias}", which is not an \`@/\` path`);
		continue;
	}
	const resolved = path.join(adminSrc, alias.slice(2).replace(/\/utils$/, ""));
	if (!statSync(path.dirname(resolved), { throwIfNoEntry: false })) {
		kitProblems.push(`aliases.${name} is "${alias}" and apps/admin-web/src/${alias.slice(2)} does not exist`);
	}
}
if (Object.keys(aliases).length === 0) kitProblems.push("components.json declares no aliases at all");

// ---- Report -------------------------------------------------------------

const over = [];
for (const [kind, count] of Object.entries(counts)) {
	const ceiling = CEILING[kind] ?? 0;
	const state = count > ceiling ? "OVER" : count < ceiling ? "under" : "at";
	console.log(`${kind.padEnd(12)} ${String(count).padStart(4)} / ceiling ${String(ceiling).padStart(4)}  ${state}`);
	if (count > ceiling) over.push(kind);
}

if (reportMode) {
	for (const [kind, entries] of Object.entries(details)) {
		if (entries.length === 0) continue;
		console.log(`\n--- ${kind} (${entries.length})`);
		for (const entry of entries) console.log("  " + entry);
	}
}

if (over.length > 0 || kitProblems.length > 0) {
	console.error("");
	// Every declared kind needs a remedy here, including the ones that are scanned
	// in their own pass rather than from RULES — a kind missing from this list
	// crashed the guard instead of reporting the finding, which is worse than the
	// finding.
	const REMEDIES = new Map([
		...RULES.map((rule) => [rule.kind, rule.remedy]),
		["unknown-var", "declare it, or fix the name"],
		["weight-class", "only `font-normal` (400) and `font-medium` (500) exist in this system"],
	]);
	for (const kind of over) {
		console.error(`  ${kind}: ${counts[kind]} literal(s), ceiling ${CEILING[kind]}. ${REMEDIES.get(kind) ?? "no remedy recorded"}`);
		const entries = details[kind].slice(0, 10);
		for (const entry of entries) console.error(`      ${entry}`);
		if (details[kind].length > entries.length) console.error(`      … and ${details[kind].length - entries.length} more`);
	}
	for (const problem of kitProblems) {
		console.error(`  components.json: ${problem}`);
	}
	if (kitProblems.length > 0) {
		console.error("      The kit is apps/admin-web/src/shared/ui; point the aliases there.");
	}
	console.error(
		"\n  The ceiling is a ratchet: lowering it is the migration, raising it needs a reason. " +
			"Run with --report for the full list.",
	);
	process.exit(1);
}

console.log("\nThe admin panel stays within the design system's budgets, and its component kit is where the config says.");
