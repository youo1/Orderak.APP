#!/usr/bin/env node
// ============================================================
// Keep the admin panel on one component kit.
//
// WHY THIS EXISTS
//   RD-16 (`docs/redesign/redesign-decisions.md`) decided that
//   `apps/admin-web/src/shared/ui/*` is the kit, and that the files hand-rolling
//   `.button`, `.field`, `.panel` and `.modal` move onto it. The audit that
//   produced the decision counted "twenty-one files"; the precise number is 134
//   usages across 15 files, and both numbers describe the same thing: two
//   implementations of every primitive, kept in step by hand.
//
//   They were not in step. `.button` was 38px tall with a hover lift and
//   `font-weight: 700`; the kit's `Button` is 40px with a background change and
//   (now) 500. `.field` and `Input` had different radii. Five of the six modals
//   were hand-rolled `div.modal-backdrop` layers with no focus trap, while the
//   kit had Radix's dialog the whole time.
//
//   The worst instance was inside the kit: `shared/ui/confirm.tsx` and
//   `shared/ui/ActionDialog.tsx` hand-rolled the very modal the kit provides.
//   That is fixed. This guard is what keeps the rest from being fixed halfway and
//   then forgotten.
//
// WHY THE CEILING IS NOW ABSOLUTE
//   It began as a ratchet: a guard that fails on the current state cannot land,
//   and one that tolerates any number records nothing, so the ceiling was the
//   measured count per file and it could only go down. The migration is done —
//   127 usages across 13 files, down to zero — and the ratchet is replaced by the
//   rule it was walking towards: a hand-rolled primitive is a failure, wherever it
//   appears, including in a file that does not exist yet.
//
// WHAT IS COUNTED
//   A `className` whose whitespace-separated tokens include exactly `button`,
//   `field`, `panel` or `modal`. A token match, not a substring: `modal-backdrop`,
//   `modal-heading`, `button-row`, `field-stack` and `icon-button` are their own
//   classes with no kit replacement and are not counted, because conflating them
//   would make the number meaningless. Comments are stripped first: a comment that
//   quotes the pattern is documentation, and it is the most useful comment a
//   migration like this carries.
//
// Usage: node tooling/repository/verify-admin-primitives.mjs
//         --report   list every counted usage
// ============================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const adminSrc = path.join(repositoryRoot, "apps", "admin-web", "src");
const reportMode = process.argv.includes("--report");

const PRIMITIVES = new Set(["button", "field", "panel", "modal"]);

/**
 * Empty, and that is the result rather than a placeholder.
 *
 * It held thirteen measured counts totalling 127 when this guard landed, and each
 * line was deleted as its file reached zero — which is what a ratchet is for. The
 * map stays as the mechanism for the next migration of this shape, and an entry in
 * it is a debt with a number attached, not a permission.
 */
const CEILING = new Map();

function sources(directory, out = []) {
	for (const entry of readdirSync(directory)) {
		const full = path.join(directory, entry);
		if (entry === "node_modules" || entry === "dist") continue;
		if (statSync(full).isDirectory()) sources(full, out);
		else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
	}
	return out;
}

const counts = new Map();
const details = [];

/**
 * Source with its comments removed.
 *
 * A comment that *quotes* the pattern this guard is about is documentation, not a
 * violation — and it is the most useful comment a file in this migration carries,
 * because it records what the code replaced and why. The Kotlin guards strip
 * comments for the same reason; this one did not, so the first file written to
 * explain the migration was reported as breaking it.
 */
function withoutComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split(/\r?\n/)
		.map((line) => line.replace(/\/\/.*$/, ""))
		.join("\n");
}

for (const file of sources(adminSrc)) {
	const relative = path.relative(repositoryRoot, file).replace(/\\/g, "/");
	const text = withoutComments(readFileSync(file, "utf8"));
	text.split(/\r?\n/).forEach((line, index) => {
		for (const match of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([^)]*)\))/g)) {
			const value = (match[1] ?? match[2] ?? match[3] ?? "").replace(/['"`]/g, "");
			const hit = value.split(/\s+/).filter(Boolean).find((token) => PRIMITIVES.has(token));
			if (!hit) continue;
			counts.set(relative, (counts.get(relative) ?? 0) + 1);
			details.push(`${relative}:${index + 1}  .${hit}`);
		}
	});
}

const over = [];
const fixed = [];
for (const [file, count] of counts) {
	const ceiling = CEILING.get(file) ?? 0;
	if (count > ceiling) over.push([file, count, ceiling]);
}
// A ceiling above the current count means the migration moved and the number was
// not lowered with it. Reported so the ratchet cannot quietly drift.
for (const [file, ceiling] of CEILING) {
	const count = counts.get(file) ?? 0;
	if (count < ceiling) fixed.push([file, count, ceiling]);
}

const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
console.log(`${total} hand-rolled primitive usage(s) remaining, across ${counts.size} file(s).`);
for (const [file, count, ceiling] of over) {
	console.log(`  OVER  ${file}: ${count}, ceiling ${ceiling}`);
}

if (reportMode) {
	console.log("");
	for (const entry of details) console.log("  " + entry);
}

if (over.length > 0) {
	console.error("\n  A primitive the kit provides is being hand-rolled again.");
	console.error("  Use the kit: shared/ui/button.tsx, field.tsx, textarea.tsx,");
	console.error("  input.tsx, dialog.tsx, card.tsx, Page.tsx.");
	console.error("  If the kit genuinely cannot express it, add the primitive to the kit first.");
	process.exit(1);
}

if (fixed.length > 0) {
	console.error("\n  The ratchet is loose — these files are now below their ceiling:");
	for (const [file, count, ceiling] of fixed) console.error(`      ${file}: ${count} (ceiling ${ceiling})`);
	console.error("  Delete the ceiling line, in the same change that reached the number.");
	process.exit(1);
}

console.log(
	"No hand-rolled button, field, panel or modal anywhere in the admin panel: " +
		"every one is the kit's, and the ceiling map is empty.",
);
