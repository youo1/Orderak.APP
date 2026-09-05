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
 *   An order the seller records by hand is written to Room and never sent
 *   anywhere. There is no POST /api/v1/orders — the app can read orders and
 *   change their status, and it cannot create one. So a manual order is not in
 *   the account: it does not appear on a second device, it does not survive a
 *   reinstall, and it is not counted against the plan.
 *
 *   Until it is, saying nothing is the worst of the options. The seller reads a
 *   confirmation, sees the order in the list beside the ones that ARE on the
 *   account, and has no way to tell the difference. Telling them plainly turns
 *   silent data loss into a stated limitation, which is a much smaller problem
 *   and an honest one.
 *
 * WHY IT KEYS OFF remoteId
 *   `remoteId` is set only by the inbound pull. An order that has one came from
 *   the server and is therefore on the account; an order without one has never
 *   been anywhere else. When work item 05 posts manual orders and reconciles the
 *   server's answer, these orders start carrying a remoteId as a matter of
 *   course and every marker below disappears on its own. That is the intended
 *   end: this file is meant to be deleted, not maintained.
 *
 * WHY IT IS NOT THE EXISTING sync_pending COPY
 *   `sync_pending` says "Saved on this device. Waiting to sync." That is true of
 *   a change that will sync. Nothing here is waiting for anything, and telling a
 *   seller to wait for something that is not coming is worse than the silence it
 *   replaces.
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

/** Shown before the seller records an order, not after. */
@Composable
fun ManualOrderLimitationBanner(modifier: Modifier = Modifier) {
    NoticeBanner(
        role = SemanticRole.Warning,
        title = stringResource(R.string.order_new_local_only_title),
        message = stringResource(R.string.order_new_local_only_message),
        modifier = modifier,
    )
}
