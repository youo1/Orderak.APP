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
    /**
     * Keyed counterpart for gates addressed by catalogue key.
     *
     * Carries the reason, not just the outcome: "denied" is not actionable,
     * while UnknownKey, NotImplemented and PlanExcluded each point at a
     * different fix — a mis-seeded snapshot, a catalogue status, or a plan.
     */
    fun logKeyedFeatureAttempt(key: String, planKey: String, availability: String, reason: String) {
        if (BuildConfig.DEBUG) {
            Log.d("UsageLogger", "Feature: $key | Plan: $planKey | $availability ($reason)")
        }
        // TODO: firebaseAnalytics.logEvent("feature_usage") { ... }
    }
}
