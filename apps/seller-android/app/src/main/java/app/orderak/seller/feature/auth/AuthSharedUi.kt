package app.orderak.seller.feature.auth

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import app.orderak.seller.R

// ═══════════════════════════════════════════════════════════════
// AuthErrorText — animated inline error message
// ═══════════════════════════════════════════════════════════════

/**
 * Animated error text that slides in/out. Visible only when [error] is non-null.
 * Uses [MaterialTheme.colorScheme.error] and [MaterialTheme.typography.bodySmall].
 */
@Composable
fun AuthErrorText(
    error: AuthError?,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = error != null,
        enter = slideInVertically { -20 } + expandVertically() + fadeIn(),
        exit = slideOutVertically { -20 } + shrinkVertically() + fadeOut(),
    ) {
        error?.let { err ->
            val errorMsg = authErrorText(err)
            Text(
                text = errorMsg,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = modifier
                    .padding(start = 16.dp, top = 8.dp)
                    .semantics { contentDescription = errorMsg },
            )
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// AuthButton — primary + secondary with loading state
// ═══════════════════════════════════════════════════════════════

/**
 * Primary filled button using [MaterialTheme.colorScheme.primary].
 * Shows a [CircularProgressIndicator] when [isLoading] is true.
 */
@Composable
fun AuthButton(
    onClick: () -> Unit,
    enabled: Boolean,
    isLoading: Boolean,
    modifier: Modifier = Modifier,
    label: String = "",
) {
    Button(
        onClick = onClick,
        enabled = enabled && !isLoading,
        modifier = modifier
            .fillMaxWidth()
            .height(56.dp),
        shape = RoundedCornerShape(100.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            disabledContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
            disabledContentColor = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.5f),
        ),
    ) {
        if (isLoading) {
            CircularProgressIndicator(
                modifier = Modifier.size(24.dp),
                color = MaterialTheme.colorScheme.onPrimary,
                strokeWidth = 2.5.dp,
            )
        } else {
            Text(
                text = label,
                style = MaterialTheme.typography.titleMedium,
            )
        }
    }
}

/**
 * Secondary outlined button using [MaterialTheme.colorScheme.primary] for border
 * and [MaterialTheme.colorScheme.surface] for container.
 */
@Composable
fun AuthOutlinedButton(
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    label: String = "",
    isLoading: Boolean = false,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled && !isLoading,
        modifier = modifier
            .fillMaxWidth()
            .height(48.dp),
        shape = RoundedCornerShape(100.dp),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.primary,
        ),
    ) {
        if (isLoading) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                color = MaterialTheme.colorScheme.primary,
                strokeWidth = 2.dp,
            )
        } else {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// AuthLoadingOverlay — semi-transparent scrim with spinner
// ═══════════════════════════════════════════════════════════════

/**
 * Full-screen overlay using [MaterialTheme.colorScheme.scrim] at low alpha.
 */
@Composable
fun AuthLoadingOverlay(
    visible: Boolean,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(300)),
        exit = fadeOut(tween(300)),
    ) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f)),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(
                color = MaterialTheme.colorScheme.primary,
                strokeWidth = 3.dp,
            )
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// AuthDivider — horizontal line with optional label
// ═══════════════════════════════════════════════════════════════

/**
 * Divider using [MaterialTheme.colorScheme.outlineVariant].
 * If [label] is non-null, shows an "or" caption.
 */
@Composable
fun AuthDivider(
    label: String? = null,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spacer(
            modifier = Modifier
                .weight(1f)
                .height(1.dp)
                .background(MaterialTheme.colorScheme.outlineVariant),
        )
        if (label != null) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            Spacer(
                modifier = Modifier
                    .weight(1f)
                    .height(1.dp)
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// TermsAndPrivacyText — clickable legal links
// ═══════════════════════════════════════════════════════════════

@Composable
fun AuthTermsAndPrivacyText(
    textAlign: TextAlign = TextAlign.Center,
    modifier: Modifier = Modifier,
) {
    val uriHandler = LocalUriHandler.current

    val linkStyle = TextLinkStyles(
        style = SpanStyle(
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.SemiBold,
        ),
    )

    val annotatedString = buildAnnotatedString {
        append(stringResource(R.string.auth_terms_prefix) + " ")
        withLink(
            LinkAnnotation.Url(
                url = "https://orderak.app/terms",
                styles = linkStyle,
            ) { uriHandler.openUri("https://orderak.app/terms") },
        ) {
            append(stringResource(R.string.auth_terms_link))
        }
        append(" " + stringResource(R.string.auth_terms_and) + " ")
        withLink(
            LinkAnnotation.Url(
                url = "https://orderak.app/privacy",
                styles = linkStyle,
            ) { uriHandler.openUri("https://orderak.app/privacy") },
        ) {
            append(stringResource(R.string.auth_privacy_link))
        }
    }

    Text(
        text = annotatedString,
        style = MaterialTheme.typography.bodySmall.copy(
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = textAlign,
        ),
        modifier = modifier,
    )
}

// ═══════════════════════════════════════════════════════════════
// AuthError → localized string mapping
// ═══════════════════════════════════════════════════════════════

/**
 * Maps a sealed [AuthError] to its localized string resource.
 */
@Composable
fun authErrorText(error: AuthError): String = stringResource(
    when (error) {
        AuthError.INVALID_PHONE -> R.string.auth_phone_invalid
        AuthError.UNSUPPORTED_COUNTRY -> R.string.auth_unsupported_country
        AuthError.SEND_FAILED -> R.string.auth_send_failed
        AuthError.TOO_MANY_REQUESTS -> R.string.auth_too_many_requests
        AuthError.NETWORK_UNAVAILABLE -> R.string.auth_network_unavailable
        AuthError.APP_VERIFICATION_FAILED -> R.string.auth_app_verification_failed
        AuthError.SEND_TIMEOUT -> R.string.auth_send_timeout
        AuthError.INVALID_OTP -> R.string.auth_otp_invalid
        AuthError.OTP_EXPIRED -> R.string.auth_otp_expired
        AuthError.PASSKEY_UNAVAILABLE -> R.string.auth_passkey_unavailable
        AuthError.PASSKEY_FAILED -> R.string.auth_passkey_failed
        AuthError.SERVICE_UNAVAILABLE -> R.string.error_service_unavailable
        AuthError.GENERIC -> R.string.error_generic
    },
)
