package app.orderak.seller.data.remote
import app.orderak.seller.core.network.Backend
import app.orderak.seller.core.locale.AppLocales
import app.orderak.seller.core.network.ApiRoutes
import app.orderak.seller.core.network.NetworkJson
import app.orderak.seller.core.platform.ClientContextProvider
import app.orderak.seller.data.session.SessionRouteMonitor
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// ---- DTOs (بتطابق JSON بتاع الـ Worker) ----

@Serializable
data class RegisterReq(
    val phone: String, val secret: String, val shop_name: String,
    val instapay: String? = null, val vfcash: String? = null, val slug: String? = null,
    val country_iso: String? = null,
    // Firebase ID token — required by the backend to create a NEW store (proves the
    // caller passed OTP for this phone). Ignored when updating an existing store.
    val id_token: String? = null,
)

@Serializable
data class RegisterRes(
    val ok: Boolean = false,
    val slug: String? = null,
    val store_code: String? = null,
    val country_code: String? = null,
    val public_identifier: String? = null,
    val store_url: String? = null,
    @SerialName("code") val error: String? = null,
)

@Serializable
data class ProductDto(
    val app_id: Long, val name: String, val price_piasters: Long,
    val stock: Int, val available: Boolean,
    val description: String? = null,
    val image_url: String? = null,
    val category_code: String? = null,
    val stock_dirty: Boolean = false,
    val expected_stock_version: Long? = null,
)

@Serializable
data class ProductsSyncReq(val phone: String, val secret: String, val products: List<ProductDto>)

/** Per-product identity assigned by the backend (immutable product_code). */
@Serializable
data class ProductCodeDto(
    val app_id: Long,
    val product_code: String,
    val remote_uuid: String? = null,
    val stock: Int = 0,
    val stock_version: Long = 0,
    val category_code: String? = null,
)

@Serializable
data class ProductsSyncRes(
    val ok: Boolean = false, val count: Int = 0,
    val products: List<ProductCodeDto> = emptyList(),
    val conflicts: List<Long> = emptyList(),
    @SerialName("code") val error: String? = null,
)

// ---- Store Information ----

@Serializable
data class StoreDto(
    val store_name: String? = null, val slug: String? = null,
    val country_code: String? = null, val store_code: String? = null,
    val public_identifier: String? = null, val store_url: String? = null,
    val description: String? = null, val phone: String? = null,
    val whatsapp: String? = null, val email: String? = null,
    val website: String? = null, val address: String? = null,
    val instapay: String? = null, val vfcash: String? = null,
    val logo_url: String? = null, val cover_url: String? = null,
    val business_category: String? = null,
    val business_category_id: String? = null,
    val business_subcategory_id: String? = null,
    val business_taxonomy_version: Int? = null,
    val city_geoname_id: Long? = null,
    val city_catalog_id: Long? = null,
    val city_catalog_version: String? = null,
    val city_name: String? = null,
)

@Serializable
data class StoreRes(val ok: Boolean = false, val store: StoreDto? = null, @SerialName("code") val error: String? = null)

@Serializable
data class RestoreSessionReq(
    val id_token: String,
    val phone: String,
    val device_secret: String,
    val terms_accepted: Boolean,
    val marketing_consent: Boolean,
    val app_version: String,
)

@Serializable
data class RestoreSessionRes(
    val ok: Boolean = false,
    val exists: Boolean = false,
    val store: StoreDto? = null,
    @SerialName("code") val error: String? = null,
)

// ---- Auth & onboarding V2 ----

@Serializable
data class PhoneCompleteReq(
    val id_token: String,
    val phone: String,
    val device_secret: String,
    val phone_country_iso: String? = null,
)

@Serializable
data class AuthCompleteRes(
    val ok: Boolean = false,
    val exists: Boolean = false,
    val phone: String? = null,
    val store: StoreDto? = null,
    val onboarding_token: String? = null,
    val expires_at: String? = null,
    val absolute_expires_at: String? = null,
    val recent_auth_token: String? = null,
    val recent_auth_expires_at: String? = null,
    val passkey_invite: Boolean = false,
    val passkey_registration_available: Boolean = false,
    val email_verification_pending: Boolean = false,
    @SerialName("code") val error: String? = null,
)

@Serializable
data class OnboardingAccountReq(
    val full_name: String,
    val birth_year: Int,
    val email: String? = null,
    val terms_accepted: Boolean = true,
    val app_version: String,
)

@Serializable
data class OnboardingAccountRes(
    val ok: Boolean = false,
    val step: Int? = null,
    val completed: Boolean = false,
    @SerialName("code") val error: String? = null,
)

@Serializable
data class OnboardingCompleteReq(
    val device_secret: String,
    val store_name: String,
    val slug: String,
    val business_category: String,
    val business_category_id: String,
    val business_subcategory_id: String? = null,
    val country_iso: String,
    val city_geoname_id: Long? = null,
    val city_catalog_id: Long? = null,
    val city_name: String,
)

