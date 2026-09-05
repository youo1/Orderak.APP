/**
 * Verifies the plan catalogue's `implementation_status` against the code.
 *
 *   node tooling/ux/verify-implementation-status.mjs
 *
 * Fails when:
 *   - a feature marked `implemented` names no evidence
 *   - declared evidence does not resolve in the repository
 *   - a screen, route or module claim names no behaviour test and is not in the
 *     recorded baseline
 *   - a named behaviour test or integration symbol does not resolve
 *   - the behaviour baseline grows, or keeps an entry whose debt is paid
 *
 * Reports (without failing) features marked `planned` whose evidence resolves:
 * those are promotion candidates. Promoting is a product decision; this tool
 * only refuses to let the claim and the code drift apart unnoticed.
 *
 * This file gathers what the repository contains and prints the result. The
 * judgement lives in implementation-audit.mjs, where it can be tested — see
 * implementation-audit.test.mjs.
 *
 * WHY THE OUTPUT LEADS WITH A LADDER
 *   The previous version printed one number: "catalogue says implemented: 31".
 *   That was true, and it was read as though the product had 31 working
 *   features. It meant 31 symbols resolved. Every count here is printed beside
 *   the weaker counts underneath it, so the strongest number cannot be quoted
 *   on its own.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, basename } from "node:path";
import { EVIDENCE, KINDS, KINDS_REQUIRING_BEHAVIOUR, BEHAVIOUR_BASELINE } from "./implementation-evidence.mjs";
import { auditImplementation, LAYERS } from "./implementation-audit.mjs";
import { loadJsonc } from "../lib/jsonc.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const ANDROID = join(root, "apps/seller-android/app/src");
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

const ktFiles = walk(join(ANDROID, "main/java"), (n) => n.endsWith(".kt"));
const ktSource = ktFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const tsSource = walk(BACKEND, (n) => n.endsWith(".ts")).map((f) => readFileSync(f, "utf8")).join("\n");

/**
 * Test corpora, indexed by basename. Android unit, instrumented and screenshot
 * tests all count, as does the backend suite. Indexed by basename because an
 * evidence entry naming a full path would break every time a test moved, and the
 * point is that the assertion exists, not where it lives.
 */
function indexTests(dirs) {
  const byName = new Map();
  for (const dir of dirs) {
    for (const file of walk(dir, (n) => n.endsWith(".kt") || n.endsWith(".spec.ts"))) {
      byName.set(basename(file), readFileSync(file, "utf8"));
    }
  }
  return byName;
}

const testCorpus = {
  android: indexTests([join(ANDROID, "test"), join(ANDROID, "androidTest"), join(ANDROID, "screenshotTest")]),
  backend: indexTests([join(root, "services/backend/test")]),
};

