package app.orderak.seller.core.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.orderak.seller.R
import app.orderak.seller.data.billing.FeatureKeys
import app.orderak.seller.data.remote.BackendConfig
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/**
 * How much of the plan is used, defined once for every screen that shows it.
 *
 * There were two copies. The dashboard card and the subscription screen each
 * held their own key list — in different orders, under a comment on one of them
 * claiming they matched — and each did its own filtering. They disagreed on the
 * case that matters: an unlimited entitlement drew an "unlimited" row on the
 * dashboard and was dropped entirely on the subscription screen, so a seller who
 * checked their usage in the two places the app offers was told two different
 * things about the same plan.
 *
 * Making the two lists equal would have fixed today's disagreement and left the
 * next one to happen. There is one list now, one filter, and one renderer.
 */

/** One row of the usage card: a catalogue key and the label a seller reads. */
data class PlanUsageRow(
    val key: String,
    @param:StringRes val label: Int,
    val used: Int,
    /** Null means unlimited — shown as a count without a ceiling, never hidden. */
    val limit: Int?,
)

/**
 * The limits worth showing, in the order they are shown.
 *
 * Keys come from [FeatureKeys] rather than being written inline, so the
 * catalogue key a screen depends on is a declared dependency that the evidence
 * verifier can see, not a string literal nothing checks.
 */
val PLAN_USAGE_KEYS: List<Pair<String, Int>> = listOf(
    FeatureKeys.MAX_PRODUCTS to R.string.usage_products,
    FeatureKeys.MAX_ORDERS_PER_MONTH to R.string.usage_orders_month,
    FeatureKeys.MAX_CATEGORIES to R.string.usage_categories,
    FeatureKeys.MAX_CONCURRENT_DEVICES to R.string.usage_devices,
    FeatureKeys.MAX_AI_REQUESTS_PER_MONTH to R.string.usage_ai_requests,
)

/**
 * The rows a config can actually fill.
 *
 * A key the snapshot does not carry is omitted, and so is one with no usage
 * figure: the app draws a meter only when it knows the numerator, and a bar
 * drawn from an assumed zero would tell a seller they have used none of
 * something nobody counted. An omitted row never blanks the card — the rest
 * still render, which is the behaviour a partial snapshot has to have.
 */
fun planUsageRows(config: BackendConfig): List<PlanUsageRow> =
    PLAN_USAGE_KEYS.mapNotNull { (key, label) ->
        val entitlement = config.entitlements[key] ?: return@mapNotNull null
        val used = entitlement.used ?: return@mapNotNull null
        val limit = if (entitlement.mode == "unlimited") null
        else (entitlement.value as? JsonPrimitive)?.intOrNull
        PlanUsageRow(key = key, label = label, used = used, limit = limit)
    }

/**
 * One row, rendered the same way wherever it appears.
 *
 * A finite limit is a meter, which carries its own threshold colours and the
 * icon that keeps a warning readable without them. An unlimited one is a count:
 * there is no proportion to draw, and hiding it would leave a seller on the top
 * plan looking at a card that has gone silent about the thing they pay for.
 */
@Composable
fun PlanUsageRowItem(row: PlanUsageRow, modifier: Modifier = Modifier) {
    val label = stringResource(row.label)
    if (row.limit != null) {
        UsageMeter(label = label, used = row.used, limit = row.limit, modifier = modifier)
    } else {
        Row(
            modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(
                stringResource(R.string.usage_value_unlimited, row.used),
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}
