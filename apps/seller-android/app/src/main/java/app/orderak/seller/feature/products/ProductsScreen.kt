package app.orderak.seller.feature.products

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.R
import app.orderak.seller.core.money.formatEgp
import app.orderak.seller.data.db.ProductEntity
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import java.io.File

/** S8 — products list + share + low-stock badges, with all states. */
@Composable
fun ProductsScreen(
    onAdd: () -> Unit,
    onEdit: (Long) -> Unit,
    onUpgrade: () -> Unit,
    sellerPhone: String?,
    viewModel: ProductsViewModel = hiltViewModel()
) {
    val products by viewModel.products.collectAsStateWithLifecycle()
    val shopName by viewModel.shopName.collectAsStateWithLifecycle()
    val storeUrl by viewModel.storeUrl.collectAsStateWithLifecycle()
    val quota by viewModel.quota.collectAsStateWithLifecycle()
    var showLimitDialog by rememberSaveable { mutableStateOf(false) }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    if (showLimitDialog) {
        val upgradeName = planName(quota.upgradePlanKey)
        val limit = quota.limit ?: quota.used
        AlertDialog(
            onDismissRequest = { showLimitDialog = false },
            icon = { Icon(Icons.Filled.Lock, contentDescription = null) },
            title = { Text(stringResource(R.string.products_limit_title)) },
            text = {
                val message = when {
                    quota.used > limit -> stringResource(
                        R.string.products_limit_body_over,
                        limit,
                        quota.used,
                    )
                    quota.upgradePlanKey != null -> stringResource(
                        R.string.products_limit_body,
                        limit,
                        upgradeName,
                    )
                    else -> stringResource(R.string.products_limit_body_max_plan, limit)
                }
                Text(message)
            },
            confirmButton = {
                if (quota.upgradePlanKey != null) {
                    TextButton(onClick = {
                        showLimitDialog = false
                        onUpgrade()
                    }) { Text(stringResource(R.string.upgrade_now)) }
                }
            },
            dismissButton = {
                TextButton(onClick = { showLimitDialog = false }) {
                    Text(stringResource(R.string.common_ok))
                }
            },
        )
    }

    if (products.isEmpty() && quota.limit == null) {
        // Empty state with guidance.
        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    imageVector = Icons.Outlined.Inbox,
                    contentDescription = null,
                    modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    stringResource(R.string.products_empty),
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center
                )
            }
        }
    } else {
        Column(Modifier.fillMaxSize()) {
            Text(
                text = quota.limit?.let { stringResource(R.string.products_usage_header, quota.used, it) }
                    ?: stringResource(R.string.products_usage_unlimited, quota.used),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            Box(Modifier.fillMaxWidth().weight(1f)) {
                LazyColumn(
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            IconButton(onClick = {
                                scope.launch {
                                    val url = storeUrl
                                    if (url.isNullOrBlank()) shareCatalogText(context, shopName, sellerPhone, products)
                                    else shareStoreLink(context, shopName, url)
                                }
                            }) {
                                Icon(Icons.Outlined.Share, contentDescription = stringResource(R.string.dash_share_catalog))
                            }
                        }
                    }
                    items(products, key = { it.id }) { p ->
                        ProductCard(p, onClick = { onEdit(p.id) })
                    }
                    item { Spacer(Modifier.height(80.dp)) }
                }
                FloatingActionButton(
                    onClick = { if (quota.canAdd) onAdd() else showLimitDialog = true },
                    modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
                    containerColor = if (quota.canAdd) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
                ) {
                    Icon(
                        if (quota.canAdd) Icons.Filled.Add else Icons.Filled.Lock,
                        contentDescription = stringResource(
                            if (quota.canAdd) R.string.product_add_title else R.string.product_add_locked
                        )
                    )
                }
            }
        }
    }
}

@Composable
private fun planName(planKey: String?): String = when (planKey) {
    "paid1" -> stringResource(R.string.plan_paid1)
    "paid2" -> stringResource(R.string.plan_paid2)
    "paid3" -> stringResource(R.string.plan_paid3)
    else -> stringResource(R.string.plan_free)
}

@Composable
private fun ProductCard(p: ProductEntity, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick).semantics(mergeDescendants = true) {}) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (p.imagePath != null) {
                AsyncImage(
                    model = File(p.imagePath),
                    contentDescription = null,
                    modifier = Modifier.size(56.dp).clip(RoundedCornerShape(10.dp))
                )
            } else {
                Box(
                    Modifier.size(56.dp).clip(RoundedCornerShape(10.dp)),
                    contentAlignment = Alignment.Center
                ) { Icon(Icons.Outlined.Image, contentDescription = null, tint = MaterialTheme.colorScheme.outline) }
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    p.name,
                    style = MaterialTheme.typography.titleMedium.copy(
                        textDirection = TextDirection.Content,
                    ),
                )
                Text(
                    stringResource(R.string.currency_egp, formatEgp(p.pricePiasters)),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("${p.stock}", style = MaterialTheme.typography.titleMedium,
                    color = if (p.stock <= 2) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                Text(stringResource(R.string.product_stock_label), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
