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

/**
 * Collect module-level `const NAME = createRoute({ ... })` bindings.
 *
 * `@hono/zod-openapi` registers a route as `app.openapi(routeDef, handler)`,
 * and the idiomatic form defines `routeDef` separately rather than inline:
 *
 *   const listOrders = createRoute({ method: "get", path: "/api/v1/orders", ... });
 *   app.openapi(listOrders, handler);
 *
 * Without this map the `.openapi()` branch below can only see inline
 * definitions, which would under-report exactly the routes most likely to be
 * written — and an under-reported route surfaces as "spec operation with no
 * implementation", the same phantom the regex inventory used to produce.
 */
function collectRouteDefinitions(sourceFile) {
	const definitions = new Map();
	const visit = (node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
			&& ts.isCallExpression(node.initializer)
			&& ts.isIdentifier(node.initializer.expression)
			&& node.initializer.expression.text === "createRoute") {
			const arg = node.initializer.arguments[0];
			if (arg && ts.isObjectLiteralExpression(arg)) definitions.set(node.name.text, arg);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return definitions;
}

/** Read a string-valued property from a `createRoute({ ... })` object literal. */
function objectLiteralProperty(objectLiteral, key) {
	for (const property of objectLiteral.properties) {
		if (!ts.isPropertyAssignment(property)) continue;
		const name = property.name;
		const text = ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
		if (text === key) return property.initializer;
	}
	return null;
}

/**
 * Resolve the first argument of `.openapi(...)` to `{ methodNode, pathNode }`.
 *
 * Accepts both the inline `app.openapi(createRoute({...}), h)` form and the
 * `const r = createRoute({...}); app.openapi(r, h)` form. Anything else — a
 * route object built by a helper, or imported from another module — is
 * genuinely not resolvable from this file alone, and returning null is the
 * honest answer: assertOpenApiRoutesResolvable() below reports it rather than
 * letting it disappear silently.
 */
function resolveOpenApiRouteDefinition(node, definitions) {
	// `.openapi()` is two different methods sharing a name. Zod's names a schema
	// for the components block — `MoneySchema.openapi("Money", { ... })` — and
	// takes a string first. Hono's registers a route and takes a createRoute
	// object. Without this discriminator every named schema in the codebase is
	// reported as an unresolvable route, which is how this was first noticed.
	if (ts.isStringLiteralLike(node)) return null;

	let objectLiteral = null;
	if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
		&& node.expression.text === "createRoute") {
		const arg = node.arguments[0];
		if (arg && ts.isObjectLiteralExpression(arg)) objectLiteral = arg;
	} else if (ts.isIdentifier(node)) {
		objectLiteral = definitions.get(node.text) ?? null;
	}
	if (!objectLiteral) return null;
	return {
		methodNode: objectLiteralProperty(objectLiteral, "method"),
		pathNode: objectLiteralProperty(objectLiteral, "path"),
	};
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
 * Report every `.openapi(...)` registration whose method and path cannot be
 * read from this file.
 *
 * A route registered through a helper or imported from another module is
 * invisible to the AST pass, and an invisible route is not a harmless omission:
 * it is implemented, serving traffic, and absent from the contract — while
 * route coverage reports 100% because it never knew the route existed. That is
 * strictly worse than the phantom "route without spec" this inventory was
 * written to eliminate, because it fails silently in the safe-looking direction.
 *
 * So it fails loudly, matching assertMountsAtRoot() above.
 */
export function assertOpenApiRoutesResolvable(files, workspaceRoot) {
	const offenders = [];
	for (const file of files) {
		const source = fs.readFileSync(file, "utf8");
		const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
		const definitions = collectRouteDefinitions(sourceFile);
		const constants = collectStringConstants(sourceFile);
		const relative = path.relative(workspaceRoot, file).replaceAll("\\", "/");
		const visit = (node) => {
			if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
				&& node.expression.name.text === "openapi" && node.arguments[0]
				&& !ts.isStringLiteralLike(node.arguments[0])) {
				const definition = resolveOpenApiRouteDefinition(node.arguments[0], definitions);
				const methodOk = definition?.methodNode && ts.isStringLiteralLike(definition.methodNode);
				const pathOk = definition?.pathNode && resolvePath(definition.pathNode, constants);
				if (!methodOk || !pathOk) {
					offenders.push(`${relative}: .openapi(${node.arguments[0].getText().slice(0, 60)}…) — `
						+ `${!definition ? "route object is not a local createRoute(...)"
							: !methodOk ? "method is not a string literal" : "path is not statically resolvable"}`);
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
/**
 * Report every plain-verb registration — app.get/post/put/patch/delete/on —
 * whose path cannot be read statically.
 *
 * assertOpenApiRoutesResolvable() above does this for .openapi() registrations
 * and explains why it matters. The same hole existed one line further down for
 * ordinary verb calls: discoverHonoRoutes() silently returns nothing for a
 * registration whose path does not resolve, so the route serves traffic while
 * being absent from both the inventory and the contract, with coverage still
 * printing 100%. Silence in the safe-looking direction is the failure mode this
 * whole file exists to prevent.
 *
 * Only calls that look like route registration are considered: an app-ish
 * receiver and at least a path plus a handler. That excludes c.get("someKey")
 * and headers.get("x"), which share the method names and take no route.
 */
export function assertHonoPathsResolvable(files, workspaceRoot) {
	const offenders = [];
	for (const file of files) {
		const source = fs.readFileSync(file, "utf8");
		const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
		const constants = collectStringConstants(sourceFile);
		const relative = path.relative(workspaceRoot, file).replaceAll("\\", "/");
		const visit = (node) => {
			if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
				const called = node.expression.name.text;
				if (ROUTE_METHODS.has(called) && node.arguments.length >= 2) {
					const receiver = node.expression.expression.getText();
					if (/^(app|router|[A-Za-z]*[Aa]pp|[A-Za-z]*[Rr]outer)$/.test(receiver)) {
						const pathNode = called === "on" ? node.arguments[1] : node.arguments[0];
						if (pathNode && !resolvePath(pathNode, constants)) {
							const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
							offenders.push(`${relative}:${line}: ${receiver}.${called}(${pathNode.getText().slice(0, 60)}…) — path is not statically resolvable`);
						}
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}
	return offenders;
}

export function discoverHonoRoutes(files, workspaceRoot) {
	const routes = [];

	for (const file of files) {
		const source = fs.readFileSync(file, "utf8");
		const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
		const constants = collectStringConstants(sourceFile);
		const routeDefinitions = collectRouteDefinitions(sourceFile);
		const relative = path.relative(workspaceRoot, file).replaceAll("\\", "/");

		const visit = (node) => {
			if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
				const called = node.expression.name.text;

				// `@hono/zod-openapi`: app.openapi(createRoute({ method, path }), handler).
				// The method and path live inside an object literal rather than in the
				// call's own arguments, so this cannot share the branch below. Handled
				// first because "openapi" is not a Hono verb and must never fall through
				// to the ROUTE_METHODS path-is-first-argument assumption.
				if (called === "openapi" && node.arguments[0]) {
					const definition = resolveOpenApiRouteDefinition(node.arguments[0], routeDefinitions);
					if (definition && definition.methodNode && definition.pathNode) {
						const raw = resolvePath(definition.pathNode, constants);
						const method = ts.isStringLiteralLike(definition.methodNode)
							? definition.methodNode.text.toUpperCase()
							: null;
						if (raw && raw.startsWith("/api/") && method && HTTP_METHODS.has(method)) {
							const resolved = toOpenApiPaths(raw);
							if (resolved) {
								routes.push({
									method,
									path: resolved.canonical,
									variants: resolved.variants,
									source: relative,
								});
							}
						}
					}
					ts.forEachChild(node, visit);
					return;
				}

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
