package app.orderak.seller.core.network

import kotlinx.serialization.json.Json

/** One forward-compatible JSON contract for every backend response. */
object NetworkJson {
    val decoder: Json = Json {
        ignoreUnknownKeys = true
        isLenient = false
        encodeDefaults = true
    }
}
