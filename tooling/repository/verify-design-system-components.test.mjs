#!/usr/bin/env node
// ============================================================
// Companion proof for verify-design-system-components.mjs.
//
// The verifier decides whether the component tree and the inventory agree.
// This suite decides whether the verifier can actually fail: it runs the guard
// on the real tree, then on isolated copies with an unused Android composable,
// an unused admin export, and a removed inventory row injected. Each failure
// must name the component and its source file; the inventory case must also
// name the inventory document.
//
// Usage: node --test tooling/repository/verify-design-system-components.test.mjs
// ============================================================

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "verify-design-system-components.mjs";
const INVENTORY = path.join("docs", "domains", "design-system-components.md");
const CORE_UI = path.join("apps", "seller-android", "app", "src", "main", "java", "app", "orderak", "seller", "core", "ui");
const ADMIN_UI = path.join("apps", "admin-web", "src", "shared", "ui");
const sandboxes = [];

/** A copy of the tooling, docs, Android sources and admin sources the guard reads. */
function sandbox() {
	const root = mkdtempSync(path.join(tmpdir(), "orderak-ds-components-"));
	sandboxes.push(root);
	cpSync(path.join(repositoryRoot, "tooling"), path.join(root, "tooling"), {
		recursive: true,
		filter: (source) => !source.includes("node_modules"),
	});
	cpSync(path.join(repositoryRoot, "docs"), path.join(root, "docs"), { recursive: true });
	cpSync(path.join(repositoryRoot, "apps", "seller-android", "app", "src"), path.join(root, "apps", "seller-android", "app", "src"), {
		recursive: true,
		filter: (source) => !source.toLowerCase().endsWith(".png"),
	});
	cpSync(path.join(repositoryRoot, "apps", "admin-web", "src"), path.join(root, "apps", "admin-web", "src"), {
		recursive: true,
		filter: (source) => !source.includes("node_modules"),
	});
	return root;
}

function run(root) {
	const result = spawnSync(process.execPath, [path.join(root, "tooling", "repository", GUARD)], {
		cwd: root,
		encoding: "utf8",
	});
	return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function write(root, relative, text) {
	const file = path.join(root, relative);
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, text);
}

function cells(line) {
	return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
}

function normalise(cell) {
	return cell.replace(/`/g, "").trim().replace(/\(\)$/, "");
}

function findRow(lines, name) {
	return lines.findIndex(
		(line) => line.trim().startsWith("|") && cells(line).some((cell) => normalise(cell) === name),
	);
}

test.after(() => {
	for (const root of sandboxes) rmSync(root, { recursive: true, force: true });
});

test("passes on the real tree", () => {
	const result = run(repositoryRoot);
	assert.equal(result.status, 0, result.output);
});

test("fails on a kit-pending row with no R-item adopter", () => {
	const root = sandbox();
	const inventory = path.join(root, INVENTORY);
	const lines = readFileSync(inventory, "utf8").split(/\r?\n/);
	const header = lines.findIndex(
		(line) => line.trim().startsWith("|") && cells(line).map((cell) => cell.trim()).includes("Adopter"),
	);
	assert.notEqual(header, -1, "the inventory header names an Adopter column");
	const adopterIndex = cells(lines[header]).map((cell) => cell.trim()).indexOf("Adopter");
	const row = findRow(lines, "Banner");
	assert.notEqual(row, -1, "the inventory names the kit-pending Banner");
	const rowCells = cells(lines[row]);
	rowCells[adopterIndex] = " ";
	lines[row] = `|${rowCells.join("|")}|`;
	writeFileSync(inventory, lines.join("\n"));
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /Banner/);
	assert.match(result.output, /kit-pending but has no R-item adopter/);
});

test("fails when a kit-pending component gains a production caller", () => {
	const root = sandbox();
	write(
		root,
		path.join("apps", "seller-android", "app", "src", "main", "java", "app", "orderak", "seller", "feature", "orders", "ZzBannerCaller.kt"),
		[
			"package app.orderak.seller.feature.orders",
			"",
			"import app.orderak.seller.core.ui.Banner",
			"",
			"fun zzBannerCaller() { Banner(state = null, title = \"x\", message = \"y\") }",
			"",
		].join("\n"),
	);
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /Banner/);
	assert.match(result.output, /kit-pending but has a production caller/);
});

test("fails on an unused Android composable, naming it and its file", () => {
	const root = sandbox();
	write(
		root,
		path.join(CORE_UI, "ZzUnusedProbe.kt"),
		[
			"package app.orderak.seller.core.ui",
			"",
			"import androidx.compose.runtime.Composable",
			"",
			"@Composable",
			"fun ZzUnusedProbe(label: String) {",
			'    SemanticChip(SemanticRole.Info, label)',
			"}",
			"",
		].join("\n"),
	);
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /ZzUnusedProbe/);
	assert.match(result.output, /ZzUnusedProbe\.kt/);
});

test("distinguishes same-name, same-basename components in separate directories", () => {
	const root = sandbox();
	// Two distinct composables share both a name and a source-file basename.
	// Both have callers, so the only problem is that neither has an inventory
	// row: the guard must key each by its full repository-relative path and
	// report both, instead of collapsing them into a single inventory key.
	const declaration = (pkg, name) =>
		[
			`package ${pkg}`,
			"",
			"import androidx.compose.runtime.Composable",
			"",
			"@Composable",
			`fun ${name}(label: String) {`,
			"    SemanticChip(SemanticRole.Info, label)",
			"}",
			"",
		].join("\n");
	write(root, path.join(CORE_UI, "ZzTwinProbe.kt"), declaration("app.orderak.seller.core.ui", "ZzTwinProbe"));
	write(
		root,
		path.join(CORE_UI, "nested", "ZzTwinProbe.kt"),
		declaration("app.orderak.seller.core.ui.nested", "ZzTwinProbe"),
	);
	write(
		root,
		path.join("apps", "seller-android", "app", "src", "main", "java", "app", "orderak", "seller", "feature", "orders", "ZzTwinProbeCaller.kt"),
		[
			"package app.orderak.seller.feature.orders",
			"",
			"import app.orderak.seller.core.ui.ZzTwinProbe",
			"",
			"fun probeCaller() {",
			'    ZzTwinProbe("x")',
			"}",
			"",
		].join("\n"),
	);
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /core\/ui\/ZzTwinProbe\.kt/);
	assert.match(result.output, /core\/ui\/nested\/ZzTwinProbe\.kt/);
});

test("fails on an unused admin component export, naming it and its file", () => {
	const root = sandbox();
	const card = path.join(root, ADMIN_UI, "card.tsx");
	writeFileSync(
		card,
		`${readFileSync(card, "utf8")}\nexport const CardFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex items-center p-5 pt-0', className)} {...props} />;\n`,
	);
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /CardFooter/);
	assert.match(result.output, /card\.tsx/);
});

