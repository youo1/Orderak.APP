package app.orderak.seller.feature.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.orderak.seller.R
import app.orderak.seller.core.text.SearchText
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.MoneyText
import app.orderak.seller.core.ui.SearchField
import app.orderak.seller.core.ui.Stepper
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.money.Money
import app.orderak.seller.data.db.ProductEntity

/**
 * The product picker of the new-order form: search, a row per product with its
 * price and what is in stock, and a stepper on each row, then "Done".
 *
 * It is the content of a sheet, not a window: the form hosts it. A product with no
 * stock cannot be added (its stepper has nothing to step to), and what is in stock
 * is said on the row so the seller is told before they tap, not after.
 */
@Composable
fun NewOrderProductSheet(
    products: List<ProductEntity>,
    quantities: Map<Long, Int>,
    onChange: (ProductEntity, Int) -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    var query by rememberSaveable { mutableStateOf("") }
    val shown = products.filter { SearchText.matches(query, it.name, it.productCode) }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .fillMaxHeight(PICKER_HEIGHT_FRACTION)
            .padding(horizontal = spacing.space4),
        verticalArrangement = Arrangement.spacedBy(spacing.space2),
    ) {
        Text(
            stringResource(R.string.order_new_add_product),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(top = spacing.space2).semantics { heading() },
        )
        SearchField(query = query, onQueryChange = { query = it }, placeholder = stringResource(R.string.products_search_hint))
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(spacing.space1)) {
            items(shown, key = { it.id }) { p ->
                val chosen = quantities[p.id] ?: 0
                Row(
                    Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(spacing.space2),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(p.name, style = MaterialTheme.typography.bodyLarge)
                        Row(horizontalArrangement = Arrangement.spacedBy(spacing.space2)) {
                            MoneyText(Money(p.priceMinor, p.currency), style = MaterialTheme.typography.labelMedium.copy(color = MaterialTheme.colorScheme.primary))
                            Text(
                                stringResource(R.string.order_new_picker_stock, formatCount(p.stock, locale)),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Stepper(
                        value = chosen,
                        onValueChange = { next -> onChange(p, next - chosen) },
                        decreaseDescription = stringResource(R.string.order_qty_decrease, p.name),
                        increaseDescription = stringResource(R.string.order_qty_increase, p.name),
                        max = p.stock,
                    )
                }
            }
        }
        Button(
            onClick = onDone,
            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget).padding(bottom = spacing.space4),
        ) { Text(stringResource(R.string.order_new_picker_done)) }
    }
}

/** How much of the height the picker takes: most of it, so the list has room and the form stays behind it. */
private const val PICKER_HEIGHT_FRACTION = 0.85f
