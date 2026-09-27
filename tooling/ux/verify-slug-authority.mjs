#!/usr/bin/env node
// ============================================================
// One surface edits the catalogue slug, and it checks the name first.
//
// WHY THIS EXISTS
//   Two surfaces edited the same store field and only one of them could be
//   right.
//
//   `StoreInfoScreen` (the store surface) owns it properly: it queries
//   `/api/v1/slug/check`, tells the seller whether the name is available, taken or
//   reserved, and keeps Save disabled until it is free.
//
//   The account surface carried a second, bare `OutlinedTextField` for the same
//   value. It wrote locally and `savePayout` triggered a refresh, whose
//   `SellerRefresher` pushed the value through `api.register`. A taken name
//   therefore made that registration fail, and `refresh()` returns false on
//   `!reg.ok` — so a single unvalidated slug stopped the whole sync, every pull
//   and push behind it, while the snackbar said "Payout details saved". The
//   seller's feedback and the truth came from different places.
//
//   `docs/ux/feature-surface-map.md` agrees with the working implementation:
//   `products_catalog.custom_catalog_slug` is a store FIELD. Two independent
//   sources against one duplicate is what settled the question the decision log
//   had left open for the owner.
//
// WHAT IT CHECKS
//   1. Exactly one file writes the slug in a save path, and it is the store
//      surface — not the account surface, not anywhere else.
//   2. That file also performs the availability check, so "owns it" and "checks
//      it" cannot come apart.
//   3. The account surface renders no slug editor: reading
//      `R.string.settings_slug_label` there again would re-create the duplicate.
//
// Usage: node tooling/ux/verify-slug-authority.mjs
// ============================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sellerSrc = path.join(
	repositoryRoot,
	"apps",
	"seller-android",
	"app",
	"src",
	"main",
	"java",
	"app",
	"orderak",
	"seller",
);

/** The one file allowed to write the slug, and the check it must also perform. */
const OWNER = "feature/settings/StoreInfoScreen.kt";
const CHECK = "checkSlug";

/** Surfaces that must not render a slug editor. */
const MUST_NOT_EDIT = ["feature/settings/AccountContent.kt"];

function kotlinFiles(directory, out = []) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) kotlinFiles(full, out);
		else if (entry.name.endsWith(".kt")) out.push(full);
	}
	return out;
}

const problems = [];
const sources = new Map();
for (const file of kotlinFiles(sellerSrc)) {
	const relative = path.relative(sellerSrc, file).replace(/\\/g, "/");
	const text = readFileSync(file, "utf8");
	// Comments explain the decision and are not code; the migration's own notes
	// name the call they removed.
	const code = text
		.split(/\r?\n/)
		.filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
		.join("\n");
	sources.set(relative, code);
}

if (!sources.has(OWNER)) {
	console.error(`  ${OWNER} no longer exists — the slug's home moved, and this guard is stale.`);
	process.exit(1);
}

// 1. Writers of the slug.
//
// A CALL, not the declaration: `SessionStore` defines `saveSlug`, and the
// definition is not a caller — counting it would make the storage layer look like
// a second editor. A call goes through the store instance, so it carries a dot.
const writers = [...sources]
	.filter(([, code]) => /\.\s*saveSlug\s*\(/.test(code))
	.map(([relative]) => relative);

if (writers.length === 0) {
	problems.push("nothing writes the slug any more — `sessionStore.saveSlug` has no caller, so the field is inert");
} else if (!writers.includes(OWNER)) {
	problems.push(`${OWNER} no longer writes the slug, but it is the surface that owns it (writers: ${writers.join(", ")})`);
}
for (const writer of writers) {
	if (writer !== OWNER) {
		problems.push(
			`${writer} writes the slug as well as ${OWNER}. Two editors for one store field is how the ` +
			`unchecked one appeared; the slug is a store field (feature-surface-map: custom_catalog_slug).`,
		);
	}
}

// 2. Owning it and checking it cannot come apart.
if (!new RegExp(`\\b${CHECK}\\s*\\(`).test(sources.get(OWNER) ?? "")) {
	problems.push(`${OWNER} writes the slug but no longer calls ${CHECK}(), so a taken name can be saved`);
}

// 3. No second editor on the account surface.
for (const relative of MUST_NOT_EDIT) {
	const code = sources.get(relative);
	if (code === undefined) {
		problems.push(`${relative} no longer exists — remove it from MUST_NOT_EDIT deliberately.`);
		continue;
	}
	if (code.includes("settings_slug_label")) {
		problems.push(
			`${relative} renders a slug editor again. Editing belongs on the store surface, which is ` +
			`the only place that can check the name against the server first.`,
		);
	}
}

if (problems.length > 0) {
	console.error(`\n${problems.length} slug-authority problem(s):\n`);
	for (const problem of problems) console.error(`  ${problem}`);
	console.error("");
	process.exit(1);
}

console.log(`The catalogue slug has one editor (${OWNER}), and it checks the name before saving it.`);
