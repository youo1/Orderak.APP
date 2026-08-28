/**
 * Verifies that docs/domains/billing.md describes the billing gate the code
 * actually applies.
 *
 *   node tooling/repository/verify-billing-gate.mjs
 *
 * The document claimed the gate held "exactly six paths" and that
 * `/api/v1/subscription/status` was deliberately outside it. The code held
 * nine, including that one — so the recorded principle, that closing billing
 * must not blind a merchant to what they already have, had quietly stopped
 * being true. Nothing caught it: verify-doc-claims checks that paths, scripts
 * and resources exist, not that a prose claim about a set still matches the set.
 *
 * Fails when:
 *   - the fenced list in the document and the code's set differ in either direction
 *   - the stated count does not match the number of paths listed
 *   - a path the document names as carved out is in fact gated
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const docPath = path.join(root, "docs/domains/billing.md");
const codePath = path.join(root, "services/backend/src/domains/commerce/billing.ts");
const doc = readFileSync(docPath, "utf8");
const code = readFileSync(codePath, "utf8");

const problems = [];

/* ---------- the code's set ---------- */
const setMatch = code.match(/const BILLING_ACQUISITION_ROUTES = new Set\(\[([\s\S]*?)\]\);/);
if (!setMatch) {
  console.error("verify-billing-gate: BILLING_ACQUISITION_ROUTES not found — the gate was renamed or restructured.");
  process.exit(1);
}
const codeRoutes = new Set([...setMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));

/* ---------- the document's list ---------- */
const listMatch = doc.match(/BILLING_ACQUISITION_ROUTES` in\n`[^`]+` holds exactly (\w+) paths:\n\n```text\n([\s\S]*?)```/);
if (!listMatch) {
  console.error("verify-billing-gate: the documented route list was not found in the expected shape.");
  process.exit(1);
}
const WORD_NUMBERS = {
  four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const claimedCount = WORD_NUMBERS[listMatch[1]] ?? Number(listMatch[1]);
const docRoutes = new Set(
  listMatch[2].split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")),
);

/* ---------- compare ---------- */
for (const route of codeRoutes) {
  if (!docRoutes.has(route)) {
    problems.push(`${route} is gated in code but the document does not list it`);
  }
}
for (const route of docRoutes) {
  if (!codeRoutes.has(route)) {
    problems.push(`${route} is listed in the document but the code does not gate it`);
  }
}
if (Number.isFinite(claimedCount) && claimedCount !== docRoutes.size) {
  problems.push(`the document says "${listMatch[1]} paths" but lists ${docRoutes.size}`);
}

/* ---------- carve-outs the document names must really be open ---------- */
const carvedOut = [...doc.matchAll(/`(\/api\/[^`]+)` is deliberately \*\*not\*\* in that set/g)]
  .map((m) => m[1]);
for (const route of carvedOut) {
  if (codeRoutes.has(route)) {
    problems.push(
      `${route} is documented as deliberately carved out, but the code gates it — ` +
      `either the carve-out was lost or the document is describing a rule that no longer holds`,
    );
  }
}

if (problems.length) {
  console.error(`Billing gate verification failed with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n  document: ${path.relative(root, docPath).replace(/\\/g, "/")}`);
  console.error(`  code:     ${path.relative(root, codePath).replace(/\\/g, "/")}`);
  process.exit(1);
}

console.log(
  `Billing gate verified: ${codeRoutes.size} gated routes match the document, ` +
  `${carvedOut.length} documented carve-out(s) confirmed open.`,
);
