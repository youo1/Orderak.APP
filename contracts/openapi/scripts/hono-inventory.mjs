// ============================================================
// AST-aware discovery of Hono route registrations.
//
// WHY THIS EXISTS
//   The original inventory was regex-based and predates the Hono migration. It
//   only recognised imperative routing (`url.pathname === "..."`,
//   `.startsWith(...)`), so every route registered as `app.get("/api/...")` was
//   invisible to it. That produced ~100 spec operations reported as having no
//   implementation — including GET /api/v1/theme, which is registered in
//   public-worker.ts — and it mangled template literals: its
//   `.replace(/\$\{[^}]+\}/g, "{id}")` turned `${B}/email-templates/:key` into
//   `{id}/email-templates/{key}`, which then surfaced as a phantom
//   "route without spec".
//
//   Parsing the real AST removes both failure modes. A path is read from the
//   call's argument node, and a template literal is resolved against the
//   module's own const bindings rather than being blanked out.
//
// SCOPE
//   Every Hono sub-app in this codebase is mounted with `app.route("/", sub)`,
//   verified across all 7 mount sites, so registered paths are already
//   absolute and no base-path composition is required. If a sub-app is ever
//   mounted under a prefix, this must learn to compose it — assertMountsAtRoot()
//   below fails loudly if that day comes rather than silently under-reporting.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "on"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * `.all(path)` is reported as the sentinel method ALL rather than expanded into
 * five operations.
 *
 * Expanding is wrong in both directions. Several `.all()` registrations are
 * terminating 404 handlers — `em.all(`${B}/email-templates`, () => 404)` — so
 * expansion invents four operations that do not exist. Others are genuine
 * multi-method routes: `app.all("/:pid")` serves both the store page (GET) and
 * order submission (POST). Dropping them would hide real implementations.
 *
 * ALL means "this path answers any method", so the coverage comparison treats
 * it as satisfying whichever methods the spec declares on that path, and never
 * reports it as an unspecified implementation.
 */
const ALL_METHOD = "ALL";

/**
 * Collect module-level `const NAME = "/api/..."` bindings so a template
 * literal such as `${B}/email-templates` can be resolved to a real path.
 */
function collectStringConstants(sourceFile) {
	const constants = new Map();
	const visit = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
			&& ts.isStringLiteralLike(node.initializer)) {
			constants.set(node.name.text, node.initializer.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return constants;
}

/** Resolve a path argument node to a literal string, or null when it is dynamic. */
function resolvePath(node, constants) {
	if (!node) return null;
	if (ts.isStringLiteralLike(node)) return node.text;

	// A bare identifier bound to a path constant: `th.get(TB, handler)` where
	// `const TB = "/api/admin/v1/theme"`. Missing this hid every route that
	// registers on a base path without a suffix.
	if (ts.isIdentifier(node)) {
		return constants.get(node.text) ?? null;
	}

	if (ts.isTemplateExpression(node)) {
		let out = node.head.text;
		for (const span of node.templateSpans) {
			// Only identifiers bound to string constants are resolvable. Anything
			// else means the path is genuinely dynamic, and guessing would
			// reintroduce exactly the bug this replaces.
			if (!ts.isIdentifier(span.expression)) return null;
			const value = constants.get(span.expression.text);
			if (value === undefined) return null;
			out += value + span.literal.text;
		}
		return out;
	}
	return null;
}

/**
 * Convert a Hono path to the OpenAPI shape: `:key` -> `{key}`.
 * Wildcard registrations are not concrete operations and are dropped.
 */
/**
 * A constraint that is a plain alternation of literals — `{verify|retry}`,
 * `{retention|deletions|google-play}` — enumerates the only values the route
 * accepts. A character class such as `{[0-9a-fA-F-]+}` does not.
 */
function enumerableAlternatives(constraint) {
	if (!constraint) return null;
	const body = constraint.slice(1, -1);
	if (!body.includes("|")) return null;
	const parts = body.split("|");
	return parts.length >= 2 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part)) ? parts : null;
}

