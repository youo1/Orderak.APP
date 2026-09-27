#!/usr/bin/env node
// ============================================================
// G4 — the admin panel is navigable, and it is one panel.
//
// THE CRITERION, from `docs/redesign/master-redesign-prompt.md`:
//   "every one of the panel's sections is reachable in at most two navigations
//   from the landing view, the panel's information architecture is documented as
//   a tree with a stated purpose per branch, and no branch exists solely because a
//   table does."
//
// WHY THIS EXISTS
//   The panel kept two registries of its own sections and nothing compared them.
//   `apps/admin-web/src/app/config/sections.ts` is what the shell renders;
//   `contracts/typescript/admin.ts` is the platform-neutral list every other
//   consumer reads. They disagreed by two entries and had drifted in labels and
//   permission strings, and the audit that found this had to count them by hand.
//
//   Two lists of the same thing with no guard is a defect that produces more
//   defects: the shell renders a section the contract does not know about, or a
//   role's permission is spelled one way in one place and another way in the
//   other, and the only symptom is an operator who cannot see a page they should.
//
// WHAT IT CHECKS
//   1. The two registries name the same sections, by path.
//   2. They agree on the label, the permission and the group/domain name.
//   3. Every section states a purpose (`description`) — the "stated purpose per
//      branch" clause, made checkable.
//   4. Every section is reachable in one navigation from the landing view. The
//      sidebar renders groups as plain headings over flat `NavLink`s, so depth is
//      1 for every visible section; this asserts that shape rather than assuming
//      it, because a collapsible group would make it 2 and a nested one would
//      break the criterion.
//
// Usage: node tooling/ux/verify-admin-ia.mjs
//         --tree   print the information architecture as a tree
// ============================================================

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const appSectionsPath = path.join(repositoryRoot, "apps", "admin-web", "src", "app", "config", "sections.ts");
const contractPath = path.join(repositoryRoot, "contracts", "typescript", "admin.ts");
const shellPath = path.join(repositoryRoot, "apps", "admin-web", "src", "app", "layout", "AppShell.tsx");

const appSource = readFileSync(appSectionsPath, "utf8");
const contractSource = readFileSync(contractPath, "utf8");
const shellSource = readFileSync(shellPath, "utf8");

const appSections = [
	...appSource.matchAll(
		/\{ id: '([^']+)', path: '([^']+)', label: '([^']+)', description: '([^']*)', group: '([^']+)', permission: '([^']+)'/g,
	),
].map((m) => ({ id: m[1], path: m[2], label: m[3], description: m[4], group: m[5], permission: m[6] }));

const contractSections = [
	...contractSource.matchAll(
		/\{ key: "([^"]+)", label: "([^"]+)", path: "([^"]+)", permission: "([^"]+)", domain: "([^"]+)" \}/g,
	),
].map((m) => ({ id: m[1], label: m[2], path: m[3], permission: m[4], domain: m[5] }));

const problems = [];

if (appSections.length === 0) problems.push(`${path.relative(repositoryRoot, appSectionsPath)}: parsed no sections — the shape changed`);
if (contractSections.length === 0) problems.push(`${path.relative(repositoryRoot, contractPath)}: parsed no sections — the shape changed`);

// 1. Same sections, by path.
const contractByPath = new Map(contractSections.map((s) => [s.path, s]));
const appByPath = new Map(appSections.map((s) => [s.path, s]));

for (const section of appSections) {
	if (!contractByPath.has(section.path)) {
		problems.push(`the shell renders ${section.path} ("${section.label}") but the contract does not list it`);
	}
}
for (const section of contractSections) {
	if (!appByPath.has(section.path)) {
		problems.push(`the contract lists ${section.path} ("${section.label}") but the shell does not render it`);
	}
}

