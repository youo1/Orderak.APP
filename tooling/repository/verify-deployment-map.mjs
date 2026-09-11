import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripJsonComments } from "../lib/jsonc.mjs";

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

// ---------------------------------------------------------------------------
// Key-version selectors must name a key the environment is guaranteed to have.
//
// admin-auth.ts resolves ADMIN_TOTP_KEY_CURRENT through keyForVersion(), and
// admin-control-plane.ts resolves ADMIN_AUDIT_KEY_CURRENT through
// keyForAuditVersion(). Both return undefined for a version whose secret is
// unset, and both callers then fail closed at runtime: beginEnrollment() answers
// 500 so no administrator can enrol MFA or finish a recovery, and
// archiveAuditBatch() throws every fifteen minutes so the audit trail stops
// being archived at all.
//
// Production declared version 2 for both while requiring only the version-1
// secrets, so nothing at deploy time established that the keys it had switched
// to actually existed — the two controls would simply have stopped working, on
// a schedule, with no failing deploy to say so. Staging required them and
// production did not, which is the wrong way round.
//
// Version 1 stays required alongside the current version because existing
// material records the version it was written under: the enrolled TOTP
// ciphertext is version 1, and migration 043 backfilled signing_key_version 1
// onto every archive written before versioning existed. Dropping V1 would leave
// that history undecryptable and unverifiable.
const TOTP_KEY_BY_VERSION = { 1: "ADMIN_TOTP_KEY_V1", 2: "ADMIN_TOTP_KEY_V2" };
const AUDIT_KEY_BY_VERSION = { 1: "ADMIN_AUDIT_SIGNING_KEY", 2: "ADMIN_AUDIT_KEY_V2" };

function checkKeyVersion(label, environment, selectorName, keysByVersion) {
  const required = new Set(environment?.secrets?.required ?? []);
  const raw = environment?.vars?.[selectorName] ?? "1";
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    fail(`${label} ${selectorName} is "${raw}", which is not a key version.`);
    return;
  }
  const current = keysByVersion[version];
  if (!current) {
    fail(`${label} ${selectorName} selects version ${version}, which no key resolves to. Add it to keyForVersion()/keyForAuditVersion() first.`);
    return;
  }
  for (const name of new Set([keysByVersion[1], current])) {
    if (!required.has(name)) {
      fail(`${label} selects ${selectorName}=${version} but does not require ${name}. A key version that is not guaranteed present fails closed at runtime instead of at deploy time.`);
    }
  }
}

for (const [label, environment] of [["Production admin", adminConfig], ["Staging admin", adminStaging]]) {
  checkKeyVersion(label, environment, "ADMIN_TOTP_KEY_CURRENT", TOTP_KEY_BY_VERSION);
  checkKeyVersion(label, environment, "ADMIN_AUDIT_KEY_CURRENT", AUDIT_KEY_BY_VERSION);
}

// Sentry must be a required secret on every Worker that initialises it.
//
// Both Workers read SENTRY_DSN and both no-op silently when it is unset — which
// is the worst property an observability tool can have, because the symptom of
// its absence is that everything looks quiet. Nothing in CI or configuration
// proved it had ever been set, so "are errors aggregating anywhere?" was a
// question with no answer short of causing one and looking.
//
// Required, it fails at deploy time instead. This check exists so the
// requirement cannot be quietly dropped the first time a deploy complains.
for (const [label, environment] of [
  ["Production public", publicConfig],
  ["Staging public", publicStaging],
  ["Production admin", adminConfig],
  ["Staging admin", adminStaging],
]) {
  const required = new Set(environment?.secrets?.required ?? []);
  if (!required.has("SENTRY_DSN")) {
    fail(`${label} does not require SENTRY_DSN. Sentry no-ops silently without it, so an unset DSN reads as "no errors" rather than as a missing tool.`);
  }
}

