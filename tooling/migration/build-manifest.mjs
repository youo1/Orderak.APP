#!/usr/bin/env node
/**
 * Builds the migration source manifest for the move to the Orderak.APP repository.
 *
 * Reads git objects, never the working tree
 * ----------------------------------------
 * .gitattributes declares `* text=auto eol=lf`, and 33 files currently sit as CRLF in
 * the checkout. Hashing files from disk would therefore produce digests that do not
 * match what git stores, and the destination — checked out on Linux CI with LF — would
 * fail verification against a manifest that was never right. So every byte here comes
 * from `git ls-tree` and `git cat-file`, which describe the commit rather than one
 * machine's copy of it.
 *
 * The same reasoning covers the file mode. Windows reports core.filemode=false, so the
 * executable bit is invisible on disk; it exists only in the index. apps/seller-android/
 * gradlew is the single 100755 entry in this repository, and losing it breaks every
 * Android CI job on Linux. It is recorded here because it cannot be recovered from a
 * checkout.
 *
 * What each row carries
 * ---------------------
 * path, mode, blob (git's own SHA-1 object id), sha256 (content digest anyone can
 * reproduce with any tool), size, type, decision, reason, evidence, reviewer,
 * reviewed_at, and new_path.
 *
 * Two hashes, deliberately: the blob id is what git guarantees and makes a mismatch
 * trivially explainable, while sha256 can be checked against a file on disk in the new
 * repository without git in the loop.
 *
 * Decisions are seeded to `pending`, with the ones already settled in the plan applied.
 * A row left `pending` fails verification later, so nothing can be migrated by accident
 * without somebody having decided about it.
 *
 * Usage: node tooling/migration/build-manifest.mjs [ref] [--out <path>]
 *        ref defaults to HEAD; for the real run it must be the freeze tag.
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = outIndex === -1 ? "migration-manifest.json" : args[outIndex + 1];
const ref = args.find((a, i) => !a.startsWith("--") && (outIndex === -1 || i !== outIndex + 1)) ?? "HEAD";

const commit = execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim();

/** Every blob in the tree at `ref`: mode, oid, size, path. */
function listTree() {
	// -z so paths containing spaces (this repo has several) survive intact.
	const raw = execFileSync("git", ["ls-tree", "-r", "-l", "-z", commit], {
		encoding: "buffer",
		maxBuffer: 64 * 1024 * 1024,
	});
	const entries = [];
	for (const record of raw.toString("utf8").split("\0")) {
		if (!record) continue;
		// "<mode> <type> <oid> <size>\t<path>"
		const tab = record.indexOf("\t");
		if (tab === -1) continue;
		const [mode, type, oid, size] = record.slice(0, tab).split(/\s+/);
		if (type !== "blob") continue;
		entries.push({ mode, oid, size: Number(size), path: record.slice(tab + 1) });
	}
	return entries;
}

/**
 * SHA-256 of every blob, via a single `git cat-file --batch` process.
 *
 * One subprocess per file would be ~700 process spawns, which on Windows is slow enough
 * that people skip running it — and a verification step nobody runs is not a control.
 */
function hashBlobs(oids) {
	return new Promise((resolve, reject) => {
		const digests = new Map();
		const child = spawn("git", ["cat-file", "--batch"], { stdio: ["pipe", "pipe", "inherit"] });

		let buffer = Buffer.alloc(0);
		let expecting = null; // { oid, size }

		child.stdout.on("data", (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			for (;;) {
				if (expecting === null) {
					const newline = buffer.indexOf(0x0a);
					if (newline === -1) return;
					const header = buffer.subarray(0, newline).toString("utf8");
					buffer = buffer.subarray(newline + 1);
					const [oid, type, size] = header.split(" ");
					if (type !== "blob") return reject(new Error(`unexpected object type: ${header}`));
					expecting = { oid, size: Number(size) };
				}
				// Payload is `size` bytes followed by a trailing newline git adds.
				if (buffer.length < expecting.size + 1) return;
				const content = buffer.subarray(0, expecting.size);
				digests.set(expecting.oid, createHash("sha256").update(content).digest("hex"));
				buffer = buffer.subarray(expecting.size + 1);
				expecting = null;
			}
		});

		child.on("error", reject);
		child.on("close", (code) =>
			code === 0 ? resolve(digests) : reject(new Error(`git cat-file exited ${code}`)),
		);

		child.stdin.write(`${oids.join("\n")}\n`);
		child.stdin.end();
	});
}

