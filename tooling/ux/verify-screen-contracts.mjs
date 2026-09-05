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
 *   - every declared action either names a symbol that resolves inside its
 *     screen's own composable body, or declares itself planned or unverified
 *
 * Exits non-zero on failure so it can be wired into CI.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { CONTRACTS, STATES, UNVERIFIED_ACTIONS, ACTION_SOURCE } from "./screen-contracts.mjs";
import { SURFACES } from "./feature-surface-map.mjs";

// Bumped by hand when someone re-checks this report against the contracts and
// Routes.kt. Deliberately not `new Date()`: a date that moves on every run says
// only that the generator ran, which is the one thing nobody needs to be told,
// and it would make the CI staleness diff fail on any day the file was
// regenerated.
const LAST_VERIFIED = "2026-09-05";

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
/**
 * Deleted, and must stay deleted.
 *
 * The account surface absorbed the settings screen, and the route was removed
 * once the surface had been checked entry by entry against it. Naming it here
 * means a contract that reintroduces it fails rather than quietly re-creating
 * the second way in.
 */
const DELETED_ROUTES = new Set(["SettingsRoute"]);
/** Exit/entry targets that are not screens. */
const EXTERNAL = [
  "رجوع", "cold start", "warm start", "تسجيل خروج", "متجر Play",
  "مشاركة الكتالوج", "استمرار", "كل شاشات التفاصيل", "أي شاشة",
];

/* ---------------- action anchors ---------------- */
/**
 * A declared action is checked against the screen's OWN composable body, not
 * the file. OperationsScreens.kt holds eight screens; a file-wide match there
 * would let any of them claim any other's handler, which is the kind of
 * almost-checking that reads as a guarantee and is not one.
 */
const ANDROID_SRC = resolve(workspace, "apps/seller-android/app/src/main/java");

function ktFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) ktFiles(full, acc);
    else if (entry.name.endsWith(".kt")) acc.push(readFileSync(full, "utf8"));
  }
  return acc;
}
const androidSources = ktFiles(ANDROID_SRC);

/**
 * Where a word character meets a non-word one — the rule `\b` applies, with
 * the ends of the string counting as non-word.
 */
const WORD = /[A-Za-z0-9_]/;
const isWord = (ch) => ch !== undefined && WORD.test(ch);
const isBoundary = (left, right) => isWord(left) !== isWord(right);

/**
 * Does `symbol` appear in `body` as a whole token rather than inside a longer
 * one? `onSave` names `onSave()` and not `onSaveDraft()`.
 *
 * Spelled out rather than assembled into a RegExp from the symbol. Both this
 * and the signature match below used to build their pattern out of data — one
 * of them escaped it, the other did not — which is a thing a reader has to
 * re-prove safe every time they meet it, and a scanner cannot prove at all.
 * Verified identical to the `\b`-anchored form it replaces over every symbol
 * in the contracts against every Kotlin source in the app.
 */
function namesSymbol(body, symbol) {
  if (!symbol) return false;
  for (let at = body.indexOf(symbol); at >= 0; at = body.indexOf(symbol, at + 1)) {
    if (isBoundary(body[at - 1], symbol[0])
      && isBoundary(symbol[symbol.length - 1], body[at + symbol.length])) return true;
  }
  return false;
}

/** Every `fun Name(` in a Kotlin source, with the name captured to compare. */
const FUN_SIGNATURE = /\bfun\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

/**
 * Body of `fun Name(...) { ... }`, brace-matched so nested braces are kept.
 *
 * The identifier is captured and compared rather than embedded in the pattern,
 * so a name carrying regex syntax cannot change what is searched for.
 */
function composableBody(source, name) {
  FUN_SIGNATURE.lastIndex = 0;
  let signature = null;
  for (let match = FUN_SIGNATURE.exec(source); match; match = FUN_SIGNATURE.exec(source)) {
    if (match[1] === name) { signature = match; break; }
  }
  if (!signature) return null;
  let index = signature.index + signature[0].length - 1;
  let depth = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") { depth -= 1; if (depth === 0) { index += 1; break; } }
  }
  const open = source.indexOf("{", index);
  if (open < 0) return null;
  depth = 0;
  for (let j = open; j < source.length; j += 1) {
    if (source[j] === "{") depth += 1;
    else if (source[j] === "}") { depth -= 1; if (depth === 0) return source.slice(open, j + 1); }
  }
  return source.slice(open);
}

