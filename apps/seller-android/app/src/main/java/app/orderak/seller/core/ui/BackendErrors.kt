package app.orderak.seller.core.ui

import androidx.annotation.StringRes
import app.orderak.seller.R

/**
 * Maps stable backend error codes to Android-owned localized UI messages.
 *
 * WHY THIS GREW
 *   It used to map seven codes, and everything else fell to "something went
 *   wrong". The backend goes to real trouble to answer with a stable,
 *   actionable code and a `message` naming the remedy — and every code that
 *   mattered landed in the default: a payment method the store has not
 *   configured, a catalogue this device is behind on, a stock count that moved
 *   under the seller, a file too large to upload. The seller was told nothing
 *   they could act on, about failures they could all have fixed.
 *
 * WHY CODES ARE GROUPED RATHER THAN MAPPED ONE TO ONE
 *   A code is the server naming a condition precisely, for a program. A message
 *   is the app telling a person what to do about it, and several conditions
 *   often have one answer — `unsupported_type` and `file_required` both mean
 *   "pick a different image". One message per distinct remedy keeps the copy
 *   honest and keeps the translator's job finite.
 *
 * WHY [MAPPED_CODES] AND [INTENTIONALLY_GENERIC] ARE PUBLIC
 *   So the pairing can be asserted rather than assumed. The backend's own error
 *   codes are extracted to `contracts/error-codes/seller-v1.json`, and
 *   BackendErrorCoverageTest fails when the server gains a code this file has
 *   never heard of. A code that genuinely has no better answer than the generic
 *   one is listed below, deliberately, rather than falling through silently —
 *   the difference between a decision and an omission.
 */
@StringRes
fun backendErrorResource(code: String?): Int = when {
    code == null -> R.string.error_unknown

    // ---- Identity and session ----
    code in AUTH -> R.string.error_auth
    code == "account_restricted" -> R.string.error_account_restricted
    code == "client_version_refused" -> R.string.error_client_version_refused
    code in ONBOARDING_RESTART -> R.string.error_onboarding_restart
    code in PASSKEY -> R.string.error_passkey
    code == "phone_already_used" -> R.string.error_phone_already_used
    code in PHONE_CHANGE -> R.string.error_phone_change

    // ---- Plan and entitlement boundaries ----
    code in PLAN -> R.string.error_plan_limit

    // ---- Orders ----
    code == "payment_unavailable" -> R.string.error_payment_unavailable
    code == "orders_disabled" -> R.string.error_orders_disabled
    code == "buyer_restricted" -> R.string.error_buyer_restricted
    code in STOCK -> R.string.error_stock_changed
    code in PRODUCT_MISSING -> R.string.error_product_missing
    code in CURRENCY -> R.string.error_currency
    code == "invalid_transition" || code == "conflict" -> R.string.error_order_moved

    // ---- Catalogue sync ----
    code in CATALOG_STALE -> R.string.error_catalog_out_of_date
    code == "bulk_deletion_unconfirmed" -> R.string.error_catalog_bulk_delete

    // ---- Uploads ----
    code in TOO_LARGE -> R.string.error_too_large
    code in UNSUPPORTED_FILE -> R.string.error_unsupported_file

    // ---- Operations surface ----
    code == "ticket_closed" -> R.string.error_ticket_closed
    code == "primary_device_cannot_be_revoked" -> R.string.error_primary_device
    code == "phone_not_editable" -> R.string.error_phone_not_editable

    // ---- Availability ----
    code in UNAVAILABLE -> R.string.error_service_unavailable
    code.startsWith("http_5") -> R.string.error_service_unavailable
    code == "rate_limited" -> R.string.error_rate_limited

    // ---- Everything else the seller can act on ----
    code == "slug_taken" -> R.string.error_slug_taken
    code == "not_found" || code == "verification_not_found" -> R.string.error_not_found
    code == "network" -> R.string.error_network
    code in REFERRAL -> R.string.error_referral
    code in INVALID_REQUEST -> R.string.error_invalid_request

    else -> R.string.error_unknown
}

