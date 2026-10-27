package app.orderak.seller.feature.products

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.Translate
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Surface
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import app.orderak.seller.core.ui.Fab
import app.orderak.seller.core.ui.Thumbnail
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.TopBarAction
import java.util.Locale
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDirection
import app.orderak.seller.R
import app.orderak.seller.core.money.formatAmountLabel
import app.orderak.seller.core.text.SearchText
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.core.ui.PlanUsageRowItem
import app.orderak.seller.core.ui.SearchField
import app.orderak.seller.core.ui.SemanticChip
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.billing.FeatureKeys
import app.orderak.seller.data.db.ProductEntity
import coil3.compose.AsyncImage
import java.io.File
import app.orderak.seller.core.ui.ErrorState
import app.orderak.seller.core.ui.ErrorStateKind
import app.orderak.seller.core.ui.EmptyState
import app.orderak.seller.core.ui.EmptyStateKind
import app.orderak.seller.core.ui.Skeleton
import app.orderak.seller.core.ui.SkeletonVariant

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
    /** True when the local Room read itself failed, not merely "not read yet". */
    val loadError: Boolean = false,
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
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenStoreInfo: () -> Unit = {},
    onOpenCategories: () -> Unit = {},
    onOpenLanguages: () -> Unit = {},
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    val catalogue = state.products
    val quota = state.quota
    val shareAction = TopBarAction(
        icon = Icons.Outlined.Share,
        description = stringResource(R.string.dash_share_catalog),
        onClick = onShare,
    )

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            TopBar(
                title = stringResource(R.string.nav_products),
                large = true,
                actions = if (catalogue.isNullOrEmpty()) emptyList() else listOf(shareAction),
            )
            // The pages of the store are one tap from here in every state, so a seller
            // with no products can still reach them.
            ManageRow(onOpenStoreInfo, onOpenCategories, onOpenLanguages)
            when {
                state.loadError -> {
                    // The local read failed, not the service, so the title names what
                    // could not be read. The retry is the point: this state was the end
                    // of the surface until `onRetry` existed.
                    ErrorState(
                        kind = ErrorStateKind.ServiceUnavailable,
                        title = stringResource(R.string.error_state_products_load_title),
                        message = stringResource(R.string.error_unknown),
                        onRetry = onRetry,
                    )
                }
                // Not read yet. The catalogue used to seed as an empty list, so a seller
                // with products met the "add your first product" page on every cold start.
                catalogue == null -> Skeleton(SkeletonVariant.ListRows, Modifier.padding(spacing.space4))
                catalogue.isEmpty() -> EmptyState(
                    kind = EmptyStateKind.Empty,
                    title = stringResource(R.string.store_empty_title),
                    message = stringResource(R.string.store_empty_body),
                    actionLabel = stringResource(R.string.store_empty_action),
                    onAction = { if (quota.canAdd) onAdd() else onLimitReached() },
                    icon = Icons.Outlined.Inbox,
                )
                else -> StoreList(state, query, onQueryChange, onEdit, onShowStuck, locale)
            }
        }
        // A day-one seller has the empty state's own button; a second control for the
        // same thing would only compete with it.
        if (!catalogue.isNullOrEmpty() && !state.loadError) {
            Fab(
                label = stringResource(if (quota.canAdd) R.string.store_add_product else R.string.product_add_locked_short),
                icon = if (quota.canAdd) Icons.Outlined.Add else Icons.Outlined.Lock,
                onClick = { if (quota.canAdd) onAdd() else onLimitReached() },
                modifier = Modifier.align(Alignment.BottomEnd).padding(spacing.space4),
            )
        }
    }
}

/** Store information, categories, catalogue languages: three tonal chips under the title. */
@Composable
private fun ManageRow(onInfo: () -> Unit, onCategories: () -> Unit, onLanguages: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = spacing.space4),
        horizontalArrangement = Arrangement.spacedBy(spacing.space2),
    ) {
        ManageChip(stringResource(R.string.store_info_title), Icons.Outlined.Storefront, onInfo)
        ManageChip(stringResource(R.string.store_manage_categories), Icons.Outlined.Sell, onCategories)
        ManageChip(stringResource(R.string.store_manage_languages), Icons.Outlined.Translate, onLanguages)
    }
}

