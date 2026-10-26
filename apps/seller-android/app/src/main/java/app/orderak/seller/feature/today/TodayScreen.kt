package app.orderak.seller.feature.today

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import app.orderak.seller.R
import app.orderak.seller.core.money.Money
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.CountText
import app.orderak.seller.core.ui.MetricTile
import app.orderak.seller.core.ui.MoneyText
import app.orderak.seller.core.ui.SectionHeader
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.StepItem
import app.orderak.seller.core.ui.StepList
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.TopBarAction
import app.orderak.seller.core.ui.isolated
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.feature.orders.OrderCard

/**
 * The counters, and what each one opens.
 *
 * Kept next to the surface that draws them so the label, the number and the
 * destination are one decision. Each counter previously opened the unfiltered
 * orders list: tapping an "unpaid 3" showed everything, which is a control
 * that lies about where it goes.
 *
 * [New], [Unpaid] and [ToShip] are the three tiles, in the order an order moves
 * through the shop. [Today] is the summary row: a figure, not a request.
 */
enum class TodayCounter(
    val labelRes: Int,
    val role: SemanticRole,
) {
    /** Waiting to be confirmed. */
    New(R.string.today_counter_new, SemanticRole.Info),

    /** Money not taken yet. The one worth interrupting a seller for. */
    Unpaid(R.string.today_counter_unpaid, SemanticRole.Warning),

    /** Paid and waiting to leave the shop. */
    ToShip(R.string.today_counter_to_ship, SemanticRole.Success),

    /** Created since local midnight. Neutral: a count, not a call to act. */
    Today(R.string.today_orders_today, SemanticRole.Neutral),
}

/**
 * Everything اليوم draws, as data.
 *
 * A plain parameter object rather than a view model, so each state renders from
 * a literal in a test. Counts are nullable because "not read yet" and "none" are
 * different things and the surface has to say which — see
 * [app.orderak.seller.feature.main.MainViewModel.todayCount].
 *
 * Every figure here is on the device: nothing on this surface needs the network.
 */
data class TodayUiState(
    val shopName: String? = null,
    val newCount: Int? = null,
    val unpaidCount: Int? = null,
    val toShipCount: Int? = null,
    val todayCount: Int? = null,
    /** null until the catalogue count has been read — see `MainViewModel.hasProducts`. */
    val hasProducts: Boolean? = null,
    /** The local summary could not be read. Not the same as there being nothing. */
    val summaryFailed: Boolean = false,
    val unreadAnnouncements: Int = 0,
    /** The newest orders that are not finished, newest first. */
    val latestOrders: List<OrderEntity> = emptyList(),
    /** This month's sales in one currency; null when there is no order this month. */
    val monthSales: Money? = null,
    /** The link the seller shares, as stored. */
    val storeUrl: String? = null,
    /**
     * Non-null when the last plan refresh failed. It moves to the subscription
     * screen with the plan itself (phase R9); until that screen takes it, the
     * seller must not lose the only place that says so.
     */
    val planError: String? = null,
)

/**
 * اليوم: what is waiting for the seller now, and one tap to get to it.
 *
 * Top to bottom: the greeting and the bell; notices; what is waiting (three
 * tiles in the order an order moves through the shop); the newest orders that
 * still need the seller; the day so far; the store link; the plan, only when it
 * needs the seller; the ad. With no products the surface is one invitation to add
 * the first one, and the checklist of what setup left.
 */
@Composable
fun TodayScreen(
    state: TodayUiState,
    onOpenCounter: (TodayCounter) -> Unit,
    onOpenOrder: (Long) -> Unit,
    onShareCatalog: () -> Unit,
    onAddProduct: () -> Unit,
    onOpenAnnouncements: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    planNotices: @Composable () -> Unit = {},
    planUsage: @Composable () -> Unit = {},
    footer: @Composable () -> Unit = {},
) {
    val spacing = LocalOrderakSpacing.current
    Column(modifier.fillMaxSize()) {
        TopBar(
            title = stringResource(R.string.today_hello),
            subtitle = state.shopName,
            large = true,
            actions = listOf(
                TopBarAction(
                    icon = Icons.Outlined.Notifications,
                    description = stringResource(R.string.announcements_title),
                    onClick = onOpenAnnouncements,
                    dot = state.unreadAnnouncements > 0,
                ),
            ),
        )
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(start = spacing.space4, end = spacing.space4, bottom = spacing.space4),
            verticalArrangement = Arrangement.spacedBy(spacing.space4),
        ) {
            item { planNotices() }

            // The error the surface used to swallow. Above the figures because it
            // explains why they may be behind, and it carries the action that fixes it.
            state.planError?.let { message ->
                item {
                    Banner(
                        state = BannerState.Error,
                        title = stringResource(R.string.sync_failed),
                        message = message,
                        actionLabel = stringResource(R.string.common_retry),
                        onAction = onRetry,
                    )
                }
            }

            if (state.summaryFailed) {
                item {
                    Banner(
                        state = BannerState.Error,
                        title = stringResource(R.string.today_error_title),
                        actionLabel = stringResource(R.string.common_retry),
                        onAction = onRetry,
                    )
                }
            }

            if (state.hasProducts == false) {
                // An order needs a product, so with none the surface has one thing
                // to say: add the first. The checklist is what setup left for later.
                item { FirstProduct(onAddProduct) }
            } else {
                item { Waiting(state, onOpenCounter) }

                if (state.latestOrders.isNotEmpty()) {
                    item {
                        SectionHeader(
                            title = stringResource(R.string.today_section_latest),
                            actionLabel = stringResource(R.string.today_view_all),
                            onAction = { onOpenCounter(TodayCounter.Today) },
                        )
                    }
                    items(state.latestOrders, key = { it.id }) { order ->
                        OrderCard(order, onClick = { onOpenOrder(order.id) })
                    }
                }

                item { DaySoFar(state, onOpen = { onOpenCounter(TodayCounter.Today) }) }

                if (state.hasProducts == true) {
                    item { StoreLink(state.storeUrl, onShareCatalog) }
                }
            }

            item { planUsage() }
            item { footer() }
        }
    }
}

