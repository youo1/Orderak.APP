#!/usr/bin/env node
// ============================================================
// Keep Android spacing and shape on the design system.
//
// WHY THIS EXISTS
//   `docs/domains/design-system-reference.md` states the rule once, for every
//   surface: "Never invent a colour, spacing value, type size, radius, duration
//   or shadow."
//
//   Colour, motion and the pill were guarded. Spacing and the corner radius were
//   not, and the gap was not small: the two flows a seller meets before they ever
//   see the app — authentication and shop setup — carried 46 raw spacing literals
//   between them, and 152 across the app. Most of those numbers were not on the
//   scale at all (6, 10, 14, 18, 22, 30), so two screens that were meant to share
//   a rhythm each had their own, and no test could tell.
//
//   The previous motion guard said so in as many words: padding and size literals
//   "are often structural... a check that cannot tell those from an invented
//   rhythm gets ignored. That migration is real and still open; it needs a token
//   set first." The token set now exists, and this is that check, scoped to what
//   it can tell apart.
//
// WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT
//   Only a value in a POSITION tells you what it is. A number inside `padding(…)`,
//   `Arrangement.spacedBy(…)` or `Spacer(Modifier.height(…))` is a distance
//   between two things, and the system has exactly one set of those. A radius
//   written as `RoundedCornerShape(16.dp)` is a corner, and the system has one
//   scale of those.
//
//   A `size(96.dp)` ad image, a `height(56.dp)` button, a `heightIn(max = 420.dp)`
//   scroll cap and a `720.dp` breakpoint are none of the above: they are the size
//   of one thing, or a comparison against the window. Forcing those onto the 4dp
//   rhythm would be inventing a rule, so this guard leaves them alone. The
//   measurements that DO repeat across screens are named in `OrderakLayout` for
//   the same reason the spacing tokens are named — eight copies of `560.dp` are
//   eight places to miss when the measure changes — but naming them is a
//   judgement about importance, not a rule that a guard could enforce.
//
// WHY THE TOKEN LIST IS READ, NOT RESTATED
//   The allowed values are parsed out of `OrderakSpacing` in the theme, so adding
//   a token accepts it here with no second edit, and deleting a token fails every
//   call site rather than silently passing against a stale copy of the list.
//
// Usage: node tooling/repository/verify-android-spacing-tokens.mjs
// ============================================================

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const androidMain = path.join(repositoryRoot, "apps", "seller-android", "app", "src", "main");
const themeFolder = path.join(androidMain, "java", "app", "orderak", "seller", "core", "ui", "theme");

// The theme file IS the token definition; a literal there is the token.
const themeText = readFileSync(path.join(themeFolder, "Theme.kt"), "utf8");

/** Every value `OrderakSpacing` declares, as the numbers a call site may use. */
function declaredSpacingValues() {
	const block = themeText.match(/data class OrderakSpacing\(([\s\S]*?)\n\)/);
	if (!block) throw new Error("Theme.kt no longer declares `data class OrderakSpacing` — this guard cannot tell which values are tokens.");
	const values = new Set();
	for (const m of block[1].matchAll(/val\s+\w+\s*:\s*Dp\s*=\s*(\d+(?:\.\d+)?)\.dp/g)) {
		values.add(Number(m[1]));
	}
	if (values.size === 0) throw new Error("OrderakSpacing declares no `val name: Dp = N.dp` field — this guard cannot tell which values are tokens.");
	return values;
}

/** The Material shape slots a hand-written radius may be replaced by. */
function declaredShapeSlots() {
	const block = themeText.match(/val OrderakShapes = Shapes\(([\s\S]*?)\n\)/);
	if (!block) throw new Error("Theme.kt no longer declares `val OrderakShapes`.");
	const slots = new Set();
	for (const m of block[1].matchAll(/(\w+)\s*=/g)) slots.add(m[1]);
	return slots;
}

const SPACING_VALUES = declaredSpacingValues();
const SHAPE_SLOTS = declaredShapeSlots();

/** The nearest declared token, ties going up the scale. */
function nearestToken(dp) {
	let best = null;
	for (const value of SPACING_VALUES) {
		const distance = Math.abs(value - dp);
		if (best === null || distance <= best.distance) best = { distance, value };
	}
	return best?.value;
}

