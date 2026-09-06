// ============================================================
// AST-aware discovery of the methods an imperative dispatch block serves.
//
// WHY THIS EXISTS
//   Route coverage compares two sets: routes the scanner discovered and
//   operations the specs declare. Both directions were reported, but only one
//   of them could be trusted, because the discovered set is built by a regex
//   pass that *guesses* the method from source text near a path literal.
//
//   A wrong guess is harmless in the forward direction — an invented
//   `POST /api/v1/store` shows up as a route without a spec and gets fixed. In
//   the reverse direction it is silently corrosive: the invented operation
//   satisfies the spec's promise, so an operation the server answers with 405
//   reads as implemented and coverage prints 100%.
//
//   That is not hypothetical. src/seller-v1.json declared GET and POST on
//   /api/v1/categories/{category_code}, which the dispatch in api-store.ts
//   answers with `methodNotAllowed("PUT", "DELETE")`. The regex pass read the
//   *previous* block's `method === "GET"` / `method === "POST"` guards through
//   its look-behind window and invented exactly the two operations needed to
//   make the phantom pair look implemented. Three more phantoms —
//   POST /api/v1/store, GET /api/v1/media/upload, GET /api/v1/products/sync —
//   were covered the same way.
//
// WHAT THIS READS INSTEAD
//   `methodNotAllowed(...)` builds the 405 response, and its arguments are the
//   `Allow` header. That is not a heuristic about the code — it is the server's
//   own, complete statement of which methods a path serves. Reading it from the
//   AST gives an exact method set per path, with no window and no guessing.
//
// SCOPE, AND WHY IT IS DELIBERATELY NARROW
//   A call is only read when its arguments are all string literals AND an
//   enclosing `if` condition names the path by equality or `.startsWith`. A
//   call this cannot place — `methodNotAllowed(...allowedMethods)` in
//   seller-operations.ts, or a function's final fall-through return — yields no
//   Allow list, and a path with no Allow list is simply not checked here.
//
//   That silence is bounded in a way the scanner's was not: it costs an
//   unchecked path, not a false claim about a checked one. Anything this pass
//   does assert, it asserts from the response the server actually sends.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ALLOW_HELPER = "methodNotAllowed";
const API_PATH = /^\/api\/(?:v1|admin\/v1|integrations\/v1)\//;
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/**
 * Read the path literals a condition uses to select a dispatch block.
 *
 * Only two shapes count, and both are positive selections:
 *
 *   p === "/api/v1/store"                 → exact  /api/v1/store
 *   p.startsWith("/api/v1/categories/")   → prefix /api/v1/categories/
 *
 * A `!==` comparison is deliberately excluded. It is how a handler *rejects*
 * paths it does not serve — `if (url.pathname !== A && url.pathname !== B)
 * return null` in phone-change.ts — so reading it as a selection would attach
 * one path's Allow list to every other path named in the guard.
 */
function selectedPaths(condition) {
	const selections = [];
	const visit = (node) => {
		if (ts.isStringLiteralLike(node) && API_PATH.test(node.text)) {
			const parent = node.parent;
			if (parent && ts.isBinaryExpression(parent)
				&& (parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
					|| parent.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)) {
				selections.push({ kind: "exact", value: node.text });
			} else if (parent && ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)
				&& parent.expression.name.text === "startsWith" && parent.arguments[0] === node) {
				selections.push({ kind: "prefix", value: node.text });
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(condition);
	return selections;
}

/**
 * Walk out from a `methodNotAllowed(...)` call to the nearest enclosing `if`
 * whose condition names a path, stopping at the function boundary.
 *
 * Only the `then` branch counts. A call reached through `else` is governed by
 * the negation of that condition, which selects no path at all.
 */
function governingPaths(call) {
	let node = call;
	let parent = node.parent;
	while (parent) {
		if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)
			|| ts.isArrowFunction(parent) || ts.isMethodDeclaration(parent)
			|| ts.isSourceFile(parent)) return [];
		if (ts.isIfStatement(parent) && parent.thenStatement === node) {
			const selections = selectedPaths(parent.expression);
			if (selections.length > 0) return selections;
		}
		node = parent;
		parent = node.parent;
	}
	return [];
}

/**
 * Every `methodNotAllowed(...)` call this pass can place, as
 * `{ kind, value, methods, file, line }`.
 *
 * `kind` is "exact" or "prefix"; `value` is the path or path prefix; `methods`
 * is the Allow header the server sends for it.
 */
