package app.orderak.seller.feature.products

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.R
import app.orderak.seller.core.money.exponentOf
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.BottomActionBar
import app.orderak.seller.core.ui.ConfirmSheet
import app.orderak.seller.core.ui.ConfirmSheetState
import app.orderak.seller.core.ui.ImagePickerState
import app.orderak.seller.core.ui.ImagePickerTile
import app.orderak.seller.core.ui.MoneyField
import app.orderak.seller.core.ui.PickerOption
import app.orderak.seller.core.ui.PickerSheet
import app.orderak.seller.core.ui.PickerSheetMode
import app.orderak.seller.core.ui.SelectField
import app.orderak.seller.core.ui.Skeleton
import app.orderak.seller.core.ui.SkeletonVariant
import app.orderak.seller.core.ui.Stepper
import app.orderak.seller.core.ui.SwitchRow
import app.orderak.seller.core.ui.TextField
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.billing.FeatureKeys
import app.orderak.seller.data.db.CategoryEntity
import coil3.compose.AsyncImage
import java.io.File

/** S9 — photo-first product form (camera capture arrives with CameraX; photo picker now). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductEditScreen(
    onBack: () -> Unit,
    onLimitReached: (String) -> Unit = {},
    viewModel: ProductEditViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val categories by viewModel.categories.collectAsStateWithLifecycle()
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) {
        viewModel.onImagePicked(it)
    }

    ProductEditContent(
        state = state,
        categories = categories,
        confirmDelete = confirmDelete,
        actions = ProductEditActions(
            onName = viewModel::onName,
            onDescription = viewModel::onDescription,
            onPrice = viewModel::onPrice,
            onStock = viewModel::onStock,
            onAvailable = viewModel::onAvailable,
            onCategory = viewModel::onCategory,
            save = viewModel::save,
            delete = viewModel::delete,
            acceptShopStock = viewModel::acceptShopStock,
            reapplyMyStock = viewModel::reapplyMyStock,
        ),
        onPickImage = {
            picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        },
        onConfirmDelete = { confirmDelete = it },
        onBack = onBack,
        onLimitReached = onLimitReached,
    )
}

/**
 * Everything the product form can ask the view model to do, as data.
 *
 * Ten lambdas in one value rather than ten parameters, each defaulting to a
 * no-op so `ProductEditActions()` is enough to render the form.
 */
data class ProductEditActions(
    val onName: (String) -> Unit = {},
    val onDescription: (String) -> Unit = {},
    val onPrice: (String) -> Unit = {},
    val onStock: (String) -> Unit = {},
    val onAvailable: (Boolean) -> Unit = {},
    val onCategory: (String?) -> Unit = {},
    val save: (() -> Unit) -> Unit = {},
    val delete: (() -> Unit) -> Unit = {},
    val acceptShopStock: () -> Unit = {},
    val reapplyMyStock: (() -> Unit) -> Unit = {},
)

