import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const failures = [];

const resolve = (relative) => path.join(root, relative);
const read = (relative) => fs.readFileSync(resolve(relative), "utf8");
const fail = (message) => failures.push(message);
const requireFile = (relative) => {
  if (!fs.existsSync(resolve(relative))) fail(`Missing required file: ${relative}`);
};
const requireAbsent = (relative) => {
  if (fs.existsSync(resolve(relative))) fail(`Legacy path must not exist: ${relative}`);
};
const requireText = (relative, expected) => {
  const source = read(relative);
  for (const value of expected) {
    if (!source.includes(value)) fail(`${relative} is missing: ${value}`);
  }
};

function stripJsonComments(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") { lineComment = false; output += current; }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") { blockComment = false; index += 1; }
      else if (current === "\n") output += current;
      continue;
    }
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') { inString = true; output += current; continue; }
    if (current === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (current === "/" && next === "*") { blockComment = true; index += 1; continue; }
    output += current;
  }
  return output;
}

const loadJsonc = (relative) => JSON.parse(stripJsonComments(read(relative)));
const values = (items, key) => (items ?? []).map((item) => item[key]);
const queueNames = (config) => [
  ...values(config.queues?.producers, "queue"),
  ...values(config.queues?.consumers, "queue"),
  ...values(config.queues?.consumers, "dead_letter_queue").filter(Boolean)
];
const assertSet = (label, actual, expected) => {
  const normalized = [...new Set(actual)].sort();
  const wanted = [...new Set(expected)].sort();
  if (JSON.stringify(normalized) !== JSON.stringify(wanted)) {
    fail(`${label} mismatch. Expected ${wanted.join(", ")}; found ${normalized.join(", ")}`);
  }
};
const assertSuffix = (label, names, suffix) => {
  for (const name of names.filter(Boolean)) {
    if (!name.endsWith(suffix)) fail(`${label} resource lacks ${suffix} suffix: ${name}`);
  }
};

for (const directory of [
  "apps/seller-android", "apps/admin-web", "services/backend", "contracts/openapi",
  "contracts/typescript", "quality/performance", "tooling/repository"
]) requireFile(directory);
for (const legacy of ["android-app", "admin-frontend", "backend", "openapi", "shared-types", "ai-prompts", "performance", "outputs", "path", "pmcp"]) requireAbsent(legacy);

const publicConfig = loadJsonc("services/backend/wrangler.jsonc");
const publicStaging = publicConfig.env?.staging;
if (!publicStaging) fail("Public Worker has no explicit staging environment.");
if (publicConfig.env?.production) fail("Do not add env.production until the live Cloudflare audit proves it will not create a new Worker.");
if (publicConfig.name !== "orderak-worker" || publicStaging?.name !== "orderak-worker-staging") fail("Public Worker names drifted.");
assertSet("Production public D1", values(publicConfig.d1_databases, "database_name"), ["orderak-db", "orderak-geo"]);
assertSet("Staging public D1", values(publicStaging?.d1_databases, "database_name"), ["orderak-db-staging", "orderak-geo-staging"]);
assertSet("Production public R2", values(publicConfig.r2_buckets, "bucket_name"), ["orderak-media"]);
assertSet("Staging public R2", values(publicStaging?.r2_buckets, "bucket_name"), ["orderak-media-staging"]);
assertSet("Production public queues", queueNames(publicConfig), ["orderak-play-billing", "orderak-email", "orderak-email-dlq"]);
assertSet("Staging public queues", queueNames(publicStaging ?? {}), ["orderak-play-billing-staging", "orderak-email-staging", "orderak-email-dlq-staging"]);
assertSuffix("Staging public", [publicStaging?.name, ...values(publicStaging?.d1_databases, "database_name"), ...values(publicStaging?.r2_buckets, "bucket_name"), ...queueNames(publicStaging ?? {})], "-staging");
if (publicConfig.d1_databases?.some((prod, index) => prod.database_id === publicStaging?.d1_databases?.[index]?.database_id)) fail("Production and Staging public D1 IDs must differ.");
if (publicConfig.kv_namespaces?.length || publicStaging?.kv_namespaces?.length) fail("Session/MFA authority must remain in D1, not KV bindings.");
if (publicStaging?.send_email?.[0]?.name !== "EMAIL") fail("Staging public Worker must declare the non-inherited EMAIL binding.");

