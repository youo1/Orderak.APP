package app.orderak.seller.feature.auth

import app.orderak.seller.core.ui.OtpField
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.AutofillNode
import androidx.compose.ui.autofill.AutofillType
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalAutofill
import androidx.compose.ui.platform.LocalAutofillTree
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

/**
 * OTP entry form — title, subtitle, 6-digit code input, inline error,
 * resend timer and change-number link. The sixth digit, typed or filled in by SMS
 * Autofill, verifies by itself (contract v10); the bottom Verify action owned by
 * the screen remains as the retry after a refused code.
 *
 * Every color comes from [MaterialTheme.colorScheme];
 * every text style from [MaterialTheme.typography].
 */
@Composable
fun AuthOtpForm(
    phoneE164: String,
    code: String,
    secondsLeft: Int,
    canResend: Boolean,
    isVerifying: Boolean,
    error: AuthError?,
    onCodeChanged: (String) -> Unit,
    onResend: () -> Unit,
    onChangeNumber: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // ── 1. Title + subtitle ────────────────────────────────────
        Text(
            text = stringResource(R.string.auth_otp_title),
            style = MaterialTheme.typography.headlineMedium,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onBackground,
        )

        Spacer(Modifier.height(spacing.space3))

        Text(
            text = stringResource(R.string.auth_otp_sent_to, phoneE164),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(spacing.space12))

        // ── 2. OTP digit input ─────────────────────────────────────
        // The kit's code field: six cells left to right, SMS Autofill filling all six at once,
        // and the error under it. The sixth digit verifies by itself (contract v10).
        OtpField(
            value = code,
            onValueChange = onCodeChanged,
            label = stringResource(R.string.auth_otp_title),
            error = error?.let { authErrorText(it) },
            enabled = !isVerifying,
        )

        Spacer(Modifier.height(spacing.space12))

        // ── 4. Status label (replaces the old always-disabled button) ──
        val statusLabel = when {
            isVerifying -> stringResource(R.string.auth_verifying)
            code.length == 6 -> stringResource(R.string.auth_otp_code_entered)
            else -> stringResource(R.string.auth_otp_waiting_for_code)
        }

        Text(
            text = statusLabel,
            style = MaterialTheme.typography.titleMedium,
            color = if (isVerifying) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )

        Spacer(Modifier.height(spacing.space6))

        // ── 5. Resend ──────────────────────────────────────────────
        if (!isVerifying) {
            TextButton(
                onClick = onResend,
                enabled = canResend,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = if (canResend) {
                        stringResource(R.string.auth_resend)
                    } else {
                        stringResource(
                            R.string.auth_resend_in,
                            formatCount(secondsLeft, LocalConfiguration.current.locales[0]),
                        )
                    },
                    style = MaterialTheme.typography.labelLarge,
                    color = if (canResend) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }

            Spacer(Modifier.height(spacing.space2))

            TextButton(
                onClick = onChangeNumber,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = stringResource(R.string.auth_change_number),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
