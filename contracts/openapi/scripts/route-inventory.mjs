import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverHonoRoutes, assertMountsAtRoot } from "./hono-inventory.mjs";

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

export function discoverRoutes() {
  const found = new Map();
  const backendFiles = walk(backendRoot);

  const badMounts = assertMountsAtRoot(backendFiles);
  if (badMounts.length > 0) {
    throw new Error(
      "Hono sub-app mounted under a prefix; route inventory would under-report.\n" +
      badMounts.map((m) => `  ${m}`).join("\n"),
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
      if (!/(===|startsWith|includes|match\(|new Set)/.test(line)) continue;
      const nextPath = matches[index + 1]?.index ?? Math.min(source.length, match.index + 1000);
      const tail = source.slice(lineStart, Math.min(nextPath, lineStart + 1000));
      const head = source.slice(Math.max(0, lineStart - 220), lineEnd < 0 ? source.length : lineEnd);
      let methods = [...line.matchAll(/["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g)].map((item) => item[1]);
      if (methods.length === 0 && !line.includes("new Set")) {
        methods = [...tail.matchAll(/(?:request|req)\.method\s*===\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]|\bmethod\s*===\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g)]
          .map((item) => item[1] ?? item[2]);
      }
      if (methods.length === 0) {
        methods = [...head.matchAll(/["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g)].map((item) => item[1]);
      }
      for (const method of new Set(methods)) {
        if (!httpMethods.has(method)) continue;
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
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export function surfaceFor(routePath) {
  if (routePath.startsWith("/api/admin/v1/")) return "admin";
  if (routePath.startsWith("/api/integrations/v1/")) return "integrations";
  return "seller";
}
