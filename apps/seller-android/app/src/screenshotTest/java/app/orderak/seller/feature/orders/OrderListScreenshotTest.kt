package app.orderak.seller.feature.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.domain.OrderStatus
import com.android.tools.screenshot.PreviewTest

private fun Modifier.greyscale(): Modifier = drawWithContent {
    val paint = Paint().apply {
        colorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) })
    }
    drawContext.canvas.saveLayer(Rect(0f, 0f, size.width, size.height), paint)
    drawContent()
    drawContext.canvas.restore()
}

/**
 * [remoteId] is what makes an order real beyond this phone, so the sample keeps
 * one row without it. Orders arriving from the storefront always have one; an
 * order the seller recorded by hand never does, because the app cannot create
 * one on the server yet. The two look identical apart from the marker, which is
 * the entire reason the marker exists.
 */
private fun order(id: Long, name: String, status: OrderStatus, total: Long, remoteId: Long? = id) = OrderEntity(
    id = id,
    remoteId = remoteId,
    buyerPhone = "+201000000$id",
    buyerName = name,
    status = status.name,
    payMethod = "CASH",
    totalMinor = total,
    createdAt = 1_756_000_000_000L + id * 3_600_000L,
)

/**
 * One order per status, in the order a seller meets them.
 *
 * Deliberately mixed rather than sorted: the question the list has to answer is
 * "which of these still need me?", and a pre-sorted sample would answer it for
 * the reader instead of letting the encoding do it.
 */
@Composable
private fun OrderList() {
    Surface {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
        ) {
            OrderCard(order(1, "منى عبد الله", OrderStatus.NEW, 45_000), onClick = {})
            OrderCard(order(2, "أحمد يسري", OrderStatus.DONE, 87_500), onClick = {})
            // The one the seller typed in. Same status family as the rows around
            // it, so the marker is the only thing separating them.
            OrderCard(order(3, "كريم فؤاد", OrderStatus.CONFIRMED, 120_000, remoteId = null), onClick = {})
            OrderCard(order(4, "هدى مصطفى", OrderStatus.CANCELLED, 64_000), onClick = {})
            OrderCard(order(5, "سارة الشناوي", OrderStatus.PAID, 32_000), onClick = {})
            OrderCard(order(6, "محمود العزب", OrderStatus.SHIPPED, 215_000), onClick = {})
        }
    }
}

@PreviewTest
@Preview(name = "Orders light", locale = "ar")
@Composable
fun orderListLight() {
    OrderakTheme(darkTheme = false) { OrderList() }
}

@PreviewTest
@Preview(name = "Orders dark", locale = "ar")
@Composable
fun orderListDark() {
    OrderakTheme(darkTheme = true) { OrderList() }
}

/**
 * The triage test.
 *
 * With every hue gone, the four rows that still need the seller must remain
 * separable from the two that do not — by the filled rail, the status word and
 * the chip's icon. If they blur together here, the list has gone back to
 * carrying its meaning in colour alone.
 *
 * The same test covers the on-this-phone marker. It warns a seller that an order
 * is not on their account, which is worth nothing if it is a coloured pill they
 * cannot distinguish from the status beside it.
 */
@PreviewTest
@Preview(name = "Orders greyscale", locale = "ar")
@Composable
fun orderListGreyscale() {
    OrderakTheme(darkTheme = false) {
        Surface { Column(modifier = Modifier.greyscale()) { OrderList() } }
    }
}
