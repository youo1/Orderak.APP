/**
 * Verifies the plan catalogue's `implementation_status` against the code.
 *
 *   node tooling/ux/verify-implementation-status.mjs
 *
 * Fails when:
 *   - a feature marked `implemented` names no evidence
 *   - declared evidence does not resolve in the repository
 *
 * Reports (without failing) features marked `planned` whose evidence resolves:
 * those are promotion candidates. Promoting is a product decision; this tool
 * only refuses to let the claim and the code drift apart unnoticed.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { EVIDENCE, KINDS } from "./implementation-evidence.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const ANDROID = join(root, "apps/seller-android/app/src/main");
const BACKEND = join(root, "services/backend/src");

const catalog = JSON.parse(readFileSync(join(root, "docs/product/orderak-plan-catalog.json"), "utf8"));

/* ---------- gather what the repository actually contains ---------- */
function walk(dir, test, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "build") continue;
      walk(p, test, acc);
    } else if (test(entry.name)) acc.push(p);
  }
  return acc;
}

const ktFiles = walk(join(ANDROID, "java"), n => n.endsWith(".kt"));
const ktSource = ktFiles.map(f => readFileSync(f, "utf8")).join("\n");
const tsSource = walk(BACKEND, n => n.endsWith(".ts")).map(f => readFileSync(f, "utf8")).join("\n");

const screens = new Set([...ktSource.matchAll(/fun\s+([A-Za-z]+Screen)\s*\(/g)].map(m => m[1]));
const routes = new Set([...ktSource.matchAll(/data\s+(?:object|class)\s+([A-Za-z]+Route)/g)].map(m => m[1]));
const endpoints = new Set([...tsSource.matchAll(/"(\/api\/v1\/[a-z0-9/{}._-]*)"/g)].map(m => m[1]));
const localeDirs = new Set(
  existsSync(join(ANDROID, "res"))
    ? readdirSync(join(ANDROID, "res")).filter(d => d.startsWith("values"))
    : [],
);
const bindings = new Set(catalog.features.map(f => f.enforcement_binding).filter(Boolean));

const resolves = (e) => {
  switch (e.kind) {
    case "screen":   return screens.has(e.value);
    case "route":    return routes.has(e.value);
    case "endpoint": return endpoints.has(e.value);
    case "resource": return localeDirs.has(e.value);
    case "binding":  return bindings.has(e.value) && tsSource.includes(e.value);
    case "module":   return existsSync(join(root, e.value));
    default: return false;
  }
};

/* ---------- checks ---------- */
const problems = [];
const candidates = [];
const confirmed = [];

for (const [key, e] of Object.entries(EVIDENCE)) {
  if (!KINDS.includes(e.kind)) problems.push(`${key}: unknown evidence kind "${e.kind}"`);
  if (!catalog.features.some(f => f.key === key)) problems.push(`${key}: evidence for a key not in the catalogue`);
}

for (const f of catalog.features) {
  const e = EVIDENCE[f.key];
  if (f.implementation_status === "implemented") {
    if (!e) { problems.push(`${f.key}: marked implemented but names no evidence`); continue; }
    if (!resolves(e)) { problems.push(`${f.key}: evidence ${e.kind} "${e.value}" does not resolve`); continue; }
    confirmed.push(f.key);
  } else if (e) {
    if (!resolves(e)) problems.push(`${f.key}: promotion evidence ${e.kind} "${e.value}" does not resolve`);
    else candidates.push({ key: f.key, e });
  }
}

if (problems.length) {
  console.error(`FAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}

console.log(`OK — every "implemented" claim resolves against the code.`);
console.log(`  catalogue says implemented: ${confirmed.length}`);
console.log(`  index: ${screens.size} screens, ${routes.size} routes, ${endpoints.size} seller endpoints, ${localeDirs.size} locale dirs`);

if (candidates.length) {
  console.log(`\nPROMOTION CANDIDATES — marked "planned", evidence resolves (${candidates.length}):`);
  for (const c of candidates) {
    console.log(`  ${c.key}`);
    console.log(`      ${c.e.kind}: ${c.e.value}${c.e.note ? `\n      note: ${c.e.note}` : ""}`);
  }
  console.log(`\n  Real implemented count is ${confirmed.length} + up to ${candidates.length} = ${confirmed.length + candidates.length}.`);
  console.log(`  Promote by editing implementation_status in the catalogue; this tool will then require the evidence.`);
}
