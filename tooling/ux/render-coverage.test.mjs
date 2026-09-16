/**
 * Tests for the render coverage guard.
 *
 *   node --test tooling/ux/
 *
 * WHY THESE EXIST
 *   This guard was written because `design-coverage.mjs` cannot fail: it checks
 *   that an artboard name appears in its own object literal, so it reported the
 *   اليوم contract fully designed while two of that contract's four states did
 *   not exist. Replacing an unfalsifiable check with an untested one would
 *   repeat the mistake in a new file. Every test below makes one failure happen
 *   on purpose.
 *
 *   The last test is the one that matters most: it fixes the meaning of
 *   `component`, which is the only thing standing between this tool and the
 *   tool it replaces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRenders, discoverPreviews } from "./render-coverage.mjs";

const CONTRACTS = [
  { id: "today", surface: "today", states: ["loading", "content", "empty", "error"], offline: true },
  { id: "paywall", surface: "account", states: ["content"] },
];

/** Everything resolves unless a test says otherwise. */
function run({ renders, discovered, missing = [], floor = 0 }) {
  return checkRenders({
    renders,
    discovered: new Map(Object.entries(discovered)),
    hasReference: (_dir, fn) => !missing.includes(fn),
    contracts: CONTRACTS,
    floor,
  });
}

const screenRender = (state) => ({ kind: "screen", contract: "today", state, theme: "light" });

/* ---------------- no claim without pixels ---------------- */

test("a claimed render with no reference PNG fails", () => {
  const { problems } = run({
    renders: { todayEmptyLight: screenRender("empty") },
    discovered: { todayEmptyLight: "a/b/TodayKt" },
    missing: ["todayEmptyLight"],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no reference PNG/);
});

test("a claim naming a @PreviewTest that does not exist fails", () => {
  const { problems } = run({
    renders: { ghostRender: screenRender("empty") },
    discovered: {},
  });
  assert.match(problems[0], /no @PreviewTest by that name exists/);
});

test("a render with pixels behind it is counted", () => {
  const { problems, provenStates } = run({
    renders: { todayEmptyLight: screenRender("empty") },
    discovered: { todayEmptyLight: "a/b/TodayKt" },
  });
  assert.deepEqual(problems, []);
  assert.deepEqual([...provenStates], ["today.empty"]);
});

/* ---------------- no render without a claim ---------------- */

test("an unclassified @PreviewTest fails", () => {
  const { problems } = run({
    renders: {},
    discovered: { somethingNew: "a/b/TodayKt" },
  });
  assert.match(problems[0], /not classified in RENDERS/);
});

/* ---------------- a screen claim must be true ---------------- */

test("a screen claim against an unknown contract fails", () => {
  const { problems } = run({
    renders: { r: { kind: "screen", contract: "nope", state: "content" } },
    discovered: { r: "a/b/Kt" },
  });
  assert.match(problems[0], /unknown contract/);
});

test("a screen claim naming an undeclared state fails", () => {
  const { problems } = run({
    renders: { r: { kind: "screen", contract: "paywall", state: "empty" } },
    discovered: { r: "a/b/Kt" },
  });
  assert.match(problems[0], /does not declare state "empty"/);
});

test("an offline claim against a non-offline contract fails", () => {
  const { problems } = run({
    renders: { r: { kind: "screen", contract: "paywall", offline: true } },
    discovered: { r: "a/b/Kt" },
  });
  assert.match(problems[0], /is not offline-capable/);
});

test("offline is tracked but never counted as a state", () => {
  const { problems, provenStates, provenOffline } = run({
    renders: { r: { kind: "screen", contract: "today", offline: true } },
    discovered: { r: "a/b/Kt" },
  });
  assert.deepEqual(problems, []);
  assert.equal(provenStates.size, 0, "offline is a modifier, not a state");
  assert.deepEqual([...provenOffline], ["today"]);
});

/* ---------------- the ratchet ---------------- */

test("deleting a claim to satisfy the guard trips the floor", () => {
  // Rule 1 says every claim needs pixels. The cheap way to obey it is to drop
  // the claim, so the floor has to notice the drop.
  const { problems } = run({ renders: {}, discovered: {}, floor: 4 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /fell to 0, below the floor of 4/);
});

test("the floor passes when the states are genuinely proven", () => {
  const renders = {}, discovered = {};
  for (const s of ["loading", "content", "empty", "error"]) {
    renders[s] = screenRender(s);
    discovered[s] = "a/b/TodayKt";
  }
  const { problems, provenStates } = run({ renders, discovered, floor: 4 });
  assert.deepEqual(problems, []);
  assert.equal(provenStates.size, 4);
});

test("light and dark of one state count once, not twice", () => {
  // 83 states x 2 themes is the render budget; the coverage number is states.
  // Conflating them would let one state report as two and inflate the floor.
  const { provenStates } = run({
    renders: {
      a: { kind: "screen", contract: "today", state: "empty", theme: "light" },
      b: { kind: "screen", contract: "today", state: "empty", theme: "dark" },
    },
    discovered: { a: "a/b/Kt", b: "a/b/Kt" },
  });
  assert.equal(provenStates.size, 1);
});

/* ---------------- the distinction the tool exists for ---------------- */

test("a component render never counts toward contract coverage", () => {
  // This is the whole thesis. `ordersEmptyState` renders FullScreenEmpty with
  // the orders copy in it — which stays green even if OrdersScreen stops
  // calling FullScreenEmpty altogether. It proves a component, not a state.
  const { problems, provenStates } = run({
    renders: { ordersEmptyState: { kind: "component", note: "FullScreenEmpty with the orders copy" } },
    discovered: { ordersEmptyState: "a/b/Kt" },
  });
  assert.deepEqual(problems, []);
  assert.equal(provenStates.size, 0);
});

test("a component render still has to have pixels", () => {
  const { problems } = run({
    renders: { c: { kind: "component", note: "x" } },
    discovered: { c: "a/b/Kt" },
    missing: ["c"],
  });
  assert.match(problems[0], /no reference PNG/);
});

/* ---------------- discovery ---------------- */

test("the reference directory is derived from package and file name", () => {
  const { discovered, problems } = discoverPreviews("root", {
    readdir: () => ["root/x/TodayScreenshotTest.kt"],
    readFile: () => `package app.orderak.seller.feature.today\n@PreviewTest\n@Preview\n@Composable\nfun todayEmptyLight() {}\n`,
    relative: f => f,
  });
  assert.deepEqual(problems, []);
  assert.equal(discovered.get("todayEmptyLight"), "app/orderak/seller/feature/today/TodayScreenshotTestKt");
});

test("several @PreviewTest functions in one file are all found", () => {
  const { discovered } = discoverPreviews("root", {
    readdir: () => ["root/S.kt"],
    readFile: () => `package p\n@PreviewTest\n@Composable\nfun one() {}\n@PreviewTest\n@Composable\nfun two() {}\n`,
    relative: f => f,
  });
  assert.deepEqual([...discovered.keys()], ["one", "two"]);
});

test("a file with no package declaration is reported, not skipped silently", () => {
  const { problems } = discoverPreviews("root", {
    readdir: () => ["root/S.kt"],
    readFile: () => `@PreviewTest\nfun one() {}\n`,
    relative: f => f,
  });
  assert.match(problems[0], /no package declaration/);
});
