/**
 * Refuses to let billing be enabled while a purchase would grant nothing.
 *
 *   node tooling/repository/verify-billing-entitlement-path.mjs
 *
 * THE DEFECT THIS GUARDS
 *   The Google Play verifier writes `organization_subscriptions`
 *   (google-play.ts, the INSERT in verifyAndApplyPlayPurchase). Every
 *   client-facing entitlement read goes through resolveEntitlementsForClient,
 *   which with ENTITLEMENTS_ENABLED unset falls to legacySnapshot — and
 *   legacySnapshot reads `subscriptions JOIN plans`, a different table written
 *   by a different code path.
 *
 *   So a seller can pay Google, the verifier can succeed and record the purchase,
 *   and the app is still told plan_key "free". No refund, no alert, and the
 *   entitlement-projection tests cannot see it because they compare the two
 *   engines' shapes without ever seeding a Play purchase and asking for the
 *   client snapshot.
 *
 *   It is not reachable today: BILLING_ENABLED is "false" in both environments
 *   and a `billing_enabled` row in `settings` gates it a second time, so nobody
 *   can buy anything. This exists so that stops being true deliberately.
 *
 * WHY THIS IS A CONFIGURATION CHECK AND NOT A FIX
 *   Fixing it means choosing how the two plan vocabularies line up, and they do
 *   not line up on their own. Legacy `plans` holds free / starter / professional
 *   (002_billing.sql); v2 `subscription_plans` holds free / paid1 / paid2 / paid3
 *   (024_versioned_entitlements.sql). Three tiers against four, overlapping only
 *   on "free", with prices that are not the same numbers. Deciding that paid2 is
 *   "professional" — or that the legacy table should be retired instead — is a
 *   pricing decision, and getting it wrong bills a seller for one tier and grants
 *   them another.
 *
 *   So this does not choose. It fails the build if BILLING_ENABLED is turned on
 *   before the choice has been made and the projection written.
 *
 * HOW TO SATISFY IT
 *   Either make resolveEntitlementsForClient serve Play purchases under both
 *   engines, or mirror organization_subscriptions into subscriptions at write
 *   time — then delete the PLAY_PROJECTION_PENDING marker in
 *   services/backend/src/domains/commerce/entitlements.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJsonc } from "../lib/jsonc.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const MARKER = "PLAY_PROJECTION_PENDING";
const entitlements = readFileSync(
  path.join(root, "services/backend/src/domains/commerce/entitlements.ts"),
  "utf8",
);
const projectionWired = !entitlements.includes(MARKER);

/** Every environment declared in a wrangler config, including the top level. */
function environments(configPath, label) {
  const config = loadJsonc(configPath);
  const out = [[label, config.vars ?? {}]];
  for (const [name, env] of Object.entries(config.env ?? {})) {
    out.push([`${label}:${name}`, env.vars ?? {}]);
  }
  return out;
}

const configs = [
  ["public", path.join(root, "services/backend/wrangler.jsonc")],
  ["admin", path.join(root, "services/backend/wrangler.admin.jsonc")],
];

const problems = [];
for (const [label, file] of configs) {
  for (const [name, vars] of environments(file, label)) {
    if (vars.BILLING_ENABLED !== "true") continue;
    if (projectionWired) continue;
    problems.push(
      `${name}: BILLING_ENABLED is "true" while a Play purchase still grants no entitlement.\n` +
      `    google-play.ts writes organization_subscriptions; resolveEntitlementsForClient serves\n` +
      `    legacySnapshot, which reads subscriptions. A seller who pays is told plan_key "free".`,
    );
  }
}

if (problems.length) {
  console.error("\nBilling would be enabled with no path from a purchase to an entitlement:\n");
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error("See tooling/repository/verify-billing-entitlement-path.mjs for the decision this is waiting on.\n");
  process.exit(1);
}

console.log(
  projectionWired
    ? "Play purchases project into the client entitlement snapshot."
    : "Play projection still pending, and billing is disabled everywhere — consistent.",
);
