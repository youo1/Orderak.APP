#!/usr/bin/env node
// ============================================================
// Check the factual claims documentation makes about this repository.
//
// WHY THIS EXISTS
//   docs/guides/setup.md told readers to run `npm run deploy:admin` from
//   services/backend. That script has never existed. The document also
//   pointed at `Orderak\backend`, a directory that does not exist, and
//   claimed migrations ran 001-040 when the highest is 042. Every one of
//   those is checkable against the repository, and every one survived a
//   human read-through - including several of mine - because prose scans as
//   plausible while a path or script name is only wrong in a way a machine
//   notices.
//
//   verify-doc-links.mjs already checks Markdown link targets. This checks
//   what links cannot: paths and commands written as inline code.
//
// WHAT IS CHECKED
//   1. Backtick-quoted repository paths - `services/backend/foo.ts` - exist.
//   2. `pnpm run <script>` / `npm run <script>` names exist in a
//      package.json somewhere in the repository.
//   3. Cloudflare resource names - Workers, D1, R2, queues - appear in a
//      wrangler config.
//
// WHAT IS NOT CHECKED, DELIBERATELY
//   Prose meaning. A document can pass this and still be wrong about what
//   something does. This narrows the review to judgement rather than
//   replacing it.
//
// Usage: node tooling/repository/verify-doc-claims.mjs [--json]
// ============================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const emitJson = process.argv.includes("--json");
const findings = [];

function relative(filePath) {
	return path.relative(repositoryRoot, filePath).replace(/\\/g, "/");
}

function walk(directory, filter, found = []) {
	for (const entry of readdirSync(directory)) {
		if (entry === "node_modules" || entry === ".git" || entry === "site" || entry === "build" || entry === "dist") continue;
		const full = path.join(directory, entry);
		if (statSync(full).isDirectory()) walk(full, filter, found);
		else if (filter(entry, full)) found.push(full);
	}
	return found;
}

// ---- What the repository actually contains -------------------------------

/** Every script name declared in any package.json. */
const declaredScripts = new Set();
for (const file of walk(repositoryRoot, (name) => name === "package.json")) {
	try {
		for (const script of Object.keys(JSON.parse(readFileSync(file, "utf8")).scripts ?? {})) {
			declaredScripts.add(script);
		}
	} catch {
		findings.push({ kind: "unparseable-package-json", file: relative(file) });
	}
}

/** Every Cloudflare resource name any wrangler config declares. */
const declaredResources = new Set();
for (const file of walk(repositoryRoot, (name) => /^wrangler.*\.jsonc?$/.test(name))) {
	const text = readFileSync(file, "utf8");
	for (const match of text.matchAll(/"(?:name|database_name|bucket_name|queue|dead_letter_queue)"\s*:\s*"([^"]+)"/g)) {
		declaredResources.add(match[1]);
	}
}

// ---- Claim extraction ----------------------------------------------------

/**
 * A backtick span is treated as a repository path claim only when it looks
 * unambiguously like one: it contains a slash, starts with a known top-level
 * directory or a dotfile, and carries a file extension or a trailing slash.
 * Anything vaguer - `path/to/x`, `<db>/objects` - is prose, not a claim, and
 * flagging it would train people to ignore this check.
 */
const TOP_LEVEL = ["apps", "services", "contracts", "packages", "docs", "tooling", "quality", "design", ".github", ".vscode"];

/**
 * Paths documentation correctly names but that are absent from a clean
 * checkout. Each needs a reason: an unexplained entry here is how a real
 * broken reference gets waved through later.
 */
const EXPECTED_ABSENT = new Map([
	["apps/seller-ios", "Reserved name, documented as planned rather than present. ADR: contracts only, no empty scaffold directories."],
	["apps/seller-desktop", "Reserved name, same decision as seller-ios."],
	["services/backend/.dev.vars", "Local secrets file. Gitignored by design and created by each developer from .dev.vars.example."],
	["apps/seller-android/app/google-services.json", "Firebase client configuration. Gitignored; each developer downloads their own."],
	["apps/seller-android/app/src/staging/google-services.json", "Staging Firebase client configuration. Same reason."],
	["contracts/openapi/dist", "Build output of the OpenAPI bundle step. Gitignored."],
	["contracts/openapi/dist/public-v1.json", "Build output. Gitignored."],
]);

/**
 * Cloudflare resources that exist in the account but are deliberately not
 * bound in any wrangler config, so they cannot be found by scanning configs.
 */
const UNBOUND_RESOURCES = new Map([
	["orderak-backups", "Backup bucket. Written by d1-backup.yml through `wrangler r2 object put`, never bound to a Worker - binding it would give the runtime read access to every backup."],
]);

