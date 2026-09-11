package app.orderak.seller.feature.orders

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.orderak.seller.R
import app.orderak.seller.core.ui.NoticeBanner
import app.orderak.seller.core.ui.SemanticChip
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.backendErrorResource
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
 * WHY THERE ARE NOW TWO STATES AND NOT ONE
 *   "Waiting" was the only thing this could say, and for one class of order it
 *   was never going to become true. The server refuses an order outright when it
 *   cannot accept it as it stands — a payment method this store has not
 *   configured, a product that no longer exists, a plan limit already reached —
 *   and it will refuse the identical payload on every later attempt. Telling
 *   that seller it will "send on the next sync" was the app asserting something
 *   it had already been told was false, and the only action it offered them was
 *   the one that could not work.
 *
 *   So a refusal is drawn as a refusal, with the server's own reason, and the
 *   screen offers the action that does work: remove the order and take the stock
 *   back. See OrderRepository.discardLocalOnlyOrder.
 *
 * WHY IT KEYS OFF remoteId
 *   `remoteId` is the per-store order number, written when the server accepts
 *   the order. An order that has one is on the account; an order without one is
 *   not, whatever the reason. So the marker needs no state of its own and clears
 *   itself the instant the post succeeds. The refusal reason is carried
 *   alongside rather than stored, because it only changes what the app SAYS —
 *   never whether the order is on the account.
 */
val OrderEntity.livesOnlyOnThisPhone: Boolean
    get() = remoteId == null

/**
 * The list marker.
 *
 * Warning for an order still on its way — nothing has failed and the seller has
 * done nothing wrong. Danger for one the server refused, because that one will
 * not resolve itself and does need them. SemanticChip pairs each role's colour
 * with its own icon and label, so the difference survives greyscale, colour
 * blindness and a phone in the sun — which matters more than usual here,
 * because it is invisible everywhere else on the row.
 */
@Composable
fun LocalOnlyOrderChip(refused: Boolean = false, modifier: Modifier = Modifier) {
    SemanticChip(
        role = if (refused) SemanticRole.Danger else SemanticRole.Warning,
        label = stringResource(
            if (refused) R.string.order_refused_chip else R.string.order_local_only_chip,
        ),
        modifier = modifier,
    )
}

/**
 * The full explanation, for the screens with room to give one.
 *
 * [refusalCode] is the stable backend code, or null while the order is simply
 * waiting. It is rendered through [backendErrorResource] so the seller reads the
 * same sentence for "plan limit reached" here as everywhere else in the app, and
 * so a code nobody has mapped yet still produces a sentence rather than a blank.
 */
@Composable
fun LocalOnlyOrderBanner(
    refusalCode: String? = null,
    modifier: Modifier = Modifier,
    onDiscard: (() -> Unit)? = null,
) {
    if (refusalCode == null) {
        NoticeBanner(
            role = SemanticRole.Warning,
            title = stringResource(R.string.order_local_only_title),
            message = stringResource(R.string.order_local_only_message),
            modifier = modifier,
        )
        return
    }
    NoticeBanner(
        role = SemanticRole.Danger,
        title = stringResource(R.string.order_refused_title),
        message = stringResource(
            R.string.order_refused_message,
            stringResource(backendErrorResource(refusalCode)),
        ),
        modifier = modifier,
        // The action sits on the banner that explains why it is needed, rather
        // than among the pipeline buttons below — which are all correctly
        // disabled for an order the server does not have, and which this is not
        // one of.
        actionLabel = onDiscard?.let { stringResource(R.string.order_refused_discard) },
        onAction = onDiscard,
    )
}