test("fails when an inventory row is removed, naming the component, file and inventory", () => {
	const root = sandbox();
	const inventory = path.join(root, INVENTORY);
	const lines = readFileSync(inventory, "utf8").split(/\r?\n/);
	const row = findRow(lines, "FeatureAvailabilityChip");
	assert.notEqual(row, -1, "the inventory names FeatureAvailabilityChip");
	writeFileSync(inventory, lines.filter((_, index) => index !== row).join("\n"));
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /FeatureAvailabilityChip/);
	assert.match(result.output, /SemanticChip\.kt/);
	assert.match(result.output, /design-system-components\.md/);
});

test("fails when an inventory source path has the right basename but the wrong directory", () => {
	const root = sandbox();
	const inventory = path.join(root, INVENTORY);
	const lines = readFileSync(inventory, "utf8").split(/\r?\n/);
	const row = findRow(lines, "FeatureAvailabilityChip");
	assert.notEqual(row, -1, "the inventory names FeatureAvailabilityChip");
	const correct = "apps/seller-android/app/src/main/java/app/orderak/seller/core/ui/SemanticChip.kt";
	const wrong = "apps/seller-android/app/src/main/java/app/orderak/seller/core/ui/theme/SemanticChip.kt";
	assert.ok(lines[row].includes(correct), lines[row]);
	lines[row] = lines[row].replace(correct, wrong);
	writeFileSync(inventory, lines.join("\n"));
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /FeatureAvailabilityChip/);
	assert.ok(result.output.includes(correct), result.output);
	assert.ok(result.output.includes(wrong), result.output);
});

test("fails on a same-line @Composable fun declaration with no caller", () => {
	const root = sandbox();
	write(
		root,
		path.join(CORE_UI, "ZzOneLineProbe.kt"),
		[
			"package app.orderak.seller.core.ui",
			"",
			"import androidx.compose.runtime.Composable",
			"import androidx.compose.material3.Text",
			"",
			"@Composable fun ZzOneLineProbe(label: String) { Text(label) }",
			"",
		].join("\n"),
	);
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /ZzOneLineProbe/);
	assert.match(result.output, /ZzOneLineProbe\.kt/);
});

test("fails when an inventory Callers cell omits a caller file the guard computes", () => {
	const root = sandbox();
	const inventory = path.join(root, INVENTORY);
	const lines = readFileSync(inventory, "utf8").split(/\r?\n/);
	const header = lines.findIndex((line) => line.trim().startsWith("|") && cells(line).map((cell) => cell.trim()).includes("Callers"));
	assert.notEqual(header, -1, "the inventory header names a Callers column");
	const callersIndex = cells(lines[header]).map((cell) => cell.trim()).indexOf("Callers");
	const row = findRow(lines, "SyncStatusBanner");
	assert.notEqual(row, -1, "the inventory names SyncStatusBanner");
	const rowCells = cells(lines[row]);
	assert.match(rowCells[callersIndex], /MainScreen\.kt/);
	rowCells[callersIndex] = " ";
	lines[row] = `|${rowCells.join("|")}|`;
	writeFileSync(inventory, lines.join("\n"));
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /SyncStatusBanner/);
	assert.match(result.output, /MainScreen\.kt/);
	assert.match(result.output, /design-system-components\.md/);
});

test("counts typed role.colors() but not an unrelated TextFieldDefaults.colors()", () => {
	const typedRoot = sandbox();
	write(
		typedRoot,
		path.join(CORE_UI, "ZzTypedColorsCaller.kt"),
		[
			"package app.orderak.seller.core.ui",
			"",
			"import androidx.compose.runtime.Composable",
			"",
			"@Composable",
			"fun ZzTypedColorsCaller(role: SemanticRole) {",
			"    role.colors()",
			"}",
			"",
		].join("\n"),
	);
	const typed = run(typedRoot);
	assert.notEqual(typed.status, 0, typed.output);
	assert.match(typed.output, /SemanticRole\.colors/);
	assert.match(typed.output, /ZzTypedColorsCaller\.kt/);

	const unrelatedRoot = sandbox();
	write(
		unrelatedRoot,
		path.join(CORE_UI, "ZzUnrelatedColorsCaller.kt"),
		[
			"package app.orderak.seller.core.ui",
			"",
			"fun zzUnrelatedColorsCaller() {",
			"    TextFieldDefaults.colors()",
			"}",
			"",
		].join("\n"),
	);
	const unrelated = run(unrelatedRoot);
	assert.equal(unrelated.status, 0, unrelated.output);
});