const adminConfig = loadJsonc("services/backend/wrangler.admin.jsonc");
const adminStaging = adminConfig.env?.staging;
if (adminConfig.name !== "orderak-admin-worker" || adminStaging?.name !== "orderak-admin-worker-staging") fail("Admin Worker names drifted.");
if (adminConfig.workers_dev !== false || adminStaging?.workers_dev !== false) fail("Production and Staging Admin Workers must keep workers.dev disabled.");
if (adminConfig.preview_urls !== false || adminStaging?.preview_urls !== false) fail("Production and Staging Admin Workers must keep preview URLs disabled.");
assertSet("Production admin R2", values(adminConfig.r2_buckets, "bucket_name"), ["orderak-media", "orderak-admin-audit"]);
assertSet("Staging admin R2", values(adminStaging?.r2_buckets, "bucket_name"), ["orderak-media-staging", "orderak-admin-audit-staging"]);
assertSet("Production admin queues", queueNames(adminConfig), ["orderak-admin-exports", "orderak-admin-exports-dlq", "orderak-play-billing", "orderak-play-billing-dlq", "orderak-email"]);
assertSet("Staging admin queues", queueNames(adminStaging ?? {}), ["orderak-admin-exports-staging", "orderak-admin-exports-dlq-staging", "orderak-play-billing-staging", "orderak-play-billing-dlq-staging", "orderak-email-staging"]);
assertSuffix("Staging admin", [adminStaging?.name, ...values(adminStaging?.d1_databases, "database_name"), ...values(adminStaging?.r2_buckets, "bucket_name"), ...queueNames(adminStaging ?? {})], "-staging");
if (adminConfig.d1_databases?.[0]?.database_id !== publicConfig.d1_databases?.[0]?.database_id) fail("Production public/admin Workers must share the mapped production D1.");
if (adminStaging?.d1_databases?.[0]?.database_id !== publicStaging?.d1_databases?.[0]?.database_id) fail("Staging public/admin Workers must share the mapped staging D1.");
if (adminStaging?.send_email?.[0]?.name !== "EMAIL") fail("Staging Admin Worker must declare the non-inherited EMAIL binding.");

const edgeProd = loadJsonc("apps/admin-web/wrangler.edge.jsonc");
const edgeStaging = loadJsonc("apps/admin-web/wrangler.edge.staging.jsonc");
if (edgeProd.name !== "orderak-admin-edge" || edgeStaging.name !== "orderak-admin-edge-staging") fail("Admin Edge Worker names drifted.");
if (edgeProd.assets?.directory !== "./dist" || edgeStaging.assets?.directory !== "./dist") fail("Admin Edge Workers must serve the compiled dist directory through Static Assets.");
if (edgeProd.services?.[0]?.binding !== "ADMIN_WORKER" || edgeProd.services?.[0]?.service !== adminConfig.name) fail("Production ADMIN_WORKER service binding drifted.");
if (edgeStaging.services?.[0]?.binding !== "ADMIN_WORKER" || edgeStaging.services?.[0]?.service !== adminStaging?.name) fail("Staging ADMIN_WORKER service binding drifted.");
requireText("apps/admin-web/wrangler.edge.jsonc", ["orderak-admin-edge", "admin.orderak.app", "https://api.orderak.app"]);
requireText("apps/admin-web/wrangler.edge.staging.jsonc", ["orderak-admin-edge-staging", "admin.staging.orderak.app", "https://api.staging.orderak.app"]);
if (read("apps/admin-web/wrangler.edge.jsonc").includes("PAGES_ORIGIN") || read("apps/admin-web/wrangler.edge.staging.jsonc").includes("PAGES_ORIGIN")) fail("Admin Edge must not proxy a Pages origin.");
requireText("apps/seller-android/app/build.gradle.kts", [
  'applicationId = "app.orderak.seller"', 'applicationIdSuffix = ".staging"',
  'https://api.orderak.app', 'https://api.staging.orderak.app'
]);