// 2. Same identity, same gate, same branch.
//
// LABELS ARE DELIBERATELY NOT COMPARED. The shell owns the words an operator
// reads, and a sidebar label is shortened to fit a 268px rail — the contract says
// "Operational jobs" where the shell says "Jobs", and both are right for where
// they appear. Comparing them would mean a copy change edits a contract that has
// no display, which is coupling without a consumer. What a consumer does depend on
// is which sections exist, what permission gates each, and which branch it hangs
// under, so those three are compared.
for (const [path_, section] of appByPath) {
	const other = contractByPath.get(path_);
	if (!other) continue;
	if (section.permission !== other.permission) {
		problems.push(`${path_}: the shell gates it on ${section.permission}, the contract says ${other.permission}`);
	}
	if (section.group !== other.domain) {
		problems.push(`${path_}: the shell groups it under "${section.group}", the contract under "${other.domain}"`);
	}
}

// 3. A stated purpose per branch.
for (const section of appSections) {
	if (section.description.trim().length < 10) {
		problems.push(`${section.path}: no stated purpose — the branch exists without saying what an operator does in it`);
	}
}

// 4. Reachable in one navigation.
const sidebar = shellSource.slice(shellSource.indexOf("<nav>"), shellSource.indexOf("</nav>"));
if (!sidebar.includes("nav-group") || !sidebar.includes("NavLink")) {
	problems.push(
		"the shell's <nav> no longer renders flat `nav-group` headings over `NavLink`s, so the " +
		"one-navigation depth this guard reports is no longer true",
	);
}
if (/<details|<summary|aria-expanded=\{[^}]*group|collapsible/i.test(sidebar)) {
	problems.push(
		"the sidebar gained a collapsible group: a section inside a collapsed group now costs two " +
		"navigations, which is the ceiling G4 allows and worth stating in the doc rather than assuming",
	);
}

const groups = [...new Set(appSections.map((s) => s.group))];
const tree = groups.map((group) => ({
	group,
	sections: appSections.filter((s) => s.group === group),
}));

if (process.argv.includes("--tree")) {
	console.log(`${appSections.length} sections in ${groups.length} groups, each 1 navigation from "/".\n`);
	for (const branch of tree) {
		console.log(`${branch.group}  (${branch.sections.length})`);
		for (const section of branch.sections) {
			console.log(`  ${section.path.padEnd(34)} ${section.label}`);
			console.log(`  ${" ".repeat(34)} ${section.description}`);
		}
		console.log("");
	}
}

// 5. The rendered tree is current.
//
// `document-admin-ia.mjs` writes `docs/admin/information-architecture.md` from
// this same registry. A generated document that nothing re-reads is worse than a
// handwritten one: it carries a "generated" header that reads as authority while
// describing a panel from three registry changes ago. So the guard runs the
// generator and compares.
const docPath = path.join(repositoryRoot, "docs", "admin", "information-architecture.md");
if (!existsSync(docPath)) {
	problems.push(
		"docs/admin/information-architecture.md does not exist — G4 asks for the architecture " +
			"documented as a tree, and `node tooling/ux/document-admin-ia.mjs` writes it",
	);
} else {
	const { execFileSync } = await import("node:child_process");
	const before = readFileSync(docPath, "utf8");
	execFileSync(process.execPath, [path.join(repositoryRoot, "tooling", "ux", "document-admin-ia.mjs")], {
		stdio: "ignore",
	});
	if (readFileSync(docPath, "utf8") !== before) {
		problems.push(
			"docs/admin/information-architecture.md was stale and has just been regenerated: the " +
				"registry changed without the document catching up. Commit the regenerated file.",
		);
	}
}

if (problems.length > 0) {
	console.error(`\n${problems.length} admin information-architecture problem(s):\n`);
	for (const problem of problems) console.error(`  ${problem}`);
	console.error("");
	process.exit(1);
}

console.log(
	`Admin IA verified: ${appSections.length} sections in ${groups.length} groups, the shell and ` +
		`${path.basename(contractPath)} agree on every one, each states its purpose, and each is 1 navigation from "/".`,
);
