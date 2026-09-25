package app.orderak.seller.core.share

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import app.orderak.seller.R

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

/** Copy any URL to the clipboard and confirm with a toast. */
fun copyLink(context: Context, url: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Orderak", url))
    Toast.makeText(context, context.getString(R.string.link_copied), Toast.LENGTH_SHORT).show()
}

// Try WhatsApp directly (Plan S10), fall back to the generic chooser.
internal fun shareText(context: Context, body: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, body)
    }
    val wa = Intent(send).setPackage("com.whatsapp")
    val intent = if (wa.resolveActivity(context.packageManager) != null) wa
                 else Intent.createChooser(send, null)
    context.startActivity(intent)
}
