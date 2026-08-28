/**
 * Validates tooling/ux/screen-contracts.mjs and emits the PHASE 0B report.
 *
 *   node tooling/ux/verify-screen-contracts.mjs        # validate + summary
 *   node tooling/ux/verify-screen-contracts.mjs --md   # markdown report
 *
 * Checks the contracts against the things that can actually drift:
 *   - every kotlinRoute exists in app/navigation/Routes.kt (except new ones)
 *   - every Routes.kt route has a contract
 *   - every exit target names a real contract or a known non-screen exit
 *   - every entry target names a real contract or a known external entry
 *   - declared states are a subset of the taxonomy and always include content
 *   - entitlementKey, when set, exists in the plan catalogue
 *   - surface is one of the five
 *
 * Exits non-zero on failure so it can be wired into CI.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CONTRACTS, STATES } from "./screen-contracts.mjs";
import { SURFACES } from "./feature-surface-map.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, "..", "..");

const routesKt = readFileSync(
  resolve(workspace, "apps/seller-android/app/src/main/java/app/orderak/seller/app/navigation/Routes.kt"),
  "utf8",
);
const declaredRoutes = new Set(
  [...routesKt.matchAll(/data (?:object|class) ([A-Za-z]+Route)/g)].map(m => m[1]),
);

const catalog = JSON.parse(
  readFileSync(resolve(workspace, "docs/product/orderak-plan-catalog.json"), "utf8"),
);
const catalogKeys = new Set(catalog.features.map(f => f.key));

/** Routes the migration adds; not expected in Routes.kt yet. */
const NEW_ROUTES = new Set(["PlansRoute", "PaywallRoute"]);
/** Route absorbed by the account surface; must no longer have a contract. */
const ABSORBED_ROUTES = new Set(["SettingsRoute"]);
/** Exit/entry targets that are not screens. */
const EXTERNAL = [
  "رجوع", "cold start", "warm start", "تسجيل خروج", "متجر Play",
  "مشاركة الكتالوج", "استمرار", "كل شاشات التفاصيل", "أي شاشة",
];

const ids = new Set(CONTRACTS.map(c => c.id));
const problems = [];
const push = (c, msg) => problems.push(`${c.id}: ${msg}`);

/** "OrderDetailsRoute — بعد الإنشاء" -> "OrderDetailsRoute" */
const head = s => s.split("—")[0].trim();
const isKnownTarget = (t) => {
  const h = head(t);
  if (ids.has(h)) return true;
  if (declaredRoutes.has(h) || NEW_ROUTES.has(h)) return true;
  return EXTERNAL.some(e => t.startsWith(e));
};

for (const c of CONTRACTS) {
  if (!SURFACES.includes(c.surface)) push(c, `unknown surface "${c.surface}"`);

  if (c.kotlinRoute !== null) {
    if (ABSORBED_ROUTES.has(c.kotlinRoute)) {
      push(c, `${c.kotlinRoute} is absorbed by the account surface — it must not keep a contract`);
    } else if (!declaredRoutes.has(c.kotlinRoute) && !NEW_ROUTES.has(c.kotlinRoute)) {
      push(c, `kotlinRoute "${c.kotlinRoute}" is not declared in Routes.kt`);
    }
  }

  if (!Array.isArray(c.states) || c.states.length === 0) push(c, "declares no states");
  for (const s of c.states ?? []) if (!STATES.includes(s)) push(c, `unknown state "${s}"`);
  if (!(c.states ?? []).includes("content") && c.transient !== true) {
    push(c, "must declare a content state, or be marked transient: true");
  }
  if (c.transient === true && (c.states ?? []).includes("content")) {
    push(c, "marked transient but declares a content state");
  }

  if (c.entitlementKey !== null && !catalogKeys.has(c.entitlementKey)) {
    push(c, `entitlementKey "${c.entitlementKey}" is not a catalogue feature key`);
  }
  if (!["implemented", "planned"].includes(c.featureStatus)) {
    push(c, `featureStatus "${c.featureStatus}" must be implemented or planned`);
  }
  if (c.phase !== null && !(c.phase >= 6 && c.phase <= 10)) {
    push(c, `phase ${c.phase} is outside the screen-replacement phases 6..10`);
  }
  if (!c.purpose || c.purpose.length < 10) push(c, "purpose is missing or too thin");

  for (const t of c.exit ?? []) if (!isKnownTarget(t)) push(c, `exit target not resolvable: "${t}"`);
  for (const t of c.entry ?? []) if (!isKnownTarget(t)) push(c, `entry target not resolvable: "${t}"`);
}

/* every declared Kotlin route must be covered, unless deliberately absorbed */
const covered = new Set(CONTRACTS.map(c => c.kotlinRoute).filter(Boolean));
for (const r of declaredRoutes) {
  if (!covered.has(r) && !ABSORBED_ROUTES.has(r)) {
    problems.push(`Routes.kt declares ${r} but no contract covers it`);
  }
}

/* duplicate ids */
const seen = new Set();
for (const c of CONTRACTS) {
  if (seen.has(c.id)) problems.push(`duplicate contract id: ${c.id}`);
  seen.add(c.id);
}

