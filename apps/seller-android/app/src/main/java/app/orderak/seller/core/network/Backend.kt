package app.orderak.seller.core.network

import app.orderak.seller.BuildConfig

object Backend {
    /** عنوان الـ API على Cloudflare (Android + web API) */
    const val BASE_URL = BuildConfig.API_BASE_URL

    /** الموقع العام اللي بيتفتح منه كتالوج الزباين */
    const val PUBLIC_SITE_URL = BuildConfig.SITE_BASE_URL

    /**
     * Public store URL — the permanent link a seller shares with customers.
     * `publicIdentifier` is "<ISO2>-<slug>-<STORE_CODE>" (e.g. EG-fresh-market-7KX9MP4R).
     * Phone numbers and internal IDs never appear in the URL.
     *
     * @deprecated Use the backend-provided `store_url` from [SessionStore.storeUrl] instead.
     *   The backend returns the canonical URL in every register/store response; the
     *   app should share/blindly display that value rather than reconstruct the URL.
     */
    @Deprecated(
        message = "Use the backend-provided store_url from SessionStore instead",
        replaceWith = ReplaceWith("sessionStore.storeUrl"),
    )
    fun storeUrl(publicIdentifier: String) = "$PUBLIC_SITE_URL/$publicIdentifier"

    /**
     * @deprecated Use the backend-provided `store_url` + "/c/$categoryCode" instead.
     */
    @Deprecated(
        message = "Append /c/{code} to the backend-provided store_url",
        replaceWith = ReplaceWith("sessionStore.storeUrl + \"/c/\$categoryCode\""),
    )
    /** Public category URL: /{public_identifier}/c/{category_code} */
    fun categoryUrl(publicIdentifier: String, categoryCode: String) =
        "$PUBLIC_SITE_URL/$publicIdentifier/c/$categoryCode"

    /**
     * @deprecated Use the backend-provided `store_url` + "/p/$productCode" instead.
     */
    @Deprecated(
        message = "Append /p/{code} to the backend-provided store_url",
        replaceWith = ReplaceWith("sessionStore.storeUrl + \"/p/\$productCode\""),
    )
    /** Public product URL (shareable): /{public_identifier}/p/{product_code} */
    fun productUrl(publicIdentifier: String, productCode: String) =
        "$PUBLIC_SITE_URL/$publicIdentifier/p/$productCode"
}
