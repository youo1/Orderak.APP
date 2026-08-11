package app.orderak.seller.core.network

/**
 * Canonical seller API routing policy.
 *
 * Before the first production release, v1 is the only allowed seller JSON API
 * surface. Call sites must provide an explicit v1 route; unversioned and v2
 * routes fail locally instead of reaching the network.
 */
object ApiRoutes {
    private const val V1_PREFIX = "/api/v1/"

    fun v1(path: String): String = V1_PREFIX + path.trimStart('/')

    fun versioned(pathWithQuery: String): String {
        require(pathWithQuery.startsWith(V1_PREFIX)) {
            "Seller API routes must start with $V1_PREFIX"
        }
        return pathWithQuery
    }

    fun isV1(path: String, relativePath: String): Boolean = path == v1(relativePath)
}