/** The three tiles, or the sentence that says nothing is waiting. */
@Composable
private fun Waiting(state: TodayUiState, onOpenCounter: (TodayCounter) -> Unit) {
    val spacing = LocalOrderakSpacing.current
    val counts = listOf(
        TodayCounter.New to state.newCount,
        TodayCounter.Unpaid to state.unpaidCount,
        TodayCounter.ToShip to state.toShipCount,
    )
    val known = counts.all { it.second != null }
    Column(verticalArrangement = Arrangement.spacedBy(spacing.space2)) {
        SectionHeader(title = stringResource(R.string.today_section_waiting))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(spacing.space2)) {
            counts.forEach { (counter, value) ->
                // A zero is not worth colouring: nothing is owed, so the tile is neutral.
                val role = if (value == null || value == 0) SemanticRole.Neutral else counter.role
                MetricTile(
                    label = stringResource(counter.labelRes),
                    value = value,
                    role = role,
                    onClick = { onOpenCounter(counter) },
                    modifier = Modifier.weight(1f),
                    // Counts start unread. Still reading is a placeholder; a read that
                    // failed is a dash, and the banner above says why.
                    loading = value == null && !state.summaryFailed,
                    notReadDescription = stringResource(R.string.struct_not_read),
                )
            }
        }
        // The other half of the question, which the surface owes: "or explicitly
        // shows that there is nothing". Calm on purpose: nothing being owed is the
        // normal state of a healthy shop, and a success colour would make the
        // exceptional day harder to see.
        if (known && counts.all { it.second == 0 }) {
            Text(
                stringResource(R.string.dash_nothing_needs_you),
                style = MaterialTheme.typography.titleSmall,
            )
            Text(
                stringResource(R.string.dash_nothing_needs_you_body),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** What merely happened: today's orders and, when there are any, the month's sales. */
@Composable
private fun DaySoFar(state: TodayUiState, onOpen: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(
            Modifier
                .heightIn(min = spacing.minimumTouchTarget)
                .padding(horizontal = spacing.space4, vertical = spacing.space3),
            verticalArrangement = Arrangement.spacedBy(spacing.space2),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.today_orders_today),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                val today = state.todayCount
                when {
                    today != null -> CountText(today)
                    // A read that failed is a dash; one still under way says it is not known yet.
                    state.summaryFailed -> Text("—")
                    else -> Text(stringResource(R.string.dash_count_unknown))
                }
            }
            state.monthSales?.let { sales ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        stringResource(R.string.today_sales_month),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    MoneyText(sales)
                }
            }
        }
    }
}

/** The link the seller shares, as it is, with the way to share it. */
@Composable
private fun StoreLink(url: String?, onShare: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
    Card(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().padding(spacing.space4),
            verticalArrangement = Arrangement.spacedBy(spacing.space2),
        ) {
            Text(stringResource(R.string.today_link_title), style = MaterialTheme.typography.titleSmall)
            if (!url.isNullOrBlank()) {
                Text(
                    // A link is a left-to-right run whatever the language around it.
                    text = isolated(url.removePrefix("https://")),
                    style = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Ltr),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Start,
                )
            }
            Button(
                onClick = onShare,
                modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
            ) {
                Icon(Icons.Outlined.Share, contentDescription = null)
                Text(stringResource(R.string.today_link_share), Modifier.padding(start = spacing.space2))
            }
        }
    }
}

/** No products yet: one invitation, and what setup left for later. */
@Composable
private fun FirstProduct(onAddProduct: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
    Card(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().padding(spacing.space6),
            verticalArrangement = Arrangement.spacedBy(spacing.space4),
        ) {
            Text(stringResource(R.string.today_empty_title), style = MaterialTheme.typography.titleMedium)
            StepList(
                steps = listOf(
                    StepItem(
                        stringResource(R.string.struct_setup_created),
                        stringResource(R.string.struct_setup_created_detail),
                        done = true,
                    ),
                    StepItem(
                        stringResource(R.string.struct_setup_product),
                        stringResource(R.string.struct_setup_product_detail),
                        done = false,
                    ),
                    StepItem(
                        stringResource(R.string.struct_setup_share),
                        stringResource(R.string.struct_setup_share_detail),
                        done = false,
                    ),
                ),
            )
            Button(
                onClick = onAddProduct,
                modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
            ) { Text(stringResource(R.string.today_empty_action)) }
        }
    }
}
