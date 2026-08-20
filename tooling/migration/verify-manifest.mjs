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
 * Migration correctness vs. present-day equality
 * ----------------------------------------------
 * A `verbatim` row records that a file was copied byte-identically **at the
 * freeze**. It does not promise the file is frozen forever — this repository has
 * developed since, and wrangler configs, contracts, workflows and docs have all
 * legitimately changed. Treating every later edit as a migration defect makes the
 * check fail permanently on ordinary work, which is how a gate stops being read.
 *
 * So a content difference is split by whether anything recorded it:
 *
 *   difference + a later commit touching that path  -> drift, reported, not fatal
 *   difference + no commit after the migration one  -> FATAL: migrated content was
 *                                                     changed with nothing
 *                                                     recording it — an
 *                                                     uncommitted or unexplained
 *                                                     edit
 *
 * Missing files, drop violations, pending rows, lost executable bits and copied
 * "regenerate" rows stay fatal in every case. Those are migration defects, and no
 * amount of later development makes them acceptable.
 *
 * What the drift check does not prove: it asks whether any commit has touched the
 * path since the migration, not whether the working tree is clean. An uncommitted
 * edit to a file that had already drifted is therefore not distinguished from the
 * committed drift. Catching that is `git status`'s job, not this one.
 *
 * It also needs real history. Under a shallow clone every path looks like it has
 * one commit, so the run stops with exit 2 rather than reporting false defects.
 *
 * Usage: node tooling/migration/verify-manifest.mjs <manifest.json> [destination-root]
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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

/**
 * The manifest's hashes come from git objects — build-manifest.mjs says so in
 * its own header, and never reads the working tree. Its sibling assumption was
 * that the destination would be checked out "on Linux CI with LF", so a digest
 * of the file on disk would match.
 *
 * On a Windows checkout it does not. git materialises CRLF for files covered by
 * `.gitattributes` text rules, so `gradlew.bat` and the two `.ps1` scripts
 * hashed differently on disk while their git blobs were byte-identical between
 * the two repositories. Three false failures out of 705, reported as content
 * changes that had not happened.
 *
 * So compare what the manifest actually recorded: the blob id. It is exact and
 * platform-independent. `sha256` stays the fallback for the case it was added
 * for — checking a destination without git in the loop.
 */
function blobIdOf(absolutePath) {
	try {
		return execFileSync("git", ["hash-object", "--", absolutePath], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
}

/**
 * How many commits in THIS repository touched each path — one `git log` pass
 * rather than 705 of them.
 *
 * A migrated file has at least one: the commit that brought it over. Two or more
 * means something after the migration changed it, and that commit is the record
 * the drift check asks for.
 */
function isShallowClone() {
	try {
		return (
			execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
				encoding: "utf8",
				cwd: destinationRoot,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim() === "true"
		);
	} catch {
		return false;
	}
}

function commitCountsByPath() {
	const map = new Map();
	try {
		const log = execFileSync("git", ["log", "--format=%H", "--name-only", "--no-renames"], {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			cwd: destinationRoot,
			stdio: ["ignore", "pipe", "ignore"],
		});
		for (const line of log.split("\n")) {
			const entry = line.trim();
			if (!entry || /^[0-9a-f]{40}$/.test(entry)) continue;
			map.set(entry, (map.get(entry) ?? 0) + 1);
		}
	} catch {
		return null; // No git in the loop: every difference stays fatal.
	}
	return map;
}

if (isShallowClone()) {
	console.error(
		"FAIL: this is a shallow clone, so every path appears to have exactly one\n" +
			"commit and every file changed since the migration would be reported as a\n" +
			"defect. Check out with full history — in Actions, actions/checkout with\n" +
			"fetch-depth: 0 — and run again.",
	);
	process.exit(2);
}

const commitCounts = commitCountsByPath();
const drift = [];

function contentDiffers(row, detail) {
	const relPath = row.new_path || row.path;
	const commits = commitCounts ? (commitCounts.get(relPath) ?? 0) : null;
	if (commits !== null && commits >= 2) {
		drift.push(`${relPath}: ${detail} — ${commits} commits touch this path`);
		return;
	}
	fail(row, `${detail}, and no commit after the migration explains it`);
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
			// Blob id first — it is what the manifest recorded and it does not
			// move with the checkout's line endings. sha256-on-disk only when
			// git is unavailable or the manifest predates blob ids.
			const actualBlob = row.blob ? blobIdOf(target) : null;
			if (actualBlob) {
				if (actualBlob !== row.blob) {
					contentDiffers(row, `content changed (expected blob ${row.blob.slice(0, 12)}, found ${actualBlob.slice(0, 12)})`);
				}
			} else {
				const actual = sha256Of(target);
				if (actual !== row.sha256) {
					contentDiffers(row, `content changed (expected ${row.sha256.slice(0, 12)}, found ${actual.slice(0, 12)})`);
				}
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

if (drift.length > 0) {
	console.log(`\n${drift.length} file(s) changed since the migration, each with a commit recording it:`);
	for (const line of drift.slice(0, 40)) console.log(`  ${line}`);
	if (drift.length > 40) console.log(`  ... and ${drift.length - 40} more`);
	console.log("Development, not migration drift. Nothing above is a defect.");
}

if (failures.length > 0) {
	console.error(`\n${failures.length} problem(s):`);
	for (const line of failures.slice(0, 60)) console.error(`  ${line}`);
	if (failures.length > 60) console.error(`  ... and ${failures.length - 60} more`);
	process.exit(1);
}

console.log("All files verified against the manifest.");
