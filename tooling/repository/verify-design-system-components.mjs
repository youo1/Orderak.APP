#!/usr/bin/env node
// ============================================================
// Keep the design-system component inventory and the source tree in step.
//
// WHY THIS EXISTS
//   A component library decays in two directions at once. A composable or
//   export lands with no caller and stays, because nothing counts callers; or
//   one is removed while the inventory that documents it keeps describing it,
//   because nothing compares the inventory with the tree. Both failures are
//   silent, and both make the design system's own reference document wrong.
//
//   This guard is the missing comparison. It walks the Android `core/ui`
//   composables and the admin `shared/ui` exports, resolves each one's callers
//   from the post-change tree, and requires:
//     1. every component has at least one caller outside its declaration
//        (a call to a name in a file counts for every overload in that file);
//     2. every component appears in docs/domains/design-system-components.md,
//        keyed by its name and full repository-relative source path;
//     3. every row in that inventory corresponds to a real component, and its
//        Source file and Callers cells match what this guard computes.
//
//   Identity is always the (name, full repository-relative path) pair, never a
//   basename, so two same-named files in different directories stay distinct.
//
// WHAT IS COUNTED
//   Android: top-level `@Composable` declarations of any visibility in
//   `apps/seller-android/app/src/main/java/app/orderak/seller/core/ui`,
//   excluding functions annotated `@Preview`. A declaration may sit on the
//   annotation line (`@Composable fun Foo()`) or on a later line. The
//   `SemanticRole.colors()` extension is matched by receiver form
//   (`SemanticRole.colors` or `SemanticRole.<Role>.colors`) and by a same-file
//   `IDENT.colors()` call when that same file declares `IDENT: SemanticRole`
//   (a parameter or `val`), so an unrelated `TextFieldDefaults.colors()` does
//   not satisfy it. A file made up solely of `@Preview` code is not a caller.
//
//   Admin: exported React components from
//   `apps/admin-web/src/shared/ui`, including PascalCase alias exports such as
//   `Dialog = DialogPrimitive.Root`. Exported types, interfaces, lowercase
//   value exports and ordinary non-component utilities are ignored. Callers
//   are imports/usages outside the declaring file and outside tests.
//
// Usage: node tooling/repository/verify-design-system-components.mjs [--report]
// ============================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const ANDROID_MAIN = path.join(repositoryRoot, "apps", "seller-android", "app", "src", "main");
const CORE_UI = path.join(ANDROID_MAIN, "java", "app", "orderak", "seller", "core", "ui");
const ADMIN_SRC = path.join(repositoryRoot, "apps", "admin-web", "src");
const ADMIN_UI = path.join(ADMIN_SRC, "shared", "ui");
const INVENTORY = path.join(repositoryRoot, "docs", "domains", "design-system-components.md");
const INVENTORY_LABEL = "docs/domains/design-system-components.md";
const reportMode = process.argv.includes("--report");

const problems = [];

function relative(filePath) {
	return path.relative(repositoryRoot, filePath).replace(/\\/g, "/");
}

function collectFiles(directory, filter, out = []) {
	if (!existsSync(directory)) return out;
	for (const entry of readdirSync(directory)) {
		if (entry === "node_modules" || entry === "build" || entry === ".gradle" || entry === "dist") continue;
		const full = path.join(directory, entry);
		if (statSync(full).isDirectory()) collectFiles(full, filter, out);
		else if (filter(entry)) out.push(full);
	}
	return out;
}

/** Source with comments removed: a comment that names a component is not a caller. */
function withoutComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split(/\r?\n/)
		.map((line) => line.replace(/\/\/.*$/, ""))
		.join("\n");
}

function isWordChar(char) {
	return char !== undefined && /\w/.test(char);
}

/**
 * Whole-word occurrences of an identifier, the same count as `\bname\b`.
 *
 * Found with indexOf rather than a RegExp built from the name: Semgrep's
 * detect-non-literal-regexp (a required check) refuses a pattern assembled from
 * a variable, and a plain identifier needs no pattern at all.
 */
function wholeWordCount(text, name) {
	let count = 0;
	for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + name.length)) {
		if (!isWordChar(text[at - 1]) && !isWordChar(text[at + name.length])) count++;
	}
	return count;
}

