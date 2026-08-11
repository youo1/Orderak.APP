package app.orderak.seller.feature.auth

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.orderak.seller.R

/**
 * AuthHeader — reusable branding header shown at the top of phone entry.
 * Logo in a pill container, title, and subtitle.
 *
 * Supports animated variants via [variant] for future extensions
 * (phone entry header, welcome-back header, etc.)
 */
@Composable
fun AuthHeader(
    variant: AuthHeaderVariant = AuthHeaderVariant.PhoneEntry,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // ── 1. Logo ────────────────────────────────────────────────
        Box(
            modifier = Modifier
                .size(88.dp)
                .clip(RoundedCornerShape(28.dp))
                .background(
                    MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_orderak_logo),
                contentDescription = stringResource(R.string.app_name),
                modifier = Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
        }

        Spacer(Modifier.height(32.dp))

        // ── 2. Title ───────────────────────────────────────────────
        AnimatedVisibility(
            visible = variant == AuthHeaderVariant.PhoneEntry,
            enter = slideInVertically { 20 } + fadeIn(tween(300)),
            exit = slideOutVertically { 20 } + fadeOut(tween(300)),
        ) {
            Text(
                text = stringResource(R.string.auth_title),
                style = MaterialTheme.typography.headlineLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }

        Spacer(Modifier.height(12.dp))

        // ── 3. Subtitle ────────────────────────────────────────────
        Text(
            text = when (variant) {
                AuthHeaderVariant.PhoneEntry -> stringResource(R.string.auth_subtitle)
                AuthHeaderVariant.WelcomeBack -> stringResource(R.string.auth_title)
            },
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
    }
}

/**
 * Header variants for different auth flow steps.
 * [PhoneEntry] shows the full title + subtitle.
 * [WelcomeBack] shows a compact welcome message.
 */
enum class AuthHeaderVariant {
    PhoneEntry,
    WelcomeBack,
}