const pascal = (id) => id.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join("");

function bodyFor(contract) {
  const name = ACTION_SOURCE[contract.id] ?? `${pascal(contract.id)}Screen`;
  for (const source of androidSources) {
    const body = composableBody(source, name);
    if (body) return { name, body };
  }
  return { name, body: null };
}

const seenUnverified = new Set();
const actionCounts = { via: 0, planned: 0, unverified: 0 };

function checkActions(contract) {
  if (!contract.actions.length) return;
  const { name, body } = bodyFor(contract);

  for (const action of contract.actions) {
    if (typeof action === "string") {
      push(contract, `action "${action}" is a bare label. Give it { do, via } or { do, status }`);
      continue;
    }
    if (!action.do) { push(contract, `an action has no "do" label`); continue; }
    const key = `${contract.id}:${action.do}`;

    if (action.via) {
      actionCounts.via += 1;
      if (body === null) {
        push(contract, `action "${action.do}" names via "${action.via}" but no composable ${name}() was found`);
      } else if (!namesSymbol(body, action.via)) {
        push(contract, `action "${action.do}" names via "${action.via}", which does not appear in ${name}()`);
      }
      if (UNVERIFIED_ACTIONS.has(key)) {
        push(contract, `action "${action.do}" now has a via and is still in UNVERIFIED_ACTIONS — remove the entry`);
      }
      continue;
    }

    if (action.status === "planned") {
      actionCounts.planned += 1;
      if (!action.why) push(contract, `action "${action.do}" is planned but gives no reason`);
      continue;
    }

    if (action.status === "unverified") {
      actionCounts.unverified += 1;
      seenUnverified.add(key);
      if (!UNVERIFIED_ACTIONS.has(key)) {
        push(contract, `action "${action.do}" is unverified and not in UNVERIFIED_ACTIONS. ` +
          `That set may shrink and never grow — name a via, or declare it planned with a reason`);
      }
      continue;
    }

    push(contract, `action "${action.do}" has neither a via nor a known status`);
  }
}

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
    if (DELETED_ROUTES.has(c.kotlinRoute)) {
      push(c, `${c.kotlinRoute} was deleted — the account surface hosts it, so no contract may name it`);
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
  if (!covered.has(r) && !DELETED_ROUTES.has(r)) {
    problems.push(`Routes.kt declares ${r} but no contract covers it`);
  }
}

/* duplicate ids */
const seen = new Set();
for (const c of CONTRACTS) {
  if (seen.has(c.id)) problems.push(`duplicate contract id: ${c.id}`);
  seen.add(c.id);
}

/* actions */
for (const c of CONTRACTS) checkActions(c);

// A baseline entry whose action no longer exists, or is no longer unverified,
// would quietly widen the exemption for the next one added under that name.
for (const key of UNVERIFIED_ACTIONS) {
  if (!seenUnverified.has(key)) {
    problems.push(`UNVERIFIED_ACTIONS lists "${key}", which is no longer an unverified action — remove the entry`);
  }
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
  console.log(`ACTIONS  ${actionCounts.via} anchored to a symbol in the screen · ` +
    `${actionCounts.planned} declared but absent · ${actionCounts.unverified} present and untraced`);
  console.log("         An anchored action names a symbol resolving inside that screen's own composable body.\n");
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
out.push(`last_verified: ${LAST_VERIFIED}`);
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
out.push("`SettingsRoute` is gone: the account surface hosts what it showed, and");
out.push("the route was deleted once the surface had been checked against it.");
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
    // Render the label with its evidence, so the report cannot read as though
    // every action were equally real. A planned one says so; an untraced one
    // says so; an anchored one names the symbol that proves it.
    const renderAction = (a) => {
      if (a.via) return `${a.do} \`${a.via}\``;
      if (a.status === "planned") return `${a.do} *(planned)*`;
      return `${a.do} *(untraced)*`;
    };
    out.push(`| Actions | ${c.actions.map(renderAction).join(" · ") || "—"} |`);
    out.push("");
  }
}
// Trailing empties plus console.log's own newline give a double blank line at
// end of file, which markdownlint MD012 rejects.
while (out.length && out[out.length - 1] === "") out.pop();
console.log(out.join("\n"));
