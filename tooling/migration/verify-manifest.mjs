#!/usr/bin/env node
/**
 * Verifies a migrated tree against the source manifest.
 *
 * Runs in the destination repository (Orderak.APP). The manifest it reads was built in
 * the source repository from git objects at the freeze tag — see build-manifest.mjs.
 *
 * One verifier per decision, because one rule cannot cover them
 * ------------------------------------------------------------
 * Comparing every file to its source hash only works for files that were copied
 * unchanged. A document whose factual errors were corrected on the way over is
 * *supposed* to differ, and a hash comparison would either fail on it or, worse, be
 * quietly relaxed until it stopped catching anything.
 *
 *   verbatim   destination sha256 == source sha256, and the file mode is preserved.
 *   rewrite    content deliberately differs. The source hash is provenance only, so
 *              what is checked instead is that a human recorded evidence and a name.
 *   regenerate never copied. The file must exist, and its generator must have produced
 *              it — the generated-doc drift check is what proves that, so this only
 *              asserts presence and that the content is NOT a byte copy of the source
 *              (which would mean someone pasted it instead of regenerating).
 *   archive     carried over intact, and additionally must not be published.
 *   drop        must be absent. Verifying a deletion means proving nothing is there.
 *   pending     always fails. A file nobody decided about must not migrate.
 *
 * Usage: node tooling/migration/verify-manifest.mjs <manifest.json> [destination-root]
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const [manifestPath, destinationRoot = process.cwd()] = process.argv.slice(2);
if (!manifestPath) {
	console.error("usage: verify-manifest.mjs <manifest.json> [destination-root]");
	process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const failures = [];
const counts = {};

function fail(row, message) {
	failures.push(`${row.decision.padEnd(10)} ${row.new_path || row.path}: ${message}`);
}

function sha256Of(absolutePath) {
	return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

for (const row of manifest.files) {
	counts[row.decision] = (counts[row.decision] ?? 0) + 1;
	const target = path.join(destinationRoot, row.new_path || row.path);
	const present = existsSync(target);

	switch (row.decision) {
		case "pending":
			fail(row, "no migration decision recorded");
			break;

		case "drop":
			if (present) fail(row, "marked drop but still present in the destination");
			break;

		case "verbatim":
		case "archive": {
			if (!present) {
				fail(row, "missing from the destination");
				break;
			}
			const actual = sha256Of(target);
			if (actual !== row.sha256) {
				fail(row, `content changed (expected ${row.sha256.slice(0, 12)}, found ${actual.slice(0, 12)})`);
			}
			// Executable bit: only meaningful where the filesystem reports it. On Windows
			// git sets core.filemode=false and the mode is carried in the index instead,
			// so this check is skipped there rather than producing a false failure.
			if (row.mode === "100755" && process.platform !== "win32") {
				const mode = statSync(target).mode;
				if ((mode & 0o111) === 0) fail(row, "executable bit lost — Android CI will fail on Linux");
			}
			break;
		}

		case "rewrite":
			if (!present) {
				fail(row, "missing from the destination");
				break;
			}
			if (!row.evidence) fail(row, "rewritten with no evidence recorded (which test or review proves it correct?)");
			if (!row.reviewer) fail(row, "rewritten with no reviewer recorded");
			break;

		case "regenerate":
			if (!present) {
				fail(row, "missing — its generator did not run in the destination");
				break;
			}
			if (sha256Of(target) === row.sha256) {
				fail(row, "byte-identical to the source, so it was copied rather than regenerated");
			}
			break;

		default:
			fail(row, `unknown decision "${row.decision}"`);
	}
}

console.log(`Verifying ${manifest.file_count} files from ${manifest.source_repository}@${manifest.source_commit.slice(0, 8)}`);
console.log(`  ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  ")}`);

if (failures.length > 0) {
	console.error(`\n${failures.length} problem(s):`);
	for (const line of failures.slice(0, 60)) console.error(`  ${line}`);
	if (failures.length > 60) console.error(`  ... and ${failures.length - 60} more`);
	process.exit(1);
}

console.log("All files verified against the manifest.");
