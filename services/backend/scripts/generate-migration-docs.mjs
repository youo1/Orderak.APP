import { readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(scriptDir, "..");
const repoDir = resolve(backendDir, "..", "..");
const migrationsDir = join(backendDir, "migrations");
const outputPath = join(repoDir, "docs", "guides", "database-migrations.md");

// Bumped by hand when someone re-checks the descriptions below against the SQL.
// Deliberately not `new Date()`: a date that moves on every run says only that
// the generator ran, which is the one thing nobody needs to be told, and it
// would make the CI staleness diff fail on any day the file was regenerated.
const LAST_VERIFIED = "2026-08-25";

const descriptions = {
  "001_init.sql": [
    "Creates the original seller, product, order, order-item, and generic item tables.",
    "Stores monetary values as integer piasters and adds lookup indexes for seller ownership, order status, phone numbers, and slugs.",
  ],
  "002_billing.sql": [
    "Adds seller referral codes and the billing, plan-feature, subscription, coupon, referral, advertising, impression, and rate-limit tables.",
    "Creates supporting indexes and seeds the Free, Starter, and Professional plans, their initial features, and default affiliate settings.",
  ],
  "003_admin.sql": [
    "Adds seller language and lifecycle status, localized plan/ad fields, scheduling fields, and the administrative RBAC and session schema.",
    "Creates settings, CMS, announcement, support, payment-event, and audit tables, then seeds platform settings, localized plan features, and initial legal/help content.",
  ],
  "004_email.sql": [
    "Creates editable email-template metadata and per-language template overrides.",
    "Adds template history and delivery-event tables with indexes for template lookup, auditing, chronology, and provider identifiers.",
  ],
  "005_inbound_email.sql": [
    "Creates storage for email received through Cloudflare Email Routing.",
    "Records envelope addresses, sender/recipient headers, parsed content, forwarding state, read state, timestamps, and lookup indexes.",
  ],
  "006_hardening.sql": [
    "Creates a webhook idempotency ledger so retried payment events are processed once.",
    "Adds server-side error logging for the admin Errors view; seller secret hashing is intentionally handled by application code rather than this migration.",
  ],
  "007_fix_phone_slugs.sql": [
    "Clears legacy slugs that consist only of seven or more digits.",
    "The backend can then generate a safer non-phone-number slug during the seller's next registration/synchronization request.",
  ],
  "008_store_codes.sql": [
    "Adds `store_code`, `country_code`, and `public_identifier` to sellers.",
    "Backfills legacy sellers with six-character codes and Egypt defaults, composes public identifiers, and enforces case-insensitive uniqueness.",
  ],
  "009_uuid_public_urls.sql": [
    "Rebuilds the core commerce tables around text UUID primary keys while preserving and remapping existing relationships.",
    "Expands store and product metadata, adds categories and immutable public codes, assigns per-store order numbers, rebuilds dependent billing/admin tables, swaps the rebuilt tables into place, and recreates indexes.",
  ],
  "010_project_admin.sql": [
    "Adds explicit plan limits and feature flags, then configures limits for the three seeded plans.",
    "Extends CMS pages and creates project-management tables for roadmap items, tasks, API endpoints, prompts, design assets, releases, bugs, and documentation.",
  ],
  "011_app_screens.sql": [
    "Creates the admin-managed application-screen inventory.",
    "Tracks screen descriptions, implementation status, Android routes, Figma links, notes, ordering, and timestamps.",
  ],
  "012_legal_versions.sql": [
    "Creates versioned legal/CMS page storage by slug, language, version, and publication status.",
    "Adds an index optimized for retrieving the latest version of a localized page.",
  ],
  "013_app_screen_statuses.sql": [
    "Separates screen progress into design and development status columns.",
    "Backfills both values from the previous combined status and adds status indexes.",
  ],
  "014_app_screen_sync.sql": [
    "Adds source and synchronization timestamps to the app-screen inventory.",
    "Indexes Android routes so code-derived screen records can be matched efficiently.",
  ],
  "015_order_no_unique.sql": [
    "Creates a unique index on `(store_id, order_no)`.",
    "Prevents concurrent order creation from producing duplicate per-store order numbers that could break the Android synchronization cursor.",
  ],
  "015_seed_app_screens.sql": [
    "Seeds the app-screen inventory with the currently known Android routes and tab/detail destinations.",
    "Uses conflict handling so existing route records are updated rather than duplicated.",
  ],
  "016_app_screen_tree.sql": [
    "Adds a self-referencing `parent_id` to model the Android navigation hierarchy.",
    "Backfills parent relationships from Splash through authentication, setup, dashboard tabs, detail screens, and settings screens.",
  ],
  "017_product_translations.sql": [
    "Creates a cache of localized product names and descriptions by product and language.",
    "Stores source text alongside translations to detect stale translations after seller edits and indexes language lookup.",
  ],
  "018_seller_devices.sql": [
    "Creates additional authenticated-device records for existing sellers.",
    "Stores hashed device secrets, creation and last-use timestamps, and an index for seller-device lookup.",
  ],
  "019_multi_device_plan_feature.sql": [
    "Adds the backend-enforced `multi_device_enabled` plan feature.",
    "Keeps multi-device access disabled for Free and enables it for Starter and Professional plans.",
  ],
  "020_product_translation_lifecycle.sql": [
	"Adds source-locale and SHA-256 source-version provenance to cached product translations.",
	"Tracks translation lifecycle, provider/model metadata, review timestamps, and indexes status lookups.",
  ],
  "021_legal_acceptances.sql": [
	"Creates an append-only audit record of the exact published terms and privacy versions accepted during verified phone authentication.",
	"Records the phone bridge, optional seller link, locale, source, app version, marketing choice, acceptance time, and lookup indexes without making the phone a permanent account key.",
  ],
  "022_deletion_requests.sql": [
	"Creates the operational queue for account-deletion requests submitted from the app-linked public resource.",
	"Tracks identity-verification and completion state, the 90-day deadline, locale, source, and lookup indexes for the manual privacy workflow.",
  ],
  "023_publish_legal_v2.sql": [
	"Archives the one-sentence legal seed pages and publishes owner-confirmed version-2 Terms and Privacy content in Arabic and English.",
	"The SQL is generated from the canonical Markdown files in `docs/legal`; independent Egyptian legal review remains recommended.",
  ],
  "024_versioned_entitlements.sql": [
	"Adds organization-scoped subscription plans, immutable plan revisions, typed entitlements, overrides, usage reservations, and Google Play purchase state.",
	"Seeds the governed four-plan catalog and supporting audit, approval, mapping, and reconciliation indexes.",
  ],
  "025_entitlement_catalog_seed.sql": [
	"Loads the versioned entitlement catalog from the governed product-plan source.",
	"Adds the current entitlement definitions and plan values without making billing active by itself.",
  ],
  "026_order_integrity.sql": [
	"Adds public-checkout idempotency, Firebase UID linkage, and optimistic product stock revisions.",
	"Creates the order-item stock-claim trigger so each D1 batch either claims every requested quantity or rolls the complete order back.",
  ],
  "027_operations_coverage.sql": [
	"Adds opaque device metadata, translation review provenance, announcement reads, and observed operational-job runs.",
	"Adds retry-safe advertising event keys and seeds the fail-closed billing admin control used by the effective runtime configuration view.",
  ],
  "028_admin_control_plane.sql": [
	"Adds opaque revocable admin sessions, recovery codes, invitations, fresh-action authorization, security alerts, feature governance, and private export/audit metadata.",
	"Supports the Pages-to-private-Worker admin boundary without activating billing, AI, or planned capabilities.",
  ],
  "029_admin_recovery_acknowledgement.sql": [
	"Adds the server-side acknowledgement timestamp for the initial MFA recovery-code set.",
	"Keeps non-auth admin routes locked until recovery codes are acknowledged and the one-time password is replaced.",
  ],
  "030_play_billing_reliability.sql": [
	"Adds encrypted Play verification jobs, organization generation heads and stale-write triggers, account hashes, replacement metadata, and dispatch/retry indexes.",
	"Adds shared provider circuit state plus idempotent AI token/cost usage and budget-threshold evidence without enabling any production feature gate.",
  ],
  "031_play_verification_leases.sql": [
	"Adds token-gated 120-second verification claims, persisted reclaim diagnostics, and indexes atomic claim acquisition.",
	"Enforces one idempotent child requeue per dead-lettered parent while preserving at-least-once queue delivery.",
  ],
  "032_stable_identity_and_routing.sql": [
	"Adds stable Firebase-phone seller identities, sanitized resumable migration issues, and single-use phone-change challenges.",
	"Adds logical organization routing and write-fence metadata while every tenant still resolves to the primary D1 binding.",
  ],
  "033_auth_onboarding_v2.sql": [
	"Adds hash-only onboarding, recent-auth, WebAuthn challenge, Passkey credential, seller-private-profile (including private birth year), and email-verification records.",
	"Adds international store category/city fields plus GeoNames city and FTS5 search tables without removing the legacy OTP/session schema.",
  ],
  "034_publish_legal_v3.sql": [
	"Archives the previous Terms and Privacy publications and publishes the bilingual Passkey, private-birth-year, private-email, Google Places, onboarding-token, retention, and deletion disclosures.",
	"The SQL is generated from the canonical Markdown files in `docs/legal`; independent Egyptian legal review remains recommended before production reliance.",
  ],
  "035_design_system_revisions.sql": [
	"Adds immutable generated design-system snapshots plus the singleton active-revision pointer and rollback ancestry.",
	"Registers the enforced global design-system capability; revision 1 is bootstrapped idempotently from the effective legacy projection after deployment.",
  ],
  "036_design_system_revision_management.sql": [
	"Adds optional Unicode display names and normalized unique name keys to immutable design-system checkpoints.",
	"Rebuilds revision ancestry with `ON DELETE SET NULL`, preserving every revision ID, active pointer, hash, snapshot, and publication timestamp.",
  ],
  "037_places_and_business_taxonomy.sql": [
	"Adds verified-phone-country and confirmed static-catalogue city fields without modifying store identity, slug, code, public identifier, or routing.",
	"Adds and seeds the versioned global Arabic/English/French business category and subcategory catalog with FTS5 search while retaining GeoNames and legacy categories for rollback.",
  ],
  "038_publish_static_city_legal_v4.sql": [
	"Archives the previous Terms and Privacy publications and publishes bilingual disclosures for the static ODbL city catalogue.",
	"The SQL is generated from the canonical Markdown files in `docs/legal`; independent Egyptian legal review remains recommended before production reliance.",
  ],
  "039_add_private_birth_year.sql": [
    "Repairs production schema drift by adding the approved private birth-year field after migration 033 had already been applied.",
    "Keeps the database column nullable for legacy rows while Auth V6 requires and validates it for every new onboarding profile.",
  ],
  "039b_repair_email_schema_drift.sql": [
    "Repairs production migration-ledger drift where migration 004 was recorded but its email tables were absent.",
    "Uses idempotent DDL to restore email templates, translations, history, delivery events, and their indexes without changing healthy databases.",
  ],
  "040_cloudflare_scalability_hardening.sql": [
    "Adds atomic single-use admin MFA/enrollment challenges, durable outbound-email idempotency, and operational leases.",
    "Adds export retry/lease fields plus retention and audit-range indexes for bounded Queue and scheduled processing.",
  ],
  "041_restore_referential_integrity.sql": [
    "Rebuilds categories, products, orders, and order_items with the FOREIGN KEY constraints migration 009 dropped, plus CHECK constraints for non-negative money and stock and positive quantities.",
    "Restores idx_orders_store_orderno, which migration 015 is recorded as creating but which was absent from production, allowing two concurrent orders to share an order_no.",
  ],
  "042_email_outbox.sql": [
    "Adds payload and dispatched_at to outbound_email_jobs so an email is committed to D1 before it is queued and can be recovered when a Queue send fails.",
  ],
  "043_audit_signing_key_version.sql": [
    "Adds signing_key_version to admin_audit_exports so an audit archive records which key signed it. Without it, rotating ADMIN_AUDIT_SIGNING_KEY made every existing archive unverifiable with no way to tell which key to try. Defaults to 1, which resolves to the pre-existing ADMIN_AUDIT_SIGNING_KEY, so history verifies unchanged and nothing is re-signed.",
  ],
  "044_money_minor_units_with_currency.sql": [
    "Renames the nine `*_piasters` columns to `*_minor` and adds a currency column to the six tables that own an amount, implementing ADR-009. `_piasters` names a unit that exists only in Egypt and asserts an exponent of 2; Kuwait, Bahrain and Oman use 1000 minor units per major unit, so a column named price_piasters holding fils is wrong in the schema itself, and every `/ 100` reading it is wrong by a factor of ten rather than by a rounding error.",
    "order_items gets no currency column: a line item takes the currency of the order above it, and a pair that can disagree is a disagreement nothing can detect after the fact. `items` gets none either, because no query in services/backend/src reads that table.",
    "Renames in place rather than rebuilding. ALTER TABLE RENAME COLUMN and ADD COLUMN ... NOT NULL DEFAULT were both verified against D1 on 2026-08-21 and succeed, so the twelve-step rebuild used elsewhere in this directory would take on its risks - dropped indexes, lost foreign keys, a partially written copy - to accomplish what the simpler statement already does.",
    "Backfills DEFAULT 'EGP', which is correct by construction rather than by assumption: there are no users and no live money rows yet. That property disappears the day a second currency exists, which is why this migration is cheap now and expensive later.",
  ],
  "045_unique_referral_code.sql": [
    "Replaces the plain `idx_sellers_refcode` with a UNIQUE index on sellers(referral_code), partial on NOT NULL so unassigned sellers do not collide with each other.",
    "ensureReferralCode() in platform/http/shared.ts already wrapped its UPDATE in a five-attempt retry loop for collisions. Without a unique constraint the UPDATE could not fail, so the catch block never ran and the retry was unreachable code: two sellers could hold one code. referralApply() resolves a referrer with SELECT ... WHERE referral_code = ? and takes the first row back, so a collision did not error - it credited the wrong seller, and nothing in the data afterwards distinguished that from a correct attribution.",
    "Expand-contract: it adds a constraint without changing a column the running Worker reads, so the previous release keeps serving while it applies.",
  ],
  "046_order_status_transitions.sql": [
    "Adds `status_changed_at` to orders and the trigger `trg_orders_release_stock_on_cancel`, giving order status a server side for the first time.",
    "OrderStatus.kt defines NEW to CONFIRMED to PAID to SHIPPED to DONE, but OrderRepository.markPaid and .cancel wrote the transition only to Room on the phone: no backend route accepted a status change, so the server held every order at NEW forever and a reinstall or a second device restored a pipeline the seller had already worked through.",
    "The cancel path leaked stock. trg_order_items_claim_stock (026, restored by 041) decrements stock when an order is placed, and the cancel handler restored it in Room only, so units came off the catalog server-side and never went back. Release is a trigger rather than handler code because the claim side already is one, and splitting the pair across SQL and TypeScript lets the two definitions drift - a drift that surfaces only as a stock count nobody can explain.",
    "Guarded on the transition (WHEN OLD.status <> 'CANCELLED') rather than on the value, so a repeated UPDATE to CANCELLED restores stock once and not twice.",
  ],
  "047_correct_entitlement_implementation_status.sql": [
    "Corrects `implementation_status` for seven entitlement definitions that migration 025 seeded as `planned` while the feature was already shipping in the app.",
    "The catalogue was never checked against the code, and the drift ran one way: CustomersScreen, CustomerDetailsScreen, MainScreen, the support-ticket, devices and catalog-translation endpoints, and AiAssistantScreen all exist, and all seven rows still claimed the work had not been done. The published figure of 23 implemented features out of 242 was understated by seven; the real count is 30. Every plan and roadmap decision framed on that number was framed on a wrong one.",
    "Written as idempotent UPDATEs rather than a regenerated 025, because 025 is applied in both environments and the ledger records it. Same shape as 039b: keep history immutable, converge forward.",
    "`ai_capabilities.basic_ai_assistance` is the row worth reading twice. The screen is built and wired but fail-closed behind AI_ASSISTANT_ENABLED, so `implemented` is now truthful about the code while the seller still cannot reach it. The UI must render that as `not built yet`, never as an upgrade: no plan change opens the flag, so an upgrade path would be a dead end.",
    "tooling/ux/verify-implementation-status.mjs now fails the build when an `implemented` claim names no evidence or names evidence that no longer resolves, which is what stops this drift recurring.",
  ],
  "048_app_screen_surface_and_transitions.sql": [
    "Adds `surface`, `transitions`, `states`, `offline_capable`, `entitlement_key` and `feature_status` to app_screens, so the admin screen tree can show a flow rather than only a hierarchy.",
    "`parent_id` (016) answers what sits under what. It cannot answer what moves a seller from here to there, which is why the branch the product plan documents - a valid cached session goes Splash straight to Dashboard - was unrepresentable while Dashboard's recorded parent was Shop Setup.",
    "transitions and states are JSON text, not child tables: they are read whole, written only by the manifest sync, and never queried by element. A join table would cost two migrations and buy nothing.",
    "entitlement_key holds the key alone. Per-plan values stay in plan_revision_entitlements as versioned revisions; copying them here would rebuild the drift this work exists to remove.",
  ],
};

function anchor(name) {
  // Match the heading IDs generated by GitHub and Python Markdown: underscores
  // are preserved and punctuation such as the filename's period is removed.
  return name.toLowerCase().replaceAll(".", "");
}

const names = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

const undocumented = names.filter((name) => !descriptions[name]);
if (undocumented.length) {
  throw new Error(`Missing migration descriptions: ${undocumented.join(", ")}`);
}

const lines = [
  // Frontmatter is emitted here, not added to the output by hand: this file is
  // regenerated, so hand-added frontmatter is destroyed on the next run. That
  // is not cosmetic - this document is the single current claimant of the
  // `database-migrations` subject, so losing its frontmatter makes
  // verify-doc-frontmatter.mjs fail with "no current document claims it".
  // Found by regenerating after stamping the claim, not by reasoning about it.
  "---",
  "status: current",
  "generated: true",
  "owner: backend",
  `last_verified: ${LAST_VERIFIED}`,
  "applies_to: [production, staging]",
  "authoritative_for: [database-migrations]",
  "---",
  "# Orderak D1 Migration Reference",
  "",
  // This document indexes and explains the migrations; it does not reproduce
  // them. It used to inline every statement, which made 92% of the file a copy
  // of SQL that already lives one `git show` away and cannot disagree with
  // itself there. The **Source:** line under each heading is the authority.
  //
  // Kept as one blockquote: two adjacent blockquotes separated by a blank line
  // are markdownlint MD028, which fails `pnpm run lint:markdown`.
  "> Generated by `services/backend/scripts/generate-migration-docs.mjs` from the SQL files in",
  "> `services/backend/migrations/`. Do not edit this file by hand; update the migration file or",
  "> the generator's description map and regenerate.",
  ">",
  "> **This is an index, not a copy.** Each section names the migration file that defines it.",
  "> Read the SQL in `services/backend/migrations/`, which is the only place it exists.",
  "",
  "## Applying migrations",
  "",
  "Run migrations through Wrangler's migration ledger from `services/backend/`:",
  "",
  "```cmd",
  "npx wrangler d1 migrations list orderak-db --local",
  "npx wrangler d1 migrations apply orderak-db --local",
  "npx wrangler d1 migrations list orderak-db --remote",
  "npx wrangler d1 migrations apply orderak-db --remote",
  // The staging database is named, not addressed by binding. `orderak_db` is
  // the binding, and it is identical in staging and production - the one
  // identifier that cannot distinguish the two environments. Passing it here
  // resolved by wrangler's binding fallback, which made a command that reads
  // as environment-specific depend on --env alone to be right.
  "npx wrangler d1 migrations list orderak-db-staging --env staging --remote",
  "npx wrangler d1 migrations apply orderak-db-staging --env staging --remote",
  "```",
  "",
  "> Do not execute individual migration files with `wrangler d1 execute`. Some SQL",
  "> files retain old command comments for historical context, but direct execution",
  "> bypasses Wrangler's migration ledger and can cause schema drift or duplicate work.",
  "",
  "**Migration sequence warning:** The directory contains both",
  "`015_order_no_unique.sql` and `015_seed_app_screens.sql`. They are distinct",
  "migration filenames and both must be recorded by Wrangler. Do not rename an",
  "already-applied migration without reconciling the migration ledger first.",
  "",
  "**Wrangler trigger replay note:** The lowercase `end` terminators in",
  "`026_order_integrity.sql` are intentional. Wrangler must preserve the",
  "trigger's final semicolon when replaying a fresh remote D1 database.",
  "",
  "## Contents",
  "",
  ...names.map((name) => `- [${name}](#${anchor(name)})`),
  "",
];

for (const name of names) {
  const source = relative(repoDir, join(migrationsDir, name)).replaceAll("\\", "/");
  lines.push(
    `## ${name}`,
    "",
    `**Source:** \`${source}\``,
    "",
    "### What it does",
    "",
    ...descriptions[name].map((item) => `- ${item}`),
    "",
  );
}

await writeFile(outputPath, `${lines.join("\n").trimEnd()}\n`, "utf8");
console.log(`Wrote ${outputPath} with ${names.length} migration sections.`);