/**
 * The product form, as a function of its state.
 *
 * Image first, because buyers see the image first; then name, price in the product's
 * currency, stock as a stepper, whether it shows on the storefront, and the category.
 * The description sits behind "more details". Deleting lives in the overflow and asks
 * in a sheet; a stock conflict is a sheet too, because it is a question, not an error.
 *
 * `state.loaded` is the whole reason this screen has a loading state: it was
 * computed in three places in the view model and read in none, so opening an
 * existing product drew an empty form first — blank name, stock "1" — and
 * swapped in the real values when Room answered, overwriting anything the seller
 * had typed in between.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductEditContent(
    state: ProductEditUiState,
    categories: List<CategoryEntity>,
    confirmDelete: Boolean,
    actions: ProductEditActions,
    onPickImage: () -> Unit,
    onConfirmDelete: (Boolean) -> Unit,
    onBack: () -> Unit,
    onLimitReached: (String) -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    var categorySheet by rememberSaveable { mutableStateOf(false) }
    var moreOpen by rememberSaveable { mutableStateOf(false) }
    val locked = state.saving
    Scaffold(
        topBar = {
            TopBar(
                title = stringResource(if (state.id > 0) R.string.product_edit_heading else R.string.product_new_heading),
                onBack = onBack,
                backDescription = stringResource(R.string.sheet_close),
                closeIcon = true,
                // The overflow holds delete and nothing else, so a new product has none.
                onOverflow = if (state.id > 0 && state.loaded) ({ onConfirmDelete(true) }) else null,
                overflowDescription = stringResource(R.string.product_delete),
            )
        },
        bottomBar = {
            if (state.loaded) {
                BottomActionBar(
                    primaryLabel = stringResource(R.string.product_save_bar),
                    onPrimary = { actions.save(onBack) },
                    primaryEnabled = state.canSave && !locked,
                    disabledReason = if (!state.canSave && !locked) stringResource(R.string.product_save_reason) else null,
                )
            }
        },
    ) { padding ->
        // Opening an existing product used to draw an empty form first, then overwrite
        // whatever the seller had typed in between. Skeleton fields until Room answers.
        if (!state.loaded) {
            Skeleton(SkeletonVariant.DetailBlock, Modifier.padding(padding).padding(spacing.space4))
            return@Scaffold
        }
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(spacing.space4),
            verticalArrangement = Arrangement.spacedBy(spacing.space4),
        ) {
            // A failed write that says nothing is the worst of the three outcomes. The
            // data authority contract's Class A rule is that an operation which cannot
            // reach the server "fails, visibly": nothing is queued, nothing is written,
            // so this banner is the only thing between the seller and a silently
            // discarded edit. The form below it is kept as it was.
            state.writeError?.takeIf { it != ProductWriteError.PLAN_LIMIT }?.let { error ->
                Banner(
                    state = BannerState.Error,
                    title = stringResource(R.string.product_save_failed_title),
                    message = stringResource(
                        when (error) {
                            ProductWriteError.OFFLINE -> R.string.error_network
                            ProductWriteError.UNKNOWN_CATEGORY -> R.string.error_not_found
                            // Covered by the banner below, which says more than a sentence
                            // can; listed so this `when` stays total.
                            ProductWriteError.PLAN_LIMIT -> R.string.error_plan_limit
                            ProductWriteError.REFUSED -> R.string.error_generic
                        },
                    ),
                )
            }
            if (state.quotaExceeded) {
                // The paywall names the limit, the usage and what the next plan gives; the
                // input on this screen survives because the paywall's exit pops.
                Banner(
                    state = BannerState.Error,
                    title = stringResource(R.string.product_save_failed_title),
                    message = stringResource(R.string.error_plan_limit),
                    actionLabel = stringResource(R.string.paywall_view_plans),
                    onAction = { onLimitReached(FeatureKeys.MAX_PRODUCTS) },
                )
            }

            ImagePickerTile(
                state = if (state.imagePath == null) ImagePickerState.Placeholder else ImagePickerState.Preview,
                label = stringResource(R.string.product_image_label),
                addLabel = stringResource(R.string.product_image_add),
                onPick = onPickImage,
            ) {
                state.imagePath?.let { path ->
                    AsyncImage(
                        model = File(path),
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }

            TextField(
                value = state.name,
                onValueChange = actions.onName,
                label = stringResource(R.string.product_name_label),
                required = true,
                enabled = !locked,
            )
            MoneyField(
                value = state.priceText,
                onValueChange = actions.onPrice,
                label = stringResource(R.string.product_price_field),
                currency = state.currency,
                fractionDigits = exponentOf(state.currency),
                required = true,
                enabled = !locked,
            )
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(stringResource(R.string.product_stock_label), style = MaterialTheme.typography.bodyLarge)
                Stepper(
                    value = state.stockText.toIntOrNull() ?: 0,
                    onValueChange = { actions.onStock(it.toString()) },
                    decreaseDescription = stringResource(R.string.product_stock_decrease),
                    increaseDescription = stringResource(R.string.product_stock_increase),
                    max = MAX_STOCK,
                    enabled = !locked,
                )
            }
            SwitchRow(
                label = stringResource(R.string.product_visible),
                checked = state.available,
                onCheckedChange = actions.onAvailable,
                enabled = !locked,
            )
            // Optional. The list is managed from the store page, one tap from here.
            if (categories.isNotEmpty()) {
                SelectField(
                    label = stringResource(R.string.product_category_field),
                    value = categories.firstOrNull { it.categoryCode == state.categoryCode }?.name
                        ?: stringResource(R.string.product_category_none),
                    onClick = { categorySheet = true },
                    enabled = !locked,
                )
            }
            if (moreOpen || state.description.isNotEmpty()) {
                TextField(
                    value = state.description,
                    onValueChange = actions.onDescription,
                    label = stringResource(R.string.product_description_label),
                    singleLine = false,
                    enabled = !locked,
                )
            } else {
                TextButton(
                    onClick = { moreOpen = true },
                    modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                ) { Text(stringResource(R.string.product_more_details)) }
            }
        }
    }

    if (categorySheet) {
        ModalBottomSheet(
            onDismissRequest = { categorySheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            PickerSheet(
                mode = PickerSheetMode.SingleChoice,
                title = stringResource(R.string.product_category_field),
                options = listOf(PickerOption(NO_CATEGORY, stringResource(R.string.product_category_none))) +
                    categories.mapNotNull { c -> c.categoryCode?.let { PickerOption(it, c.name) } },
                selectedKey = state.categoryCode ?: NO_CATEGORY,
                onSelect = { option ->
                    categorySheet = false
                    actions.onCategory(option.key.takeIf { it != NO_CATEGORY })
                },
                closeLabel = stringResource(R.string.sheet_close),
                onClose = { categorySheet = false },
            )
        }
    }

    if (confirmDelete) {
        ModalBottomSheet(
            onDismissRequest = { onConfirmDelete(false) },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            ConfirmSheet(
                state = ConfirmSheetState.Destructive,
                title = stringResource(R.string.product_delete_title),
                message = stringResource(R.string.product_delete_body),
                confirmLabel = stringResource(R.string.common_delete),
                cancelLabel = stringResource(R.string.common_cancel),
                onConfirm = { onConfirmDelete(false); actions.delete(onBack) },
                onCancel = { onConfirmDelete(false) },
            )
        }
    }

    // The stock conflict, which is a question rather than an error.
    //
    // The seller's figure and the shop's disagree because an order arrived while
    // they were editing. Both numbers are real and the app cannot know which one
    // the seller means, so it shows both and asks. Re-sending theirs
    // automatically against the revision the server just reported is
    // last-write-wins wearing a different name: it would erase the decrement the
    // order made, which is the one outcome the compare-and-set exists to prevent.
    //
    // Dismissing takes the shop's figure. That is a choice the seller made by
    // tapping away, and it is the half of the choice that cannot destroy
    // anything — their number is still in the field afterwards, unsaved.
    state.stockConflict?.let { conflict ->
        ModalBottomSheet(
            onDismissRequest = { actions.acceptShopStock() },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            ConfirmSheet(
                state = ConfirmSheetState.Regular,
                title = stringResource(R.string.product_stock_conflict_heading),
                message = stringResource(
                    R.string.product_stock_conflict_message,
                    formatCount(conflict.yours, locale),
                    formatCount(conflict.shop, locale),
                ),
                confirmLabel = stringResource(R.string.product_stock_conflict_take_shop, formatCount(conflict.shop, locale)),
                cancelLabel = stringResource(R.string.product_stock_conflict_save_mine, formatCount(conflict.yours, locale)),
                onConfirm = { actions.acceptShopStock() },
                onCancel = { actions.reapplyMyStock(onBack) },
            )
        }
    }
}

/** The key the picker uses for "no category": a product may be sold without one. */
private const val NO_CATEGORY = ""

/** The most the stock field has ever accepted (five digits), now the stepper's ceiling. */
private const val MAX_STOCK = 99_999
