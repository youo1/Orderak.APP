package app.orderak.seller.feature.orders

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.orderak.seller.R
import app.orderak.seller.core.ui.NoticeBanner
import app.orderak.seller.core.ui.SemanticChip
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.data.db.OrderEntity

/**
 * Orders that exist on this phone and nowhere else.
 *
 * WHY THIS IS ON SCREEN AT ALL
 *   An order the seller records by hand is written to Room first, because the
 *   seller is standing in front of a customer and it must not depend on a
 *   signal, and posted to the server immediately afterwards. Until that post
 *   lands the order is not on the account: it does not reach a second device, it
 *   does not survive a reinstall, and it is not counted against the plan.
 *
 *   Usually that gap is a moment. Offline it lasts until the next sync. Either
 *   way the seller can see the order sitting in the list beside orders that ARE
 *   on the account, and nothing else on the row tells them apart, so the app
 *   says which is which.
 *
 *   This used to describe a permanent state: there was no POST /api/v1/orders at
 *   all, and an order typed in here stopped in Room forever. Work item 05 added
 *   the route, so what is left is a retry window rather than a dead end — and
 *   the copy says "not yet", not "never".
 *
 * WHY IT KEYS OFF remoteId
 *   `remoteId` is the per-store order number, written when the server accepts
 *   the order — by the inbound pull for storefront orders, and by the create
 *   call for these. An order that has one is on the account; an order without
 *   one is not, whatever the reason. So the marker needs no state of its own and
 *   clears itself the instant the post succeeds.
 */
val OrderEntity.livesOnlyOnThisPhone: Boolean
    get() = remoteId == null

/**
 * The list marker.
 *
 * Warning rather than Danger: nothing has failed and the seller has done nothing
 * wrong. SemanticChip pairs the role's colour with its icon and the label, so
 * the meaning survives greyscale, colour blindness and a phone in the sun —
 * which matters more than usual here, because the difference this marks is
 * invisible everywhere else on the screen.
 */
@Composable
fun LocalOnlyOrderChip(modifier: Modifier = Modifier) {
    SemanticChip(
        role = SemanticRole.Warning,
        label = stringResource(R.string.order_local_only_chip),
        modifier = modifier,
    )
}

/** The full explanation, for the screens with room to give one. */
@Composable
fun LocalOnlyOrderBanner(modifier: Modifier = Modifier) {
    NoticeBanner(
        role = SemanticRole.Warning,
        title = stringResource(R.string.order_local_only_title),
        message = stringResource(R.string.order_local_only_message),
        modifier = modifier,
    )
}

