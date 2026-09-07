import fs from "node:fs";
import path from "node:path";
import { discoverRoutes, discoverBackendAllowLists, openapiRoot, surfaceFor } from "./route-inventory.mjs";
import { assertNoOverDeclaredOperations, excusedByOptOut, loadSpecAheadOfImplementation } from "./method-allow-inventory.mjs";

const routes = discoverRoutes();
// Every path a route serves counts as implemented, so a spec operation matches
// whichever form the spec chose to document.
const implemented = new Set(
  routes.flatMap((route) =>
    (route.variants ?? [route.path]).map((variant) => `${route.method} ${variant}`),
  ),
);
// `app.all(path)` answers every method on that path, so it satisfies whichever
// operations the spec declares there. Tracked separately rather than expanded
// into five entries: some .all() registrations are terminating 404 handlers,
// and expanding those would invent operations that do not exist.
const answersAnyMethod = new Set(
  routes.filter((route) => route.method === "ALL").map((route) => route.path),
);
const isImplemented = (key) => {
  if (implemented.has(key)) return true;
  const routePath = key.slice(key.indexOf(" ") + 1);
  return answersAnyMethod.has(routePath);
};
const specifiedOperations = [];
for (const surface of ["seller", "admin", "integrations"]) {
  const spec = JSON.parse(fs.readFileSync(path.join(openapiRoot, "src", `${surface}-v1.json`), "utf8"));
  for (const [routePath, pathItem] of Object.entries(spec.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      if (pathItem[method]) specifiedOperations.push({ surface, method: method.toUpperCase(), path: routePath });
    }
  }
}
const specified = new Set(specifiedOperations.map((operation) => `${operation.method} ${operation.path}`));

// Over-declaration, checked against the 405 the server actually returns.
//
// The two set comparisons below can only be as honest as `implemented`, and
// that set is built partly by guessing methods from source text. A guess that
// happens to match a spec operation makes the operation look implemented, which
// is how four paths came to promise five operations the dispatch answers with
// 405 while coverage reported 100%. This check does not consult the guesses at
// all: it reads the Allow header out of `methodNotAllowed(...)` and fails on
// any specified operation that header excludes.
const aheadOfImplementation = loadSpecAheadOfImplementation(openapiRoot);
assertNoOverDeclaredOperations(specifiedOperations, discoverBackendAllowLists(), aheadOfImplementation);
// An operation listed there has no implementation by definition, so it would
// fail spec_without_route below as well. One opt-out has to cover both, or it
// is not an opt-out — it just moves which check refuses the build.
const deliberatelyAhead = new Set(
  specifiedOperations
    .filter((operation) => excusedByOptOut(operation, aheadOfImplementation))
    .map((operation) => `${operation.method} ${operation.path}`),
);
// A route that enumerates alternatives serves several equivalent paths, and the
// spec may legitimately document any one of them. It counts as specified when
// any variant is, and is only reported when none is.
const routeWithoutSpec = routes
  .filter((route) => route.method !== "ALL")
  .filter((route) => {
    const variants = route.variants ?? [route.path];
    return !variants.some((variant) => specified.has(`${route.method} ${variant}`));
  })
  .map((route) => `${route.method} ${route.path}`);
const specWithoutRoute = [...specified].filter((key) => !isImplemented(key) && !deliberatelyAhead.has(key));
if (routeWithoutSpec.length || specWithoutRoute.length) {
  console.error(JSON.stringify({ route_without_spec: routeWithoutSpec, spec_without_route: specWithoutRoute }, null, 2));
  process.exit(1);
}
const surfaceCounts = Object.fromEntries(["seller", "admin", "integrations"].map((surface) => [surface, discoverRoutes().filter((route) => surfaceFor(route.path) === surface).length]));
console.log(`Route/spec coverage is 100%: ${implemented.size} operations ${JSON.stringify(surfaceCounts)}`);
