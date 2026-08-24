import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * The test database is built from `migrations/`, not from a schema written out
 * again in the test helpers.
 *
 * It used to be the latter, and the cost was invisible until a migration
 * renamed nine money columns and all 246 tests stayed green: the suite was
 * asserting against a schema that no longer resembled the one the Workers
 * actually run on. A hand-maintained copy of a schema does not drift loudly —
 * it drifts into a passing test run, which is the worst place for it to go.
 *
 * Reading the real migrations means a migration that breaks a query now breaks
 * a test, and a migration that fails to apply fails the suite rather than
 * production.
 */
const migrations = await readD1Migrations("./migrations");
const geoMigrations = await readD1Migrations("./geo-migrations");

export default defineConfig({
	test: {
		// Istanbul, because that is the provider this package depends on.
		// Vitest defaults to v8, so `vitest run --coverage` failed outright with
		// "MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'" — the
		// declared devDependency was unusable and coverage could not be measured
		// at all. v8 coverage is also unreliable under the Workers pool, which
		// runs tests inside workerd rather than in Node.
		coverage: {
			provider: "istanbul",
			reporter: ["text-summary", "html", "json-summary"],
			include: ["src/**/*.ts"],
			exclude: ["src/generated/**", "src/**/*.d.ts"],
		},
	},
	plugins: [
		cloudflareTest({
			remoteBindings: false,
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				r2Buckets: ["orderak_audit"],
				bindings: {
					// Read in Node above and applied inside the Workers runtime by
					// createSchema(). Bindings must be JSON, and D1Migration is
					// `{ name, queries }`, so it crosses the boundary as-is.
					TEST_MIGRATIONS: migrations,
					TEST_GEO_MIGRATIONS: geoMigrations,
					DEPLOYMENT_ENVIRONMENT: "test",
					// Tests register stores without Firebase OTP; production
					// fails closed when FIREBASE_WEB_API_KEY is unset.
					ALLOW_UNVERIFIED_REGISTRATION: "true",
					// Existing AI contract tests exercise the enabled path. Dedicated
					// tests verify that production's default-off flags fail closed.
					AI_ASSISTANT_ENABLED: "true",
					BILLING_ENABLED: "true",
					GOOGLE_PLAY_LIFECYCLE_ENABLED: "true",
					AI_MONTHLY_BUDGET_MICRO_USD: "100000000",
					DEEPSEEK_INPUT_MICRO_USD_PER_MILLION: "100000",
					DEEPSEEK_OUTPUT_MICRO_USD_PER_MILLION: "200000",
					LOCAL_ADMIN_ENABLED: "true",
					// Admin sessions derive their pepper from ADMIN_SESSION_PEPPER, falling
					// back to ADMIN_JWT_SECRET while LOCAL_ADMIN_ENABLED is true. Neither
					// was provided here, so the pepper resolved to null and every admin
					// session failed to verify - the admin specs passed only on a machine
					// with a .dev.vars file and returned 401 instead of 403 in CI, where
					// .dev.vars is gitignored. Fixed values keep the suite self-contained.
					// Test-only; the real secrets are Wrangler secrets and are not here.
					ADMIN_JWT_SECRET: "test-admin-jwt-secret-not-a-real-credential",
					ADMIN_API_KEY: "test-admin-api-key-not-a-real-credential",
				},
			},
		}),
	],
});