function classify(filePath) {
	if (/^services\/backend\/(geo-)?migrations\//.test(filePath)) return "migration";
	if (/^services\/backend\/src\/generated\//.test(filePath)) return "generated";
	if (filePath === "docs/guides/database-migrations.md") return "generated";
	if (filePath === "pnpm-lock.yaml") return "generated";
	if (/^docs\//.test(filePath)) return "docs";
	if (/\.md$/.test(filePath)) return "docs";
	if (/^\.github\//.test(filePath)) return "ci";
	if (/\.(png|jpe?g|ico|svg|woff2?|jar|docx)$/i.test(filePath)) return "asset";
	if (/\.(json|jsonc|ya?ml|toml|properties|gradle|kts|xml)$/i.test(filePath)) return "config";
	return "code";
}

/**
 * Decisions already settled in the migration plan. Everything else stays `pending`,
 * which verification treats as a failure — a file nobody decided about must not move.
 */
function seedDecision(filePath) {
	const drop = [
		".wrangler/cache/wrangler-account.json",
		".wrangler/cache/cf.json",
		".vscode/mcp.json",
		"docs/archive/source-plans/ChatGPT Prompt .txt",
	];
	if (drop.includes(filePath)) {
		return filePath.startsWith(".wrangler/")
			? ["drop", "Tracked Cloudflare session cache: account id, personal email, geolocation, ISP and TLS material. Gitignored, but committed before the rule existed."]
			: filePath === ".vscode/mcp.json"
				? ["drop", "Declared local editor config, gitignored yet tracked."]
				: ["drop", "33-byte scratch prompt with no value: \"Can you plan for this? In English\"."];
	}
	if (filePath.startsWith("multi-agent/")) return ["archive", "Orphan subtree: absent from pnpm-workspace, turbo, mkdocs and every workflow. Archived by decision."];
	if (filePath.startsWith("docs/archive/")) return ["archive", "Historical record. Carried over but excluded from the published site."];
	if (/^\.github\/(agents|instructions|skills)\/.*admin-frontend/.test(filePath)) return ["rewrite", "Targets admin-frontend/, a directory that does not exist; superseded by the admin-web variant."];
	if (classify(filePath) === "generated") return ["regenerate", "Produced by its generator in the new repository; never copied."];
	if (classify(filePath) === "migration") return ["verbatim", "Wrangler tracks applied migrations by filename; any change re-runs applied SQL."];
	return ["pending", ""];
}

const entries = listTree();
if (entries.length === 0) {
	console.error("git ls-tree returned no blobs - refusing to write an empty manifest.");
	process.exit(1);
}

const digests = await hashBlobs(entries.map((e) => e.oid));

const rows = entries.map((entry) => {
	const [decision, reason] = seedDecision(entry.path);
	return {
		path: entry.path,
		new_path: entry.path, // structure is unchanged during the move; Phase 10 reshapes it
		mode: entry.mode,
		blob: entry.oid,
		sha256: digests.get(entry.oid) ?? null,
		size: entry.size,
		type: classify(entry.path),
		decision,
		reason,
		evidence: "",
		reviewer: "",
		reviewed_at: "",
	};
});

const unhashed = rows.filter((r) => !r.sha256);
if (unhashed.length > 0) {
	console.error(`${unhashed.length} blob(s) produced no digest - refusing to write a partial manifest.`);
	process.exit(1);
}

const manifest = {
	source_repository: "youo1/Orderak",
	source_ref: ref,
	source_commit: commit,
	generated_at: new Date().toISOString(),
	file_count: rows.length,
	files: rows,
};

mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const byDecision = rows.reduce((acc, r) => ((acc[r.decision] = (acc[r.decision] ?? 0) + 1), acc), {});
const executables = rows.filter((r) => r.mode === "100755");

console.log(`Manifest for ${ref} (${commit.slice(0, 8)}): ${rows.length} files -> ${outPath}`);
console.log(`  decisions: ${Object.entries(byDecision).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`  executable (mode 100755): ${executables.length}${executables.length ? ` -> ${executables.map((r) => r.path).join(", ")}` : ""}`);