/**
 * Names declared in this text with the type `SemanticRole`, as in
 * `role: SemanticRole` (a parameter) or `val role: SemanticRole`. This is a
 * same-file, text-level check, not Kotlin type resolution: it only widens the
 * receiver form for `SemanticRole.colors()` to variables the file itself types
 * as `SemanticRole`.
 */
function semanticRoleTypedNames(text) {
	const names = [];
	for (const match of text.matchAll(/\b([A-Za-z_]\w*)\s*:\s*SemanticRole\b/g)) {
		if (!names.includes(match[1])) names.push(match[1]);
	}
	return names;
}

/**
 * Occurrences of a component name, preferring the receiver form for
 * `SemanticRole.colors()`. A same-file `IDENT: SemanticRole` declaration lets
 * `IDENT.colors()` count as a call on a SemanticRole value; unrelated calls
 * such as `TextFieldDefaults.colors()` have no such declaration and are not
 * counted.
 */
function countOccurrences(text, name) {
	if (name === "SemanticRole.colors") {
		let count = (text.match(/\bSemanticRole(?:\.\w+)?\.colors\b/g) ?? []).length;
		for (const identifier of semanticRoleTypedNames(text)) {
			count += wholeWordCount(text, `${identifier}.colors`);
		}
		return count;
	}
	return wholeWordCount(text, name);
}

/**
 * A production call site: the name as a standalone call, not a member access on
 * something else, not a declaration, and not text inside a string literal.
 *
 * The Android tree already had an unrelated `Banner` member on the ad manager;
 * a kit-pending composable must not inherit that as a caller.
 */
function androidProductionOccurrences(text, name) {
	if (name === "SemanticRole.colors") return countOccurrences(text, name);
	const code = text.replace(/"(?:\\.|[^"\\])*"/g, '""');
	let count = 0;
	for (let at = code.indexOf(name); at !== -1; at = code.indexOf(name, at + name.length)) {
		if (isWordChar(code[at - 1]) || isWordChar(code[at + name.length])) continue;
		const before = code.slice(0, at).trimEnd();
		if (/\bfun$/.test(before)) continue;
		if (before.endsWith(".") && !/(?:^|[^A-Za-z0-9_])(?:[a-z_]\w*\.){2,}$/.test(before)) continue;
		count++;
	}
	return count;
}

// ---- Android ---------------------------------------------------------------

/** Strip a run of leading annotations (`@Composable private fun` -> `private fun`). */
function stripAnnotations(line) {
	return line.replace(/^(?:\s*@\w+(?:\([^)]*\))?\s*)+/, "");
}

function carriesDeclaration(line) {
	return /\bfun\b/.test(stripAnnotations(line));
}

const DECLARATION_PATTERN =
	/^(?:(?:public|private|internal|protected|suspend|inline|operator|open|override|external|expect|actual|tailrec)\s+)*fun\s+(?:<[^>]+>\s*)?(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)\s*\(/;

/**
 * Top-level `@Composable` declarations in one Kotlin source text, each flagged
 * with whether its annotation group carries `@Preview`. The declaration may sit
 * on the last annotation line itself (`@Composable fun Foo()`) or on a later
 * line. The receiver is folded into the name for extension composables such as
 * `SemanticRole.colors`.
 */
function scanComposableDeclarations(text) {
	const found = [];
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		if (!/^\s*@Composable\b/.test(lines[i])) continue;

		// Group the annotation block, but do not swallow an adjacent one-line
		// declaration: `@Composable fun Foo()` is a declaration, not an
		// annotation continuing the block.
		let start = i;
		while (start - 1 >= 0 && /^\s*@\w/.test(lines[start - 1]) && !carriesDeclaration(lines[start - 1])) start--;
		let end = i;
		while (end + 1 < lines.length && /^\s*@\w/.test(lines[end + 1]) && !carriesDeclaration(lines[end + 1])) end++;

		const annotations = lines.slice(start, end + 1).map((line) => line.trim());
		const preview = annotations.some((line) => /^@Preview\b/.test(line));

		let declarationLine = lines[end];
		if (!carriesDeclaration(declarationLine)) {
			let j = end + 1;
			while (j < lines.length && lines[j].trim() === "") j++;
			if (j >= lines.length) continue;
			declarationLine = lines[j];
		}
		if (/^\s/.test(declarationLine)) continue; // indented: not top-level

		const withoutAnnotations = stripAnnotations(declarationLine);
		const match = DECLARATION_PATTERN.exec(withoutAnnotations);
		if (!match) continue;

		const receiver = match[1] ?? null;
		found.push({ name: receiver ? `${receiver}.${match[2]}` : match[2], preview });
	}
	return found;
}

