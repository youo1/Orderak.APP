package app.orderak.seller.feature.products

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Card
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.money.formatAmountLabel
import app.orderak.seller.core.text.SearchText
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.FullScreenEmpty
import app.orderak.seller.core.ui.FullScreenLoading
import app.orderak.seller.core.ui.NoticeBanner
import app.orderak.seller.core.ui.SearchField
import app.orderak.seller.core.ui.SemanticChip
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.UsageMeter
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.db.ProductEntity
import coil3.compose.AsyncImage
import java.io.File

/**
 * المتجر, as a function of its state.
 *
 * WHY THIS IS SEPARATE FROM ProductsScreen
 *   `ProductsScreen` reads six flows off a Hilt view model, so nothing can
 *   render it without a running graph — which is why a screen with four
 *   declared states had screenshot renders of none of them. What existed
 *   instead were renders of `FullScreenEmpty` called directly by the test,
 *   which stay green whatever this screen decides to show.
 *
 *   Splitting the decision out means the states become literals, and the
 *   renders prove the screen rather than the components it happens to use
 *   today. `render-coverage.mjs` is where that distinction is enforced.
 *
 * The dialogs stay behind in `ProductsScreen`: they are a conversation, not a
 * state of the surface, and the contract does not declare them.
 */
data class StoreUiState(
    /** null until Room answers. Not `emptyList()` — see the empty branch below. */
    val products: List<ProductEntity>? = null,
    val quota: ProductQuotaUiState = ProductQuotaUiState(),
    /** Saved here, never reached the account. Blocks the catalogue refresh. */
    val stuckCount: Int = 0,
)

@Composable
fun StoreContent(
    state: StoreUiState,
    query: String,
    onQueryChange: (String) -> Unit,
    onAdd: () -> Unit,
    onLimitReached: () -> Unit,
    onEdit: (Long) -> Unit,
    onShare: () -> Unit,
    onShowStuck: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    val catalogue = state.products
    val quota = state.quota

    if (catalogue == null) {
        // The state this screen declared and never had. The catalogue seeded as
        // an empty list, so a seller with products met the "add your first
        // product" screen on every cold start until Room answered.
        FullScreenLoading(modifier)
        return
    }
    if (catalogue.isEmpty()) {
        // WAS `products.isEmpty() && quota.limit == null`, and the second half
        // was the bug. A limit is the normal case — free is 20 — so a new seller
        // fell through to the branch below, where an empty catalogue and an
        // empty SEARCH are the same test. They were shown
        // «مفيش منتج مطابق لـ «»» and a "clear search" button, for a search they
        // had not typed, on the first screen of their first session.
        FullScreenEmpty(
            message = stringResource(R.string.products_empty),
            icon = Icons.Outlined.Inbox,
            modifier = modifier,
        )
        return
    }

    // Filtered in memory over what Room already holds, so search works with the
    // network off. Name and code both, because a seller reading a code off a
    // shelf label is the case a name-only search cannot serve.
    val visible = catalogue.filter { SearchText.matches(query, it.name, it.productCode) }

    Column(modifier.fillMaxSize()) {
        // Above the meter, because it is about whether the catalogue is
        // updating at all — which outranks how close it is to the plan
        // limit. Warning rather than Danger: nothing is lost, and the
        // products are still here.
        if (state.stuckCount > 0) {
            NoticeBanner(
                role = SemanticRole.Warning,
                title = stringResource(R.string.products_stuck_title),
                // The count picks the plural form; the digits it prints are a
                // separate question, and Arabic answers the two differently.
                message = pluralStringResource(
                    R.plurals.products_stuck_body,
                    state.stuckCount,
                    formatCount(state.stuckCount, locale),
                ),
                actionLabel = stringResource(R.string.products_stuck_action),
                onAction = onShowStuck,
                modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
            )
        }
        // The shared meter rather than a sentence: the same component the
        // dashboard and the subscription screen use, so "how close am I to
        // the limit" reads identically wherever a seller meets it.
        val limitValue = quota.limit
        if (limitValue != null) {
            UsageMeter(
                label = stringResource(R.string.nav_products),
                used = quota.used,
                limit = limitValue,
                modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
            )
        } else {
            Text(
                text = stringResource(R.string.products_usage_unlimited, formatCount(quota.used, locale)),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
            )
        }
        SearchField(
            query = query,
            onQueryChange = onQueryChange,
            placeholder = stringResource(R.string.products_search_hint),
            modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space1),
        )
        Box(Modifier.fillMaxWidth().weight(1f)) {
            // A query that matches nothing is not an empty catalogue. Same
            // sentence for both would read as "your products are gone", so
            // this names the query and offers the way back to the full list.
            if (visible.isEmpty()) {
                FullScreenEmpty(
                    message = stringResource(R.string.products_search_empty, query),
                    actionLabel = stringResource(R.string.search_clear_action),
                    onAction = { onQueryChange("") },
                )
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(spacing.space4),
                    verticalArrangement = Arrangement.spacedBy(spacing.space2),
                ) {
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            IconButton(onClick = onShare) {
                                Icon(
                                    Icons.Outlined.Share,
                                    contentDescription = stringResource(R.string.dash_share_catalog),
                                )
                            }
                        }
                    }
                    items(visible, key = { it.id }) { p ->
                        ProductCard(p, onClick = { onEdit(p.id) })
                    }
                    item { Spacer(Modifier.height(80.dp)) }
                }
            }
            FloatingActionButton(
                onClick = { if (quota.canAdd) onAdd() else onLimitReached() },
                modifier = Modifier.align(Alignment.BottomEnd).padding(spacing.space4),
                containerColor = if (quota.canAdd) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                },
            ) {
                Icon(
                    if (quota.canAdd) Icons.Filled.Add else Icons.Filled.Lock,
                    contentDescription = stringResource(
                        if (quota.canAdd) R.string.product_add_title else R.string.product_add_locked,
                    ),
                )
            }
        }
    }
}

