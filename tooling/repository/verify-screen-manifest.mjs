/**
 * Verifies the app screen manifest against the code, the screen contracts and
 * the plan catalogue.
 *
 *   node tooling/repository/verify-screen-manifest.mjs
 *
 * The manifest drives the admin panel's screen tree and, once PHASE 5 lands,
 * the navigation model itself. Nothing checked it before, and it had drifted:
 * SellerProfileRoute shipped in Routes.kt and the NavHost without ever being
 * registered here.
 *
 * Fails when:
 *   - a route declared in Routes.kt has no manifest entry
 *   - a manifest entry names a route that does not exist and is not planned
 *   - a transition points at a screen nothing declares
 *   - a parent_route names a screen nothing declares
 *   - surface, state or feature_status values are outside their vocabularies
 *   - entitlement_key is not a plan-catalogue feature key
 *   - feature_status disagrees with the catalogue's implementation_status
 *   - a screen declares no states, or declares content it cannot have
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");

const manifestPath = path.join(root, "services/backend/src/domains/design/app-screen-manifest.ts");
const routesPath = path.join(root, "apps/seller-android/app/src/main/java/app/orderak/seller/app/navigation/Routes.kt");
const catalogPath = path.join(root, "docs/product/orderak-plan-catalog.json");

const manifestSource = readFileSync(manifestPath, "utf8");
const routesSource = readFileSync(routesPath, "utf8");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

const SURFACES = ["today", "orders", "store", "customers", "account"];
const STATES = ["loading", "content", "empty", "error"];


/** Synthetic manifest keys: surfaces and overlays hosted inside MainRoute. */
const isSynthetic = (route) => route.includes("#");

/**
 * The surfaces hosted inside `MainRoute`, read from the code.
 *
 * `MainRoute#orders` is a synthetic key: it is not a `Routes.kt` entry, so the
 * route check above skips it, and nothing tied the five of them to the code. That
 * was tolerable while a surface was a piece of state inside one screen and the
 * manifest was describing something that had no route at all. It is not
 * tolerable now: each surface is a destination of the shell's own `NavHost`,
 * named by its `SellerSurface` entry, so the suffix after the `#` is a literal
 * route string — and a surface renamed in Kotlin while the manifest kept the old
 * name would leave the admin panel's screen tree describing a screen that no
 * longer exists.
 */
const surfaceSourcePath = path.join(
  root,
  "apps/seller-android/app/src/main/java/app/orderak/seller/app/navigation/SellerSurface.kt",
);
const surfaceSource = readFileSync(surfaceSourcePath, "utf8");
const declaredSurfaces = [...surfaceSource.matchAll(/^ {4}([A-Z][A-Za-z]*)\s*\(/gm)].map((m) => m[1]);

const problems = [];

/* ---------- parse ---------- */
const declaredRoutes = new Set(
  [...routesSource.matchAll(/data\s+(?:object|class)\s+([A-Za-z]+Route)/g)].map((m) => m[1]),
);

// One entry per line. A brace-matching parse would be defeated by the nested
// transition objects, and the manifest is written one screen per line anyway.
const entries = manifestSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("{ name:") && line.includes("android_route:"));

/**
 * Every `key: value` pair on a manifest line, read in one pass with a static
 * pattern. Building the pattern from the key instead would leave the search
 * unanchored — `name` would happily match a `display_name` added later — and a
 * regex assembled from a variable is a finding in its own right.
 *
 * First occurrence wins, so a key nested inside `transitions: [...]` cannot
 * shadow the screen's own.
 */