@Serializable
data class PasskeyOptionsRes(
    val ok: Boolean = false,
    val challenge_id: String? = null,
    val options_json: String? = null,
    @SerialName("code") val error: String? = null,
)

@Serializable
data class PasskeyAuthenticationCompleteReq(
    val challenge_id: String,
    val response: kotlinx.serialization.json.JsonObject,
    val device_secret: String,
)

@Serializable
data class PasskeyRegistrationCompleteReq(
    val challenge_id: String,
    val response: kotlinx.serialization.json.JsonObject,
    val label: String? = null,
)

@Serializable
data class PasskeyMutationRes(
    val ok: Boolean = false,
    val id: String? = null,
    @SerialName("code") val error: String? = null,
)

@Serializable
data class PasskeyDto(
    val id: String,
    val label: String? = null,
    val device_type: String? = null,
    val backed_up: Boolean = false,
    val created_at: String? = null,
    val last_used_at: String? = null,
)

@Serializable
data class PasskeysRes(
    val ok: Boolean = false,
    val passkeys: List<PasskeyDto> = emptyList(),
    @SerialName("code") val error: String? = null,
)

@Serializable
data class PasskeyLabelReq(val label: String)

@Serializable
data class GeoCityDto(
    val geoname_id: Long,
    val name: String,
    val ascii_name: String,
    val country_iso: String,
    val admin1_code: String? = null,
    val population: Long = 0,
)

@Serializable
data class GeoAttributionDto(
    val name: String = "GeoNames",
    val url: String = "https://www.geonames.org/",
    val license: String = "CC BY 4.0",
)

@Serializable
data class GeoCitiesRes(
    val ok: Boolean = false,
    val cities: List<GeoCityDto> = emptyList(),
    val attribution: GeoAttributionDto? = null,
    @SerialName("code") val error: String? = null,
)

@Serializable
data class CityCatalogSuggestionDto(
    val city_id: Long,
    val name: String,
    val canonical_name: String,
    val native_name: String? = null,
    val state_name: String? = null,
    val country_iso: String,
)

@Serializable
data class CityCatalogAttributionDto(
    val name: String = "Countries States Cities Database",
    val url: String = "https://github.com/dr5hn/countries-states-cities-database",
    val license: String = "ODbL-1.0",
    val license_url: String = "https://opendatacommons.org/licenses/odbl/1-0/",
)

@Serializable
data class CityCatalogSearchRes(
    val ok: Boolean = false,
    val cities: List<CityCatalogSuggestionDto> = emptyList(),
    val attribution: CityCatalogAttributionDto? = null,
    val manual_entry_allowed: Boolean = false,
    @SerialName("code") val error: String? = null,
)

@Serializable
data class CityCatalogSelectReq(
    val city_id: Long,
    val language: String,
)

@Serializable
data class CityCatalogSelectRes(
    val ok: Boolean = false,
    val city: CityCatalogSuggestionDto? = null,
    val attribution: CityCatalogAttributionDto? = null,
    val manual_entry_allowed: Boolean = false,
    @SerialName("code") val error: String? = null,
)

@Serializable
data class BusinessCategoryDto(
    val id: String,
    val key: String,
    val name: String,
    val version: Int,
)

@Serializable
data class BusinessCategoriesRes(
    val ok: Boolean = false,
    val version: Int? = null,
    val categories: List<BusinessCategoryDto> = emptyList(),
    @SerialName("code") val error: String? = null,
)

@Serializable
data class BusinessSubcategoryDto(
    val id: String,
    val category_id: String,
    val key: String,
    val name: String,
    val version: Int,
)

@Serializable
data class BusinessSubcategoriesRes(
    val ok: Boolean = false,
    val version: Int? = null,
    val subcategories: List<BusinessSubcategoryDto> = emptyList(),
    @SerialName("code") val error: String? = null,
)

@Serializable
data class StoreUpdateReq(
    val store_name: String? = null, val slug: String? = null,
    val description: String? = null, val phone: String? = null,
    val whatsapp: String? = null, val email: String? = null,
    val website: String? = null, val address: String? = null,
    val instapay: String? = null, val vfcash: String? = null,
    val logo_url: String? = null, val cover_url: String? = null,
    val business_category_id: String? = null,
    val business_subcategory_id: String? = null,
)

// ---- Categories ----

@Serializable
data class CategoryDto(
    val category_code: String, val name: String,
    val slug: String? = null, val sort_order: Int = 0, val product_count: Int = 0,
)

@Serializable
data class CategoriesRes(val ok: Boolean = false, val categories: List<CategoryDto> = emptyList(), @SerialName("code") val error: String? = null)

@Serializable
data class CategoryReq(val name: String, val slug: String? = null, val sort_order: Int? = null)

@Serializable
data class CategoryRes(val ok: Boolean = false, val category: CategoryDto? = null, @SerialName("code") val error: String? = null)

