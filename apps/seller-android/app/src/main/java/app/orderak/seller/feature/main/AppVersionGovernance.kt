package app.orderak.seller.feature.main

import app.orderak.seller.data.remote.AppVersionPolicy

internal enum class VersionUiMode { NONE, WARNING, FORCE_UPDATE, BLOCKED, MAINTENANCE, STALE_WARNING }

internal fun versionUiMode(policy: AppVersionPolicy?, configAgeMs: Long?): VersionUiMode {
    if (policy == null || policy.status == "ok") return VersionUiMode.NONE
    val stale = configAgeMs == null || configAgeMs > MAX_BLOCKING_CONFIG_AGE_MS
    if (stale && policy.status in blockingStatuses) return VersionUiMode.STALE_WARNING
    return when (policy.status) {
        "warning" -> VersionUiMode.WARNING
        "force_update" -> VersionUiMode.FORCE_UPDATE
        "blocked" -> VersionUiMode.BLOCKED
        "maintenance" -> VersionUiMode.MAINTENANCE
        else -> VersionUiMode.NONE
    }
}

private val blockingStatuses = setOf("force_update", "blocked", "maintenance")
internal const val MAX_BLOCKING_CONFIG_AGE_MS = 24L * 60L * 60L * 1000L