/**
 * Cloudflare API **token names**, which are not resources at all.
 *
 * These are kept apart from UNBOUND_RESOURCES rather than folded into it,
 * because that map means "a real resource that is deliberately not bound" and
 * these are a different kind of thing entirely — a token is an account-level
 * credential, never declared in a wrangler config and never bindable.
 *
 * They collide with the resource check only because they share the `orderak-`
 * prefix, and one pair is genuinely confusable: `orderak-backups` is the R2
 * bucket, `orderak-backup-production` is the token that writes to it.
 *
 * The authoritative list is docs/governance/cloudflare-token-inventory.md.
 */
const API_TOKEN_NAMES = new Set([
	"orderak-deploy-staging",
	"orderak-deploy-production",
	"orderak-backup-staging",
	"orderak-backup-production",
	"orderak-drift-check",
	"orderak-analytics",
	"orderak-restore-read",
	"orderak-restore-read-production",
	"orderak-rollback-breakglass",
	"orderak-production-rollback-breakglass",
]);

function pathClaims(text) {
	const claims = new Set();
	// A line that names the source repository is describing something over
	// there, not a claim about this checkout — README's pointer to the freeze
	// manifest in youo1/Orderak is correct precisely because it says so.
	const lines = text.split(/\r?\n/).filter((line) => !/youo1\/Orderak(?!\.APP)/.test(line));
	for (const match of lines.join("\n").matchAll(/`([^`\n]+)`/g)) {
		const span = match[1].trim();
		if (!span.includes("/")) continue;
		if (/[<>{}*$|\\]/.test(span)) continue; // placeholders, globs, shell
		if (span.includes(" ")) continue; // a command, handled separately
		if (/^https?:/.test(span)) continue;
		const clean = span.replace(/[.,;:)]+$/, "");
		const top = clean.split("/")[0];
		if (!TOP_LEVEL.includes(top)) continue;
		if (!/\.[a-z0-9]+$/i.test(clean) && !clean.endsWith("/")) continue; // needs an extension or to be a directory
		claims.add(clean.replace(/\/$/, ""));
	}
	return claims;
}

function scriptClaims(text) {
	const claims = new Set();
	for (const match of text.matchAll(/\b(?:pnpm|npm|npm\.cmd)\s+run\s+([a-z][a-z0-9:_-]*)/gi)) {
		claims.add(match[1]);
	}
	// `pnpm test` / `pnpm <script>` without `run` resolves to a script too, but
	// only the unambiguous `run` form is checked - bare `pnpm build` could be a
	// package manager builtin and guessing would produce noise.
	return claims;
}

function resourceClaims(text) {
	const claims = new Set();
	for (const match of text.matchAll(/`(orderak-[a-z0-9-]+)`/g)) claims.add(match[1]);
	return claims;
}

// ---- Check every document ------------------------------------------------

const docs = walk(path.join(repositoryRoot, "docs"), (name) => name.endsWith(".md")).filter(
	(file) => !relative(file).includes("/archive/"),
);
const rootDocs = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "AGENTS.md", "CHANGELOG.md"]
	.map((name) => path.join(repositoryRoot, name))
	.filter(existsSync);

for (const file of [...docs, ...rootDocs]) {
	const text = readFileSync(file, "utf8");
	const where = relative(file);

	for (const claim of pathClaims(text)) {
		if (EXPECTED_ABSENT.has(claim)) continue;
		if (!existsSync(path.join(repositoryRoot, claim))) {
			findings.push({ kind: "missing-path", file: where, claim });
		}
	}
	for (const claim of scriptClaims(text)) {
		if (!declaredScripts.has(claim)) {
			findings.push({ kind: "missing-script", file: where, claim });
		}
	}
	for (const claim of resourceClaims(text)) {
		if (declaredResources.has(claim) || UNBOUND_RESOURCES.has(claim) || API_TOKEN_NAMES.has(claim)) continue;
		findings.push({ kind: "undeclared-resource", file: where, claim });
	}
}

// ---- Report --------------------------------------------------------------

if (emitJson) {
	console.log(JSON.stringify(findings, null, 2));
	process.exit(0);
}

const byKind = findings.reduce((acc, f) => ((acc[f.kind] = (acc[f.kind] ?? 0) + 1), acc), {});
console.log(
	`Checked ${docs.length + rootDocs.length} document(s) against ${declaredScripts.size} declared script(s) and ${declaredResources.size} declared Cloudflare resource(s).`,
);
console.log(`  ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join("  ") || "no findings"}`);

if (findings.length > 0) {
	console.error("");
	for (const finding of findings) {
		console.error(`  ${finding.kind.padEnd(20)} ${finding.file}: ${finding.claim}`);
	}
	process.exit(1);
}