@Serializable
data class MediaRes(val ok: Boolean = false, val url: String? = null, val key: String? = null, @SerialName("code") val error: String? = null)

@Serializable
data class OkRes(val ok: Boolean = false, @SerialName("code") val error: String? = null)

@Serializable
data class RemoteItem(
    val product_id: String? = null,     // server product UUID
    val product_code: String? = null,   // immutable public code (maps to local product)
    val product_name: String,
    val qty: Int, val price_piasters: Long,
)

@Serializable
data class RemoteOrder(
    val id: String,                      // server order UUID
    val order_no: Long = 0,              // human-friendly per-store number (sync cursor)
    val buyer_phone: String, val buyer_name: String? = null,
    val status: String = "NEW", val pay_method: String = "COD",
    val total_piasters: Long, val note: String? = null,
    val created_at: String? = null, val items: List<RemoteItem> = emptyList(),
)

@Serializable
data class OrdersRes(
    val ok: Boolean = false,
    val orders: List<RemoteOrder> = emptyList(),
    // Piggybacked plan config (perf: saves a separate /api/v1/config call each sync).
    val config: ConfigRes? = null,
    val has_more: Boolean = false,
    val next_since: Long? = null,
    @SerialName("code") val error: String? = null,
)

@Serializable
data class ChatReq(val message: String)

@Serializable
data class ChatRes(val reply: String? = null, @SerialName("code") val error: String? = null)

// ---- Operations coverage ----

@Serializable data class AccountStatusRes(val ok: Boolean = false, val status: String = "active", @SerialName("code") val error: String? = null)
@Serializable data class DeletionRequestDto(val id: String, val status: String, val requested_at: String? = null, val deadline_at: String? = null, val verified_at: String? = null, val completed_at: String? = null, val notes: String? = null)
@Serializable data class DeletionStatusRes(val ok: Boolean = false, val request: DeletionRequestDto? = null, @SerialName("code") val error: String? = null)
@Serializable data class SupportTicketDto(val id: Long, val subject: String, val status: String, val priority: String = "normal", val last_message: String? = null, val created_at: String? = null, val updated_at: String? = null)
@Serializable data class SupportMessageDto(val id: Long, val sender: String, val body: String, val created_at: String? = null)
@Serializable data class SupportTicketsRes(val ok: Boolean = false, val tickets: List<SupportTicketDto> = emptyList(), val ticket: SupportTicketDto? = null, val messages: List<SupportMessageDto> = emptyList(), @SerialName("code") val error: String? = null)
@Serializable data class SupportCreateReq(val subject: String, val message: String)
@Serializable data class SupportReplyReq(val message: String)
@Serializable data class AnnouncementDto(val id: Long, val title_i18n: String, val body_i18n: String, val starts_at: String? = null, val ends_at: String? = null, val is_read: Boolean = false)
@Serializable data class AnnouncementsRes(val ok: Boolean = false, val announcements: List<AnnouncementDto> = emptyList(), @SerialName("code") val error: String? = null)
@Serializable data class ProductTranslationDto(val product_code: String, val source_name: String, val source_description: String? = null, val lang: String, val name: String? = null, val description: String? = null, val translation_status: String = "missing", val provider: String? = null, val reviewed_at: String? = null, val updated_at: String? = null)
@Serializable data class ProductTranslationsRes(val ok: Boolean = false, val translations: List<ProductTranslationDto> = emptyList(), @SerialName("code") val error: String? = null)
@Serializable data class ProductTranslationReq(val name: String, val description: String? = null)
@Serializable data class DeviceDto(val row_id: Long, val device_id: String? = null, val device_label: String? = null, val platform: String? = null, val app_version: String? = null, val created_at: String? = null, val last_used_at: String? = null)
@Serializable data class DevicesRes(val ok: Boolean = false, val devices: List<DeviceDto> = emptyList(), @SerialName("code") val error: String? = null)
@Serializable data class SlugCheckRes(
    val ok: Boolean = false,
    val available: Boolean = false,
    val valid: Boolean = false,
    val reserved: Boolean = false,
    val suggestions: List<String> = emptyList(),
    @SerialName("code") val error: String? = null,
)
@Serializable data class AdDto(val id: Long, val title: String, val image_url: String, val click_url: String? = null, val type: String = "banner", val frequency: Int = 1, val weight: Int = 1)
@Serializable data class AdsRes(val ok: Boolean = false, val ads_enabled: Boolean = false, val ads: List<AdDto> = emptyList(), @SerialName("code") val error: String? = null)
@Serializable data class AdTrackReq(val ad_id: Long, val kind: String, val event_key: String)

// ---- Config (plan limits + features from /api/v1/config) ----

@Serializable
data class ConfigRes(
    val ok: Boolean = false,
    val plan_id: String? = null,
    val plan_name: String? = null,
    val ads_enabled: Boolean = true,
    val limits: ConfigLimits? = null,
    val features: ConfigFeatures? = null,
    val governance: GovernanceConfig? = null,
    @SerialName("code") val error: String? = null,
)

