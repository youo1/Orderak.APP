package app.orderak.seller.feature.products

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import app.orderak.seller.R
import app.orderak.seller.core.money.DEFAULT_CURRENCY
import app.orderak.seller.core.money.formatAmount
import app.orderak.seller.data.db.ProductEntity

/**
 * Fallback text catalog — used only before the first successful sync (no public
 * URL yet). Once the store has a public_identifier, prefer the link shares below.
 */
fun shareCatalogText(context: Context, shopName: String?, sellerPhone: String?, products: List<ProductEntity>) {
    val body = buildString {
        appendLine(context.getString(R.string.share_catalog_header, shopName.orEmpty()))
        appendLine()
        products.filter { it.available && it.stock > 0 }.forEach { p ->
            // Not a composable: the locale comes from the context the share text is
            // built in, which is the same one the rest of the screen is drawing with.
            val priceStr = context.getString(
                R.string.currency_egp,
                formatAmount(p.priceMinor, p.currency, context.resources.configuration.locales[0]),
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

/**
 * Share the live store link (after the first successful sync).
 * @param storeUrl The canonical URL returned by the backend, persisted in SessionStore.
 */
fun shareStoreLink(context: Context, shopName: String?, storeUrl: String) {
    val body = context.getString(R.string.share_catalog_header, shopName.orEmpty()) +
        "\n\n" + storeUrl +
        "\n\n" + context.getString(R.string.share_link_footer)
    shareText(context, body)
}

/** Share a single category link. */
fun shareCategoryLink(context: Context, categoryName: String?, storeUrl: String, categoryCode: String) {
    val url = "$storeUrl/c/$categoryCode"
    val body = (categoryName?.takeIf { it.isNotBlank() }?.plus("\n\n") ?: "") +
        url +
        "\n\n" + context.getString(R.string.share_link_footer)
    shareText(context, body)
}

/** Share a single product link (shareable product page). */
fun shareProductLink(context: Context, productName: String?, storeUrl: String, productCode: String) {
    val url = "$storeUrl/p/$productCode"
    val body = (productName?.takeIf { it.isNotBlank() }?.plus("\n\n") ?: "") +
        url +
        "\n\n" + context.getString(R.string.share_link_footer)
    shareText(context, body)
}

/** Copy any URL to the clipboard and confirm with a toast. */
fun copyLink(context: Context, url: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Orderak", url))
    Toast.makeText(context, context.getString(R.string.link_copied), Toast.LENGTH_SHORT).show()
}

// Try WhatsApp directly (Plan S10), fall back to the generic chooser.
private fun shareText(context: Context, body: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, body)
    }
    val wa = Intent(send).setPackage("com.whatsapp")
    val intent = if (wa.resolveActivity(context.packageManager) != null) wa
                 else Intent.createChooser(send, null)
    context.startActivity(intent)
}