@Composable
private fun ManageChip(label: String, icon: ImageVector, onClick: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
    AssistChip(
        onClick = onClick,
        label = { Text(label) },
        leadingIcon = { Icon(icon, contentDescription = null, modifier = Modifier.size(spacing.space6)) },
        colors = AssistChipDefaults.assistChipColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        border = null,
        modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
    )
}

@Composable
private fun StoreList(
    state: StoreUiState,
    query: String,
    onQueryChange: (String) -> Unit,
    onEdit: (Long) -> Unit,
    onShowStuck: () -> Unit,
    locale: Locale,
) {
    val spacing = LocalOrderakSpacing.current
    val quota = state.quota
    // Filtered in memory over what Room already holds, so search works with the network
    // off. Name and code both: a seller reading a code off a shelf label is the case a
    // name-only search cannot serve.
    val visible = state.products.orEmpty().filter { SearchText.matches(query, it.name, it.productCode) }
    Column(Modifier.fillMaxSize()) {
        // Above the meter, because it is about whether the catalogue is updating at all,
        // which outranks how close it is to the plan limit. Warning, not Danger: nothing
        // is lost and the products are still here.
        if (state.stuckCount > 0) {
            Banner(
                state = BannerState.Warning,
                title = stringResource(R.string.products_stuck_title),
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
        // The shared meter, the one the dashboard and the subscription page draw, so
        // "how close am I to the limit" reads the same wherever a seller meets it.
        PlanUsageRowItem(
            row = PlanUsageRow(
                key = FeatureKeys.MAX_PRODUCTS,
                label = R.string.usage_products,
                used = quota.used,
                limit = quota.limit,
            ),
            modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
        )
        SearchField(
            query = query,
            onQueryChange = onQueryChange,
            placeholder = stringResource(R.string.products_search_hint),
            modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space1),
        )
        // A query that matches nothing is not an empty catalogue. The same sentence for
        // both would read as "your products are gone", so this names the query and
        // offers the way back to the full list.
        if (visible.isEmpty()) {
            EmptyState(
                kind = EmptyStateKind.FilteredToNothing,
                title = stringResource(R.string.products_search_empty, query),
                actionLabel = stringResource(R.string.search_clear_action),
                onAction = { onQueryChange("") },
            )
        } else {
            LazyColumn(
                contentPadding = PaddingValues(spacing.space4),
                verticalArrangement = Arrangement.spacedBy(spacing.space2),
            ) {
                items(visible, key = { it.id }) { p -> ProductRow(p, onClick = { onEdit(p.id) }) }
                item { Spacer(Modifier.height(spacing.fabClearance)) }
            }
        }
    }
}

/**
 * A product: thumbnail, name, "price, then what is left", and a chip only when it
 * matters: sold out (warning) or hidden from the storefront (neutral). The chip carries
 * an icon and a word as well as a colour, so it survives greyscale and bright sun.
 */
@Composable
internal fun ProductRow(p: ProductEntity, onClick: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
    ) {
        Row(
            Modifier
                .defaultMinSize(minHeight = spacing.minimumTouchTarget)
                .padding(spacing.space3),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(spacing.space3),
        ) {
            Thumbnail(size = spacing.thumbnail) {
                if (p.imagePath != null) {
                    AsyncImage(
                        model = File(p.imagePath),
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    Icon(Icons.Outlined.Image, contentDescription = null, tint = MaterialTheme.colorScheme.outline)
                }
            }
            Column(Modifier.weight(1f)) {
                Text(
                    p.name,
                    style = MaterialTheme.typography.titleMedium.copy(textDirection = TextDirection.Content),
                )
                // Not interpolated: a template has no locale, and the price beside the
                // count is already in the locale digits. See core/text/Counts.kt.
                Text(
                    stringResource(
                        R.string.store_row_detail,
                        formatAmountLabel(p.priceMinor, p.currency, locale),
                        formatCount(p.stock, locale),
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            when {
                p.stock <= 0 -> SemanticChip(SemanticRole.Warning, stringResource(R.string.store_row_out))
                !p.available -> SemanticChip(SemanticRole.Neutral, stringResource(R.string.store_row_hidden))
            }
        }
    }
}
