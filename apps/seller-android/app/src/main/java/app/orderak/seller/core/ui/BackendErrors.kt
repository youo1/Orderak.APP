package app.orderak.seller.core.ui

import androidx.annotation.StringRes
import app.orderak.seller.R

/** Maps stable backend error codes to Android-owned localized UI messages. */
@StringRes
fun backendErrorResource(code: String?): Int = when {
    code == "auth" -> R.string.error_auth
    code == "slug_taken" -> R.string.error_slug_taken
    code == "rate_limited" -> R.string.error_rate_limited
    code == "plan_limit_reached" || code == "plan_feature_unavailable" -> R.string.error_plan_limit
    code == "firebase_not_configured" || code?.startsWith("http_5") == true -> R.string.error_service_unavailable
    code == "not_found" -> R.string.error_not_found
    code == "network" -> R.string.error_network
    else -> R.string.error_unknown
}