export function discoverAllowLists(files, workspaceRoot) {
	const found = [];
	for (const file of files) {
		const source = fs.readFileSync(file, "utf8");
		if (!source.includes(ALLOW_HELPER)) continue;
		const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
		const relative = path.relative(workspaceRoot, file).replaceAll("\\", "/");
		const visit = (node) => {
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
				&& node.expression.text === ALLOW_HELPER && node.arguments.length > 0) {
				// A spread or a variable means the Allow header is assembled at
				// runtime and this pass cannot claim to know it. Skip the call
				// rather than read part of it.
				const literal = node.arguments.every((argument) => ts.isStringLiteralLike(argument));
				const methods = literal ? node.arguments.map((argument) => argument.text.toUpperCase()) : [];
				if (literal && methods.every((method) => HTTP_METHODS.has(method))) {
					const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
					for (const selection of governingPaths(node)) {
						found.push({ ...selection, methods, file: relative, line });
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}
	return found;
}

/**
 * The complete method set for `routePath`, or null when nothing declared one.
 *
 * An exact selection wins over a prefix one, because that is the order the
 * dispatch resolves them in: `p === "/api/v1/categories"` is tested before
 * `p.startsWith("/api/v1/categories/")`. Several sites may serve the same path
 * from different handlers — GET /api/v1/account/deletion-request lives in
 * public-worker.ts and POST in api-store.ts — so same-kind matches union
 * rather than overwrite.
 */
export function allowedMethodsFor(routePath, allowLists) {
	const exact = allowLists.filter((entry) => entry.kind === "exact" && entry.value === routePath);
	const matches = exact.length > 0
		? exact
		: allowLists.filter((entry) => entry.kind === "prefix" && routePath.startsWith(entry.value));
	if (matches.length === 0) return null;
	return { methods: new Set(matches.flatMap((entry) => entry.methods)), sites: matches };
}

/**
 * Load the deliberate opt-outs for operations specified ahead of implementation.
 *
 * Same shape and same spirit as route-scanner-ignore.json: an explicit,
 * reviewed list rather than a flag that silences the whole check. A `reason` is
 * mandatory — an opt-out nobody had to justify is how a guard stops meaning
 * anything, and this file is what whoever later wonders why the contract
 * promises something the server refuses will actually read.
 */
export function loadSpecAheadOfImplementation(openapiRoot) {
	const file = path.join(openapiRoot, "spec-ahead-of-implementation.json");
	if (!fs.existsSync(file)) return [];
	const entries = JSON.parse(fs.readFileSync(file, "utf8"));
	const broken = entries.filter((entry) => !entry.method || !entry.path || !String(entry.reason ?? "").trim());
	if (broken.length > 0) {
		throw new Error(
			"spec-ahead-of-implementation.json entries need a method, a path and a reason:\n" +
			broken.map((entry) => `  ${JSON.stringify(entry)}`).join("\n"),
		);
	}
	return entries;
}

/**
 * Whether an opt-out entry covers this `{ surface, method, path }` operation.
 *
 * Shared so every check that reads the file agrees on what it excuses. An
 * opt-out that silences one of two checks is not an opt-out — it only moves
 * which check refuses the build.
 */
export function excusedByOptOut(operation, exceptions) {
	return exceptions.some((rule) =>
		String(rule.method).toUpperCase() === operation.method && rule.path === operation.path
		&& (!rule.surface || rule.surface === operation.surface));
}

/**
 * Fail when a spec declares an operation the server answers with 405.
 *
 * `specified` is `[{ surface, method, path }]`. Matching the fail-closed shape
 * of assertMountsAtRoot / assertOpenApiRoutesResolvable / assertHonoPathsResolvable
 * in hono-inventory.mjs: collect offenders, throw on a non-empty list.
 */
export function assertNoOverDeclaredOperations(specified, allowLists, exceptions = []) {
	const excused = (operation) => excusedByOptOut(operation, exceptions);

	const offenders = [];
	for (const operation of specified) {
		if (excused(operation)) continue;
		const allowed = allowedMethodsFor(operation.path, allowLists);
		if (!allowed || allowed.methods.has(operation.method)) continue;
		const site = allowed.sites[0];
		offenders.push(
			`${operation.surface}-v1.json  ${operation.method} ${operation.path}\n` +
			`      server answers 405 — Allow: ${[...allowed.methods].join(", ")}\n` +
			`      refused at ${site.file}:${site.line}`,
		);
	}
	if (offenders.length === 0) return;

	throw new Error(
		`${offenders.length} specified operation(s) the server answers with 405. The contract\n` +
		"promises them, the dispatch refuses them, and route coverage counted them as\n" +
		"implemented because the regex scanner guessed a method for the path.\n\n" +
		offenders.join("\n\n") +
		"\n\nFix it in one of three ways, in order of preference:\n" +
		"  1. Remove the operation from the spec, if nothing implements or calls it.\n" +
		"  2. Implement it, and widen the methodNotAllowed(...) Allow list to match.\n" +
		"  3. Add it to spec-ahead-of-implementation.json with a reason, if the contract\n" +
		"     is deliberately published before the server catches up.\n",
	);
}