// Vars that must agree between the two Workers sharing one database.
//
// The public Worker and the admin Worker are separate deployments reading the
// same D1, and three of these are not inert on the admin side: it runs the
// Play verification queue consumer, and it reports the entitlements gate in the
// admin readiness readout. They had drifted on all four in staging — most
// damagingly GOOGLE_PLAY_PACKAGE_NAME, which selects the play_product_mappings
// row set, so the consumer resolved staging purchases against production's
// products and failed them as play_product_not_enabled.
//
// The drift was invisible because each file reads correctly on its own. Only
// the pair is wrong, which is exactly the thing a per-file review cannot see
// and a check across both can.
// AUTH_IDENTITY_ENABLED and PHONE_CHANGE_ENABLED are deliberately absent.
// Both are declared on the admin Worker and read by nothing there — their only
// readers are findSellerByVerifiedIdentity(), restoreFirebaseSession() and
// handlePhoneChangeRoutes(), all of which are mounted on the public Worker. They
// are inert rather than shared, so requiring them to match would be enforcing a
// rule about values that have no effect. They are candidates for deletion from
// wrangler.admin.jsonc, not for alignment.
const SHARED_DATABASE_VARS = [
  "ENTITLEMENTS_ENABLED",
  "GOOGLE_PLAY_PACKAGE_NAME",
  "BILLING_ENABLED",
  "GOOGLE_PLAY_LIFECYCLE_ENABLED",
  // Both Workers build store_url from this — the Seller API from
  // identityBlock(), the Admin store list from its own query — so a difference
  // would have one of them handing out links to the other deployment, which is
  // the bug PUBLIC_SITE_URL was introduced to fix.
  "PUBLIC_SITE_URL",
];
for (const [label, publicEnvironment, adminEnvironment] of [
  ["Production", publicConfig, adminConfig],
  ["Staging", publicStaging, adminStaging],
]) {
  for (const name of SHARED_DATABASE_VARS) {
    const fromPublic = publicEnvironment?.vars?.[name];
    const fromAdmin = adminEnvironment?.vars?.[name];
    if (fromPublic !== fromAdmin) {
      fail(
        `${label} public/admin Workers disagree on ${name} ("${fromPublic}" vs "${fromAdmin}"). `
        + "They share one D1 database, and the admin Worker runs the Play verification consumer, "
        + "so a difference here is a behaviour difference rather than a cosmetic one.",
      );
    }
  }
}

// Billing lifecycle requires the entitlements engine.
//
// applyVerifiedPurchase() writes organization_subscriptions, and only the v2
// engine reads it. With GOOGLE_PLAY_LIFECYCLE_ENABLED on and
// ENTITLEMENTS_ENABLED off, a verified purchase is recorded and then invisible:
// /api/v1/entitlements answers from the legacy `subscriptions` table, which the
// billing path never writes, so the seller is charged and downgraded to free on
// their next sync.
//
// The two flags are independent switches that are not independent facts. This
// is the check that says so, rather than a comment asking the next person to
// remember.
for (const [label, environment] of [
  ["Production public", publicConfig],
  ["Staging public", publicStaging],
  ["Production admin", adminConfig],
  ["Staging admin", adminStaging],
]) {
  const lifecycle = environment?.vars?.GOOGLE_PLAY_LIFECYCLE_ENABLED === "true";
  const entitlements = environment?.vars?.ENTITLEMENTS_ENABLED === "true";
  if (lifecycle && !entitlements) {
    fail(
      `${label} enables GOOGLE_PLAY_LIFECYCLE_ENABLED without ENTITLEMENTS_ENABLED. `
      + "A verified Play purchase writes organization_subscriptions, which only the v2 engine reads, "
      + "so the seller would pay and then be served the free plan.",
    );
  }
}

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
// Raised to 247 on 2026-08-22 for PATCH /api/v1/orders/{id}/status. Order status
// had no server route at all: OrderStatus.kt described a pipeline and the app
// wrote transitions to its own Room database, so the server held every order at
// NEW and a reinstall replayed work the seller had already done. Cancelling was
// worse — placing an order takes stock through a trigger, and the Room-only
// restore meant every cancellation leaked it.
// Raised to 249 on 2026-09-05 for the two phone-change routes. Unlike the raises
// above, no route was added: POST /api/v1/auth/phone-change/challenges and
// .../complete have been live and enabled in both environments for months. The
// route scanner could not read `if (url.pathname !== X)`, so it never discovered
// them, they never appeared in `route_without_spec`, and coverage reported 100%
// over a surface that was missing them. The scanner now fails closed instead of
// skipping what it cannot read, which is what made these two visible.
// Raised to 250 on 2026-09-05 for POST /api/v1/orders. The app could read
// orders and change their status and could not create one, so an order the
// seller took in a conversation was written to Room and stopped there: absent
// from the account, from a second device, from a reinstall, and from the
// monthly plan count. The seller read a confirmation and had a note on one
// phone. Unlike the phone-change raise above, this route is genuinely new.
// Lowered to 245 on 2026-09-06 for five operations that were never served. The
// seller contract declared GET and POST on /api/v1/categories/{category_code},
// POST /api/v1/store, GET /api/v1/media/upload and GET /api/v1/products/sync;
// every one is answered with 405. The first lowering, and the mirror image of
// the phone-change raise above: there the scanner could not read a dispatch and
// under-reported, here it guessed a method out of a neighbouring block and
// over-reported, so each phantom silently satisfied the spec entry it had
// created. Coverage now checks the spec against the Allow header the server
// actually sends — see contracts/openapi/scripts/method-allow-inventory.mjs.
// Raised to 248 on 2026-09-06 for the three customer routes. A buyer was two
// denormalised columns on `orders` and the customer list was aggregated on the
// device, so there was no row to edit — the catalogue sold editable customer
// profiles at paid1 while CustomerDetailsScreen had nowhere to put an edit.
// GET /api/v1/customers, GET and PATCH /api/v1/customers/{customer_key} are the
// resource that edit goes into.
if (operationCount !== 248) fail(`OpenAPI operation inventory changed: expected 248, found ${operationCount}.`);
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
