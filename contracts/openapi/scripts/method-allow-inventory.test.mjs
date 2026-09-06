/**
 * Tests for the over-declaration guard.
 *
 *   node --test contracts/openapi/scripts/method-allow-inventory.test.mjs
 *
 * WHY THESE EXIST
 *   Route coverage reported "100%" while src/seller-v1.json promised five
 *   operations the server answers with 405, including GET and POST on
 *   /api/v1/categories/{category_code}. The reverse comparison was already
 *   there — it just could not fire, because the regex scanner had guessed
 *   methods for those paths out of a neighbouring dispatch block, and a guess
 *   that happens to match the spec satisfies it.
 *
 *   So there are two things to keep true, and both are tested here: the guard
 *   fails on an operation the dispatch refuses, and the scanner stops inventing
 *   the methods that used to hide it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	discoverAllowLists,
	allowedMethodsFor,
	assertNoOverDeclaredOperations,
	loadSpecAheadOfImplementation,
} from "./method-allow-inventory.mjs";
import { discoverRoutes, discoverBackendAllowLists, openapiRoot } from "./route-inventory.mjs";

/** Run the AST pass over a throwaway .ts file. */
function scan(source) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allow-scan-"));
	const file = path.join(dir, "handler.ts");
	fs.writeFileSync(file, source);
	try {
		return discoverAllowLists([file], dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

const operation = (over = {}) => ({ surface: "seller", method: "GET", path: "/api/v1/thing", ...over });
const allowList = (over = {}) => ({
	kind: "exact",
	value: "/api/v1/thing",
	methods: ["POST"],
	file: "services/backend/src/x.ts",
	line: 7,
	...over,
});

/* ---------------- the regression that started this ---------------- */

test("the categories dispatch declares exactly the two methods it serves", () => {
	const entry = discoverBackendAllowLists()
		.find((item) => item.kind === "prefix" && item.value === "/api/v1/categories/");
	assert.ok(entry, "expected an Allow list for the /api/v1/categories/ block");
	assert.deepEqual([...entry.methods].sort(), ["DELETE", "PUT"]);
});

test("the scanner no longer invents GET and POST on a category code", () => {
	const keys = new Set(discoverRoutes().map((route) => `${route.method} ${route.path}`));
	assert.ok(keys.has("PUT /api/v1/categories/{category_code}"));
	assert.ok(keys.has("DELETE /api/v1/categories/{category_code}"));
	assert.ok(!keys.has("GET /api/v1/categories/{category_code}"));
	assert.ok(!keys.has("POST /api/v1/categories/{category_code}"));
});

test("no shipped spec promises an operation the dispatch refuses", () => {
	const specified = [];
	for (const surface of ["seller", "admin", "integrations"]) {
		const spec = JSON.parse(fs.readFileSync(path.join(openapiRoot, "src", `${surface}-v1.json`), "utf8"));
		for (const [routePath, item] of Object.entries(spec.paths)) {
			for (const method of ["get", "post", "put", "patch", "delete"]) {
				if (item[method]) specified.push({ surface, method: method.toUpperCase(), path: routePath });
			}
		}
	}
	assert.doesNotThrow(() => assertNoOverDeclaredOperations(
		specified,
		discoverBackendAllowLists(),
		loadSpecAheadOfImplementation(openapiRoot),
	));
});

/* ---------------- reading the dispatch ---------------- */

test("an equality guard names the path its Allow list covers", () => {
	const found = scan(`
		function handle(p: string) {
			if (p === "/api/v1/store") {
				if (method === "GET") return get();
				return methodNotAllowed("GET", "PUT");
			}
		}
	`);
	assert.deepEqual(found, [{
		kind: "exact",
		value: "/api/v1/store",
		methods: ["GET", "PUT"],
		file: "handler.ts",
		line: 5,
	}]);
});

test("a startsWith guard covers every path beneath the prefix", () => {
	const found = scan(`
		function handle(p: string) {
			if (p.startsWith("/api/v1/categories/")) return methodNotAllowed("PUT", "DELETE");
		}
	`);
	assert.equal(found[0].kind, "prefix");
	const allowed = allowedMethodsFor("/api/v1/categories/{category_code}", found);
	assert.deepEqual([...allowed.methods].sort(), ["DELETE", "PUT"]);
});

test("an exact selection outranks a prefix that also matches", () => {
	// The dispatch tests `p === "/api/v1/x/y"` before `p.startsWith("/api/v1/x/")`,
	// so the more specific block is the one that answers.
	const lists = [
		allowList({ kind: "prefix", value: "/api/v1/x/", methods: ["DELETE"] }),
		allowList({ kind: "exact", value: "/api/v1/x/y", methods: ["GET"] }),
	];
	assert.deepEqual([...allowedMethodsFor("/api/v1/x/y", lists).methods], ["GET"]);
});

test("two handlers serving one path contribute both methods", () => {
	// GET /api/v1/account/deletion-request lives in public-worker.ts and POST in
	// api-store.ts; taking either alone would report the other as a 405.
	const lists = [
		allowList({ value: "/api/v1/a", methods: ["GET"] }),
		allowList({ value: "/api/v1/a", methods: ["POST"] }),
	];
	assert.deepEqual([...allowedMethodsFor("/api/v1/a", lists).methods].sort(), ["GET", "POST"]);
});

test("a !== guard is a rejection, not a selection", () => {
	// phone-change.ts gates two paths with `!==` and then 405s everything but
	// POST. Reading that as a selection would claim POST is the only method
	// either path serves — true there, but the same shape elsewhere would
	// attach one path's Allow list to every other path in the guard.
	const found = scan(`
		function handle(url: URL) {
			if (url.pathname !== "/api/v1/auth/phone-change/challenges"
				&& url.pathname !== "/api/v1/auth/phone-change/complete") return null;
			if (request.method !== "POST") return methodNotAllowed("POST");
		}
	`);
	assert.deepEqual(found, []);
});

test("phone-change keeps its POST routes, which have no Allow list to prune them", () => {
	const keys = new Set(discoverRoutes().map((route) => `${route.method} ${route.path}`));
	assert.ok(keys.has("POST /api/v1/auth/phone-change/challenges"));
	assert.ok(keys.has("POST /api/v1/auth/phone-change/complete"));
});

test("an Allow list assembled at runtime is not read", () => {
	// seller-operations.ts ends with `methodNotAllowed(...allowedMethods)`.
	// Reading part of a spread would be worse than reading none of it.
	const found = scan(`
		function handle(p: string) {
			if (p === "/api/v1/devices") return methodNotAllowed(...allowedMethods);
		}
	`);
	assert.deepEqual(found, []);
});

test("a call no enclosing guard names yields nothing", () => {
	// A function's fall-through return says which methods are allowed but not
	// for which path. Guessing one is how this whole class of bug started.
	const found = scan(`
		function handle(p: string) {
			return methodNotAllowed("POST"); // /api/v1/media/upload
		}
	`);
	assert.deepEqual(found, []);
});

/* ---------------- the guard ---------------- */

test("a specified operation the dispatch refuses throws", () => {
	assert.throws(
		() => assertNoOverDeclaredOperations([operation()], [allowList()], []),
		/answers with 405/,
	);
});

test("the error names the surface, operation, Allow header and refusing line", () => {
	try {
		assertNoOverDeclaredOperations([operation()], [allowList()], []);
		assert.fail("expected a throw");
	} catch (error) {
		assert.match(error.message, /seller-v1\.json {2}GET \/api\/v1\/thing/);
		assert.match(error.message, /Allow: POST/);
		assert.match(error.message, /services\/backend\/src\/x\.ts:7/);
	}
});

test("an operation the Allow list includes is fine", () => {
	assert.doesNotThrow(() => assertNoOverDeclaredOperations(
		[operation({ method: "POST" })], [allowList()], [],
	));
});

test("a path no dispatch declared an Allow list for is not checked", () => {
	assert.doesNotThrow(() => assertNoOverDeclaredOperations(
		[operation({ path: "/api/v1/elsewhere" })], [allowList()], [],
	));
});

test("every offender is reported, not just the first", () => {
	const specified = [operation(), operation({ method: "PUT" }), operation({ method: "DELETE" })];
	try {
		assertNoOverDeclaredOperations(specified, [allowList()], []);
		assert.fail("expected a throw");
	} catch (error) {
		assert.match(error.message, /^3 specified operation\(s\)/);
	}
});

test("the error explains the three ways to resolve it", () => {
	try {
		assertNoOverDeclaredOperations([operation()], [allowList()], []);
		assert.fail("expected a throw");
	} catch (error) {
		assert.match(error.message, /Remove the operation from the spec/);
		assert.match(error.message, /widen the methodNotAllowed/);
		assert.match(error.message, /spec-ahead-of-implementation\.json/);
	}
});

/* ---------------- the opt-out ---------------- */

test("an operation specified ahead of implementation is excused", () => {
	const exceptions = [{ method: "GET", path: "/api/v1/thing", reason: "ships in the next release" }];
	assert.doesNotThrow(() => assertNoOverDeclaredOperations([operation()], [allowList()], exceptions));
});

test("an opt-out scoped to another surface does not excuse this one", () => {
	const exceptions = [{ method: "GET", path: "/api/v1/thing", surface: "admin", reason: "x" }];
	assert.throws(
		() => assertNoOverDeclaredOperations([operation()], [allowList()], exceptions),
		/answers with 405/,
	);
});

test("an opt-out excuses only the method it names", () => {
	const exceptions = [{ method: "GET", path: "/api/v1/thing", reason: "x" }];
	assert.throws(
		() => assertNoOverDeclaredOperations([operation({ method: "PUT" })], [allowList()], exceptions),
		/answers with 405/,
	);
});

test("an opt-out without a reason is rejected", () => {
	// An exemption nobody had to justify is how a guard stops meaning anything.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allow-opt-"));
	fs.writeFileSync(
		path.join(dir, "spec-ahead-of-implementation.json"),
		JSON.stringify([{ method: "GET", path: "/api/v1/thing" }]),
	);
	try {
		assert.throws(() => loadSpecAheadOfImplementation(dir), /need a method, a path and a reason/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("a well-formed opt-out file loads", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allow-opt-"));
	const entries = [{ method: "GET", path: "/api/v1/thing", reason: "server catches up in v1.1" }];
	fs.writeFileSync(path.join(dir, "spec-ahead-of-implementation.json"), JSON.stringify(entries));
	try {
		assert.deepEqual(loadSpecAheadOfImplementation(dir), entries);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("no opt-out file at all means no opt-outs, not an error", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allow-opt-"));
	try {
		assert.deepEqual(loadSpecAheadOfImplementation(dir), []);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
