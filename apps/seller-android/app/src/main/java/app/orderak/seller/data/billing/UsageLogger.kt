package app.orderak.seller.data.billing

import android.util.Log
import app.orderak.seller.BuildConfig
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Logs premium feature usage.
 * In production, this would send events to Analytics (Firebase/Mixpanel).
 */
@Singleton
class UsageLogger @Inject constructor() {
    fun logFeatureAttempt(feature: Feature, planKey: String, success: Boolean) {
        if (BuildConfig.DEBUG) {
            val status = if (success) "ALLOWED" else "DENIED"
            Log.d("UsageLogger", "Feature: ${feature.name} | Plan: $planKey | Status: $status")
        }
        // TODO: firebaseAnalytics.logEvent("feature_usage") { ... }
    }
}
