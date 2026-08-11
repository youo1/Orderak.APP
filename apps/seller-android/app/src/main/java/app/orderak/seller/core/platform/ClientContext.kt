package app.orderak.seller.core.platform

/** Platform-neutral metadata attached to authenticated seller requests. */
data class ClientContext(
    val installationId: String,
    val deviceLabel: String,
    val platform: String,
    val appVersion: String,
    val versionCode: Long,
)

/** Boundary between the HTTP client and Android-specific device APIs. */
interface ClientContextProvider {
    suspend fun current(): ClientContext
    fun newRequestId(): String
}
