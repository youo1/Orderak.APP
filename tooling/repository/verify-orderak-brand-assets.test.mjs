#!/usr/bin/env node
// ============================================================
// Companion proof for verify-orderak-brand-assets.mjs.
//
// The verifier decides whether every served copy of the D-14 mark is the
// approved export, whether the artwork stays on design-system colour roles,
// and whether the manifest, landing page and admin index reference files that
// exist. This suite decides whether the verifier can actually fail: it runs
// the guard on the real tree, then on isolated copies with a modified served
// copy, a non-role colour, and a removed referenced asset injected. Each
// failure must name the offending repository-relative file.
//
// Usage: node --test tooling/repository/verify-orderak-brand-assets.test.mjs
// ============================================================

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = path.join("tooling", "repository", "verify-orderak-brand-assets.mjs");
const ANDROID_RES = path.join("apps", "seller-android", "app", "src", "main", "res");
const sandboxes = [];

/**
 * A copy of the brand exports, the served copies and the three reference
 * documents the guard reads. The guard itself is copied too, so it resolves
 * its repository root from the sandbox rather than the real tree.
 */
function sandbox() {
	const root = mkdtempSync(path.join(tmpdir(), "orderak-brand-assets-"));
	sandboxes.push(root);
	cpSync(path.join(repositoryRoot, "tooling"), path.join(root, "tooling"), {
		recursive: true,
		filter: (source) => !source.includes("node_modules"),
	});
	cpSync(path.join(repositoryRoot, "design"), path.join(root, "design"), { recursive: true });
	cpSync(path.join(repositoryRoot, ANDROID_RES), path.join(root, ANDROID_RES), { recursive: true });
	cpSync(path.join(repositoryRoot, "services", "backend", "assets"), path.join(root, "services", "backend", "assets"), {
		recursive: true,
	});
	cpSync(
		path.join(repositoryRoot, "services", "backend", "src", "landing.ts"),
		path.join(root, "services", "backend", "src", "landing.ts"),
		{ recursive: true },
	);
	cpSync(path.join(repositoryRoot, "apps", "admin-web", "public"), path.join(root, "apps", "admin-web", "public"), {
		recursive: true,
	});
	cpSync(
		path.join(repositoryRoot, "apps", "admin-web", "index.html"),
		path.join(root, "apps", "admin-web", "index.html"),
	);
	return root;
}

function run(root) {
	const result = spawnSync(process.execPath, [path.join(root, GUARD)], {
		cwd: root,
		encoding: "utf8",
	});
	return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

test.after(() => {
	for (const root of sandboxes) rmSync(root, { recursive: true, force: true });
});

test("passes on the real tree", () => {
	const result = run(repositoryRoot);
	assert.equal(result.status, 0, result.output);
});

test("fails on a modified served copy, naming the served file", () => {
	const root = sandbox();
	const served = path.join(root, "services", "backend", "assets", "static", "orderak-favicon.svg");
	writeFileSync(served, `${readFileSync(served, "utf8")}\n<!-- tampered -->\n`);
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /services\/backend\/assets\/static\/orderak-favicon\.svg/);
	assert.match(result.output, /byte-identical/);
});

test("fails on a non-role colour, naming the file that carries it", () => {
	const root = sandbox();
	const source = path.join(root, "design", "assets", "brand", "svg", "orderak-mark-small.svg");
	const text = readFileSync(source, "utf8");
	writeFileSync(source, text.replace("</svg>", '<rect width="1" height="1" fill="#ABCDEF"/>\n</svg>'));
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /design\/assets\/brand\/svg\/orderak-mark-small\.svg/);
	assert.match(result.output, /#ABCDEF/);
});

test("fails on a missing referenced asset, naming the reference document", () => {
	const root = sandbox();
	rmSync(path.join(root, "services", "backend", "assets", "static", "orderak-icon-180.png"));
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /services\/backend\/src\/landing\.ts/);
	assert.match(result.output, /orderak-icon-180\.png/);
});

test("fails on a document-relative asset reference that does not exist, naming the manifest", () => {
	const root = sandbox();
	const manifestPath = path.join(root, "services", "backend", "assets", "manifest.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.icons = [...(Array.isArray(manifest.icons) ? manifest.icons : []), { src: "missing-relative.png", sizes: "512x512", type: "image/png" }];
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	const result = run(root);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /services\/backend\/assets\/manifest\.json/);
	assert.match(result.output, /missing-relative\.png/);
});
