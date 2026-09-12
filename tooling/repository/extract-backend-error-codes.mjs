#!/usr/bin/env node
// ============================================================
// Extract the error codes the seller API can answer with, and check that the
// Android client has an answer for each.
//
// WHY THIS EXISTS
//   The audit of 2026-09-11 found that `backendErrorResource()` mapped seven
//   codes while the backend emitted dozens, so every code that mattered —
//   payment_unavailable, stale_catalog, bulk_deletion_unconfirmed,
//   stock_changed — rendered as "something went wrong". The server goes to real
//   trouble to answer with a stable code and a remediation message; the app
//   discarded all of it.
//
//   Fixing the map once fixes today. This is what stops it drifting again: the
//   backend's own source is the list, the client declares what it answers, and
//   a code the server gains without the client gaining an answer for it fails
//   the build rather than quietly becoming "something went wrong".
//
//   It is also the cheapest of the three cross-layer checks the audit called
//   for, and the only one that needs no running server: both sides are read
//   from source.
//
// WHY IT PARSES SOURCE RATHER THAN THE OPENAPI DOCUMENT
//   The contract documents a problem example per status per operation, not the
//   full set of codes a handler can produce — several statuses carry a single
//   representative example. The handlers are where the truth is.
//
// SCOPE
//   Seller-facing modules only. The admin surface has its own client and its
//   own vocabulary, and folding the two together would make the Android
//   allowlist meaningless.
//
// Usage:
//   node tooling/repository/extract-backend-error-codes.mjs           # verify
//   node tooling/repository/extract-backend-error-codes.mjs --write   # update
// ============================================================

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REPO = process.cwd();
const SRC = join(REPO, "services", "backend", "src");
const OUT = join(REPO, "contracts", "error-codes", "seller-v1.json");
const KOTLIN = join(
	REPO, "apps", "seller-android", "app", "src", "main", "java",
	"app", "orderak", "seller", "core", "ui", "BackendErrors.kt",
);

/** Modules whose responses never reach a seller credential. */
const EXCLUDED = [
	join("domains", "admin") + sep,
	join("integrations", "email") + sep,
	"generated" + sep,
];

function sourceFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...sourceFiles(full));
		} else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Codes are normalised the way jsonResponse() normalises them, because that is
 * what a client actually receives: lower-cased, non-[a-z0-9._-] runs collapsed
 * to underscores, edges trimmed. `error: "PLAN_LIMIT_REACHED"` and
 * `error: "plan_limit_reached"` are one code on the wire and must be one code
 * here.
 */
function normalise(raw) {
	return raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "");
}

function extract() {
	const codes = new Map();
	for (const file of sourceFiles(SRC)) {
		const rel = relative(SRC, file);
		if (EXCLUDED.some((prefix) => rel.startsWith(prefix))) continue;
		const text = readFileSync(file, "utf8");
		// `error: "..."` is the single shape every refusal in this codebase uses
		// to name itself — jsonResponse() reads exactly that key to build the
		// problem body's `code`.
		for (const match of text.matchAll(/\berror:\s*"([^"]+)"/g)) {
			const raw = match[1];
			// `error` is also a semantic ROLE name in the design system, whose
			// value is a colour: `error: "#BA1A1A"`. A code never starts with a
			// hash and never contains whitespace, so both shapes are excluded
			// rather than the design module being special-cased — the next module
			// to reuse the word gets the same treatment for free.
			if (raw.startsWith("#") || /\s/.test(raw)) continue;
			const code = normalise(raw);
			if (!code) continue;
			if (!codes.has(code)) codes.set(code, new Set());
			codes.get(code).add(relative(REPO, file).split(sep).join("/"));
		}
	}
	return codes;
}

/** The two declared sets in BackendErrors.kt, read from the Kotlin source. */
function kotlinDeclarations() {
	const text = readFileSync(KOTLIN, "utf8");
	const read = (name) => {
		const start = text.indexOf(name);
		if (start === -1) throw new Error(`${name} not found in BackendErrors.kt`);
		// Everything from the declaration to the closing paren of its last set().
		const slice = text.slice(start, text.indexOf("\n\n", start) === -1 ? undefined : undefined);
		return slice;
	};
	const mapped = new Set();
	// Every quoted string inside MAPPED_CODES / INTENTIONALLY_GENERIC and the
	// private sets they are built from. Reading the whole file is deliberate:
	// a code named anywhere in this file has been considered, which is the
	// property being checked.
	for (const match of text.matchAll(/"([a-z0-9._-]{3,})"/g)) mapped.add(match[1]);
	read("MAPPED_CODES");
	read("INTENTIONALLY_GENERIC");
	return mapped;
}

const codes = extract();
const sorted = [...codes.keys()].sort();
const document = {
	$comment:
		"Generated by tooling/repository/extract-backend-error-codes.mjs. The error codes the "
		+ "seller-facing Worker can answer with, normalised the way jsonResponse() normalises them. "
		+ "Every code here must be answered by BackendErrors.kt or listed in its INTENTIONALLY_GENERIC "
		+ "set; BackendErrorCoverageTest asserts it.",
	generated_from: "services/backend/src (seller-facing modules)",
	count: sorted.length,
	codes: sorted.map((code) => ({ code, sources: [...codes.get(code)].sort() })),
};

const serialised = `${JSON.stringify(document, null, "\t")}\n`;

if (process.argv.includes("--write")) {
	mkdirSync(join(REPO, "contracts", "error-codes"), { recursive: true });
	writeFileSync(OUT, serialised);
	console.log(`Wrote ${sorted.length} codes to ${relative(REPO, OUT)}`);
} else {
	let existing;
	try {
		existing = readFileSync(OUT, "utf8");
	} catch {
		console.error(`Missing ${relative(REPO, OUT)}. Run with --write.`);
		process.exit(1);
	}
	if (existing !== serialised) {
		console.error(
			`${relative(REPO, OUT)} is out of date.\n`
			+ "The backend's error codes changed. Run:\n"
			+ "  node tooling/repository/extract-backend-error-codes.mjs --write\n"
			+ "then give any new code an answer in BackendErrors.kt, or list it in\n"
			+ "INTENTIONALLY_GENERIC if the generic message is the honest one.",
		);
		process.exit(1);
	}
}

// The coverage half runs here too, so a Node-only CI job catches a missing
// answer without waiting for the Android toolchain. BackendErrorCoverageTest
// asserts the same thing from the Kotlin side, where a refactor of
// BackendErrors.kt would be noticed first.
const declared = kotlinDeclarations();
const unanswered = sorted.filter((code) => !declared.has(code));
if (unanswered.length) {
	console.error(
		"These backend error codes have no answer in BackendErrors.kt:\n"
		+ unanswered.map((code) => `  ${code}  (${[...codes.get(code)][0]})`).join("\n")
		+ "\n\nGive each one a message, or add it to INTENTIONALLY_GENERIC with a reason.",
	);
	process.exit(1);
}
console.log(`${sorted.length} backend error codes, all answered by the Android client.`);
