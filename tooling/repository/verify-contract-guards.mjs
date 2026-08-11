#!/usr/bin/env node

import { readFileSync } from "node:fs";

const buildPath = "apps/seller-android/app/build.gradle.kts";
const workflowPath = ".github/workflows/auth-phase1-contract.yml";
const build = readFileSync(buildPath, "utf8");
const workflow = readFileSync(workflowPath, "utf8");

const forbiddenRepositoryMarkers = [
	"orderak.contracts.suspended",
	"contractsSuspended",
	"docs/contracts/SUSPENDED.md",
];

for (const marker of forbiddenRepositoryMarkers) {
	if (build.includes(marker) || workflow.includes(marker)) {
		throw new Error(`Contract enforcement regression: forbidden suspension marker ${JSON.stringify(marker)} is present.`);
	}
}

const protectedTasks = [
	["verifyLocalizationContract", "verifyAuthPhase1Contract"],
	["verifyAuthPhase1Contract", "androidComponents"],
	["verifySellerApiContract", "verifyDesignSystemContract"],
];

const forbiddenTaskPatterns = [
	[/\breturn@doLast\b/, "early task return"],
	[/\bonlyIf\b|\bsetOnlyIf\b/, "conditional task execution"],
	[/\benabled\s*=\s*false\b/, "disabled task"],
	[/\bStopExecutionException\b/, "task stop exception"],
	[/\bfindProperty\b|\bgradleProperty\b|\bhasProperty\b/, "Gradle-property control path"],
	[/\benvironmentVariable\b|\bSystem\.getenv\b/, "environment-variable control path"],
	[/\bcontract(?:s)?\W*(?:suspend|bypass)|(?:suspend|bypass)\W*contract/i, "contract suspension or bypass marker"],
];

for (const [taskName, nextDeclaration] of protectedTasks) {
	const start = build.indexOf(`val ${taskName} by tasks.registering`);
	const end = build.indexOf(nextDeclaration, start + 1);
	if (start === -1 || end === -1) {
		throw new Error(`Contract enforcement regression: could not locate the complete ${taskName} task.`);
	}

	const taskBody = build.slice(start, end);
	if (!taskBody.includes("doLast")) {
		throw new Error(`Contract enforcement regression: ${taskName} no longer executes its verification body.`);
	}
	for (const [pattern, description] of forbiddenTaskPatterns) {
		if (pattern.test(taskBody)) {
			throw new Error(`Contract enforcement regression: ${taskName} contains ${description}.`);
		}
	}
	if (!workflow.includes(taskName)) {
		throw new Error(`Contract enforcement regression: ${workflowPath} does not run ${taskName}.`);
	}
}

if (!workflow.includes("node tooling/repository/verify-contract-guards.mjs")) {
	throw new Error(`Contract enforcement regression: ${workflowPath} does not run this suspension guard.`);
}

console.log("Contract enforcement guard passed: protected tasks have no suspension or bypass control path.");
