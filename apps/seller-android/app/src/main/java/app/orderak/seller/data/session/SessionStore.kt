package app.orderak.seller.data.session

import android.content.Context
import android.content.SharedPreferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "session")
private const val SECRET_PREFS_FILE = "orderak_secure_secret"
private const val SECRET_PREFS_KEY = "backend_secret"
private const val ONBOARDING_TOKEN_PREFS_KEY = "onboarding_token"
private const val RECENT_AUTH_TOKEN_PREFS_KEY = "recent_auth_token"
private const val RECENT_AUTH_EXPIRES_PREFS_KEY = "recent_auth_expires_at"

enum class AccountStage { PRE_REGISTRATION, REGISTERED }

enum class OnboardingStage { NOT_STARTED, IN_PROGRESS, COMPLETE }

data class LocalSessionSnapshot(
    val phone: String?,
    val shopName: String?,
    val category: String?,
    val city: String?,
    val cityGeonameId: Long? = null,
    val slug: String? = null,
    val countryIso: String?,
    val logoUri: String?,
    val fullName: String?,
    val email: String?,
    val birthYear: String?,
    val profilePhotoUri: String?,
    val storeCode: String?,
    val publicIdentifier: String?,
    val accountStage: AccountStage,
    val onboardingStage: OnboardingStage,
    val onboardingStep: Int,
    val cachedAccountStatus: String?,
    val accountStatusCheckedAtEpochMs: Long?,
    val cityCatalogId: Long? = null,
    val businessCategoryId: String? = null,
    val businessCategoryName: String? = null,
    val businessSubcategoryId: String? = null,
    val businessSubcategoryName: String? = null,
    val businessTaxonomyVersion: Int? = null,
)

data class PendingBillingVerification(
    val verificationId: String,
    val retryAtEpochMs: Long,
)

/**
 * Stage-1 session/profile store (DataStore).
 * Stage 2+: seller profile moves to Room + backend sync; this keeps only the session token.
 */
@Singleton
class SessionStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {
    private object Keys {
        val PHONE = stringPreferencesKey("phone")
        val SHOP_NAME = stringPreferencesKey("shop_name")
        val CATEGORY = stringPreferencesKey("category")
        val BUSINESS_CATEGORY_ID = stringPreferencesKey("business_category_id")
        val BUSINESS_CATEGORY_NAME = stringPreferencesKey("business_category_name")
        val BUSINESS_SUBCATEGORY_ID = stringPreferencesKey("business_subcategory_id")
        val BUSINESS_SUBCATEGORY_NAME = stringPreferencesKey("business_subcategory_name")
        val BUSINESS_TAXONOMY_VERSION = intPreferencesKey("business_taxonomy_version")
        val CITY = stringPreferencesKey("city")
        val CITY_GEONAME_ID = longPreferencesKey("city_geoname_id")
        val CITY_CATALOG_ID = longPreferencesKey("city_catalog_id")
        val COUNTRY_ISO = stringPreferencesKey("country_iso")

