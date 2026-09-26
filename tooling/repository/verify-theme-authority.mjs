#!/usr/bin/env node
// ============================================================
// Verify that the published design system outranks the committed token bundle.
//
// WHY THIS EXISTS
//   `apps/admin-web/src/orderak-tokens.css` is a flattened snapshot of the
//   design system, generated on one date and checked in. The live values come
//   from the published revision, which the edge Worker serves at /theme.css.
//   Both declare the same custom properties on `:root`.
//
//   CSS settles that by document order, so whichever stylesheet the browser
//   parses last wins — and Vite injects the application's CSS link at the end of
//   <head>, always. The checked-in snapshot therefore overrode every published
//   revision. Pressing "Apply as current" in the Theme Builder changed nothing
//   for anybody, while the administrator who pressed it saw their own tab
//   restyle, because the builder also writes inline styles onto
//   documentElement. The one person who could have noticed was the one person
//   for whom it worked.
//
//   Nothing failed. The shell test asserted the theme link came before the
//   application module in the HTML, which was true and irrelevant: the ordering
//   that decides the cascade is created by the bundler, after that file is read.
//
// THE RULE
//   The committed bundle is a fallback, so it is imported into a cascade layer.
//   Unlayered author styles beat layered ones regardless of order, so the
//   published theme wins wherever they disagree, and the fallback still supplies
//   every token when /theme.css is unavailable.
//
// WHAT IS CHECKED
//   1. `src/index.css` imports the bundle with `layer(...)`, and no other source
//      file imports it at all.
//   2. When a build exists, no token custom property in the built CSS is left
//      unlayered. This catches a future toolchain change that flattens layers —
//      the source rule can hold while the output quietly stops honouring it.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//   It does not check that the two stylesheets agree, or that the published theme
//   is reachable. Those are runtime facts about a deployment. This checks the one
//   thing a build can get wrong silently and permanently.
//
// Usage: node tooling/repository/verify-theme-authority.mjs
// ============================================================

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const adminRoot = path.join(repositoryRoot, "apps", "admin-web");
const indexPath = path.join(adminRoot, "src", "index.css");
const bundleName = "orderak-tokens.css";
const layerName = "orderak-fallback";
const distAssets = path.join(adminRoot, "dist", "assets");

/** Custom properties the design system owns, in either naming scheme. */
const TOKEN_PREFIXES = ["--orderak-", "--md-sys-"];

const problems = [];
const note = (message) => problems.push(message);

function relative(filePath) {
	return path.relative(repositoryRoot, filePath).replace(/\\/g, "/");
}

// ---- 1. The source rule -------------------------------------------------

const indexCss = readFileSync(indexPath, "utf8");
const importLines = indexCss
	.split(/\r?\n/)
	.map((line) => line.trim())
	.filter((line) => line.startsWith("@import") && line.includes(bundleName));

if (importLines.length === 0) {
	note(
		`${relative(indexPath)} no longer imports ${bundleName}. If the bundle was removed on purpose, delete this ` +
			`check with it — an unenforced rule that reads as enforced is worse than no rule.`,
	);
} else if (importLines.length > 1) {
	note(`${relative(indexPath)} imports ${bundleName} ${importLines.length} times; expected exactly one, inside the layer.`);
} else {
	const line = importLines[0];
	if (!new RegExp(`layer\\(\\s*${layerName}\\s*\\)`).test(line)) {
		note(
			`${relative(indexPath)} imports ${bundleName} without layer(${layerName}): "${line}". Unlayered, it outranks ` +
				`the published theme, which is the defect this check exists for.`,
		);
	}
	if (!line.endsWith(";")) note(`${relative(indexPath)}: the ${bundleName} import does not end with a semicolon.`);
}

/** Every source file that pulls the bundle in, so a second unlayered import cannot hide. */
function sourceFiles(directory) {
	const found = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (["node_modules", "dist", ".turbo"].includes(entry.name)) continue;
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) found.push(...sourceFiles(full));
		else if (/\.(css|ts|tsx|html)$/.test(entry.name)) found.push(full);
	}
	return found;
}

for (const file of sourceFiles(adminRoot)) {
	if (file === indexPath) continue;
	if (path.basename(file) === bundleName) continue;
	const text = readFileSync(file, "utf8");
	if (new RegExp(`@import\\s+["'][^"']*${bundleName}`).test(text)) {
		note(
			`${relative(file)} imports ${bundleName} as well as ${relative(indexPath)}. One import, in the layer, or the ` +
				`ordering this check removed comes back through the other door.`,
		);
	}
}

// ---- 2. The build rule, when a build is present -------------------------

let builtFile = null;
if (existsSync(distAssets)) {
	const candidate = readdirSync(distAssets).find((name) => /^admin-.*\.css$/.test(name));
	if (candidate) builtFile = path.join(distAssets, candidate);
}

if (!builtFile) {
	console.log("No admin build found under apps/admin-web/dist; checked the source rule only.");
} else {
	const css = readFileSync(builtFile, "utf8");
	const stack = [];
	let unlayered = 0;
	const examples = [];

	for (let index = 0; index < css.length; index += 1) {
		const character = css[index];
		if (character === "{") {
			let start = index - 1;
			while (start >= 0 && /\s/.test(css[start])) start -= 1;
			let key = start;
			while (key >= 0 && !/[{};]/.test(css[key])) key -= 1;
			stack.push(css.slice(key + 1, index).trim().slice(0, 120));
		} else if (character === "}") {
			stack.pop();
		} else if (character === "-") {
			const prefix = TOKEN_PREFIXES.find((candidate) => css.startsWith(candidate, index));
			if (!prefix) continue;
			const name = /^--[a-z0-9-]+/.exec(css.slice(index))?.[0];
			const afterName = css.slice(index + (name?.length ?? 0)).trimStart();
			if (!afterName.startsWith(":")) continue;
			const layered = stack.some((prelude) => prelude.startsWith("@layer"));
			if (!layered) {
				unlayered += 1;
				if (examples.length < 3) examples.push(`${name} in ${stack.join(" > ") || "(top level)"}`);
			}
			index += (name?.length ?? 1) - 1;
		}
	}

	if (unlayered > 0) {
		note(
			`${relative(builtFile)} declares ${unlayered} design-system token(s) outside a cascade layer, so they can ` +
				`outrank the published theme again: ${examples.join("; ")}. The source rule holds but the build does not ` +
				`honour it — most likely the CSS pipeline stopped preserving layers.`,
		);
	}
}

// ---- Report -------------------------------------------------------------

if (problems.length > 0) {
	console.error(`\n${problems.length} problem(s):`);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(`The committed token bundle is a fallback in @layer ${layerName}; the published theme outranks it.`);
