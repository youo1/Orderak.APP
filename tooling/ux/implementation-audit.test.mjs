/**
 * Tests for the implementation audit.
 *
 *   node --test tooling/ux/
 *
 * WHY THESE EXIST
 *   The audit is the thing that decides whether the product's claims about
 *   itself are true. Before this, it had no tests, and the failure it missed was
 *   not exotic: a feature was marked implemented, its screen resolved by name,
 *   and the screen could not do the thing. Every test below makes one failure
 *   happen on purpose, because a guard is only worth its green tick if its red
 *   one has been seen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { auditImplementation } from "./implementation-audit.mjs";

const KINDS = ["screen", "route", "endpoint", "binding", "resource", "module"];
const REQUIRING = ["screen", "route", "module"];

/** An index where everything resolves, unless a test says otherwise. */
function stubIndex(overrides = {}) {
  return {
    has: () => true,
    test: () => "it(\"asserts the thing\", async () => {})",
    client: "const path = \"/api/v1/thing\"",
    gate: () => true,
    ...overrides,
  };
}

const feature = (key, status = "implemented") => ({ key, implementation_status: status });

function run({ features, evidence, baseline = {}, index = stubIndex() }) {
  return auditImplementation({
    catalog: { features },
    evidence,
    baseline,
    kinds: KINDS,
    kindsRequiringBehaviour: REQUIRING,
    index,
  });
}

/* ---------------- the failure that started this ---------------- */