@Serializable
data class EntitlementSnapshotRes(
    val ok: Boolean = false,
    val schema_version: Int = 1,
    val organization_id: String? = null,
    val plan_key: String = "free",
    val plan_name: String = "Free",
    val plan_revision_id: String? = null,
    val plan_version: Int = 0,
    val subscription_status: String = "active",
    val current_period_end: String? = null,
    val pending_revision_id: String? = null,
    val pending_effective_at: String? = null,
    val entitlements: Map<String, EntitlementDto> = emptyMap(),
    val governance: GovernanceConfig? = null,
    val server_time: String? = null,
    val etag: String? = null,
    @SerialName("code") val error: String? = null,
)

sealed interface EntitlementFetchResult {
    data class Updated(val snapshot: EntitlementSnapshotRes) : EntitlementFetchResult
    data class NotModified(val etag: String?) : EntitlementFetchResult
    data class Failed(val error: String) : EntitlementFetchResult
}

@Serializable
data class BillingProductDto(
    val plan_key: String,
    val name: String,
    val product_id: String,
    val base_plan_id: String,
    val price_snapshot_json: String? = null,
)

@Serializable
data class BillingCatalogRes(
    val ok: Boolean = false,
    val billing_enabled: Boolean = false,
    val lifecycle_enabled: Boolean = false,
    val products: List<BillingProductDto> = emptyList(),
    @SerialName("code") val error: String? = null,
)

@Serializable data class VerifyPlayPurchaseReq(val purchase_token: String)
@Serializable data class VerifyPlayPurchaseRes(
    val ok: Boolean = false,
    val pending: Boolean = false,
    val status: String? = null,
    val verification_id: String? = null,
    val retry_after_seconds: Long? = null,
    val purchase_status: String? = null,
    val entitlements: EntitlementSnapshotRes? = null,
    @SerialName("code") val error: String? = null,
)

/**
 * عميل HTTP بسيط للـ Worker.
 * Main-safe: all blocking work (request execution + body read + parsing input)
 * is confined to [io] internally, so callers may invoke from any dispatcher.
 */
