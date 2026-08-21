#!/usr/bin/env node
/**
 * Worker size and startup budget guard.
 *
 * WHY THIS EXISTS
 *   Two Cloudflare limits can reject a deployment, and both are discovered at
 *   `wrangler deploy` time — the worst possible moment, because the change has
 *   already been merged and the release is already in flight:
 *
 *     Worker size      3 MB compressed (free) / 10 MB (paid)
 *     Startup time     1 second, enforced as "parse and execute global scope"
 *
 *   The repository guards the Android bundle with `apk-size` and guarded
 *   nothing on the Workers. This closes that asymmetry.
 *
 * WHY A BUDGET AND NOT THE PLATFORM LIMIT
 *   Alerting at the platform limit alerts once, on the deployment that already
 *   failed. A budget set near current usage turns a cliff into a slope: the
 *   pull request that adds the weight is the one that reports it, and raising
 *   the budget is a deliberate line in a diff rather than a silent drift.
 *
 *   Budgets are therefore set with real headroom above today's measurement but
 *   far below the platform limit. Raising one is fine. Raising one without
 *   saying why in the commit message is the thing this is meant to prevent.
 *
 * WHY "ACTIVE" AND NOT THE PROFILE WINDOW
 *   `wrangler check startup` reports a profile window, sampled time, active
 *   time and idle time. Only active time is CPU spent executing the global
 *   scope, which is what the 1 second limit measures. The window includes idle
 *   and varies with machine load, so budgeting it would produce a flaky gate —
 *   and a flaky gate gets disabled, which is worse than no gate.
 *
 *   Wrangler states plainly that a local profile runs on a different CPU than
 *   Cloudflare's, so this number is a regression signal, not a prediction. That
 *   is exactly what a budget needs it to be.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

/**
 * Measured 2026-08-21 on the pre-Zod bundle:
 *   public  442.26 KiB gzip, 22.0 ms active startup
 *
 * The size budget allows roughly a doubling and the startup budget roughly an
 * order of magnitude, because ADR-010 is about to add Zod schemas to the global
 * scope and the point is to observe that cost, not to block on it. Tighten both
 * once the schema migration settles.
 */
const WORKERS = [
	{ name: "backend-public", cwd: "services/backend", config: "wrangler.jsonc", maxGzipKiB: 1024, maxStartupMs: 250 },
	{ name: "backend-admin", cwd: "services/backend", config: "wrangler.admin.jsonc", maxGzipKiB: 1024, maxStartupMs: 250 },
	// Serves static assets, so wrangler needs the Vite build present before it
	// can resolve an entry point. Reported as a problem rather than skipped when
	// the build is missing: a guard that quietly measures two of three Workers
	// reads as "passed" while the third is unmeasured.
	{
		name: "admin-web-edge",
		cwd: "apps/admin-web",
		config: "wrangler.edge.jsonc",
		maxGzipKiB: 1024,
		maxStartupMs: 250,
		requiresBuild: { dir: "dist", command: "pnpm --filter @orderak/admin-web run build" },
	},
];

/**
 * Wrangler is invoked through Node against its own bin entry rather than
 * through `npx`.
 *
 * `npx` is a .cmd shim on Windows that execFileSync cannot spawn directly, and
 * the usual workaround — `shell: true` with an args array — is deprecated
 * (DEP0190) precisely because the arguments are concatenated without escaping.
 * Resolving the bin entry sidesteps both: no shell, no escaping, and the
 * workspace's pinned Wrangler rather than whatever `npx` decides to fetch.
 */
const WRANGLER_BIN = path.join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");

function wrangler(args, cwd) {
	if (!existsSync(WRANGLER_BIN)) {
		throw new Error(`wrangler is not installed at ${WRANGLER_BIN} — run pnpm install`);
	}
	return execFileSync(process.execPath, [WRANGLER_BIN, ...args], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

/** `Total Upload: 2108.73 KiB / gzip: 442.26 KiB` */
function measureSize(worker, outDir) {
	const output = wrangler(
		["deploy", "--dry-run", "--outdir", outDir, "--config", worker.config],
		path.join(repoRoot, worker.cwd),
	);
	const match = output.match(/gzip:\s*([\d.]+)\s*KiB/i);
	if (!match) throw new Error(`${worker.name}: could not read a gzip size from wrangler output`);
	return Number(match[1]);
}

/**
 * `Active: 22.0 ms (including 0.0 ms garbage collection)`
 *
 * `check startup` shells out to `wrangler deploy` internally and does not
 * forward its own `--config` to that call, so a non-default config name needs
 * `--args` as well. `--args` must use the `=` form: passing
 * `--args "--config x"` splits on the space and wrangler rejects it with
 * "Unknown argument: config wrangler".
 */
function measureStartup(worker, outFile) {
	const output = wrangler(
		["check", "startup", "--outfile", outFile, "--config", worker.config, `--args=--config=${worker.config}`],
		path.join(repoRoot, worker.cwd),
	);
	const match = output.match(/Active:\s*([\d.]+)\s*ms/i);
	if (!match) throw new Error(`${worker.name}: could not read an active startup time from wrangler output`);
	return Number(match[1]);
}

const scratch = mkdtempSync(path.join(tmpdir(), "orderak-worker-budget-"));
const problems = [];
const rows = [];

try {
	for (const worker of WORKERS) {
		const configPath = path.join(repoRoot, worker.cwd, worker.config);
		if (!existsSync(configPath)) {
			problems.push(`${worker.name}: ${worker.cwd}/${worker.config} does not exist — the budget names a Worker that is gone`);
			continue;
		}

		if (worker.requiresBuild && !existsSync(path.join(repoRoot, worker.cwd, worker.requiresBuild.dir))) {
			problems.push(
				`${worker.name}: ${worker.cwd}/${worker.requiresBuild.dir} is missing, so wrangler cannot `
				+ `resolve an entry point and this Worker went unmeasured. Run: ${worker.requiresBuild.command}`,
			);
			continue;
		}

		const gzipKiB = measureSize(worker, path.join(scratch, worker.name));
		const startupMs = measureStartup(worker, path.join(scratch, `${worker.name}.cpuprofile`));

		rows.push({ worker, gzipKiB, startupMs });
		if (gzipKiB > worker.maxGzipKiB) {
			problems.push(`${worker.name}: ${gzipKiB} KiB gzip exceeds its ${worker.maxGzipKiB} KiB budget`);
		}
		if (startupMs > worker.maxStartupMs) {
			problems.push(`${worker.name}: ${startupMs} ms active startup exceeds its ${worker.maxStartupMs} ms budget`);
		}
	}
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

for (const { worker, gzipKiB, startupMs } of rows) {
	const size = `${gzipKiB.toFixed(2)}/${worker.maxGzipKiB} KiB gzip`;
	const startup = `${startupMs.toFixed(1)}/${worker.maxStartupMs} ms startup`;
	console.log(`  ${worker.name.padEnd(16)} ${size.padEnd(24)} ${startup}`);
}

if (problems.length > 0) {
	console.error(`\n${problems.length} budget problem(s):`);
	for (const problem of problems) console.error(`  ${problem}`);
	console.error(
		"\nRaise the budget in tooling/repository/verify-worker-budget.mjs only when the\n"
		+ "growth is intended, and say why in the commit message. The platform limits\n"
		+ "behind these budgets are 10 MB compressed and 1 second of startup CPU, and\n"
		+ "exceeding those rejects the deployment rather than failing this check.",
	);
	process.exit(1);
}

console.log(`\nWorker budgets passed: ${rows.length} Worker(s) within size and startup budget.`);