        // The catalogue baseline: the store version this device last downloaded,
        // and the account it downloaded it for. Both, because a version alone
        // would survive a sign-out and let the next seller push against a number
        // that describes someone else's catalogue.
        val CATALOG_BASELINE = longPreferencesKey("catalog_baseline_version")
        val CATALOG_BASELINE_ACCOUNT = stringPreferencesKey("catalog_baseline_account")
        val LOGO_URI = stringPreferencesKey("logo_uri")
        val FULL_NAME = stringPreferencesKey("full_name")
        val EMAIL = stringPreferencesKey("email")
        val BIRTH_YEAR = stringPreferencesKey("birth_year")
        val PROFILE_PHOTO_URI = stringPreferencesKey("profile_photo_uri")
        val INSTAPAY = stringPreferencesKey("payout_instapay")
        val VFCASH = stringPreferencesKey("payout_vfcash")
        val SLUG = stringPreferencesKey("catalog_slug")
        val PUBLIC_ID = stringPreferencesKey("catalog_public_id")
        val STORE_CODE = stringPreferencesKey("store_code")
        val STORE_URL = stringPreferencesKey("store_url")
        val COUNTRY_CODE = stringPreferencesKey("country_code")
        val DESCRIPTION = stringPreferencesKey("store_description")
        val WHATSAPP = stringPreferencesKey("store_whatsapp")
        val STORE_EMAIL = stringPreferencesKey("store_email")
        val WEBSITE = stringPreferencesKey("store_website")
        val ADDRESS = stringPreferencesKey("store_address")
        val LOGO_URL = stringPreferencesKey("store_logo_url")
        val COVER_URL = stringPreferencesKey("store_cover_url")
        val LEGACY_SECRET = stringPreferencesKey("backend_secret")
        val DEVICE_ID = stringPreferencesKey("device_id")
        val SYNC_STATUS = stringPreferencesKey("sync_status")
        val ACCOUNT_STAGE = stringPreferencesKey("account_stage")
        val ONBOARDING_STAGE = stringPreferencesKey("onboarding_stage")
        val ONBOARDING_STEP = intPreferencesKey("onboarding_step")
        val ONBOARDING_PASSKEY_OPT_IN = booleanPreferencesKey("onboarding_passkey_opt_in")
        val ACCOUNT_STATUS = stringPreferencesKey("account_status")
        val ACCOUNT_STATUS_CHECKED_AT = longPreferencesKey("account_status_checked_at")
        val BILLING_VERIFICATION_ID = stringPreferencesKey("billing_verification_id")
        val BILLING_VERIFICATION_RETRY_AT = longPreferencesKey("billing_verification_retry_at")
    }

