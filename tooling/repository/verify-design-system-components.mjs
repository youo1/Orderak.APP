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
//     2. every component appears in docs/domains/design-system-components.md;
//     3. every row in that inventory corresponds to a real component.
//
// WHAT IS COUNTED
//   Android: top-level `@Composable` declarations of any visibility in
//   `apps/seller-android/app/src/main/java/app/orderak/seller/core/ui`,
//   excluding functions annotated `@Preview`. The `SemanticRole.colors()`
//   extension is matched by receiver form (`SemanticRole.colors` or
//   `SemanticRole.<Role>.colors`) so an unrelated `TextFieldDefaults.colors()`
//   does not satisfy it.
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

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True for an occurrence matcher preferring the receiver form for SemanticRole.colors(). */
function occurrencePattern(name) {
	if (name === "SemanticRole.colors") return /\bSemanticRole(?:\.\w+)?\.colors\b/g;
	return new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");
}

function countOccurrences(text, name) {
	const pattern = occurrencePattern(name);
	let count = 0;
	while (pattern.exec(text) !== null) count++;
	return count;
}

// ---- Android ---------------------------------------------------------------

/**
 * Every top-level `@Composable` declaration under core/ui, excluding those
 * carrying `@Preview`. Returned as `{ name, file, source }`, with the receiver
 * folded into the name for extension composables such as SemanticRole.colors.
 */
function androidDeclarations() {
	const found = [];
	for (const file of collectFiles(CORE_UI, (name) => name.endsWith(".kt"))) {
		const lines = readFileSync(file, "utf8").split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			if (!/^\s*@Composable\b/.test(lines[i])) continue;

			let start = i;
			while (start - 1 >= 0 && /^\s*@\w/.test(lines[start - 1])) start--;
			let end = i;
			while (end + 1 < lines.length && /^\s*@\w/.test(lines[end + 1])) end++;

			const annotations = lines.slice(start, end + 1).map((line) => line.trim());
			if (annotations.some((line) => /^@Preview\b/.test(line))) continue;

			let j = end + 1;
			while (j < lines.length && lines[j].trim() === "") j++;
			if (j >= lines.length) continue;

			const declarationLine = lines[j];
			if (/^\s/.test(declarationLine)) continue; // indented: not top-level
			const withoutAnnotations = declarationLine.replace(/^(?:\s*@\w+(?:\([^)]*\))?\s*)+/, "");
			const match =
				/^(?:(?:public|private|internal|protected|suspend|inline|operator|open|override|external|expect|actual|tailrec)\s+)*fun\s+(?:<[^>]+>\s*)?(?:([A-Za-z_]\w*)\.)?([A-Za-z_]\w*)\s*\(/.exec(
					withoutAnnotations,
				);
			if (!match) continue;

			const receiver = match[1] ?? null;
			const name = receiver ? `${receiver}.${match[2]}` : match[2];
			found.push({ name, file, relative: relative(file) });
		}
	}
	return found;
}

function androidCallerCount(declaration, declarations, texts) {
	let total = 0;
	for (const text of texts) total += countOccurrences(text, declaration.name);
	const declarationsOfName = declarations.filter((entry) => entry.name === declaration.name).length;
	return total - declarationsOfName;
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
	const files = collectFiles(ADMIN_SRC, (name) => /\.(tsx|ts)$/.test(name));
	const withCallers = new Set();
	for (const component of components) {
		const pattern = new RegExp(`\\b${escapeRegExp(component.name)}\\b`);
		const caller = files.find((file) => {
			if (file === component.file) return false;
			if (isTestFile(relative(file))) return false;
			return pattern.test(withoutComments(readFileSync(file, "utf8")));
		});
		if (caller) withCallers.add(`${component.name}@@${path.basename(component.file)}`);
	}
	return { components, withCallers };
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
	const entries = [];
	for (let i = headerIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim().startsWith("|")) break;
		const cells = splitRow(line);
		if (cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))) continue;
		if (cells.length <= Math.max(nameIndex, fileIndex)) continue;
		const name = normaliseName(cells[nameIndex]);
		const file = cells[fileIndex].replace(/`/g, "").trim();
		if (!name || !file) continue;
		entries.push({ name, file: path.basename(file) });
	}
	return entries;
}

// ---- Checks ----------------------------------------------------------------

const declarations = androidDeclarations();
const androidTexts = collectFiles(ANDROID_MAIN, (name) => name.endsWith(".kt")).map((file) =>
	withoutComments(readFileSync(file, "utf8")),
);

const androidKeys = [];
for (const declaration of declarations) {
	const callers = androidCallerCount(declaration, declarations, androidTexts);
	if (callers <= 0) {
		problems.push(
			`Android composable ${declaration.name} (${path.basename(declaration.relative)}) has no caller ` +
				`in apps/seller-android/app/src/main outside its declaration.`,
		);
	}
	androidKeys.push(`${declaration.name}@@${path.basename(declaration.file)}`);
}

const { components: adminEntries, withCallers: adminWithCallers } = adminComponentsWithCallers();
for (const component of adminEntries) {
	if (!adminWithCallers.has(`${component.name}@@${path.basename(component.file)}`)) {
		problems.push(
			`Admin component ${component.name} (${path.basename(component.relative)}) has no caller outside its ` +
				"declaring file and outside tests.",
		);
	}
}
const adminKeys = adminEntries.map((component) => `${component.name}@@${path.basename(component.file)}`);

const inventory = readInventory();
if (inventory === null) {
	problems.push(
		`${INVENTORY_LABEL} is missing or has no inventory table with "Component" and "Source file" columns.`,
	);
} else {
	const inventoryKeys = new Set(inventory.map((entry) => `${entry.name}@@${path.basename(entry.file)}`));
	const treeKeys = new Map();
	for (const key of [...androidKeys, ...adminKeys]) {
		treeKeys.set(key, key);
	}
	for (const [key, label] of treeKeys) {
		if (!inventoryKeys.has(key)) {
			const [name, file] = key.split("@@");
			problems.push(
				`Component ${name} (${file}) is in the tree but missing from ${INVENTORY_LABEL}. ` +
					"Add one inventory row per component key.",
			);
		}
	}
	for (const entry of inventory) {
		const key = `${entry.name}@@${path.basename(entry.file)}`;
		if (!treeKeys.has(key)) {
			problems.push(
				`${INVENTORY_LABEL} lists ${entry.name} (${entry.file}), which is not a component in the tree. ` +
					"Remove the stale inventory row.",
			);
		}
	}
	// Duplicate keys collapse overloads; the inventory wants one row per key.
	const seen = new Map();
	for (const entry of inventory) {
		const key = `${entry.name}@@${path.basename(entry.file)}`;
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
		const callers = androidCallerCount(declaration, declarations, androidTexts);
		console.log(`  ${callers > 0 ? "OK " : "MISS"} ${declaration.name} (${path.basename(declaration.file)}) callers=${callers}`);
	}
	console.log(`Admin components: ${adminEntries.length}`);
	for (const component of adminEntries) {
		const has = adminWithCallers.has(`${component.name}@@${path.basename(component.file)}`);
		console.log(`  ${has ? "OK " : "MISS"} ${component.name} (${path.basename(component.file)})`);
	}
	console.log(`Inventory rows: ${inventory === null ? "MISSING" : inventory.length}`);
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