@Singleton
class BackendApi @Inject constructor(
    private val client: OkHttpClient,
    private val sessionRouteMonitor: SessionRouteMonitor,
    private val clientContextProvider: ClientContextProvider,
) {
    // Not constructor-injected to avoid a Hilt qualifier for one binding;
    // swap to injection if a test ever needs a TestDispatcher here.
    private val io: CoroutineDispatcher = Dispatchers.IO

    private val json = NetworkJson.decoder
    private val mediaJson = "application/json; charset=utf-8".toMediaType()

    /**
     * Decode an API response, never swallowing cancellation.
     * Error taxonomy surfaced in DTO `error` fields:
     *  - "network"      transport failure (no connectivity, timeout, DNS…)
     *  - "http_<code>"  server returned 5xx, or 4xx without a JSON body
     *  - "bad_response" body was not decodable as the expected DTO
     *  - domain keys    (e.g. "slug_taken") passed through from 4xx JSON bodies
     */
    private suspend inline fun <reified T> apiCall(
        crossinline onError: (String) -> T,
        crossinline block: suspend () -> String,
    ): T = try {
        json.decodeFromString<T>(block())
    } catch (e: CancellationException) {
        throw e // never convert cancellation into an error result
    } catch (e: IOException) {
        val m = e.message
        onError(if (m != null && (m == "bad_response" || m.startsWith("http_"))) m else "network")
    } catch (e: Exception) {
        onError("bad_response")
    }

    private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
        enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                cont.resume(response)
            }
            override fun onFailure(call: Call, e: IOException) {
                if (cont.isCancelled) return
                cont.resumeWithException(e)
            }
        })
        cont.invokeOnCancellation { cancel() }
    }

    private fun Response.bodyOrThrow(): String {
        val raw = body?.string().orEmpty()
        reportSessionRouteSignal(raw)
        // 4xx responses carry a structured JSON error body (e.g. slug_taken,
        // plan_limit_reached, plan_feature_unavailable). Return it so the caller's
        // DTO can decode the `error` field and the UI can react. 5xx throws.
        // Fix: a 4xx whose body is empty or not JSON (proxy/gateway HTML page)
        // must NOT decode into a silent `ok=false, error=null` — synthesize
        // an "http_<code>" error instead. Never leak the raw body into messages.
        if (!isSuccessful) {
            if (code !in 400..499) throw IOException("http_$code")
            if (raw.isBlank() || !raw.trimStart().startsWith("{")) throw IOException("http_$code")
        }
        if (raw.isBlank()) throw IOException("bad_response")
        return raw
    }

    /**
     * Normal API DTO decoding still owns the response. This observer only
     * publishes stable backend auth codes from credentialed seller requests;
     * it never logs or forwards credential values or raw response bodies.
     */
    private fun Response.reportSessionRouteSignal(raw: String) {
        val sellerCredentialed = !request.header("x-orderak-phone").isNullOrBlank() &&
            !request.header("x-orderak-secret").isNullOrBlank()
        if (!sellerCredentialed || ApiRoutes.isV1(request.url.encodedPath, "account/status")) return
        if (code != 401 && code != 403) return

        val payload = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return
        val error = runCatching { payload["code"]?.jsonPrimitive?.contentOrNull }.getOrNull()
        when (error) {
            "auth" -> if (code == 401) sessionRouteMonitor.reportCredentialRejected()
            "account_restricted" -> if (code == 403) {
                val status = runCatching { payload["resource_status"]?.jsonPrimitive?.contentOrNull }.getOrNull()
                sessionRouteMonitor.reportRestricted(status)
            }
        }
    }

    /** Executes on [io]: OkHttp enqueue is async, but body.string() blocks. */
    private suspend fun execute(request: Request): String = withContext(io) {
        client.newCall(request).await().use { it.bodyOrThrow() }
    }

    private fun builder(path: String, headers: Map<String, String>) = Request.Builder()
        .url(Backend.BASE_URL + ApiRoutes.versioned(path))
        // The app UI locale is independent from seller-authored product text.
        // The Worker may use this only for optional messages and communication;
        // API decisions always use stable machine-readable codes.
        .header("Accept-Language", AppLocales.currentTag())
        .header("x-request-id", clientContextProvider.newRequestId())
        .apply { headers.forEach { (k, v) -> header(k, v) } }

    private suspend fun postRaw(path: String, body: String, headers: Map<String, String> = emptyMap()): String =
        execute(builder(path, headers).post(body.toRequestBody(mediaJson)).build())

    private suspend fun putRaw(path: String, body: String, headers: Map<String, String> = emptyMap()): String =
        execute(builder(path, headers).put(body.toRequestBody(mediaJson)).build())

    private suspend fun deleteRaw(path: String, headers: Map<String, String> = emptyMap()): String =
        execute(builder(path, headers).delete().build())

    private suspend fun getRaw(pathWithQuery: String, headers: Map<String, String> = emptyMap()): String =
        execute(builder(pathWithQuery, headers).get().build())

    /**
     * Build credential headers for seller API calls. Throws [IllegalStateException]
     * when phone or secret are blank — callers must gate on authenticated state.
     */
    private suspend fun creds(phone: String, secret: String): Map<String, String> {
        if (phone.isBlank() || secret.isBlank()) {
            throw IllegalStateException("BackendApi called without seller credentials")
        }
        val context = clientContextProvider.current()
        return mapOf(
            "x-orderak-phone" to phone,
            "x-orderak-secret" to secret,
            "x-orderak-device-id" to context.installationId,
            "x-orderak-device-label" to context.deviceLabel,
            "x-orderak-platform" to context.platform,
            "x-orderak-app-version" to context.appVersion,
            "x-orderak-version-code" to context.versionCode.toString(),
        )
    }

    suspend fun register(req: RegisterReq): RegisterRes =
        apiCall({ RegisterRes(error = it) }) { postRaw("/api/v1/register", json.encodeToString(req)) }

    suspend fun restoreSession(req: RestoreSessionReq): RestoreSessionRes =
        apiCall({ RestoreSessionRes(error = it) }) { postRaw("/api/v1/auth/session", json.encodeToString(req)) }

    suspend fun completePhoneAuth(req: PhoneCompleteReq): AuthCompleteRes =
        apiCall({ AuthCompleteRes(error = it) }) {
            postRaw("/api/v1/auth/phone/complete", json.encodeToString(req))
        }

    suspend fun saveOnboardingAccount(token: String, req: OnboardingAccountReq): OnboardingAccountRes =
        apiCall({ OnboardingAccountRes(error = it) }) {
            postRaw(
                "/api/v1/onboarding/account",
                json.encodeToString(req),
                mapOf("authorization" to "Bearer $token"),
            )
        }

    suspend fun completeOnboarding(
        token: String,
        idempotencyKey: String,
        req: OnboardingCompleteReq,
    ): AuthCompleteRes = apiCall({ AuthCompleteRes(error = it) }) {
        postRaw(
            "/api/v1/onboarding/complete",
            json.encodeToString(req),
            mapOf(
                "authorization" to "Bearer $token",
                "idempotency-key" to idempotencyKey,
            ),
        )
    }

    suspend fun checkOnboardingSlug(token: String, slug: String): SlugCheckRes =
        apiCall({ SlugCheckRes(error = it) }) {
            getRaw(
                "/api/v1/onboarding/slug/check?slug=${java.net.URLEncoder.encode(slug, "UTF-8")}",
                mapOf("authorization" to "Bearer $token"),
            )
        }

    suspend fun passkeyAuthenticationOptions(): PasskeyOptionsRes =
        apiCall({ PasskeyOptionsRes(error = it) }) {
            postRaw("/api/v1/auth/passkeys/authentication/options", "{}")
        }

    suspend fun completePasskeyAuthentication(
        challengeId: String,
        responseJson: String,
        deviceSecret: String,
    ): AuthCompleteRes = apiCall({ AuthCompleteRes(error = it) }) {
        val response = json.parseToJsonElement(responseJson).jsonObject
        postRaw(
            "/api/v1/auth/passkeys/authentication/complete",
            json.encodeToString(PasskeyAuthenticationCompleteReq(challengeId, response, deviceSecret)),
        )
    }

    suspend fun passkeyRegistrationOptions(
        phone: String,
        secret: String,
        recentAuthToken: String,
    ): PasskeyOptionsRes = apiCall({ PasskeyOptionsRes(error = it) }) {
        postRaw(
            "/api/v1/auth/passkeys/registration/options",
            "{}",
            creds(phone, secret) + ("x-orderak-recent-auth" to recentAuthToken),
        )
    }

    suspend fun completePasskeyRegistration(
        phone: String,
        secret: String,
        recentAuthToken: String,
        challengeId: String,
        responseJson: String,
        label: String?,
    ): PasskeyMutationRes = apiCall({ PasskeyMutationRes(error = it) }) {
        val response = json.parseToJsonElement(responseJson).jsonObject
        postRaw(
            "/api/v1/auth/passkeys/registration/complete",
            json.encodeToString(PasskeyRegistrationCompleteReq(challengeId, response, label)),
            creds(phone, secret) + ("x-orderak-recent-auth" to recentAuthToken),
        )
    }

    suspend fun listPasskeys(phone: String, secret: String): PasskeysRes =
        apiCall({ PasskeysRes(error = it) }) {
            getRaw("/api/v1/auth/passkeys", creds(phone, secret))
        }

    suspend fun renamePasskey(
        phone: String,
        secret: String,
        recentAuthToken: String,
        id: String,
        label: String,
    ): PasskeyMutationRes = apiCall({ PasskeyMutationRes(error = it) }) {
        execute(
            builder(
                "/api/v1/auth/passkeys/${java.net.URLEncoder.encode(id, "UTF-8")}",
                creds(phone, secret) + ("x-orderak-recent-auth" to recentAuthToken),
            ).patch(json.encodeToString(PasskeyLabelReq(label)).toRequestBody(mediaJson)).build(),
        )
    }

    suspend fun deletePasskey(
        phone: String,
        secret: String,
        recentAuthToken: String,
        id: String,
    ): PasskeyMutationRes = apiCall({ PasskeyMutationRes(error = it) }) {
        deleteRaw(
            "/api/v1/auth/passkeys/${java.net.URLEncoder.encode(id, "UTF-8")}",
            creds(phone, secret) + ("x-orderak-recent-auth" to recentAuthToken),
        )
    }

    suspend fun searchCities(countryIso: String, language: String, query: String): GeoCitiesRes =
        apiCall({ GeoCitiesRes(error = it) }) {
            getRaw(
                "/api/v1/geo/cities?country=${java.net.URLEncoder.encode(countryIso, "UTF-8")}" +
                    "&lang=${java.net.URLEncoder.encode(language, "UTF-8")}" +
                    "&q=${java.net.URLEncoder.encode(query, "UTF-8")}",
            )
        }

    suspend fun searchCityCatalog(
        onboardingToken: String,
        language: String,
        query: String,
    ): CityCatalogSearchRes = apiCall({ CityCatalogSearchRes(error = it) }) {
        getRaw(
            "/api/v1/geo/cities" +
                "?input=${java.net.URLEncoder.encode(query, "UTF-8")}" +
                "&language=${java.net.URLEncoder.encode(language, "UTF-8")}",
            mapOf("authorization" to "Bearer $onboardingToken"),
        )
    }

    suspend fun selectCatalogCity(
        onboardingToken: String,
        cityId: Long,
        language: String,
    ): CityCatalogSelectRes = apiCall({ CityCatalogSelectRes(error = it) }) {
        postRaw(
            "/api/v1/geo/cities/select",
            json.encodeToString(CityCatalogSelectReq(cityId, language)),
            mapOf("authorization" to "Bearer $onboardingToken"),
        )
    }

    suspend fun listBusinessCategories(language: String): BusinessCategoriesRes =
        apiCall({ BusinessCategoriesRes(error = it) }) {
            getRaw(
                "/api/v1/catalog/business-categories" +
                    "?language=${java.net.URLEncoder.encode(language, "UTF-8")}",
            )
        }

    suspend fun listBusinessSubcategories(
        categoryId: String,
        query: String,
        language: String,
    ): BusinessSubcategoriesRes = apiCall({ BusinessSubcategoriesRes(error = it) }) {
        getRaw(
            "/api/v1/catalog/business-subcategories" +
                "?category_id=${java.net.URLEncoder.encode(categoryId, "UTF-8")}" +
                "&query=${java.net.URLEncoder.encode(query, "UTF-8")}" +
                "&language=${java.net.URLEncoder.encode(language, "UTF-8")}" +
                "&limit=50",
        )
    }

    suspend fun resendAccountEmailVerification(
        phone: String,
        secret: String,
        recentAuthToken: String,
    ): OkRes = apiCall({ OkRes(error = it) }) {
        postRaw(
            "/api/v1/account/email/verification/resend",
            "{}",
            creds(phone, secret) + ("x-orderak-recent-auth" to recentAuthToken),
        )
    }

    suspend fun syncProducts(req: ProductsSyncReq): ProductsSyncRes =
        apiCall({ ProductsSyncRes(error = it) }) {
            postRaw("/api/v1/products/sync", json.encodeToString(req), creds(req.phone, req.secret))
        }

    // ---- Store Information ----

    suspend fun getStore(phone: String, secret: String): StoreRes =
        apiCall({ StoreRes(error = it) }) { getRaw("/api/v1/store", creds(phone, secret)) }

    suspend fun updateStore(phone: String, secret: String, req: StoreUpdateReq): StoreRes =
        apiCall({ StoreRes(error = it) }) { putRaw("/api/v1/store", json.encodeToString(req), creds(phone, secret)) }

    // ---- Categories ----

    suspend fun listCategories(phone: String, secret: String): CategoriesRes =
        apiCall({ CategoriesRes(error = it) }) { getRaw("/api/v1/categories", creds(phone, secret)) }

    suspend fun createCategory(phone: String, secret: String, req: CategoryReq): CategoryRes =
        apiCall({ CategoryRes(error = it) }) { postRaw("/api/v1/categories", json.encodeToString(req), creds(phone, secret)) }

    suspend fun updateCategory(phone: String, secret: String, code: String, req: CategoryReq): CategoryRes =
        apiCall({ CategoryRes(error = it) }) { putRaw("/api/v1/categories/$code", json.encodeToString(req), creds(phone, secret)) }

    suspend fun deleteCategory(phone: String, secret: String, code: String): OkRes =
        apiCall({ OkRes(error = it) }) { deleteRaw("/api/v1/categories/$code", creds(phone, secret)) }

    // ---- Media (logo / cover / product image) ----

    suspend fun uploadMedia(
        phone: String, secret: String, kind: String,
        bytes: ByteArray, fileName: String, contentType: String,
    ): MediaRes = apiCall({ MediaRes(error = it) }) {
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("kind", kind)
            .addFormDataPart("file", fileName, bytes.toRequestBody(contentType.toMediaType()))
            .build()
        execute(builder("/api/v1/media/upload", creds(phone, secret)).post(body).build())
    }

    suspend fun fetchOrders(phone: String, secret: String, sinceRemoteId: Long): OrdersRes =
        apiCall({ OrdersRes(error = it) }) {
            // Fix(#10): credentials in headers, never in the query string (log hygiene)
            getRaw("/api/v1/orders?since=$sinceRemoteId", creds(phone, secret))
        }

    suspend fun chat(phone: String, secret: String, message: String): ChatRes =
        apiCall({ ChatRes(error = it) }) {
            postRaw("/api/v1/chat", json.encodeToString(ChatReq(message)), creds(phone, secret))
        }

    suspend fun getConfig(phone: String, secret: String): ConfigRes =
        apiCall({ ConfigRes(error = it) }) { getRaw("/api/v1/config", creds(phone, secret)) }

    suspend fun fetchEntitlements(phone: String, secret: String, etag: String? = null): EntitlementFetchResult = try {
        val headers = creds(phone, secret).toMutableMap().apply {
            etag?.takeIf(String::isNotBlank)?.let { put("if-none-match", it) }
        }
        val request = builder("/api/v1/entitlements?projection=android-v1", headers).get().build()
        withContext(io) {
            client.newCall(request).await().use { response ->
                if (response.code == 304) {
                    return@withContext EntitlementFetchResult.NotModified(response.header("etag") ?: etag)
                }
                val snapshot = json.decodeFromString<EntitlementSnapshotRes>(response.bodyOrThrow())
                if (!snapshot.ok) EntitlementFetchResult.Failed(snapshot.error ?: "bad_response")
                else EntitlementFetchResult.Updated(snapshot.copy(etag = response.header("etag") ?: snapshot.etag))
            }
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: IOException) {
        val message = e.message
        EntitlementFetchResult.Failed(
            if (message != null && (message == "bad_response" || message.startsWith("http_"))) message else "network"
        )
    } catch (_: Exception) {
        EntitlementFetchResult.Failed("bad_response")
    }

    suspend fun getEntitlements(phone: String, secret: String): EntitlementSnapshotRes =
        when (val result = fetchEntitlements(phone, secret)) {
            is EntitlementFetchResult.Updated -> result.snapshot
            is EntitlementFetchResult.Failed -> EntitlementSnapshotRes(error = result.error)
            is EntitlementFetchResult.NotModified -> EntitlementSnapshotRes(error = "bad_response")
        }

    suspend fun getBillingCatalog(): BillingCatalogRes =
        apiCall({ BillingCatalogRes(error = it) }) { getRaw("/api/v1/billing/catalog") }

    suspend fun verifyPlayPurchase(phone: String, secret: String, token: String): VerifyPlayPurchaseRes =
        apiCall({ VerifyPlayPurchaseRes(error = it) }) {
            postRaw(
                "/api/v1/billing/google/verify",
                json.encodeToString(VerifyPlayPurchaseReq(token)),
                creds(phone, secret),
            )
        }

    suspend fun requestAccountDeletion(phone: String, secret: String): OkRes =
        apiCall({ OkRes(error = it) }) {
            postRaw("/api/v1/account/deletion-request", "{}", creds(phone, secret))
        }

    suspend fun getPlayVerification(phone: String, secret: String, verificationId: String): VerifyPlayPurchaseRes =
        apiCall({ VerifyPlayPurchaseRes(error = it) }) {
            getRaw(
                "/api/v1/billing/verifications/${java.net.URLEncoder.encode(verificationId, "UTF-8")}",
                creds(phone, secret),
            )
        }

    suspend fun getAccountStatus(phone: String, secret: String): AccountStatusRes =
        apiCall({ AccountStatusRes(error = it) }) { getRaw("/api/v1/account/status", creds(phone, secret)) }

    suspend fun getDeletionStatus(phone: String, secret: String): DeletionStatusRes =
        apiCall({ DeletionStatusRes(error = it) }) { getRaw("/api/v1/account/deletion-request", creds(phone, secret)) }

    suspend fun listSupportTickets(phone: String, secret: String): SupportTicketsRes =
        apiCall({ SupportTicketsRes(error = it) }) { getRaw("/api/v1/support/tickets", creds(phone, secret)) }

    suspend fun createSupportTicket(phone: String, secret: String, subject: String, message: String): SupportTicketsRes =
        apiCall({ SupportTicketsRes(error = it) }) { postRaw("/api/v1/support/tickets", json.encodeToString(SupportCreateReq(subject, message)), creds(phone, secret)) }

    suspend fun getSupportTicket(phone: String, secret: String, id: Long): SupportTicketsRes =
        apiCall({ SupportTicketsRes(error = it) }) { getRaw("/api/v1/support/tickets/$id", creds(phone, secret)) }

    suspend fun replySupportTicket(phone: String, secret: String, id: Long, message: String): OkRes =
        apiCall({ OkRes(error = it) }) { postRaw("/api/v1/support/tickets/$id", json.encodeToString(SupportReplyReq(message)), creds(phone, secret)) }

    suspend fun listAnnouncements(phone: String, secret: String): AnnouncementsRes =
        apiCall({ AnnouncementsRes(error = it) }) { getRaw("/api/v1/announcements", creds(phone, secret)) }

    suspend fun markAnnouncementRead(phone: String, secret: String, id: Long): OkRes =
        apiCall({ OkRes(error = it) }) { postRaw("/api/v1/announcements/$id/read", "{}", creds(phone, secret)) }

    suspend fun listProductTranslations(phone: String, secret: String, lang: String): ProductTranslationsRes =
        apiCall({ ProductTranslationsRes(error = it) }) { getRaw("/api/v1/catalog/translations?lang=$lang", creds(phone, secret)) }

    suspend fun updateProductTranslation(phone: String, secret: String, code: String, lang: String, name: String, description: String?): OkRes =
        apiCall({ OkRes(error = it) }) { putRaw("/api/v1/catalog/translations/${java.net.URLEncoder.encode(code, "UTF-8")}/$lang", json.encodeToString(ProductTranslationReq(name, description)), creds(phone, secret)) }

    suspend fun listDevices(phone: String, secret: String): DevicesRes =
        apiCall({ DevicesRes(error = it) }) { getRaw("/api/v1/devices", creds(phone, secret)) }

    suspend fun revokeDevice(phone: String, secret: String, rowId: Long): OkRes =
        apiCall({ OkRes(error = it) }) { deleteRaw("/api/v1/devices/$rowId", creds(phone, secret)) }

    suspend fun checkSlug(phone: String, secret: String, slug: String): SlugCheckRes =
        apiCall({ SlugCheckRes(error = it) }) { getRaw("/api/v1/slug/check?slug=${java.net.URLEncoder.encode(slug, "UTF-8")}", creds(phone, secret)) }

    suspend fun listAds(phone: String, secret: String): AdsRes =
        apiCall({ AdsRes(error = it) }) { getRaw("/api/v1/ads/active", creds(phone, secret)) }

    suspend fun trackAd(phone: String, secret: String, adId: Long, kind: String, eventKey: String): OkRes =
        apiCall({ OkRes(error = it) }) { postRaw("/api/v1/ads/track", json.encodeToString(AdTrackReq(adId, kind, eventKey)), creds(phone, secret)) }
}
