package app.orderak.seller.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.billing.Feature

/**
 * Wraps premium features. If user doesn't have the entitlement,
 * it shows a "Locked" placeholder or hides it.
 */
@Composable
fun FeatureGate(
    entitlementManager: EntitlementManager,
    feature: Feature,
    content: @Composable () -> Unit
) {
    val isEnabled = entitlementManager.isFeatureEnabled(feature)

    LaunchedEffect(isEnabled) {
        entitlementManager.logAttempt(feature)
    }

    if (isEnabled) {
        content()
    } else {
        LockedFeatureOverlay(feature)
    }
}

@Composable
private fun LockedFeatureOverlay(feature: Feature) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(8.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f), MaterialTheme.shapes.medium)
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.common_premium_feature),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}
