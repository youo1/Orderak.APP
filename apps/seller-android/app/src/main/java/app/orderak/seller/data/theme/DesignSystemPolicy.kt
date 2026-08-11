package app.orderak.seller.data.theme

/** Formal accessibility precedence: standard < medium < high. */
internal fun selectHighestContrast(vararg values: String): String {
    val order = mapOf("standard" to 0, "medium" to 1, "high" to 2)
    return values.maxByOrNull { order[it] ?: 0 }?.takeIf(order::containsKey) ?: "standard"
}
