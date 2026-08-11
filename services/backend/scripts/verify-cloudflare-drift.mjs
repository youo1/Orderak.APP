#!/usr/bin/env node
// ============================================================
// Compare the Cloudflare resources the wrangler configs declare against the
// ones the account actually has.
//
// WHY
//   On 2026-08-01 the email queues were created and orderak-worker /
//   orderak-worker-staging were registered as their consumers, server-side.
//   Neither Worker's code exports a queue() handler on the default branch, and
//   no config declared the consumer. Nothing noticed for a week — until the
//   next push to main touching services/backend, which failed with:
//
//     Queue handler is missing [code: 11001]
//
//   and took production deploys down with it. The drift existed the whole time
//   and was only ever going to surface as a deploy failure at an unrelated
//   moment.
//
//   Terraform with a nightly plan is the fuller answer and remains the goal.
//   This is the part of it that can exist today: it needs nothing but the
//   wrangler CLI that CI already installs and authenticates, and it checks the
//   specific class of divergence that has actually caused an outage here.
//
// Usage:
//   node scripts/verify-cloudflare-drift.mjs [--strict]
//
//   Consumer drift always fails. Resources that exist in the account but are
//   not declared anywhere are reported, and only fail under --strict, because
//   an account legitimately accumulates things a single service does not own.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(here, "..");
const strict = process.argv.includes("--strict");

const problems = [];
const notes = [];

/** Strip JSONC comments so the wrangler configs can be parsed. */
function readJsonc(file) {
	const raw = fs.readFileSync(file, "utf8");
	const withoutComments = raw
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
	return JSON.parse(withoutComments);
}

/**
 * Names that may be interpolated into a command line.
 *
 * Windows needs shell:true here — Node refuses to execFile a .cmd, and npx is
 * a .cmd — and shell:true concatenates arguments rather than escaping them. So
 * anything that reaches wrangler() is checked against this first. Cloudflare
 * resource names are already limited to this alphabet; a name that is not is a
 * reason to stop, not to quote harder.
 */
const SAFE_ARGUMENT = /^[A-Za-z0-9_.-]+$/;

function wrangler(args) {
	for (const arg of args) {
		if (!SAFE_ARGUMENT.test(arg)) {
			throw new Error(`refusing to pass ${JSON.stringify(arg)} to a shell`);
		}
	}
	try {
		return execFileSync("npx", ["wrangler", ...args], {
			cwd: backendRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			shell: process.platform === "win32",
		});
	} catch {
		return "";
	}
}

/** Pull the cells out of a wrangler box-drawing table row. */
function tableRows(output) {
	return output
		.split("\n")
		.filter((line) => line.trim().startsWith("│"))
		.map((line) => line.split("│").slice(1, -1).map((cell) => cell.trim()))
		.filter((cells) => cells.length > 1 && cells[0] !== "id" && !cells[0].startsWith("─"));
}

// ---- Declared state --------------------------------------------------------

const configs = [
	{ file: "wrangler.jsonc", label: "public" },
	{ file: "wrangler.admin.jsonc", label: "admin" },
];

const declared = {
	d1: new Set(),
	r2: new Set(),
	queues: new Set(),
	/** queue name -> Worker names declared as its consumer */
	consumers: new Map(),
};

for (const { file } of configs) {
	const config = readJsonc(path.join(backendRoot, file));
	const environments = [config, ...Object.values(config.env ?? {})];

	for (const env of environments) {
		const workerName = env.name ?? config.name;
		for (const db of env.d1_databases ?? []) declared.d1.add(db.database_name);
		for (const bucket of env.r2_buckets ?? []) declared.r2.add(bucket.bucket_name);
		for (const producer of env.queues?.producers ?? []) declared.queues.add(producer.queue);
		for (const consumer of env.queues?.consumers ?? []) {
			declared.queues.add(consumer.queue);
			if (consumer.dead_letter_queue) declared.queues.add(consumer.dead_letter_queue);
			if (!declared.consumers.has(consumer.queue)) declared.consumers.set(consumer.queue, new Set());
			declared.consumers.get(consumer.queue).add(workerName);
		}
	}
}

// ---- Live state ------------------------------------------------------------

const liveD1 = new Set(tableRows(wrangler(["d1", "list"])).map((cells) => cells[1]).filter(Boolean));
const liveR2 = new Set(
	wrangler(["r2", "bucket", "list"])
		.split("\n")
		.map((line) => /^name:\s+(\S+)/.exec(line.trim())?.[1])
		.filter(Boolean),
);
const liveQueues = new Set(tableRows(wrangler(["queues", "list"])).map((cells) => cells[1]).filter(Boolean));

if (liveD1.size === 0 && liveQueues.size === 0) {
	console.error("Could not read live Cloudflare state — is wrangler authenticated?");
	process.exit(2);
}

// ---- Declared but absent ---------------------------------------------------
// These fail a deploy, so they are always a problem.

for (const [kind, want, have] of [["D1 database", declared.d1, liveD1], ["R2 bucket", declared.r2, liveR2], ["Queue", declared.queues, liveQueues]]) {
	for (const name of want) {
		if (!have.has(name)) problems.push(`${kind} "${name}" is declared in wrangler config but does not exist in the account.`);
	}
}

// ---- Consumer registration drift -------------------------------------------
// The one that caused the outage: a Worker registered server-side as a queue
// consumer while no config declares it, so deploying that Worker is rejected
// for having no queue() handler.

for (const queue of liveQueues) {
	const info = wrangler(["queues", "info", queue]);
	const consumerLine = /^Consumers:\s*(.*)$/m.exec(info)?.[1] ?? "";
	const liveConsumers = consumerLine
		.split(",")
		.map((entry) => entry.trim().replace(/^worker:/, ""))
		.filter(Boolean);

	const declaredFor = declared.consumers.get(queue) ?? new Set();

	for (const worker of liveConsumers) {
		if (!declaredFor.has(worker)) {
			problems.push(
				`Queue "${queue}" has Worker "${worker}" registered as a consumer in the account, ` +
				"but no wrangler config declares that consumer.\n" +
				"    Deploying that Worker will fail with \"Queue handler is missing [code: 11001]\"\n" +
				"    unless its code exports a queue() handler. Either declare the consumer or\n" +
				`    detach it: wrangler queues consumer worker remove ${queue} ${worker}`,
			);
		}
	}
	for (const worker of declaredFor) {
		if (!liveConsumers.includes(worker)) {
			notes.push(`Queue "${queue}" declares consumer "${worker}" which is not registered live — it will be attached on next deploy.`);
		}
	}
}

// ---- Undeclared resources --------------------------------------------------

for (const [kind, have, want] of [["D1 database", liveD1, declared.d1], ["R2 bucket", liveR2, declared.r2], ["Queue", liveQueues, declared.queues]]) {
	for (const name of have) {
		if (!want.has(name) && name.startsWith("orderak")) {
			(strict ? problems : notes).push(`${kind} "${name}" exists in the account but no wrangler config declares it.`);
		}
	}
}

// ---- Report ----------------------------------------------------------------

for (const note of notes) console.log(`note: ${note}`);

if (problems.length > 0) {
	console.error("\nCloudflare drift detected:");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(
	`No drift: ${declared.d1.size} D1, ${declared.r2.size} R2, ${declared.queues.size} queues declared and present, ` +
	"and every live queue consumer is accounted for.",
);