/** The Android network layer — where an integration claim has to show up. */
const clientSource = ktFiles
  .filter((f) => /BackendApi\.kt$|ApiRoutes\.kt$/.test(f))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const screens = new Set([...ktSource.matchAll(/fun\s+([A-Za-z]+Screen)\s*\(/g)].map((m) => m[1]));
const routes = new Set([...ktSource.matchAll(/data\s+(?:object|class)\s+([A-Za-z]+Route)/g)].map((m) => m[1]));
const endpoints = new Set([...tsSource.matchAll(/"(\/api\/v1\/[a-z0-9/{}._-]*)"/g)].map((m) => m[1]));
const localeDirs = new Set(
  existsSync(join(ANDROID, "main/res"))
    ? readdirSync(join(ANDROID, "main/res")).filter((d) => d.startsWith("values"))
    : [],
);
const bindings = new Set(catalog.features.map((f) => f.enforcement_binding).filter(Boolean));

/* ---------- deployment gates, read from the configuration that ships ---------- */
const wrangler = loadJsonc(join(root, "services/backend/wrangler.jsonc"));
const gates = { production: wrangler.vars ?? {}, staging: wrangler.env?.staging?.vars ?? {} };

const index = {
  has(kind, value) {
    switch (kind) {
      case "screen":   return screens.has(value);
      case "route":    return routes.has(value);
      case "endpoint": return endpoints.has(value);
      case "resource": return localeDirs.has(value);
      case "binding":  return bindings.has(value) && tsSource.includes(value);
      case "module":   return existsSync(join(root, value));
      default: return false;
    }
  },
  test: (layer, file) => testCorpus[layer]?.get(file),
  client: clientSource,
  gate: (env, name) => {
    const raw = gates[env]?.[name];
    return raw === undefined ? null : raw === "true";
  },
};

const { problems, confirmed, candidates, levels, gateClosed } = auditImplementation({
  catalog,
  evidence: EVIDENCE,
  baseline: BEHAVIOUR_BASELINE,
  kinds: KINDS,
  kindsRequiringBehaviour: KINDS_REQUIRING_BEHAVIOUR,
  index,
});

/* ---------- report ---------- */
if (problems.length) {
  console.error(`FAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error("  " + p);
  console.error("");
}

const declaresGate = levels.reachable.length + gateClosed.length;
const ungated = confirmed.length - declaresGate;
console.log(`Evidence ladder across ${confirmed.length} features the catalogue marks implemented:`);
console.log(`  EXISTS              ${levels.exists.length}  a symbol of that name resolves`);
console.log(`  REACHABLE           ${levels.reachable.length} of ${declaresGate} that declare a deployment gate  (${ungated} declare none, which is unverified rather than proven open)`);
console.log(`  BEHAVIOUR-TESTED    ${levels.behaviour.length}  a named test asserts what it does`);
console.log(`  INTEGRATION-TESTED  ${levels.integration.length}  a client call site was found`);

const byLayer = levels.behaviour.reduce((acc, k) => {
  const layer = EVIDENCE[k].behaviour.layer;
  acc[layer] = (acc[layer] ?? 0) + 1;
  return acc;
}, {});
if (levels.behaviour.length) {
  console.log(`\n  Behaviour evidence by layer: ${LAYERS.filter((l) => byLayer[l]).map((l) => `${byLayer[l]} ${l}`).join(", ")}.`);
  if (byLayer.backend) console.log(`  A backend test proves the server behaviour, not the screen that drives it.`);
}

console.log(`\n  index: ${screens.size} screens, ${routes.size} routes, ${endpoints.size} seller endpoints, ${localeDirs.size} locale dirs,`);
console.log(`         ${testCorpus.android.size} android test files, ${testCorpus.backend.size} backend spec files`);

if (gateClosed.length) {
  console.log(`\nIMPLEMENTED BUT CLOSED IN PRODUCTION (${gateClosed.length}):`);
  for (const g of gateClosed) {
    const staging = g.staging === null ? "undeclared" : g.staging ? "open" : "closed";
    console.log(`  ${g.key}\n      ${g.gate}=false in production, ${staging} in staging`);
  }
}

const baseline = Object.entries(BEHAVIOUR_BASELINE);
if (baseline.length) {
  console.log(`\nBEHAVIOUR DEBT — implemented, no test named (${baseline.length}):`);
  for (const [key, reason] of baseline) console.log(`  ${key}\n      ${reason}`);
  console.log(`\n  This set may shrink and never grow. A new screen, route or module claim must name a test.`);
}

if (candidates.length) {
  console.log(`\nPROMOTION CANDIDATES — marked "planned", evidence resolves (${candidates.length}):`);
  for (const c of candidates) {
    console.log(`  ${c.key}`);
    console.log(`      ${c.e.kind}: ${c.e.value}${c.e.note ? `\n      note: ${c.e.note}` : ""}`);
  }
  console.log(`\n  Promote by editing implementation_status in the catalogue; this tool will then require the evidence.`);
}

if (problems.length) process.exit(1);
console.log(`\nOK — every claim resolves at the level it declares.`);