function tokenFieldFor(value) {
	const block = themeText.match(/data class OrderakSpacing\(([\s\S]*?)\n\)/);
	const found = [...block[1].matchAll(/val\s+(\w+)\s*:\s*Dp\s*=\s*(\d+(?:\.\d+)?)\.dp/g)].find(
		(m) => Number(m[2]) === value,
	);
	return found ? found[1] : null;
}

/** Positions where a number is a distance, not a size. */
const SPACING_POSITIONS = [
	{ name: "padding", find: /\b(padding\w*)\s*\(([^)]*)\)/g, group: 2 },
	{ name: "Arrangement.spacedBy", find: /\b(spacedBy)\s*\(([^)]*)\)/g, group: 2 },
	{ name: "Spacer dimension", find: /\bSpacer\s*\(\s*Modifier\s*\.\s*(height|width)\s*\(\s*(\d+(?:\.\d+)?)\s*\.dp/g, group: 1, literal: true },
];

function kotlinFiles(directory, out = []) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (["build", "node_modules"].includes(entry.name)) continue;
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) kotlinFiles(full, out);
		else if (entry.name.endsWith(".kt")) out.push(full);
	}
	return out;
}

const findings = [];
let tokenisedSites = 0;
let radiusSites = 0;
let radiusTokenised = 0;

for (const file of kotlinFiles(androidMain)) {
	// The theme folder is where the tokens are defined, so it is the one place a
	// literal is the definition rather than a departure from it.
	if (path.dirname(file) === themeFolder) continue;
	const relative = path.relative(repositoryRoot, file).replace(/\\/g, "/");
	const lines = readFileSync(file, "utf8").split(/\r?\n/);

	lines.forEach((line, index) => {
		// A comment naming a value that was removed is documentation, not a
		// violation, and that note is usually worth more than the rule.
		const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
		if (code.trim() === "") return;

		for (const position of SPACING_POSITIONS) {
			for (const match of code.matchAll(position.find)) {
				const args = match[position.group];
				// Positions that already read a token.
				tokenisedSites += [...args.matchAll(/\bspacing\.\w+/g)].length;
				const literals = position.literal
					? [`${args}.dp`]
					: [...args.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)\.dp/g)].map((m) => m[0]);
				for (const literal of literals) {
					const value = Number.parseFloat(literal);
					const isToken = SPACING_VALUES.has(value);
					const nearest = isToken ? value : nearestToken(value);
					const field = tokenFieldFor(nearest);
					findings.push({
						file: relative,
						line: index + 1,
						text: `${match[0].trim()}  →  ${literal}`,
						rule: `${position.name} takes a design-system token, not a literal`,
						remedy: isToken
							? `that value is OrderakSpacing.${field} — read LocalOrderakSpacing.current and use it`
							: `${value}.dp is not on the scale; the nearest token is ${nearest}.dp (OrderakSpacing.${field})`,
					});
				}
			}
		}

		// A radius with a dp value is a shape decision taken at a call site.
		for (const match of code.matchAll(/\bRoundedCornerShape\s*\(([^)]*)\)/g)) {
			if (!/\.dp/.test(match[1])) {
				radiusTokenised++; // RoundedCornerShape(percent = 50): the pill, which is a proportion
				continue;
			}
			radiusSites++;
			findings.push({
				file: relative,
				line: index + 1,
				text: match[0],
				rule: "a corner comes from the shape scale",
				remedy: `use MaterialTheme.shapes.${[...SHAPE_SLOTS].join(" | ")}, or MaterialTheme.shapes.full for a pill`,
			});
		}
	});
}

if (findings.length > 0) {
	console.error(`\n${findings.length} design-system value(s) written by hand:\n`);
	for (const finding of findings) {
		console.error(`  ${finding.file}:${finding.line}  ${finding.text}`);
		console.error(`      ${finding.rule}: ${finding.remedy}`);
	}
	console.error(`\n${tokenisedSites} other spacing position(s) already read a token.\n`);
	process.exit(1);
}

console.log(
	`Spacing and shape stay on the design system: ${tokenisedSites} spacing position(s) read a token, ` +
		`${radiusSites} hand-written radius/radii, and ${radiusTokenised} proportional pill(s).`,
);