@Composable
internal fun ProductCard(p: ProductEntity, onClick: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick).semantics(mergeDescendants = true) {}) {
        Row(Modifier.padding(spacing.space3), verticalAlignment = Alignment.CenterVertically) {
            if (p.imagePath != null) {
                AsyncImage(
                    model = File(p.imagePath),
                    contentDescription = null,
                    modifier = Modifier.size(56.dp).clip(RoundedCornerShape(10.dp)),
                )
            } else {
                Box(
                    Modifier.size(56.dp).clip(RoundedCornerShape(10.dp)),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.Image, contentDescription = null, tint = MaterialTheme.colorScheme.outline) }
            }
            Spacer(Modifier.width(spacing.space3))
            Column(Modifier.weight(1f)) {
                Text(
                    p.name,
                    style = MaterialTheme.typography.titleMedium.copy(
                        textDirection = TextDirection.Content,
                    ),
                )
                Text(
                    formatAmountLabel(p.priceMinor, p.currency, locale),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            // Low stock used to be the number in red and nothing else, which is
            // invisible to a colour-blind seller and to anyone in bright sun. The
            // chip carries an icon and a word as well.
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                if (p.stock <= LOW_STOCK_THRESHOLD) {
                    SemanticChip(
                        role = if (p.stock <= 0) SemanticRole.Danger else SemanticRole.Warning,
                        label = if (p.stock <= 0) {
                            stringResource(R.string.product_stock_out)
                        } else {
                            stringResource(R.string.product_stock_low, formatCount(p.stock, locale))
                        },
                    )
                } else {
                    // Not "${p.stock}": interpolation has no locale, so this
                    // column printed Latin digits beside an Arabic-Indic price in
                    // the same card — and changed form whenever the low-stock chip
                    // took over. See core/text/Counts.kt.
                    Text(formatCount(p.stock, locale), style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.product_stock_label), style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

/** Stock at or below this draws a warning; at or below zero, a failure. */
private const val LOW_STOCK_THRESHOLD = 2