test("a screen marked implemented with no behaviour evidence fails", () => {
  const { problems } = run({
    features: [feature("a.editable_profiles")],
    evidence: { "a.editable_profiles": { kind: "screen", value: "ProfileScreen" } },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /must name a behaviour test/);
});

test("the same screen passes once it names a test that exists", () => {
  const { problems, levels } = run({
    features: [feature("a.editable_profiles")],
    evidence: {
      "a.editable_profiles": {
        kind: "screen",
        value: "ProfileScreen",
        behaviour: { layer: "android", file: "ProfileTest.kt", test: "an edit persists" },
      },
    },
    index: stubIndex({ test: () => "fun `an edit persists`() {}" }),
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(levels.behaviour, ["a.editable_profiles"]);
});

/* ---------------- behaviour evidence must be real ---------------- */

test("a behaviour entry naming a test file that does not exist fails", () => {
  const { problems } = run({
    features: [feature("a.thing")],
    evidence: {
      "a.thing": { kind: "screen", value: "S", behaviour: { layer: "android", file: "Missing.kt", test: "x" } },
    },
    index: stubIndex({ test: () => undefined }),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /is not in the android test corpus/);
});

test("a behaviour entry naming a test the file does not contain fails", () => {
  const { problems } = run({
    features: [feature("a.thing")],
    evidence: {
      "a.thing": { kind: "screen", value: "S", behaviour: { layer: "backend", file: "x.spec.ts", test: "a test nobody wrote" } },
    },
    index: stubIndex({ test: () => "it(\"a different test\", () => {})" }),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not contain a test named/);
});

test("a behaviour entry with an unknown layer fails", () => {
  const { problems } = run({
    features: [feature("a.thing")],
    evidence: {
      "a.thing": { kind: "screen", value: "S", behaviour: { layer: "ios", file: "x", test: "y" } },
    },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /layer "ios" is not one of/);
});

test("kinds that are not client claims do not require behaviour", () => {
  const { problems } = run({
    features: [feature("a.endpoint"), feature("a.binding"), feature("a.resource")],
    evidence: {
      "a.endpoint": { kind: "endpoint", value: "/api/v1/x" },
      "a.binding": { kind: "binding", value: "max_x" },
      "a.resource": { kind: "resource", value: "values-ar" },
    },
  });
  assert.deepEqual(problems, []);
});

/* ---------------- the ratchet ---------------- */

test("a baselined feature is exempt from the behaviour requirement", () => {
  const { problems } = run({
    features: [feature("a.legacy")],
    evidence: { "a.legacy": { kind: "screen", value: "S" } },
    baseline: { "a.legacy": "no test yet" },
  });
  assert.deepEqual(problems, []);
});

test("a baseline entry whose debt is paid fails, so the exemption cannot linger", () => {
  const { problems } = run({
    features: [feature("a.legacy")],
    evidence: {
      "a.legacy": { kind: "screen", value: "S", behaviour: { layer: "android", file: "T.kt", test: "t" } },
    },
    baseline: { "a.legacy": "no test yet" },
    index: stubIndex({ test: () => "fun `t`() {}" }),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /remove the entry, the debt is paid/);
});

test("a baseline entry for a key not in the catalogue fails", () => {
  const { problems } = run({
    features: [feature("a.real")],
    evidence: { "a.real": { kind: "endpoint", value: "/x" } },
    baseline: { "a.ghost": "stale" },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not in the catalogue/);
});

test("a baseline entry for a feature that is no longer implemented fails", () => {
  const { problems } = run({
    features: [feature("a.demoted", "planned")],
    evidence: { "a.demoted": { kind: "screen", value: "S" } },
    baseline: { "a.demoted": "was implemented once" },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no longer implemented/);
});

/* ---------------- reachability ---------------- */

test("a closed production gate is reported, not counted as reachable", () => {
  const { levels, gateClosed, problems } = run({
    features: [feature("a.gated")],
    evidence: {
      "a.gated": { kind: "endpoint", value: "/x", reachable: "AI_ASSISTANT_ENABLED" },
    },
    index: stubIndex({ gate: (env) => (env === "production" ? false : true) }),
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(levels.reachable, []);
  assert.deepEqual(gateClosed, [{ key: "a.gated", gate: "AI_ASSISTANT_ENABLED", staging: true }]);
});

test("an open production gate counts as reachable", () => {
  const { levels, gateClosed } = run({
    features: [feature("a.gated")],
    evidence: { "a.gated": { kind: "endpoint", value: "/x", reachable: "OPEN_FLAG" } },
  });
  assert.deepEqual(levels.reachable, ["a.gated"]);
  assert.deepEqual(gateClosed, []);
});

test("naming a gate that the deployment config does not declare fails", () => {
  const { problems } = run({
    features: [feature("a.gated")],
    evidence: { "a.gated": { kind: "endpoint", value: "/x", reachable: "TYPO_ENABLED" } },
    index: stubIndex({ gate: () => null }),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /is not declared in wrangler\.jsonc/);
});

/* ---------------- integration ---------------- */

test("an endpoint with no client call site fails its integration claim", () => {
  const { problems } = run({
    features: [feature("a.uncalled")],
    evidence: { "a.uncalled": { kind: "endpoint", value: "/api/v1/orphan", integration: "/api/v1/orphan" } },
    index: stubIndex({ client: "nothing calls it" }),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not appear in the Android network layer/);
});

/* ---------------- the checks that were already there ---------------- */

test("a feature marked implemented with no evidence at all fails", () => {
  const { problems } = run({ features: [feature("a.bare")], evidence: {} });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /names no evidence/);
});

test("evidence that does not resolve fails, and the feature is not confirmed", () => {
  const { problems, confirmed } = run({
    features: [feature("a.ghost")],
    evidence: { "a.ghost": { kind: "screen", value: "NoSuchScreen" } },
    index: stubIndex({ has: () => false }),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not resolve/);
  assert.deepEqual(confirmed, []);
});

test("an unknown evidence kind fails", () => {
  const { problems } = run({
    features: [feature("a.odd")],
    evidence: { "a.odd": { kind: "vibes", value: "x" } },
  });
  assert.ok(problems.some((p) => /unknown evidence kind "vibes"/.test(p)));
});

test("a planned feature whose evidence resolves is a candidate, not a failure", () => {
  const { problems, candidates } = run({
    features: [feature("a.planned", "planned")],
    evidence: { "a.planned": { kind: "screen", value: "S" } },
  });
  assert.deepEqual(problems, []);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].key, "a.planned");
});

test("a planned feature is never required to have behaviour evidence", () => {
  const { problems } = run({
    features: [feature("a.planned", "planned")],
    evidence: { "a.planned": { kind: "screen", value: "S" } },
  });
  assert.deepEqual(problems, []);
});