/**
 * Convert a Hono path to the OpenAPI shape, returning every concrete path it
 * serves. Wildcards are not concrete operations and are dropped.
 *
 * `:id` becomes `{id}`. A constraint is normally matching detail and is
 * consumed with its parameter — but when it enumerates literal alternatives it
 * is real contract information, so the route is expanded into one path per
 * alternative. `POST /deletion-requests/:id/:action{verify|retry}` is a single
 * Hono registration and two distinct operations, and the spec is right to
 * document them separately: "verify" and "retry" do different things and
 * deserve their own summaries and responses. Collapsing them to `{action}` to
 * satisfy the gate would trade a worse contract for an easier diff.
 */
function toOpenApiPaths(honoPath) {
	if (honoPath.includes("*")) return null;
	const base = honoPath.split("?")[0];

	let canonical = "";
	let expanded = [""];
	let hasAlternatives = false;

	const token = /:([A-Za-z_][A-Za-z0-9_]*)(\{[^}]*\})?|([^:]+)/g;
	for (let match = token.exec(base); match !== null; match = token.exec(base)) {
		const [, name, constraint, literal] = match;
		if (literal !== undefined) {
			canonical += literal;
			expanded = expanded.map((prefix) => prefix + literal);
			continue;
		}
		canonical += `{${name}}`;
		const alternatives = enumerableAlternatives(constraint);
		if (alternatives) {
			hasAlternatives = true;
			expanded = expanded.flatMap((prefix) => alternatives.map((value) => prefix + value));
		} else {
			expanded = expanded.map((prefix) => `${prefix}{${name}}`);
		}
	}

	// Both shapes describe the same route, and either is a legitimate way for the
	// spec to document it. `:action{verify|retry}` is better documented as two
	// paths, because verify and retry do different things; `:key{retention|
	// deletions|google-play}` is better as one operation with an enumerated
	// parameter. That is a contract-authoring judgement, not something the
	// inventory should impose — so it reports every form the route serves and
	// lets the spec choose.
	return {
		canonical,
		variants: hasAlternatives ? [canonical, ...expanded] : [canonical],
	};
}

/** Fail loudly if a sub-app is ever mounted under a prefix (see SCOPE above). */
export function assertMountsAtRoot(files) {
	const offenders = [];
	for (const file of files) {
		const source = fs.readFileSync(file, "utf8");
		const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
		const visit = (node) => {
			if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
				&& node.expression.name.text === "route") {
				const base = node.arguments[0];
				if (!base || !ts.isStringLiteralLike(base) || base.text !== "/") {
					offenders.push(`${file}: .route(${base ? base.getText() : "?"})`);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}
	return offenders;
}

/**
 * Discover every Hono route registration in the given files.
 * Returns [{ method, path, source }].
 */
export function discoverHonoRoutes(files, workspaceRoot) {
	const routes = [];

	for (const file of files) {
		const source = fs.readFileSync(file, "utf8");
		const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
		const constants = collectStringConstants(sourceFile);
		const relative = path.relative(workspaceRoot, file).replaceAll("\\", "/");

		const visit = (node) => {
			if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
				const called = node.expression.name.text;
				if (ROUTE_METHODS.has(called)) {
					// `.on(method, path, handler)` puts the path second.
					const isOn = called === "on";
					const pathNode = isOn ? node.arguments[1] : node.arguments[0];
					const raw = resolvePath(pathNode, constants);

					// Only /api/ paths are contract surface. This also filters the
					// many `c.get("someKey")` and `headers.get("x")` calls that share
					// these method names but never take a route path.
					if (raw && raw.startsWith("/api/")) {
						const resolved = toOpenApiPaths(raw);
						if (resolved) {
							let methods;
							if (isOn) {
								const first = node.arguments[0];
								methods = first && ts.isStringLiteralLike(first)
									? [first.text.toUpperCase()]
									: [];
							} else if (called === "all") {
								methods = [ALL_METHOD];
							} else {
								methods = [called.toUpperCase()];
							}
							for (const method of methods) {
								if (HTTP_METHODS.has(method) || method === ALL_METHOD) {
									routes.push({
										method,
										path: resolved.canonical,
										variants: resolved.variants,
										source: relative,
									});
								}
							}
						}
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}

	return routes;
}
