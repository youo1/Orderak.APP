// Bindings and non-secret vars come from Wrangler-generated interfaces in
// src/generated. Only secrets and local/test-only values are augmented here.
//
// The secrets live in their own interface so they can be mixed into *both*
// shapes that reference them:
//   * the global `Env`, which application code uses;
//   * `Cloudflare.Env`, which `@cloudflare/vitest-pool-workers` exports as the
//     type of `env` from "cloudflare:test" (it dropped `ProvidedEnv` in 0.18).
// Declaring them on the global `Env` alone leaves every secret invisible to
// the test suite.
interface OrderakSecrets {
	ADMIN_BREAK_GLASS_IP_ALLOWLIST?: string;
	ADMIN_SESSION_PEPPER?: string;
	ADMIN_RECOVERY_PEPPER?: string;
	ADMIN_TOTP_KEY_CURRENT?: string;
	/**
	 * Which audit signing key version new archives are signed with. Defaults
	 * to 1. Mirrors ADMIN_TOTP_KEY_CURRENT deliberately: the same
	 * version-selector-as-a-var idiom already exists in this codebase for
	 * TOTP, and a second mechanism for the same shape of problem would be one
	 * more thing to learn for no benefit.
	 */
	ADMIN_AUDIT_KEY_CURRENT?: string;
	ADMIN_TOTP_KEY_V1?: string;
	ADMIN_TOTP_KEY_V2?: string;
	ADMIN_EXPORT_SIGNING_KEY?: string;
	/**
	 * Version 1 of the audit archive signing key. Named without a version
	 * suffix because it predates versioning and every archive written before
	 * migration 043 was signed with it — renaming would have required
	 * re-signing history to keep it verifiable.
	 */
	ADMIN_AUDIT_SIGNING_KEY?: string;
	/** Version 2. Set this, then move ADMIN_AUDIT_KEY_CURRENT to "2". */
	ADMIN_AUDIT_KEY_V2?: string;
	BUYER_PRIVACY_PEPPER?: string;
	PAYMENT_WEBHOOK_SECRET?: string;
	STRIPE_SECRET_KEY?: string;
	DEEPSEEK_API_KEY?: string;
	FIREBASE_WEB_API_KEY?: string;
	// FIREBASE_PROJECT_ID is a plain var in wrangler.jsonc, so the generated
	// bindings already declare it as a required string. Re-declaring it
	// optional here made the two Env shapes structurally incompatible.
	FIREBASE_SERVICE_ACCOUNT_EMAIL?: string;
	FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
	GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL?: string;
	GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
	GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY?: string;
	GOOGLE_PLAY_PUBSUB_AUDIENCE?: string;
	GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL?: string;
	DEEPSEEK_INPUT_MICRO_USD_PER_MILLION?: string;
	DEEPSEEK_OUTPUT_MICRO_USD_PER_MILLION?: string;
	LOCAL_ADMIN_ENABLED?: string;
	ALLOW_UNVERIFIED_REGISTRATION?: string;
	EMAIL_FROM?: string;
	WEBAUTHN_ANDROID_ORIGINS?: string;
	WEBAUTHN_RP_ID?: string;
	WEBAUTHN_WEB_ORIGIN?: string;
	ANDROID_RELEASE_SHA256_CERT_FINGERPRINTS?: string;
	FORWARD_TO?: string;
}

/**
 * Bindings both Workers actually have.
 *
 * `Env` used to extend PublicWorkerBindings *and* AdminWorkerBindings, which
 * unioned two trust boundaries into one type: code running in the public Worker
 * type-checked against `env.orderak_audit` (the admin audit bucket),
 * `env.ADMIN_EXPORT_QUEUE` and `env.ADMIN_TOTP_KEY_CURRENT` — admin MFA key
 * material — and only failed at runtime, where the binding is simply absent.
 * A type union across a trust boundary defeats the isolation the two-Worker
 * split exists to provide.
 *
 * Deriving the common surface from the generated interfaces keeps it honest: a
 * binding added to one Worker does not silently become visible to the other,
 * and one added to both appears here automatically.
 */
type CommonBindings = Pick<
	PublicWorkerBindings,
	Extract<keyof PublicWorkerBindings, keyof AdminWorkerBindings>
>;

/**
 * The shared surface, for platform and domain code that runs under either
 * Worker. Both PublicWorkerEnv and AdminWorkerEnv are assignable to it, so shared helpers
 * keep taking `Env` unchanged.
 */
type Env = CommonBindings & OrderakSecrets;

/** The public Worker's bindings — adds orderak_geo, RATE_LIMITER, and the onboarding flags. */
type PublicWorkerEnv = PublicWorkerBindings & OrderakSecrets;

/** The admin Worker's bindings — adds orderak_audit, ADMIN_EXPORT_QUEUE, ADMIN_ORIGIN, ADMIN_TOTP_KEY_CURRENT. */
type AdminWorkerEnv = AdminWorkerBindings & OrderakSecrets;

// Interface merging: adds the secrets to the `Cloudflare.Env` that the two
// generated binding files already contribute to.
declare namespace Cloudflare {
	interface Env extends OrderakSecrets {}
}

interface AdminExportMessage {
	exportId: string;
	requestedBy: number;
}

interface PlayBillingQueueMessage {
	version: 1;
	jobId: string;
}