private val AUTH = setOf(
    "auth", "auth_stale", "recent_auth_required", "unauthorized",
    "onboarding_auth", "weak_device_secret",
)
private val ONBOARDING_RESTART = setOf(
    "onboarding_expired", "onboarding_inconsistent", "onboarding_complete",
    "onboarding_complete_failed", "account_step_required",
)
private val PASSKEY = setOf(
    "passkey_verification_failed", "passkey_not_found", "passkey_challenge_expired",
    "passkey_challenge_mismatch", "passkey_challenge_replayed", "expired_challenge",
    "invalid_challenge", "replayed_challenge", "invalid_passkey_response",
    "passkey_origin_not_configured",
)
private val PHONE_CHANGE = setOf(
    "phone_change_disabled", "phone_change_requires_reverification",
    "new_phone_mismatch", "current_proof_mismatch", "phone_country_unavailable",
    "country_mismatch",
)
private val PLAN = setOf(
    "plan_limit_reached", "plan_feature_unavailable", "plan_feature_required",
    "plan_not_found", "no_active_subscription",
)
private val STOCK = setOf("stock_changed", "stale_stock", "insufficient_stock")
private val PRODUCT_MISSING = setOf("products", "duplicate_products")
private val CURRENCY = setOf("currency_not_enabled", "mixed_currency_order")
private val CATALOG_STALE = setOf("stale_catalog", "catalog_baseline_required")
private val TOO_LARGE = setOf("file_too_large", "request_body_too_large", "message_too_long")
private val UNSUPPORTED_FILE = setOf("unsupported_type", "file_required", "invalid_form")
private val UNAVAILABLE = setOf(
    "firebase_not_configured", "feature_disabled", "ai_temporarily_unavailable",
    "identity_not_ready", "legal_not_configured", "entitlements_not_ready",
    "billing_lifecycle_disabled", "tenant_unavailable", "tenant_read_only",
    "tenant_write_fenced", "server", "city_catalog_unavailable", "taxonomy_unavailable",
    "email_not_configured", "payment_gateway_unavailable", "asset_links_not_configured",
)

/**
 * Anything the seller can fix by correcting what they typed.
 *
 * A long list on purpose. Each of these is the server naming one field it could
 * not accept, and the screens that own those fields validate them before they
 * send — so reaching this map at all usually means the two validations
 * disagree. One honest "check these details" beats twenty near-identical
 * sentences nobody will read, and the server's own `message` carries the
 * specifics for a support conversation.
 */
private val INVALID_REQUEST = setOf(
    "invalid", "invalid_json", "invalid_json_body", "validation_failed",
    "name_required", "no_fields", "subject_and_message_required",
    "message_required", "message_is_required", "status_required",
    "idempotency_key_required", "products_required", "purchase_token_required",
    "duplicate_app_id", "duplicate_remote_uuid", "invalid_client_platform",
    "invalid_app_version", "invalid_request_id", "invalid_version_code",
    "invalid_phone_country", "legal_acceptance_required", "slug_invalid", "method",
    "code_required", "invalid_code", "invalid_email", "email_in_use",
    "invalid_full_name", "invalid_birth_year", "invalid_store_name", "invalid_slug",
    "invalid_business_category", "invalid_category", "invalid_city", "invalid_country",
    "invalid_language", "invalid_label", "invalid_limit", "invalid_query", "invalid_url",
    "unexpected_query_parameter", "event_key_required", "ad_id_required",
)

/** Referral and coupon entry, which the seller retypes rather than retries. */
private val REFERRAL = setOf(
    "already_referred", "cannot_refer_self", "coupon_invalid",
)

/** Every code this file answers with something other than the generic message. */
val MAPPED_CODES: Set<String> =
    AUTH + ONBOARDING_RESTART + PASSKEY + PHONE_CHANGE + PLAN + STOCK +
        PRODUCT_MISSING + CURRENCY + CATALOG_STALE + TOO_LARGE + UNSUPPORTED_FILE +
        UNAVAILABLE + INVALID_REQUEST + REFERRAL + setOf(
        "account_restricted", "client_version_refused", "payment_unavailable",
        "orders_disabled", "buyer_restricted", "invalid_transition", "conflict",
        "bulk_deletion_unconfirmed", "ticket_closed", "primary_device_cannot_be_revoked",
        "phone_not_editable", "phone_already_used", "rate_limited", "slug_taken",
        "not_found", "verification_not_found", "network",
    )

/**
 * Codes the seller cannot act on, where the generic message is the honest answer.
 *
 * Listed rather than left to fall through, so that "we thought about this one"
 * and "we have never seen this one" stay different states.
 */
val INTENTIONALLY_GENERIC: Set<String> = setOf(
    // Internal bookkeeping the seller never causes and cannot fix.
    "rtdn_persistence_failed", "play_verification_failed", "verification_superseded",
    "package_mismatch", "could_not_generate_referral_code",
    // Admin-surface only: never reachable from a seller credential.
    "invalid_content_config", "admin_key_required", "forbidden",
    // Machine-to-machine surfaces. The integrations API answers Google Play and
    // the payment gateway, never this app, so a seller-facing sentence for one
    // of these would be a sentence no seller can ever be shown. (Its path is
    // deliberately not written here: verifySellerApiContract forbids any API
    // literal outside the v1 seller prefix anywhere in main source, comments
    // included, and that bluntness is the point of the guard.)
    "invalid_webhook", "invalid_pubsub_message", "missing_sub_id",
    // Ad serving degrades silently by design — an advert that cannot be shown
    // or tracked is not a failure the seller is told about.
    "ad_not_found", "ad_not_eligible",
)