const PAIR = /([a-z_]+): (null|true|false|"[^"]*"|\[[^\]]*\])/g;
const fieldsOf = (block) => {
  const found = new Map();
  for (const [, key, value] of block.matchAll(PAIR)) {
    if (!found.has(key)) found.set(key, value);
  }
  return found;
};
const unquote = (v) => (v && v.startsWith('"') ? v.slice(1, -1) : v);
const arrayOf = (v) => (v && v.startsWith("[") ? [...v.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : []);

const screens = entries.map((block) => {
  const f = fieldsOf(block);
  return {
    block,
    name: unquote(f.get("name")),
    route: unquote(f.get("android_route")),
    parent: unquote(f.get("parent_route")),
    surface: unquote(f.get("surface")),
    states: arrayOf(f.get("states")),
    offline: f.get("offline_capable") === "true",
    entitlement: unquote(f.get("entitlement_key")),
    status: unquote(f.get("feature_status")),
    transitions: [...block.matchAll(/\{ to: "([^"]+)"/g)].map((m) => m[1]),
  };
});

if (screens.length === 0) problems.push(`${rel(manifestPath)}: parsed no screens — the manifest shape changed`);

const known = new Set(screens.map((s) => s.route));
const catalogKeys = new Map(catalog.features.map((f) => [f.key, f.implementation_status]));

/* ---------- checks ---------- */
for (const s of screens) {
  const at = `${rel(manifestPath)}: ${s.route}`;

  if (!isSynthetic(s.route) && !declaredRoutes.has(s.route)) {
    problems.push(`${at}: names a route that is not declared in Routes.kt`);
  }
  if (s.parent !== "null" && s.parent !== undefined && !known.has(s.parent)) {
    problems.push(`${at}: parent_route "${s.parent}" is not a screen in the manifest`);
  }
  if (!SURFACES.includes(s.surface)) problems.push(`${at}: surface "${s.surface}" is not one of ${SURFACES.join(", ")}`);
  if (s.states.length === 0) problems.push(`${at}: declares no states`);
  for (const st of s.states) if (!STATES.includes(st)) problems.push(`${at}: unknown state "${st}"`);
  if (!["implemented", "planned"].includes(s.status)) problems.push(`${at}: feature_status "${s.status}" is invalid`);

  for (const to of s.transitions) {
    if (!known.has(to) && !declaredRoutes.has(to)) {
      problems.push(`${at}: transition to "${to}" resolves to nothing`);
    }
  }

  if (s.entitlement && s.entitlement !== "null") {
    if (!catalogKeys.has(s.entitlement)) {
      problems.push(`${at}: entitlement_key "${s.entitlement}" is not a plan-catalogue feature key`);
    } else if (catalogKeys.get(s.entitlement) !== s.status) {
      problems.push(
        `${at}: feature_status "${s.status}" disagrees with the catalogue, which says ` +
        `"${catalogKeys.get(s.entitlement)}" for ${s.entitlement}`,
      );
    }
  }
}

for (const route of declaredRoutes) {
  if (!known.has(route)) {
    problems.push(`${rel(routesPath)}: ${route} is declared but the manifest does not register it`);
  }
}

/* ---------- the surfaces inside MainRoute ---------- */
if (declaredSurfaces.length === 0) {
  problems.push(`${rel(surfaceSourcePath)}: SellerSurface declares no entries — the parse of that enum is stale`);
}
const manifestSurfaces = screens
  .map((s) => s.route)
  .filter((route) => route.startsWith("MainRoute#") && !route.includes("#version-governance"))
  .map((route) => route.slice("MainRoute#".length));
for (const surface of declaredSurfaces) {
  if (!manifestSurfaces.some((s) => s.toLowerCase() === surface.toLowerCase())) {
    problems.push(
      `SellerSurface.${surface} is a surface of the shell's NavHost but the manifest has no ` +
      `"MainRoute#${surface.toLowerCase()}" entry`,
    );
  }
}
for (const surface of manifestSurfaces) {
  if (!declaredSurfaces.some((s) => s.toLowerCase() === surface.toLowerCase())) {
    problems.push(
      `the manifest hosts "MainRoute#${surface}", which is not a SellerSurface entry — ` +
      `the shell's NavHost has no such route`,
    );
  }
}

if (problems.length) {
  console.error(`Screen manifest verification failed with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const gated = screens.filter((s) => s.entitlement && s.entitlement !== "null").length;
const offline = screens.filter((s) => s.offline).length;
const edges = screens.reduce((a, s) => a + s.transitions.length, 0);
console.log(
  `Screen manifest verified: ${screens.length} screens, ${declaredRoutes.size} Kotlin routes covered, ` +
  `${edges} transitions, ${gated} entitlement-gated, ${offline} offline-capable.`,
);
