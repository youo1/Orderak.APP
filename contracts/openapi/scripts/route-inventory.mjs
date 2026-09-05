import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverHonoRoutes, assertMountsAtRoot, assertOpenApiRoutesResolvable, assertHonoPathsResolvable } from "./hono-inventory.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const openapiRoot = path.resolve(here, "..");
export const workspaceRoot = path.resolve(openapiRoot, "..", "..");
const backendRoot = path.join(workspaceRoot, "services", "backend", "src");
const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith(".ts") ? [full] : [];
  });
}

function normalize(raw, tail = "") {
  let value = raw.split("?")[0]
    .replace(/\$\{[^}]+\}/g, "{id}")
    .replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, (token) => `{${token.slice(1)}}`);
  if (value.endsWith("/")) value += "{id}";
  const suffix = /\.endsWith\(["'`]([^"'`]+)["'`]\)/.exec(tail)?.[1];
  if (suffix && !value.endsWith(suffix)) value += suffix;
  value = value.replace("/api/v1/categories/{id}", "/api/v1/categories/{category_code}");
  return value;
}

/**
 * Path literals the regex pass could not turn into a route.
 *
 * WHY THESE ARE COLLECTED RATHER THAN SKIPPED
 *   The pass used to `continue` past anything it did not recognise. That is a
 *   silent skip, and it produced the worst possible failure: two live POST
 *   routes — /api/v1/auth/phone-change/challenges and .../complete — were
 *   invisible to discovery for months, so they never appeared in the contract,
 *   never appeared in `route_without_spec`, and coverage printed "100%" the
 *   whole time. docs/status.md then quoted that number.
 *
 *   A scanner that cannot read an expression must say so. Silence in the
 *   safe-looking direction is worse than a known gap, because a known gap gets
 *   fixed and a false 100% gets cited.
 *
 * WHY NOT FAIL ON EVERY UNREADABLE LITERAL
 *   Because most of them are fine. Of the 45 literals this pass cannot read
 *   today, 43 name routes that the Hono AST pass or route-overrides.json
 *   already knows about — base-path constants, gated-route lists, error
 *   payloads that mention a path. Failing on those would be noise, and a guard
 *   that cries wolf gets an ever-growing ignore list until it means nothing.
 *
 *   So the check is narrower and much sharper: fail when an unreadable literal
 *   names a route that NO pass and NO override knows about. That is exactly the
 *   phone-change failure, and on this repository it fires on nothing else.
 */
function candidate(file, source, match, lineStart, line, reason) {
  return {
    file: path.relative(workspaceRoot, file).replaceAll("\\", "/"),
    line: source.slice(0, match.index).split("\n").length,
    path: normalize(match[1]),
    text: line.trim().slice(0, 120),
    reason,
  };
}

function loadIgnores() {
  const file = path.join(openapiRoot, "route-scanner-ignore.json");
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function discoverRoutes() {
  const found = new Map();
  const unreadable = [];
  const backendFiles = walk(backendRoot);

  const badMounts = assertMountsAtRoot(backendFiles);
  if (badMounts.length > 0) {
    throw new Error(
      "Hono sub-app mounted under a prefix; route inventory would under-report.\n" +
      badMounts.map((m) => `  ${m}`).join("\n"),
    );
  }

  const unresolvable = assertOpenApiRoutesResolvable(backendFiles, backendRoot);
  if (unresolvable.length > 0) {
    throw new Error(
      "app.openapi() route whose method/path cannot be read statically. It would be\n" +
      "implemented but absent from the contract, with coverage still reporting 100%.\n" +
      unresolvable.map((m) => `  ${m}`).join("\n"),
    );
  }

  const unresolvableVerbs = assertHonoPathsResolvable(backendFiles, backendRoot);
  if (unresolvableVerbs.length > 0) {
    throw new Error(
      "Hono route registered with a path that cannot be read statically. It would be\n" +
      "implemented but absent from the contract, with coverage still reporting 100%.\n" +
      unresolvableVerbs.map((m) => `  ${m}`).join("\n"),
    );
  }

  // Both passes run over every file, because a single file can use both styles:
  // public-worker.ts registers Hono routes *and* still resolves the legacy
  // chat/orders surface imperatively inside handleApi(). Skipping the regex pass
  // for any file containing Hono routes loses GET /api/v1/orders.
  const honoRoutes = discoverHonoRoutes(backendFiles, workspaceRoot);

  for (const file of backendFiles) {
    const source = fs.readFileSync(file, "utf8");
    const literal = /["'`](\/api\/(?:v1|admin\/v1|integrations\/v1)\/[A-Za-z0-9_./${}-]+)["'`]/g;
    const matches = [...source.matchAll(literal)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const lineStart = source.lastIndexOf("\n", match.index) + 1;
      const lineEnd = source.indexOf("\n", match.index);
      const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
      // `!==` reads a route guarded by early return — `if (pathname !== X) return null`
      // is how the identity handlers dispatch, and omitting it is what hid them.
      if (!/(===|!==|startsWith|includes|match\(|new Set)/.test(line)) {
        unreadable.push(candidate(file, source, match, lineStart, line, "dispatch expression not recognised"));
        continue;
      }
      const nextPath = matches[index + 1]?.index ?? Math.min(source.length, match.index + 1000);
      const tail = source.slice(lineStart, Math.min(nextPath, lineStart + 1000));
      const head = source.slice(Math.max(0, lineStart - 220), lineEnd < 0 ? source.length : lineEnd);
      let methods = [...line.matchAll(/["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g)].map((item) => item[1]);
      if (methods.length === 0 && !line.includes("new Set")) {
        // A method guard written as `method !== "POST"` names the method the
        // route accepts just as surely as `=== "POST"` does; it rejects the rest.
        methods = [...tail.matchAll(/(?:request|req)\.method\s*[!=]==\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]|\bmethod\s*[!=]==\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g)]
          .map((item) => item[1] ?? item[2]);
      }
      if (methods.length === 0) {
        methods = [...head.matchAll(/["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g)].map((item) => item[1]);
      }
      if (methods.length === 0) {
        // Last resort: a dispatch that lists several paths before guarding the
        // method shares one guard between them, and `tail` stops at the next
        // path literal — so the first path in the list never sees it. Widen past
        // the neighbours rather than dropping the route. Only reached when every
        // narrower read failed, and a wrong guess surfaces loudly as a route
        // without a spec rather than quietly as no route at all.
        const wide = source.slice(lineStart, Math.min(source.length, lineStart + 600));
        methods = [...wide.matchAll(/(?:request|req)\.method\s*[!=]==\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]|\bmethod\s*[!=]==\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g)]
          .map((item) => item[1] ?? item[2]);
      }
      const usable = [...new Set(methods)].filter((method) => httpMethods.has(method));
      if (usable.length === 0) {
        unreadable.push(candidate(file, source, match, lineStart, line, "no HTTP method inferable"));
        continue;
      }
      for (const method of usable) {
        const routePath = normalize(match[1], tail);
        const key = `${method} ${routePath}`;
        found.set(key, { method, path: routePath, source: path.relative(workspaceRoot, file).replaceAll("\\", "/") });
      }
    }
  }
  for (const route of honoRoutes) {
    found.set(`${route.method} ${route.path}`, route);
  }

  const overrides = JSON.parse(fs.readFileSync(path.join(openapiRoot, "route-overrides.json"), "utf8"));
  for (const route of overrides) found.set(`${route.method} ${route.path}`, { ...route, source: "contracts/openapi/route-overrides.json" });

  assertNoOrphanLiterals(unreadable, found);

  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/**
 * Fail when an unreadable literal names a route nothing else discovered.
 *
 * A literal is not an orphan when another pass found the same path, nor when it
 * is a base constant that longer known routes are built from — `const A =
 * "/api/admin/v1/auth"` is not a route and should not be reported as one.
 */
export function assertNoOrphanLiterals(unreadable, found, ignores = loadIgnores()) {
  const known = new Set([...found.values()].map((route) => route.path));
  const knownList = [...known];
  const isBaseConstant = (value) => knownList.some((route) => route.startsWith(value + "/"));

  const ignored = (item) => ignores.some((rule) => rule.path === item.path && (!rule.file || rule.file === item.file));

  const orphans = [];
  const seen = new Set();
  for (const item of unreadable) {
    if (known.has(item.path) || isBaseConstant(item.path) || ignored(item)) continue;
    const key = `${item.file}:${item.line}:${item.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    orphans.push(item);
  }
  if (orphans.length === 0) return;

  throw new Error(
    `Route scanner found ${orphans.length} path literal(s) it cannot read, naming routes that\n` +
    "no pass and no override knows about. Each is either a live route that would be\n" +
    "absent from the contract while coverage still reported 100%, or a string that only\n" +
    "looks like a route.\n\n" +
    orphans.map((o) => `  ${o.file}:${o.line}  ${o.path}\n      ${o.reason}\n      ${o.text}`).join("\n\n") +
    "\n\nFix it in one of three ways, in order of preference:\n" +
    "  1. Teach this scanner the dispatch expression, if it is a real pattern worth reading.\n" +
    "  2. Add the route to route-overrides.json, if it is real but not statically readable.\n" +
    "  3. Add it to route-scanner-ignore.json with a reason, if it is not a route at all.\n",
  );
}

export function surfaceFor(routePath) {
  if (routePath.startsWith("/api/admin/v1/")) return "admin";
  if (routePath.startsWith("/api/integrations/v1/")) return "integrations";
  return "seller";
}
