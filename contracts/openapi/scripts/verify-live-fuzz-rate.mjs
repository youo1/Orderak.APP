#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const openapiDir = dirname(dirname(fileURLToPath(import.meta.url)));
const config = readFileSync(join(openapiDir, "schemathesis-live.toml"), "utf8");

const workerMatch = config.match(/^\s*workers\s*=\s*(\d+)\s*(?:#.*)?$/m);
if (!workerMatch || Number(workerMatch[1]) !== 1) {
	throw new Error("Live fuzzing must use exactly one worker so its configured rate is not multiplied.");
}

const rateMatch = config.match(/^\s*rate-limit\s*=\s*"(\d+)\/([smh])"\s*(?:#.*)?$/m);
if (!rateMatch) {
	throw new Error("Live fuzzing needs an explicit integer rate limit using s, m, or h.");
}

const amount = Number(rateMatch[1]);
if (amount < 1) {
	throw new Error("Live fuzzing needs a positive request rate.");
}
const requestsPerTenMinutes = {
	s: amount * 600,
	m: amount * 10,
	h: amount / 6,
}[rateMatch[2]];
const safeCeiling = 300;

if (requestsPerTenMinutes > safeCeiling) {
	throw new Error(
		`Live fuzz rate permits ${requestsPerTenMinutes} requests per ten minutes; the safety ceiling is ${safeCeiling}.`,
	);
}

console.log(`Live-fuzz rate is capped at ${requestsPerTenMinutes} requests per ten minutes with one worker.`);