if (problems.length) {
  console.error(`FAIL — ${problems.length} problem(s):`);
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}

/* ---------- output ---------- */
const bySurface = SURFACES.map(s => ({
  surface: s,
  n: CONTRACTS.filter(c => c.surface === s).length,
}));
const byPhase = [6, 7, 8, 9, 10].map(p => ({
  phase: p,
  n: CONTRACTS.filter(c => c.phase === p).length,
}));
const stateHist = STATES.map(s => ({
  state: s,
  n: CONTRACTS.filter(c => c.states.includes(s)).length,
}));
const offline = CONTRACTS.filter(c => c.offline).length;
const gated = CONTRACTS.filter(c => c.entitlementKey !== null).length;

if (!process.argv.includes("--md")) {
  console.log(`OK — ${CONTRACTS.length} contracts, ${declaredRoutes.size} routes in Routes.kt, all covered.\n`);
  console.log("BY SURFACE");
  for (const r of bySurface) console.log(`  ${r.surface.padEnd(11)} ${String(r.n).padStart(3)}`);
  console.log("\nBY PHASE");
  for (const r of byPhase) console.log(`  phase ${r.phase}    ${String(r.n).padStart(3)}`);
  console.log("\nSTATE COVERAGE (screens declaring each state)");
  for (const r of stateHist) console.log(`  ${r.state.padEnd(11)} ${String(r.n).padStart(3)} / ${CONTRACTS.length}`);
  console.log(`\noffline-capable: ${offline}   entitlement-gated: ${gated}`);
  console.log(`screenshot cases: ${CONTRACTS.reduce((a, c) => a + c.states.length, 0)} states x 2 themes = ${CONTRACTS.reduce((a, c) => a + c.states.length, 0) * 2}`);
  process.exit(0);
}

const out = [];
out.push("---");
out.push("status: current");
out.push("generated: true");
out.push("owner: product");
out.push(`last_verified: ${new Date().toISOString().slice(0, 10)}`);
out.push("applies_to: [internal]");
out.push("---");
out.push("# Screen contracts");
out.push("");
out.push("Generated by `tooling/ux/verify-screen-contracts.mjs --md` from");
out.push("`tooling/ux/screen-contracts.mjs`. Do not edit by hand — change the contracts.");
out.push("");
out.push(`**${CONTRACTS.length} contracts.** Every route declared in \`Routes.kt\` is covered, plus the`);
out.push("five surfaces hosted inside `MainRoute`, the version-governance overlay, and the");
out.push("two routes the migration adds.");
out.push("");
out.push("`SettingsRoute` is deliberately absent: the account surface absorbs it.");
out.push("");
out.push("| Surface | Contracts |");
out.push("| --- | --- |");
for (const r of bySurface) out.push(`| ${r.surface} | ${r.n} |`);
out.push("");
out.push("## States are declared, not assumed");
out.push("");
out.push("Not every screen has four states. Each contract declares the states it");
out.push("actually has, and the screenshot suite asserts coverage of exactly those.");
out.push("");
out.push("| State | Screens declaring it |");
out.push("| --- | --- |");
for (const r of stateHist) out.push(`| ${r.state} | ${r.n} / ${CONTRACTS.length} |`);
out.push("");
const cases = CONTRACTS.reduce((a, c) => a + c.states.length, 0);
out.push(`Screenshot cases to write: **${cases} states × 2 themes = ${cases * 2}**.`);
out.push("");
out.push("## Build order");
out.push("");
out.push("| Phase | Contracts |");
out.push("| --- | --- |");
for (const r of byPhase) out.push(`| ${r.phase} | ${r.n} |`);
out.push("");
for (const s of SURFACES) {
  out.push(`## Surface: ${s}`);
  out.push("");
  for (const c of CONTRACTS.filter(x => x.surface === s)) {
    out.push(`### \`${c.id}\``);
    out.push("");
    out.push(`${c.purpose}`);
    out.push("");
    out.push("| | |");
    out.push("| --- | --- |");
    out.push(`| Route | ${c.kotlinRoute ? `\`${c.kotlinRoute}\`` : "مستضافة في `MainRoute`"} |`);
    out.push(`| Phase | ${c.phase} |`);
    out.push(`| States | ${c.states.join(" · ")}${c.offline ? " · **offline overlay**" : ""} |`);
    out.push(`| Entitlement | ${c.entitlementKey ? `\`${c.entitlementKey}\`` : "—"} |`);
    out.push(`| Status | ${c.featureStatus} |`);
    out.push(`| Entry | ${c.entry.join(" · ") || "—"} |`);
    out.push(`| Exit | ${c.exit.join(" · ") || "—"} |`);
    out.push(`| Data | ${c.data.join(" · ") || "—"} |`);
    out.push(`| Actions | ${c.actions.join(" · ") || "—"} |`);
    out.push("");
  }
}
// Trailing empties plus console.log's own newline give a double blank line at
// end of file, which markdownlint MD012 rejects.
while (out.length && out[out.length - 1] === "") out.pop();
console.log(out.join("\n"));