/** Every top-level `@Composable` declaration under core/ui, excluding @Preview. */
function androidDeclarations() {
	const found = [];
	for (const file of collectFiles(CORE_UI, (name) => name.endsWith(".kt"))) {
		const relativeFile = relative(file);
		for (const declaration of scanComposableDeclarations(readFileSync(file, "utf8"))) {
			if (declaration.preview) continue;
			found.push({ name: declaration.name, file, relative: relativeFile });
		}
	}
	return found;
}

/**
 * A Kotlin file made up solely of `@Preview` code. Such a file declares no
 * component and is not a caller: preview scaffolding is not a production call
 * site, so adding or removing it must not re-key the caller sets.
 */
function isPreviewOnlyKotlin(text) {
	if (!/^\s*@Preview\b/m.test(text)) return false;
	return scanComposableDeclarations(text).every((declaration) => declaration.preview);
}

/**
 * Caller files for a declaration: files with a production call site.
 *
 * A whole-word count was enough while every name was unique. Once the kit's
 * `Banner` gained callers (R1a-1b), it also matched the ad manager's unrelated
 * `Banner` member and the word inside string literals ("AdMob Banner"), and
 * listed three ad files as callers of a composable they never call. So callers
 * use the same strict call sites as the kit-pending check. `SemanticRole.colors`
 * keeps its own counting, which includes its declaration, so that is subtracted.
 */
function androidCallerFiles(declaration, declarations, texts) {
	const files = [];
	for (const { relative: file, text } of texts) {
		const declarationsInFile = declaration.name === "SemanticRole.colors"
			? declarations.filter((entry) => entry.name === declaration.name && entry.relative === file).length
			: 0;
		if (androidProductionOccurrences(text, declaration.name) - declarationsInFile > 0) files.push(file);
	}
	return files;
}

/**
 * Aggregate caller count, preserving the original accounting: every whole-word
 * occurrence outside the declarations themselves counts, so a call to a name
 * counts for every overload in its file.
 */
function androidCallerCount(declaration, declarations, texts) {
	let total = 0;
	for (const { text } of texts) total += countOccurrences(text, declaration.name);
	const declarationsOfName = declarations.filter((entry) => entry.name === declaration.name).length;
	return total - declarationsOfName;
}

/** Strict call sites, used only for a kit-pending component's caller check. */
function androidKitCallerFiles(declaration, texts) {
	return texts
		.filter(({ text }) => androidProductionOccurrences(text, declaration.name) > 0)
		.map(({ relative }) => relative);
}

// ---- Admin -----------------------------------------------------------------

function isTestFile(relativePath) {
	if (/(^|\/)(tests?|__tests__)\//.test(relativePath)) return true;
	return /\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath);
}

