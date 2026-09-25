package app.orderak.seller.feature.products

import android.content.Context
import app.orderak.seller.R
import app.orderak.seller.core.money.formatAmountLabel
import app.orderak.seller.core.share.shareText
import app.orderak.seller.data.db.ProductEntity

/**
 * Fallback text catalog — used only before the first successful sync (no public
 * URL yet). Once the store has a public_identifier, prefer the link shares in
 * `core.share`.
 */
fun shareCatalogText(context: Context, shopName: String?, sellerPhone: String?, products: List<ProductEntity>) {
    val body = buildString {
        appendLine(context.getString(R.string.share_catalog_header, shopName.orEmpty()))
        appendLine()
        products.filter { it.available && it.stock > 0 }.forEach { p ->
            // Not a composable: the locale comes from the context the share text is
            // built in, which is the same one the rest of the screen is drawing with.
            val priceStr = formatAmountLabel(
                p.priceMinor,
                p.currency,
                context.resources.configuration.locales[0],
            )

            append("• ${p.name}")
            append(" — $priceStr")
            if (!p.description.isNullOrBlank()) {
                append("\n  ${p.description}")
            }
            appendLine()
        }
        appendLine()
        append(context.getString(R.string.share_catalog_footer, sellerPhone.orEmpty()))
    }
    shareText(context, body)
}
