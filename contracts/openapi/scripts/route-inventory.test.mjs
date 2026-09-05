/**
 * Tests for the route scanner's fail-closed behaviour.
 *
 *   node --test contracts/openapi/scripts/route-inventory.test.mjs
 *
 * WHY THESE EXIST
 *   The scanner reported "Route/spec coverage is 100%" for months while two live
 *   POST routes were undocumented, because it could not read the expression that
 *   dispatched them and said nothing. Coverage is quoted in docs/status.md as
 *   evidence the contract is complete, so a false 100% is worse than a known
 *   gap: a gap gets closed, a number gets cited.
 *
 *   The first test below is that exact regression. The rest exercise the guard
 *   that now refuses to be silent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverRoutes, assertNoOrphanLiterals } from "./route-inventory.mjs";

const found = (paths) => new Map(paths.map((p, i) => [`GET ${p}`, { method: "GET", path: p, source: `f${i}` }]));
const literal = (over = {}) => ({
  file: "services/backend/src/x.ts",
  line: 1,
  path: "/api/v1/thing",
  text: 'if (url.pathname !== "/api/v1/thing")',
  reason: "dispatch expression not recognised",
  ...over,
});

/* ---------------- the regression that started this ---------------- */

test("both phone-change routes are discovered, not silently dropped", () => {
  const routes = discoverRoutes();
  const paths = routes.filter((r) => r.path.includes("phone-change"));
  assert.equal(paths.length, 2, "expected challenges + complete");
  assert.deepEqual(
    paths.map((r) => `${r.method} ${r.path}`).sort(),
    ["POST /api/v1/auth/phone-change/challenges", "POST /api/v1/auth/phone-change/complete"],
  );
});

test("a pathname guard written with !== is read as a route", () => {
  // phone-change.ts dispatches with `if (url.pathname !== X && ... ) return null`.
  // Before this, the gate only recognised ===, so the whole handler was invisible.
  const routes = discoverRoutes();
  const byPath = new Set(routes.map((r) => r.path));
  assert.ok(byPath.has("/api/v1/auth/phone-change/challenges"));
});

/* ---------------- the orphan guard ---------------- */

test("an unreadable literal naming an unknown route throws", () => {
  assert.throws(
    () => assertNoOrphanLiterals([literal()], found(["/api/v1/other"]), []),
    /cannot read/,
  );
});

test("the error names the file, line and path so it can be acted on", () => {
  try {
    assertNoOrphanLiterals([literal({ line: 42 })], found([]), []);
    assert.fail("expected a throw");
  } catch (error) {
    assert.match(error.message, /services\/backend\/src\/x\.ts:42/);
    assert.match(error.message, /\/api\/v1\/thing/);
    assert.match(error.message, /dispatch expression not recognised/);
  }
});

test("a literal another pass already discovered is not an orphan", () => {
  assert.doesNotThrow(() => assertNoOrphanLiterals([literal()], found(["/api/v1/thing"]), []));
});

test("a base-path constant that longer routes build on is not an orphan", () => {
  // `const A = "/api/admin/v1/auth"` is not a route, and reporting it as one
  // would train people to ignore this guard.
  const item = literal({ path: "/api/admin/v1/auth" });
  assert.doesNotThrow(() => assertNoOrphanLiterals([item], found(["/api/admin/v1/auth/login"]), []));
});

test("a prefix match is not enough — it must be a path segment boundary", () => {
  const item = literal({ path: "/api/v1/order" });
  assert.throws(() => assertNoOrphanLiterals([item], found(["/api/v1/orders"]), []), /cannot read/);
});

test("an explicit ignore entry suppresses one orphan", () => {
  const ignores = [{ path: "/api/v1/thing", reason: "a string in an error payload, not a route" }];
  assert.doesNotThrow(() => assertNoOrphanLiterals([literal()], found([]), ignores));
});

test("an ignore entry scoped to another file does not suppress this one", () => {
  const ignores = [{ path: "/api/v1/thing", file: "services/backend/src/elsewhere.ts", reason: "x" }];
  assert.throws(() => assertNoOrphanLiterals([literal()], found([]), ignores), /cannot read/);
});

test("the same literal reported twice is listed once", () => {
  try {
    assertNoOrphanLiterals([literal(), literal()], found([]), []);
    assert.fail("expected a throw");
  } catch (error) {
    // Count the file:line anchor, not the path — the path also appears inside
    // the quoted source line, so it is two occurrences for a single report.
    assert.equal(error.message.match(/src\/x\.ts:1\b/g).length, 1);
    assert.match(error.message, /found 1 path literal/);
  }
});

test("nothing unreadable means nothing thrown", () => {
  assert.doesNotThrow(() => assertNoOrphanLiterals([], found(["/api/v1/thing"]), []));
});

test("the error explains the three ways to resolve it", () => {
  try {
    assertNoOrphanLiterals([literal()], found([]), []);
    assert.fail("expected a throw");
  } catch (error) {
    assert.match(error.message, /Teach this scanner/);
    assert.match(error.message, /route-overrides\.json/);
    assert.match(error.message, /route-scanner-ignore\.json/);
  }
});