/** Exported React components, including PascalCase alias exports. */
function adminExports() {
	const found = [];
	for (const file of collectFiles(ADMIN_UI, (name) => /\.(tsx|ts)$/.test(name))) {
		const text = withoutComments(readFileSync(file, "utf8"));
		for (const match of text.matchAll(/^\s*export\s+function\s+([A-Z]\w*)\s*\(/gm)) {
			found.push({ name: match[1], file, relative: relative(file) });
		}
		for (const match of text.matchAll(/^\s*export\s+const\s+([A-Z]\w*)\s*=/gm)) {
			found.push({ name: match[1], file, relative: relative(file) });
		}
	}
	return found;
}

function adminComponentsWithCallers() {
	const components = adminExports();
	const files = collectFiles(ADMIN_SRC, (name) => /\.(tsx|ts)$/.test(name)).map((file) => ({
		relative: relative(file),
		text: withoutComments(readFileSync(file, "utf8")),
	}));
	const callerFiles = new Map();
	for (const component of components) {
		const key = `${component.name}@@${component.relative}`;
		if (callerFiles.has(key)) continue;
		const callers = [];
		for (const file of files) {
			if (file.relative === component.relative) continue;
			if (isTestFile(file.relative)) continue;
			if (wholeWordCount(file.text, component.name) > 0) callers.push(file.relative);
		}
		callerFiles.set(key, callers);
	}
	return { components, callerFiles };
}

// ---- Inventory -------------------------------------------------------------

function splitRow(line) {
	let trimmed = line.trim();
	if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
	if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
	return trimmed.split("|");
}

function normaliseName(cell) {
	return cell.replace(/`/g, "").trim().replace(/\(\)$/, "");
}

/** Caller paths from an inventory cell: `<br>`-separated repository-relative paths. */
function parseCallers(cell) {
	const text = cell.replace(/`/g, "").trim();
	if (text === "" || text === "—" || text === "–" || text === "-") return [];
	return text
		.split(/<br\s*\/?>/i)
		.map((part) => part.replace(/`/g, "").trim().replace(/\\/g, "/"))
		.filter((part) => part.length > 0);
}

function readInventory() {
	if (!existsSync(INVENTORY)) return null;
	const lines = readFileSync(INVENTORY, "utf8").split(/\r?\n/);
	let headerIndex = -1;
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].trim().startsWith("|")) continue;
		const cells = splitRow(lines[i]).map((cell) => cell.trim());
		if (cells.includes("Component") && cells.includes("Source file")) {
			headerIndex = i;
			break;
		}
	}
	if (headerIndex === -1) return null;

	const header = splitRow(lines[headerIndex]).map((cell) => cell.trim());
	const nameIndex = header.indexOf("Component");
	const fileIndex = header.indexOf("Source file");
	const callersIndex = header.indexOf("Callers");
	const statusIndex = header.indexOf("Status");
	const adopterIndex = header.indexOf("Adopter");
	const entries = [];
	for (let i = headerIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim().startsWith("|")) break;
		const cells = splitRow(line);
		if (cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))) continue;
		if (cells.length <= Math.max(nameIndex, fileIndex)) continue;
		const name = normaliseName(cells[nameIndex]);
		const file = cells[fileIndex].replace(/`/g, "").trim().replace(/\\/g, "/");
		if (!name || !file) continue;
		const callers = callersIndex >= 0 && cells.length > callersIndex ? cells[callersIndex] : "";
		const status = statusIndex >= 0 && cells.length > statusIndex ? cells[statusIndex] : "";
		const adopter = adopterIndex >= 0 && cells.length > adopterIndex ? cells[adopterIndex] : "";
		entries.push({ name, file, callers, status, adopter });
	}
	return { entries, hasCallers: callersIndex >= 0 };
}

// ---- Checks ----------------------------------------------------------------

const inventory = readInventory();
const inventoryRows = new Map();
if (inventory !== null) {
	for (const entry of inventory.entries) {
		inventoryRows.set(`${entry.name}@@${entry.file}`, entry);
	}
}
const isKitPending = (entry) =>
	(entry?.status ?? "").trim().toLowerCase().replace(/\s+/g, "-") === "kit-pending";
const hasRItemAdopter = (entry) => /^R\d+\b/i.test((entry?.adopter ?? "").trim());

const declarations = androidDeclarations();
const androidTexts = collectFiles(ANDROID_MAIN, (name) => name.endsWith(".kt"))
	.map((file) => ({ relative: relative(file), text: withoutComments(readFileSync(file, "utf8")) }))
	.filter((entry) => !isPreviewOnlyKotlin(entry.text));

const androidKeys = [];
const androidCallers = new Map();
const androidKitCallers = new Map();
for (const declaration of declarations) {
	const key = `${declaration.name}@@${declaration.relative}`;
	if (!androidCallers.has(key)) {
		androidCallers.set(key, androidCallerFiles(declaration, declarations, androidTexts));
	}
	const entry = inventoryRows.get(key);
	const pending = isKitPending(entry) && hasRItemAdopter(entry);
	if (pending) {
		androidKitCallers.set(key, androidKitCallerFiles(declaration, androidTexts));
	}
	if (!pending && androidCallerCount(declaration, declarations, androidTexts) <= 0) {
		problems.push(
			`Android composable ${declaration.name} (${declaration.relative}) has no caller ` +
				`in apps/seller-android/app/src/main outside its declaration.`,
		);
	}
	androidKeys.push(key);
}

const { components: adminEntries, callerFiles: adminCallers } = adminComponentsWithCallers();
for (const component of adminEntries) {
	const key = `${component.name}@@${component.relative}`;
	if ((adminCallers.get(key) ?? []).length === 0) {
		problems.push(
			`Admin component ${component.name} (${component.relative}) has no caller outside its ` +
				"declaring file and outside tests.",
		);
	}
}
const adminKeys = adminEntries.map((component) => `${component.name}@@${component.relative}`);

const effectiveAndroidCallers = new Map(androidCallers);
for (const [key, callers] of androidKitCallers) effectiveAndroidCallers.set(key, callers);
const treeCallers = new Map([...effectiveAndroidCallers, ...adminCallers]);
if (inventory !== null) {
	for (const entry of inventory.entries) {
		if (!isKitPending(entry)) continue;
		const key = `${entry.name}@@${entry.file}`;
		if (!hasRItemAdopter(entry)) {
			problems.push(
				`${INVENTORY_LABEL} row ${entry.name} (${entry.file}) is kit-pending but has no ` +
					"R-item adopter; name the adopter in the Adopter column.",
			);
		}
		if ((androidKitCallers.get(key) ?? []).length > 0) {
			problems.push(
				`${INVENTORY_LABEL} row ${entry.name} (${entry.file}) is kit-pending but has a ` +
					"production caller; promote its status or remove the caller.",
			);
		}
	}
}
if (inventory === null) {
	problems.push(
		`${INVENTORY_LABEL} is missing or has no inventory table with "Component" and "Source file" columns.`,
	);
} else {
	const entries = inventory.entries;
	const inventoryKeys = new Set(entries.map((entry) => `${entry.name}@@${entry.file}`));
	const treeKeys = new Set(treeCallers.keys());
	for (const key of treeKeys) {
		if (!inventoryKeys.has(key)) {
			const [name, file] = key.split("@@");
			problems.push(
				`Component ${name} (${file}) is in the tree but missing from ${INVENTORY_LABEL}. ` +
					"Add one inventory row per component key.",
			);
		}
	}
	for (const entry of entries) {
		const key = `${entry.name}@@${entry.file}`;
		if (!treeKeys.has(key)) {
			problems.push(
				`${INVENTORY_LABEL} lists ${entry.name} (${entry.file}), which is not a component in the tree. ` +
					"Remove the stale inventory row.",
			);
			continue;
		}
		if (!inventory.hasCallers) continue;
		const expected = treeCallers.get(key) ?? [];
		const actual = parseCallers(entry.callers);
		const expectedSet = new Set(expected);
		const actualSet = new Set(actual);
		const missing = expected.filter((file) => !actualSet.has(file));
		const unexpected = actual.filter((file) => !expectedSet.has(file));
		if (missing.length > 0 || unexpected.length > 0) {
			const details = [];
			if (missing.length > 0) details.push(`missing caller file(s): ${missing.join(", ")}`);
			if (unexpected.length > 0) details.push(`unexpected caller file(s): ${unexpected.join(", ")}`);
			problems.push(
				`${INVENTORY_LABEL} row ${entry.name} (${entry.file}) has a Callers cell that does not ` +
					`match the guard: ${details.join("; ")}.`,
			);
		}
	}
	if (!inventory.hasCallers) {
		problems.push(`${INVENTORY_LABEL} has no "Callers" column; add one caller cell per component row.`);
	}
	// Duplicate keys collapse overloads; the inventory wants one row per key.
	const seen = new Map();
	for (const entry of entries) {
		const key = `${entry.name}@@${entry.file}`;
		seen.set(key, (seen.get(key) ?? 0) + 1);
	}
	for (const [key, count] of seen) {
		if (count > 1) {
			const [name, file] = key.split("@@");
			problems.push(`${INVENTORY_LABEL} has ${count} rows for ${name} (${file}); keep exactly one.`);
		}
	}
}

if (reportMode) {
	console.log(`Android composables: ${androidKeys.length}`);
	for (const declaration of declarations) {
		const count = androidCallerCount(declaration, declarations, androidTexts);
		console.log(`  ${count > 0 ? "OK " : "MISS"} ${declaration.name} (${declaration.relative}) callers=${count}`);
	}
	console.log(`Admin components: ${adminEntries.length}`);
	for (const component of adminEntries) {
		const has = (adminCallers.get(`${component.name}@@${component.relative}`) ?? []).length > 0;
		console.log(`  ${has ? "OK " : "MISS"} ${component.name} (${component.relative})`);
	}
	console.log(`Inventory rows: ${inventory === null ? "MISSING" : inventory.entries.length}`);
}

if (problems.length > 0) {
	console.error(`\n${problems.length} design-system component problem(s):`);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(
	`Design-system components verified: ${new Set(androidKeys).size} Android composable key(s) and ` +
		`${adminKeys.length} admin export(s) all have callers and an inventory row.`,
);
