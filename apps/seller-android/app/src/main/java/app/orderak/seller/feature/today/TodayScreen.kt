package app.orderak.seller.feature.today

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Schedule
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.NoticeBanner
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.colors
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

/**
 * The three counters, and what each one opens.
 *
 * Kept next to the surface that draws them so the label, the number and the
 * destination are one decision. Each counter previously opened the unfiltered
 * orders list: tapping "لسه مدفعوش ٣" showed everything, which is a control
 * that lies about where it goes.
 */
enum class TodayCounter(
    val labelRes: Int,
    val role: SemanticRole,
) {
    /** Created since local midnight. Neutral: a count, not a call to act. */
    Today(R.string.dash_today_orders, SemanticRole.Neutral),

    /** Money not taken yet. The one worth interrupting a seller for. */
    Unpaid(R.string.dash_unpaid, SemanticRole.Warning),

    /** Paid and waiting to leave the shop. */
    ToShip(R.string.dash_to_ship, SemanticRole.Success),
}

/**
 * Everything اليوم draws, as data.
 *
 * A plain parameter object rather than a view model: the surface was a private
 * `DashboardTab` inside a 450-line `MainScreen.kt`, which is exactly why it had
 * never been screenshot-tested. Stateless, it renders from a literal in a test.
 *
 * Counts are nullable because "not read yet" and "none" are different things and
 * the surface has to say which — see [MainViewModel.todayCount].
 */
data class TodayUiState(
    val shopName: String? = null,
    val todayCount: Int? = null,
    val unpaidCount: Int? = null,
    val toShipCount: Int? = null,
    /** null until the catalogue count has been read — see [MainViewModel.hasProducts]. */
    val hasProducts: Boolean? = null,
    /** Non-null when the last plan refresh failed. The state the surface never had. */
    val planError: String? = null,
    val unreadAnnouncements: Int = 0,
    /** True once a plan snapshot exists, fresh or cached. */
    val hasPlanSnapshot: Boolean = false,
    /** Cached plan limits are being shown because the network is unreachable. */
    val usingOfflinePlan: Boolean = false,
)

/**
 * S4 — the daily habit: what happened today, what is owed, what is going out.
 *
 * WHAT CHANGED AND WHY
 *   Four states are declared in this surface's contract (`screen-contracts.mjs`)
 *   and two of them had no code at all: `loading` rendered counters as `0`, and
 *   `error` was computed into `EntitlementSyncState.error` and never shown. Both
 *   had named artboards in the design coverage map, so nothing failed — the
 *   coverage check asserts an artboard exists, never that a state is built.
 */