const serverExpectations = {
  "contracts/openapi/src/seller-v1.json": ["https://api.orderak.app", "https://api.staging.orderak.app", "http://localhost:4010"],
  "contracts/openapi/src/admin-v1.json": ["https://admin.orderak.app", "https://admin.staging.orderak.app"],
  "contracts/openapi/src/integrations-v1.json": ["https://api.orderak.app", "https://api.staging.orderak.app"]
};
let operationCount = 0;
for (const [relative, expectedServers] of Object.entries(serverExpectations)) {
  const spec = JSON.parse(read(relative));
  assertSet(`${relative} servers`, spec.servers.map((server) => server.url), expectedServers);
  for (const pathItem of Object.values(spec.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) if (pathItem[method]) operationCount += 1;
  }
}
// Tripwire: the operation count only moves when the API surface deliberately
// moves. Raised from 231 when route discovery became AST-aware — the previous
// regex inventory could not see Hono registrations, so the email-template and
// inbound-email admin operations, the public theme CSS endpoints, and the
// expanded verify/retry and activate/rollback paths were all absent from the
// spec despite being implemented and serving traffic.
// Raised to 246 on 2026-08-13 for POST /api/admin/v1/security/audit-archives/verify,
// which made verifyAuditArchives() reachable. The function and its tests already
// existed; nothing called them, so on a live system verified_at was never written.
// Phase 7b needed it to prove that archives signed under audit key version 1 still
// verify after staging moved to version 2.
if (operationCount !== 246) fail(`OpenAPI operation inventory changed: expected 246, found ${operationCount}.`);
const seller = JSON.parse(read("contracts/openapi/src/seller-v1.json"));
for (const [route, pathItem] of Object.entries(seller.paths)) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operation = pathItem[method];
    if (!operation) continue;
    const refs = new Set((operation.parameters ?? []).map((parameter) => parameter.$ref));
    for (const header of ["ClientPlatform", "AppVersion"]) {
      if (!refs.has(`./components/common.json#/parameters/${header}`)) fail(`${method.toUpperCase()} ${route} lacks ${header}.`);
    }
  }
}

requireText(".github/workflows/staging-deploy.yml", ["environment:", "name: staging", "services/backend", "apps/admin-web", "--env staging", "api.staging.orderak.app"]);
requireText(".github/workflows/production-deploy.yml", ["workflow_dispatch:", "release_sha:", "actions: read", "environment:", "name: production", "gh api", "staging-deploy.yml", "DEPLOY_PRODUCTION"]);
const workflowRoot = resolve(".github/workflows");
const oldPathPattern = /(^|[\s'"`(])(?:android-app|admin-frontend|backend|openapi|shared-types|ai-prompts|performance)[\\/]/m;
for (const entry of fs.readdirSync(workflowRoot)) {
  if (!/\.ya?ml$/.test(entry)) continue;
  const source = fs.readFileSync(path.join(workflowRoot, entry), "utf8");
  if (oldPathPattern.test(source)) fail(`Old repository path remains in workflow: ${entry}`);
}

for (const doc of [
  "docs/architecture/deployment-environment-map.md",
  "docs/architecture/application-structure.md",
  "docs/architecture/cross-platform-readiness.md"
]) requireFile(doc);

if (failures.length) {
  console.error("Deployment/repository map verification failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("Deployment/repository map verified: paths, environments, resources, bindings, clients, and OpenAPI are aligned.");