    private val secureSecretPrefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            SECRET_PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }


    val phone: Flow<String?> = context.dataStore.data.map { it[Keys.PHONE] }
    val shopName: Flow<String?> = context.dataStore.data.map { it[Keys.SHOP_NAME] }
    val instapay: Flow<String?> = context.dataStore.data.map { it[Keys.INSTAPAY] }
    val vfcash: Flow<String?> = context.dataStore.data.map { it[Keys.VFCASH] }
    val slug: Flow<String?> = context.dataStore.data.map { it[Keys.SLUG] }

    /**
     * The catalogue version this device downloaded, if it belongs to [account].
     *
     * Null means the device has no baseline: it has never downloaded, the
     * download failed, or the stored one belongs to a different seller. In every
     * one of those cases the device must not send a destructive mirror, because
     * it cannot vouch for what it is about to overwrite.
     */
    suspend fun catalogBaseline(account: String): Long? {
        val prefs = context.dataStore.data.first()
        if (prefs[Keys.CATALOG_BASELINE_ACCOUNT] != account) return null
        return prefs[Keys.CATALOG_BASELINE]
    }

    /** Record a completed download. Only ever called after the whole catalogue landed. */
    suspend fun saveCatalogBaseline(account: String, version: Long) {
        context.dataStore.edit {
            it[Keys.CATALOG_BASELINE_ACCOUNT] = account
            it[Keys.CATALOG_BASELINE] = version
        }
    }

    /** Drop the baseline, forcing a fresh download before the next mirror push. */
    suspend fun clearCatalogBaseline() {
        context.dataStore.edit {
            it.remove(Keys.CATALOG_BASELINE_ACCOUNT)
            it.remove(Keys.CATALOG_BASELINE)
        }
    }
    val publicIdentifier: Flow<String?> = context.dataStore.data.map { it[Keys.PUBLIC_ID] }
    val storeCode: Flow<String?> = context.dataStore.data.map { it[Keys.STORE_CODE] }
    val storeUrl: Flow<String?> = context.dataStore.data.map { it[Keys.STORE_URL] }

    /** ISO-3166 alpha-2 country, chosen at onboarding and confirmed by the backend. */
    val countryIso: Flow<String?> = context.dataStore.data.map { it[Keys.COUNTRY_CODE] ?: it[Keys.COUNTRY_ISO] }

    val description: Flow<String?> = context.dataStore.data.map { it[Keys.DESCRIPTION] }
    val whatsapp: Flow<String?> = context.dataStore.data.map { it[Keys.WHATSAPP] }
    val storeEmail: Flow<String?> = context.dataStore.data.map { it[Keys.STORE_EMAIL] }
    val website: Flow<String?> = context.dataStore.data.map { it[Keys.WEBSITE] }
    val address: Flow<String?> = context.dataStore.data.map { it[Keys.ADDRESS] }
    val logoUrl: Flow<String?> = context.dataStore.data.map { it[Keys.LOGO_URL] }
    val coverUrl: Flow<String?> = context.dataStore.data.map { it[Keys.COVER_URL] }
    val syncStatus: Flow<String?> = context.dataStore.data.map { it[Keys.SYNC_STATUS] }
    val pendingBillingVerification: Flow<PendingBillingVerification?> = context.dataStore.data.map { prefs ->
        val id = prefs[Keys.BILLING_VERIFICATION_ID]
        if (id.isNullOrBlank()) null else PendingBillingVerification(
            verificationId = id,
            retryAtEpochMs = prefs[Keys.BILLING_VERIFICATION_RETRY_AT] ?: 0L,
        )
    }

    /**
     * One Preferences DataStore emission for all routing/profile fields. The
     * encrypted device secret intentionally remains a separate security store.
     */
    suspend fun snapshot(): LocalSessionSnapshot {
        val prefs = context.dataStore.data.first()
        val shopName = prefs[Keys.SHOP_NAME]
        val storeCode = prefs[Keys.STORE_CODE]
        val publicIdentifier = prefs[Keys.PUBLIC_ID]
        val inferredAccountStage = if (!storeCode.isNullOrBlank() || !publicIdentifier.isNullOrBlank()) {
            AccountStage.REGISTERED
        } else {
            AccountStage.PRE_REGISTRATION
        }
        val inferredOnboardingStage = if (shopName.isNullOrBlank()) {
            OnboardingStage.NOT_STARTED
        } else {
            OnboardingStage.COMPLETE
        }
        return LocalSessionSnapshot(
            phone = prefs[Keys.PHONE],
            shopName = shopName,
            category = prefs[Keys.CATEGORY],
            city = prefs[Keys.CITY],
            cityGeonameId = prefs[Keys.CITY_GEONAME_ID],
            slug = prefs[Keys.SLUG],
            countryIso = prefs[Keys.COUNTRY_CODE] ?: prefs[Keys.COUNTRY_ISO],
            logoUri = prefs[Keys.LOGO_URI],
            fullName = prefs[Keys.FULL_NAME],
            email = prefs[Keys.EMAIL],
            birthYear = prefs[Keys.BIRTH_YEAR],
            profilePhotoUri = prefs[Keys.PROFILE_PHOTO_URI],
            storeCode = storeCode,
            publicIdentifier = publicIdentifier,
            accountStage = prefs[Keys.ACCOUNT_STAGE]
                ?.let { runCatching { AccountStage.valueOf(it) }.getOrNull() }
                ?: inferredAccountStage,
            onboardingStage = prefs[Keys.ONBOARDING_STAGE]
                ?.let { runCatching { OnboardingStage.valueOf(it) }.getOrNull() }
                ?: inferredOnboardingStage,
            onboardingStep = (prefs[Keys.ONBOARDING_STEP] ?: 1).coerceIn(1, 2),
            cachedAccountStatus = prefs[Keys.ACCOUNT_STATUS],
            accountStatusCheckedAtEpochMs = prefs[Keys.ACCOUNT_STATUS_CHECKED_AT],
            cityCatalogId = prefs[Keys.CITY_CATALOG_ID],
            businessCategoryId = prefs[Keys.BUSINESS_CATEGORY_ID],
            businessCategoryName = prefs[Keys.BUSINESS_CATEGORY_NAME],
            businessSubcategoryId = prefs[Keys.BUSINESS_SUBCATEGORY_ID],
            businessSubcategoryName = prefs[Keys.BUSINESS_SUBCATEGORY_NAME],
            businessTaxonomyVersion = prefs[Keys.BUSINESS_TAXONOMY_VERSION],
        )
    }

    /**
     * The canonical public identifier ("<ISO2>-<slug>-<STORE_CODE>") used to
     * build share links. We deliberately do NOT fall back to a bare slug — a
     * public URL must always carry the country + immutable store_code (spec §5),
     * and a slug-only link can be non-canonical or unresolvable. When this is
     * null the UI shows "link preparing" and triggers a sync to obtain it.
     */
    val storeIdentifier: Flow<String?> = publicIdentifier.map { it?.ifBlank { null } }


    suspend fun savePhone(phone: String) =
        context.dataStore.edit { it[Keys.PHONE] = phone }

    suspend fun savePhoneCountry(phone: String, countryIso: String) =
        context.dataStore.edit {
            it[Keys.PHONE] = phone
            it[Keys.COUNTRY_ISO] = countryIso.uppercase()
        }

    /**
     * Atomically binds a Firebase-verified phone to its new-seller routing
     * state. Keeping these fields in one DataStore transaction prevents a
     * background seller request from observing the new phone with the previous
     * account's REGISTERED state and forcing authentication back to Welcome.
     */
    suspend fun beginPreRegistration(phone: String, countryIso: String) =
        context.dataStore.edit { prefs ->
        prefs[Keys.PHONE] = phone
        prefs[Keys.COUNTRY_ISO] = countryIso.uppercase()
        prefs[Keys.ACCOUNT_STAGE] = AccountStage.PRE_REGISTRATION.name

        // A fresh onboarding token is authoritative evidence that this phone
        // does not currently have a seller. Never let a stale COMPLETE marker
        // send that new seller to Main. Preserve only a genuinely resumable
        // in-progress draft (for example, after renewing an expired token).
        if (prefs[Keys.ONBOARDING_STAGE] != OnboardingStage.IN_PROGRESS.name) {
            prefs[Keys.ONBOARDING_STAGE] = OnboardingStage.NOT_STARTED.name
            prefs[Keys.ONBOARDING_STEP] = 1
        } else {
            prefs[Keys.ONBOARDING_STEP] = (prefs[Keys.ONBOARDING_STEP] ?: 1).coerceIn(1, 2)
        }

        // Account status belongs to the previous authenticated seller context
        // and must not affect routing for a new pre-registration session.
        prefs.remove(Keys.ACCOUNT_STATUS)
        prefs.remove(Keys.ACCOUNT_STATUS_CHECKED_AT)
    }

    suspend fun markRegistered() = context.dataStore.edit {
        it[Keys.ACCOUNT_STAGE] = AccountStage.REGISTERED.name
    }

    suspend fun markOnboardingComplete() = context.dataStore.edit {
        it[Keys.ONBOARDING_STAGE] = OnboardingStage.COMPLETE.name
        it[Keys.ONBOARDING_STEP] = 2
    }

    suspend fun saveOnboardingPasskeyOptIn(enabled: Boolean) = context.dataStore.edit {
        it[Keys.ONBOARDING_PASSKEY_OPT_IN] = enabled
    }

    suspend fun readOnboardingPasskeyOptIn(): Boolean =
        context.dataStore.data.first()[Keys.ONBOARDING_PASSKEY_OPT_IN] ?: true

    suspend fun clearOnboardingPasskeyOptIn() = context.dataStore.edit {
        it.remove(Keys.ONBOARDING_PASSKEY_OPT_IN)
    }

    suspend fun saveAccountStatus(status: String, checkedAtEpochMs: Long = System.currentTimeMillis()) =
        context.dataStore.edit {
            it[Keys.ACCOUNT_STATUS] = status
            it[Keys.ACCOUNT_STATUS_CHECKED_AT] = checkedAtEpochMs
        }

    suspend fun saveOnboardingDraft(
        step: Int,
        name: String,
        category: String?,
        city: String,
        countryIso: String,
        logoUri: String?,
        fullName: String,
        email: String?,
        birthYear: String?,
        profilePhotoUri: String?,
        cityGeonameId: Long? = null,
        slug: String? = null,
        cityCatalogId: Long? = null,
        businessCategoryId: String? = null,
        businessCategoryName: String? = null,
        businessSubcategoryId: String? = null,
        businessSubcategoryName: String? = null,
        businessTaxonomyVersion: Int? = null,
    ) = context.dataStore.edit { prefs ->
        prefs[Keys.ONBOARDING_STAGE] = OnboardingStage.IN_PROGRESS.name
        prefs[Keys.ONBOARDING_STEP] = step.coerceIn(1, 2)
        prefs[Keys.SHOP_NAME] = name
        if (category == null) prefs.remove(Keys.CATEGORY) else prefs[Keys.CATEGORY] = category
        prefs[Keys.CITY] = city
        if (cityGeonameId == null) prefs.remove(Keys.CITY_GEONAME_ID) else prefs[Keys.CITY_GEONAME_ID] = cityGeonameId
        if (cityCatalogId == null) prefs.remove(Keys.CITY_CATALOG_ID)
        else prefs[Keys.CITY_CATALOG_ID] = cityCatalogId
        prefs[Keys.COUNTRY_ISO] = countryIso
        if (logoUri.isNullOrBlank()) prefs.remove(Keys.LOGO_URI) else prefs[Keys.LOGO_URI] = logoUri
        prefs[Keys.FULL_NAME] = fullName
        if (email.isNullOrBlank()) prefs.remove(Keys.EMAIL) else prefs[Keys.EMAIL] = email
        if (birthYear.isNullOrBlank()) prefs.remove(Keys.BIRTH_YEAR) else prefs[Keys.BIRTH_YEAR] = birthYear
        if (profilePhotoUri.isNullOrBlank()) prefs.remove(Keys.PROFILE_PHOTO_URI) else prefs[Keys.PROFILE_PHOTO_URI] = profilePhotoUri
        if (slug.isNullOrBlank()) prefs.remove(Keys.SLUG) else prefs[Keys.SLUG] = slug
        if (businessCategoryId.isNullOrBlank()) prefs.remove(Keys.BUSINESS_CATEGORY_ID)
        else prefs[Keys.BUSINESS_CATEGORY_ID] = businessCategoryId
        if (businessCategoryName.isNullOrBlank()) prefs.remove(Keys.BUSINESS_CATEGORY_NAME)
        else prefs[Keys.BUSINESS_CATEGORY_NAME] = businessCategoryName
        if (businessSubcategoryId.isNullOrBlank()) prefs.remove(Keys.BUSINESS_SUBCATEGORY_ID)
        else prefs[Keys.BUSINESS_SUBCATEGORY_ID] = businessSubcategoryId
        if (businessSubcategoryName.isNullOrBlank()) prefs.remove(Keys.BUSINESS_SUBCATEGORY_NAME)
        else prefs[Keys.BUSINESS_SUBCATEGORY_NAME] = businessSubcategoryName
        if (businessTaxonomyVersion == null) prefs.remove(Keys.BUSINESS_TAXONOMY_VERSION)
        else prefs[Keys.BUSINESS_TAXONOMY_VERSION] = businessTaxonomyVersion
    }

    suspend fun saveShop(
        name: String,
        category: String,
        city: String,
        countryIso: String,
        logoUri: String?,
        fullName: String,
        email: String?,
        birthYear: String?,
        profilePhotoUri: String?,
        cityCatalogId: Long? = null,
        businessCategoryId: String? = null,
        businessCategoryName: String? = null,
        businessSubcategoryId: String? = null,
        businessSubcategoryName: String? = null,
        businessTaxonomyVersion: Int? = null,
    ) = context.dataStore.edit {
        it[Keys.SHOP_NAME] = name
        it[Keys.CATEGORY] = category
        it[Keys.CITY] = city
        it[Keys.COUNTRY_ISO] = countryIso
        if (logoUri.isNullOrBlank()) it.remove(Keys.LOGO_URI) else it[Keys.LOGO_URI] = logoUri
        it[Keys.FULL_NAME] = fullName
        if (email.isNullOrBlank()) it.remove(Keys.EMAIL) else it[Keys.EMAIL] = email
        if (birthYear.isNullOrBlank()) it.remove(Keys.BIRTH_YEAR) else it[Keys.BIRTH_YEAR] = birthYear
        if (profilePhotoUri.isNullOrBlank()) it.remove(Keys.PROFILE_PHOTO_URI) else it[Keys.PROFILE_PHOTO_URI] = profilePhotoUri
        if (cityCatalogId == null) it.remove(Keys.CITY_CATALOG_ID)
        else it[Keys.CITY_CATALOG_ID] = cityCatalogId
        if (businessCategoryId.isNullOrBlank()) it.remove(Keys.BUSINESS_CATEGORY_ID)
        else it[Keys.BUSINESS_CATEGORY_ID] = businessCategoryId
        if (businessCategoryName.isNullOrBlank()) it.remove(Keys.BUSINESS_CATEGORY_NAME)
        else it[Keys.BUSINESS_CATEGORY_NAME] = businessCategoryName
        if (businessSubcategoryId.isNullOrBlank()) it.remove(Keys.BUSINESS_SUBCATEGORY_ID)
        else it[Keys.BUSINESS_SUBCATEGORY_ID] = businessSubcategoryId
        if (businessSubcategoryName.isNullOrBlank()) it.remove(Keys.BUSINESS_SUBCATEGORY_NAME)
        else it[Keys.BUSINESS_SUBCATEGORY_NAME] = businessSubcategoryName
        if (businessTaxonomyVersion == null) it.remove(Keys.BUSINESS_TAXONOMY_VERSION)
        else it[Keys.BUSINESS_TAXONOMY_VERSION] = businessTaxonomyVersion
        it[Keys.ONBOARDING_STAGE] = OnboardingStage.COMPLETE.name
        it[Keys.ONBOARDING_STEP] = 2
    }

    suspend fun savePayout(instapay: String, vfcash: String) =
        context.dataStore.edit {
            it[Keys.INSTAPAY] = instapay
            it[Keys.VFCASH] = vfcash
        }

    suspend fun saveSlug(slug: String) =
        context.dataStore.edit { it[Keys.SLUG] = slug }

    /** Save the structured public identity returned by the backend register/store call. */
    suspend fun saveStoreIdentity(
        slug: String?,
        publicIdentifier: String?,
        storeCode: String?,
        countryCode: String? = null,
        storeUrl: String? = null,
    ) = context.dataStore.edit { prefs ->
        slug?.takeIf { it.isNotBlank() }?.let { prefs[Keys.SLUG] = it }
        publicIdentifier?.takeIf { it.isNotBlank() }?.let { prefs[Keys.PUBLIC_ID] = it }
        storeCode?.takeIf { it.isNotBlank() }?.let { prefs[Keys.STORE_CODE] = it }
        countryCode?.takeIf { it.isNotBlank() }?.let { prefs[Keys.COUNTRY_CODE] = it }
        storeUrl?.takeIf { it.isNotBlank() }?.let { prefs[Keys.STORE_URL] = it }
        if (!storeCode.isNullOrBlank() || !publicIdentifier.isNullOrBlank()) {
            prefs[Keys.ACCOUNT_STAGE] = AccountStage.REGISTERED.name
        }
    }

    /** Cache the editable Store Information fields returned by GET/PUT /api/v1/store. */
    suspend fun saveStoreInfo(
        shopName: String? = null,
        description: String? = null,
        whatsapp: String? = null,
        email: String? = null,
        website: String? = null,
        address: String? = null,
        logoUrl: String? = null,
        coverUrl: String? = null,
    ) = context.dataStore.edit { prefs ->
        shopName?.let { prefs[Keys.SHOP_NAME] = it }
        description?.let { prefs[Keys.DESCRIPTION] = it }
        whatsapp?.let { prefs[Keys.WHATSAPP] = it }
        email?.let { prefs[Keys.STORE_EMAIL] = it }
        website?.let { prefs[Keys.WEBSITE] = it }
        address?.let { prefs[Keys.ADDRESS] = it }
        logoUrl?.let { prefs[Keys.LOGO_URL] = it }
        coverUrl?.let { prefs[Keys.COVER_URL] = it }
    }


    /** سر ثابت للجهاز بيمثّل هوية التطبيق عند الباك اند (بيتولد مرة واحدة). */
    suspend fun getOrCreateSecret(): String {
        val encrypted = secureSecretPrefs.getString(SECRET_PREFS_KEY, null)
        if (!encrypted.isNullOrBlank()) return encrypted

        val legacy = context.dataStore.data.map { it[Keys.LEGACY_SECRET] }.first()
        if (!legacy.isNullOrBlank()) {
            secureSecretPrefs.edit().putString(SECRET_PREFS_KEY, legacy).apply()
            context.dataStore.edit { it.remove(Keys.LEGACY_SECRET) }
            return legacy
        }

        val secret = java.util.UUID.randomUUID().toString()
        secureSecretPrefs.edit().putString(SECRET_PREFS_KEY, secret).apply()
        return secret
    }

    fun saveOnboardingToken(token: String) {
        secureSecretPrefs.edit().putString(ONBOARDING_TOKEN_PREFS_KEY, token).apply()
    }

    fun readOnboardingToken(): String? =
        secureSecretPrefs.getString(ONBOARDING_TOKEN_PREFS_KEY, null)?.ifBlank { null }

    fun clearOnboardingToken() {
        secureSecretPrefs.edit().remove(ONBOARDING_TOKEN_PREFS_KEY).apply()
    }

    fun saveRecentAuth(token: String, expiresAt: String?) {
        secureSecretPrefs.edit()
            .putString(RECENT_AUTH_TOKEN_PREFS_KEY, token)
            .putString(RECENT_AUTH_EXPIRES_PREFS_KEY, expiresAt.orEmpty())
            .apply()
    }

    fun readRecentAuthToken(): String? =
        secureSecretPrefs.getString(RECENT_AUTH_TOKEN_PREFS_KEY, null)?.ifBlank { null }

    fun clearRecentAuth() {
        secureSecretPrefs.edit()
            .remove(RECENT_AUTH_TOKEN_PREFS_KEY)
            .remove(RECENT_AUTH_EXPIRES_PREFS_KEY)
            .apply()
    }

    /** Returns a previously provisioned credential without creating a new one. */
    suspend fun readExistingSecret(): String? {
        val encrypted = secureSecretPrefs.getString(SECRET_PREFS_KEY, null)
        if (!encrypted.isNullOrBlank()) return encrypted
        return context.dataStore.data.map { it[Keys.LEGACY_SECRET] }.first()?.ifBlank { null }
    }

    /** Opaque installation identifier; it contains no hardware identifier or user data. */
    suspend fun getOrCreateDeviceId(): String {
        val current = context.dataStore.data.map { it[Keys.DEVICE_ID] }.first()
        if (!current.isNullOrBlank()) return current
        val id = java.util.UUID.randomUUID().toString()
        context.dataStore.edit { it[Keys.DEVICE_ID] = id }
        return id
    }

    suspend fun setSyncStatus(status: String) =
        context.dataStore.edit { it[Keys.SYNC_STATUS] = status }

    /** Purchase tokens are deliberately excluded from local persistence. */
    suspend fun savePendingBillingVerification(verificationId: String, retryAtEpochMs: Long) =
        context.dataStore.edit {
            it[Keys.BILLING_VERIFICATION_ID] = verificationId
            it[Keys.BILLING_VERIFICATION_RETRY_AT] = retryAtEpochMs
        }

    suspend fun clearPendingBillingVerification(verificationId: String? = null) =
        context.dataStore.edit { prefs ->
            if (verificationId == null || prefs[Keys.BILLING_VERIFICATION_ID] == verificationId) {
                prefs.remove(Keys.BILLING_VERIFICATION_ID)
                prefs.remove(Keys.BILLING_VERIFICATION_RETRY_AT)
            }
        }

    /** Fix(#8): logout clears the profile but keeps the device secret and device ID —
     *  the backend identity survives re-login with the same phone. */
    suspend fun clear() = context.dataStore.edit { prefs ->
        val legacySecret = prefs[Keys.LEGACY_SECRET]
        val deviceId = prefs[Keys.DEVICE_ID]
        prefs.clear()
        if (!legacySecret.isNullOrBlank() && secureSecretPrefs.getString(SECRET_PREFS_KEY, null).isNullOrBlank()) {
            secureSecretPrefs.edit().putString(SECRET_PREFS_KEY, legacySecret).apply()
        }
        deviceId?.let { prefs[Keys.DEVICE_ID] = it }
        secureSecretPrefs.edit()
            .remove(ONBOARDING_TOKEN_PREFS_KEY)
            .remove(RECENT_AUTH_TOKEN_PREFS_KEY)
            .remove(RECENT_AUTH_EXPIRES_PREFS_KEY)
            .apply()
    }
}
