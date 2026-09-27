#!/usr/bin/env node
// ============================================================
// Keep motion and the pill shape on the Android design system.
//
// WHY THIS EXISTS
//   `docs/domains/design-system-reference.md` states the rule for every screen:
//   "Never invent a colour, spacing value, type size, radius, duration or shadow.
//   A literal outside `orderak-tokens.css` is a bug." It also states the motion
//   budget — "150ms for hover and colour, 180ms for the sidebar slide, 200ms for
//   switches and drawers" — and that "nothing has an entrance animation".
//
//   Colour was guarded. Motion was not, and the Android app carried exactly one
//   duration written by hand: `tween(300)` at six sites, which is longer than
//   every value the system names. Nothing detected it, and nothing could: a
//   duration is a bare integer inside an animation call, so it reads as a local
//   detail rather than as a design decision taken out of the system's hands.
//
//   The same was true of the pill. `RoundedCornerShape(100.dp)` appeared twice,
//   which is a pill on a 56dp button and a different shape on anything taller
//   than 200dp. The system has one pill, and it is a proportion of the element's
//   own height, not a number.
//
// WHY DURATIONS AND PILLS, AND NOT SPACING
//   These two are unambiguous: a duration literal is never anything but a
//   duration, and a radius at or above 100dp is never anything but an attempt at
//   a pill. Padding and size literals are not checked here because they are
//   often structural — a 74px header, a 268px rail, an 88dp logo box — and a
//   check that cannot tell those from an invented rhythm gets ignored. That
//   migration is real and still open; it needs a token set first, and pretending
//   otherwise with a noisy guard would be worse than leaving it visible.
//
// Usage: node tooling/repository/verify-android-motion-tokens.mjs
// ============================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const androidMain = path.join(repositoryRoot, "apps", "seller-android", "app", "src", "main");

/** A radius at or above this is an attempt at a pill, not a corner. */
const PILL_FLOOR_DP = 100;

const RULES = [
	{
		name: "hardcoded animation duration",
		// `tween(300)`, `spring(dampingRatio = 1f, stiffness = 400f)` is not matched:
		// only integer milliseconds are a duration literal here.
		find: /\btween\s*\(\s*(\d+)\s*\)/g,
		remedy: "read LocalOrderakMotion.current — its durations collapse to 0 when the platform reports animators disabled",
	},
	{
		name: "hand-written pill radius",
		find: /\bRoundedCornerShape\s*\(\s*(\d+(?:\.\d+)?)\s*\.dp\s*\)/g,
		keep: (value) => Number.parseFloat(value) < PILL_FLOOR_DP,
		remedy: "use MaterialTheme.shapes.full, which is a proportion of the element's own height",
	},
];

function kotlinFiles(directory) {
	const found = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (["build", "node_modules"].includes(entry.name)) continue;
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) found.push(...kotlinFiles(full));
		else if (entry.name.endsWith(".kt")) found.push(full);
	}
	return found;
}

const files = kotlinFiles(androidMain);
const findings = [];

for (const file of files) {
	const lines = readFileSync(file, "utf8").split(/\r?\n/);
	lines.forEach((line, index) => {
		// A comment explaining why a value was removed is documentation, not a
		// violation. Both files that were migrated keep a note naming the value
		// they used to carry, and that note is worth more than the rule.
		const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
		if (code.trim() === "") return;
		for (const rule of RULES) {
			for (const match of code.matchAll(rule.find)) {
				if (rule.keep?.(match[1])) continue;
				findings.push({
					file: path.relative(repositoryRoot, file).replace(/\\/g, "/"),
					line: index + 1,
					rule: rule.name,
					text: match[0].trim(),
					remedy: rule.remedy,
				});
			}
		}
	});
}

if (findings.length > 0) {
	console.error(`\n${findings.length} value(s) outside the design system:\n`);
	for (const finding of findings) {
		console.error(`  ${finding.file}:${finding.line}  ${finding.text}  (${finding.rule})`);
		console.error(`      ${finding.remedy}`);
	}
	process.exit(1);
}

console.log(
	`Motion and the pill shape stay on the design system across ${files.length} Kotlin file(s).`,
);