@Composable
fun TodayScreen(
    state: TodayUiState,
    onOpenCounter: (TodayCounter) -> Unit,
    onShareCatalog: () -> Unit,
    onOpenAnnouncements: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    planNotices: @Composable () -> Unit = {},
    planUsage: @Composable () -> Unit = {},
    footer: @Composable () -> Unit = {},
) {
    val spacing = LocalOrderakSpacing.current
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(spacing.space4),
        verticalArrangement = Arrangement.spacedBy(spacing.space4),
    ) {
        item {
            Text(
                stringResource(R.string.dash_greeting, state.shopName.orEmpty()),
                style = MaterialTheme.typography.titleLarge,
            )
        }

        item { planNotices() }

        // The error the surface used to swallow. Above the counters because it
        // explains why the figures beneath it may be behind, and it carries the
        // action that fixes it rather than leaving the seller to find one.
        state.planError?.let { message ->
            item {
                NoticeBanner(
                    role = SemanticRole.Danger,
                    title = stringResource(R.string.sync_failed),
                    message = message,
                    actionLabel = stringResource(R.string.common_retry),
                    onAction = onRetry,
                )
            }
        }

        // ── What is waiting on the seller ──
        //
        // These three counters were one row of equal weight, so the surface
        // answered "here are three numbers" rather than this contract's question,
        // which is "what needs me now". The enum above already ranks them —
        // Unpaid is "the one worth interrupting a seller for" — and the layout
        // contradicted the code that draws it. Unpaid and to-ship are the two that
        // are waiting on somebody; today's total is a figure, not a request, and
        // it moved below.
        item {
            Text(
                stringResource(R.string.dash_needs_you),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { heading() },
            )
        }

        val unpaidValue = state.unpaidCount
        val toShipValue = state.toShipCount
        val waiting = buildList {
            unpaidValue?.takeIf { it > 0 }?.let { add(TodayCounter.Unpaid to it) }
            toShipValue?.takeIf { it > 0 }?.let { add(TodayCounter.ToShip to it) }
        }
        val countsKnown = unpaidValue != null && toShipValue != null
        item {
            when {
                // Still reading. The cards keep their shape with a skeleton inside,
                // because "not known yet" and "none" are different facts.
                !countsKnown -> Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(spacing.space2),
                ) {
                    CounterCard(
                        counter = TodayCounter.Unpaid,
                        value = null,
                        onClick = { onOpenCounter(TodayCounter.Unpaid) },
                        modifier = Modifier.weight(1f),
                    )
                    CounterCard(
                        counter = TodayCounter.ToShip,
                        value = null,
                        onClick = { onOpenCounter(TodayCounter.ToShip) },
                        modifier = Modifier.weight(1f),
                    )
                }

                // The other half of the criterion, which the surface never said:
                // "or explicitly shows that there is nothing". Three neutral zeros
                // said "here are zeros", and a seller had to read all three and
                // decide for themselves that the answer was nothing.
                waiting.isEmpty() -> NothingWaiting()

                else -> Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(spacing.space2),
                ) {
                    waiting.forEach { (counter, value) ->
                        CounterCard(
                            counter = counter,
                            value = value,
                            onClick = { onOpenCounter(counter) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }

        // ── What merely happened today ──
        //
        // Demoted deliberately. It is the one figure on this surface that asks
        // nothing of the seller, and it used to sit in the same row at the same
        // size as the two that do.
        item {
            val locale = LocalConfiguration.current.locales[0]
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = spacing.minimumTouchTarget)
                    .clickable { onOpenCounter(TodayCounter.Today) },
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surfaceContainerLow,
            ) {
                Row(
                    Modifier.padding(horizontal = spacing.space4, vertical = spacing.space3),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        stringResource(R.string.dash_day_so_far),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        // Same locale-aware digits as every other figure here.
                        state.todayCount?.let { formatCount(it, locale) }
                            ?: stringResource(R.string.dash_count_unknown),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.width(spacing.space2))
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                        contentDescription = null,
                        modifier = Modifier.size(spacing.iconSmall),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        item { planUsage() }

        // Nothing at all until the catalogue count is known. Guessing here is
        // what told a seller with a full shop to add their first product.
        if (state.hasProducts != null) {
            item {
            Card(Modifier.fillMaxWidth()) {
                Column(
                    Modifier.fillMaxWidth().padding(spacing.space6),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(spacing.space2),
                ) {
                    if (!state.hasProducts) {
                        Text(
                            stringResource(R.string.dash_empty_title),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            stringResource(R.string.dash_empty_body_v2),
                            style = MaterialTheme.typography.bodyMedium,
                            textAlign = TextAlign.Center,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        Button(
                            onClick = onShareCatalog,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = spacing.minimumTouchTarget),
                        ) {
                            Icon(Icons.Outlined.Share, contentDescription = null)
                            Text(
                                stringResource(R.string.dash_share_catalog),
                                Modifier.padding(start = spacing.space2),
                            )
                        }
                    }
                }
            }
            }
        }

        item { footer() }
    }
}

/**
 * One counter.
 *
 * The whole card is the target, not the number: a seller reaching one-handed at
 * a counter gets the full 88dp rather than the glyph. Role carries colour, an
 * icon and a label together, so the difference survives greyscale and sunlight —
 * the rule `SemanticChip` already sets for this app.
 */
@Composable
private fun CounterCard(
    counter: TodayCounter,
    value: Int?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    val label = stringResource(counter.labelRes)
    // A zero is not worth colouring as a warning: nothing is owed, so the card
    // reads as neutral until there is something to act on.
    val role = if (value == null || value == 0) SemanticRole.Neutral else counter.role
    val palette = role.colors()
    Surface(
        modifier = modifier
            .heightIn(min = 88.dp)
            .clickable(onClick = onClick)
            // One announcement for the card, so a screen reader says the label
            // and the figure instead of reading three nested nodes.
            .clearAndSetSemantics {
                contentDescription =
                    if (value == null) label else "$label: ${formatCount(value, locale)}"
            },
        shape = RoundedCornerShape(spacing.space4),
        color = palette.container,
        contentColor = palette.onContainer,
        border = BorderStroke(1.dp, palette.containerOutline),
    ) {
        Column(
            Modifier.padding(spacing.space3),
            verticalArrangement = Arrangement.spacedBy(spacing.space1),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = when (counter) {
                        TodayCounter.Today -> Icons.Outlined.CalendarMonth
                        TodayCounter.Unpaid -> Icons.Outlined.Schedule
                        TodayCounter.ToShip -> Icons.Outlined.LocalShipping
                    },
                    contentDescription = null,
                    modifier = Modifier.size(spacing.iconSmall),
                )
                Spacer(Modifier.weight(1f))
                // Says the card goes somewhere. Without it the counters read as
                // read-out figures, which is what they were: three cards that
                // all opened the same unfiltered list. AutoMirrored so it points
                // the way the language travels.
                Icon(
                    imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
            }
            if (value == null) {
                // Loading. A skeleton says "not known yet"; a 0 would say
                // "known, and it is none" — a different fact the seller acts on.
                CounterSkeleton(palette.containerOutline)
            } else {
                Text(
                    // Not value.toString(): these three figures sat in Latin
                    // digits under an Arabic greeting. See core/text/Counts.kt.
                    formatCount(value, locale),
                    style = MaterialTheme.typography.headlineSmall,
                )
            }
            Text(label, style = MaterialTheme.typography.labelMedium)
        }
    }
}

/**
 * The sentence the surface owed the seller when the answer was "nothing".
 *
 * G2 asks for one of two answers at first paint, and this is the second: "or
 * explicitly shows that there is nothing". Without it, three neutral zeros left
 * the seller to read all three and conclude it themselves — and the same three
 * zeros were drawn while the counts were still being read, which is a different
 * fact that the seller acted on.
 *
 * Calm on purpose: `Neutral`, not a success colour. Nothing being owed is the
 * normal state of a healthy shop, and a green badge for it would make the
 * exceptional day harder to see when it arrives.
 */
@Composable
private fun NothingWaiting() {
    val spacing = LocalOrderakSpacing.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(
            Modifier.padding(spacing.space4),
            verticalArrangement = Arrangement.spacedBy(spacing.space1),
        ) {
            Text(
                stringResource(R.string.dash_nothing_needs_you),
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                stringResource(R.string.dash_nothing_needs_you_body),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun CounterSkeleton(tint: Color) {
    val spacing = LocalOrderakSpacing.current
    Surface(
        modifier = Modifier.width(spacing.space8).height(spacing.space6),
        shape = RoundedCornerShape(spacing.space1),
        color = tint.copy(alpha = 0.35f),
        content = {},
    )
}
