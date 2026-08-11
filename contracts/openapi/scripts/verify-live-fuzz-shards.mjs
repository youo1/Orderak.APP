#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const openapiDir = dirname(dirname(fileURLToPath(import.meta.url)));
const filterScript = join(openapiDir, "scripts", "live-fuzz-filter.mjs");
const specPath = join(openapiDir, "src", "seller-v1.json");
const allowlist = JSON.parse(readFileSync(join(openapiDir, "live-fuzz-allowlist.json"), "utf8"));
const expected = [...allowlist.allow].sort();
const shardCount = 8;
const observed = [];

for (let shard = 0; shard < shardCount; shard += 1) {
	const filter = execFileSync(
		process.execPath,
		[filterScript, specPath, String(shard), String(shardCount)],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
	).trim();
	const ids = filter.slice(2, -2).split("|");
	const wanted = expected.filter((_, index) => index % shardCount === shard);
	if (JSON.stringify(ids) !== JSON.stringify(wanted)) {
		throw new Error(`Live-fuzz shard ${shard} does not match its deterministic allowlist partition.`);
	}
	observed.push(...ids);
}

if (new Set(observed).size !== observed.length) {
	throw new Error("Live-fuzz shards overlap; one operation would be exercised more than once.");
}
if (JSON.stringify([...observed].sort()) !== JSON.stringify(expected)) {
	throw new Error("Live-fuzz shards do not cover the complete allowlist.");
}

console.log(`Live-fuzz shards cover all ${expected.length} allowlisted operations exactly once.`);
