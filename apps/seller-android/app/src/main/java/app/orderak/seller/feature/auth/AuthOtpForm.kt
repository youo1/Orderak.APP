package app.orderak.seller.feature.auth

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
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import app.orderak.seller.R

/**
 * OTP entry form — title, subtitle, 6-digit code input, inline error,
 * resend timer and change-number link. Verification is an explicit bottom
 * action owned by the screen, including after SMS Autofill.
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

        Spacer(Modifier.height(12.dp))

        Text(
            text = stringResource(R.string.auth_otp_sent_to, phoneE164),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(48.dp))

        // ── 2. OTP digit input ─────────────────────────────────────
        AndroidViewLayoutDirectionReset {
            OtpCodeInput(
                code = code,
                onCodeChanged = onCodeChanged,
                isError = error != null,
                enabled = !isVerifying,
                length = 6,
            )
        }

        // ── 3. Inline error ───────────────────────────────────────
        AuthErrorText(error = error)

        Spacer(Modifier.height(48.dp))

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

        Spacer(Modifier.height(24.dp))

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
                        stringResource(R.string.auth_resend_in, secondsLeft)
                    },
                    style = MaterialTheme.typography.labelLarge,
                    color = if (canResend) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            }

            Spacer(Modifier.height(8.dp))

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

// ═══════════════════════════════════════════════════════════════
// OtpCodeInput — 6 individual digit boxes with auto-focus advance
// ═══════════════════════════════════════════════════════════════

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun OtpCodeInput(
    code: String,
    onCodeChanged: (String) -> Unit,
    isError: Boolean,
    enabled: Boolean,
    length: Int,
) {
    BasicTextField(
        value = code,
        onValueChange = { raw ->
            if (enabled && (raw.length <= length)) {
                onCodeChanged(raw.filter(Char::isDigit))
            }
        },
        textStyle = TextStyle(color = MaterialTheme.colorScheme.background), // invisible underlying text
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.NumberPassword,
            imeAction = ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(
            onDone = { /* Verification remains an explicit screen action. */ },
        ),
        enabled = enabled,
        singleLine = true,
        modifier = Modifier
            .fillMaxWidth()
            .autofill(
                autofillTypes = listOf(AutofillType.SmsOtpCode),
                onFill = onCodeChanged,
            ),
        decorationBox = { innerText ->
            Box(contentAlignment = Alignment.Center) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    repeat(length) { index ->
                        val digit = code.getOrNull(index)
                        val isActive = index == code.length && enabled
                        val isFilled = digit != null

                        val boxBackgroundColor = when {
                            isError -> MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
                            isActive -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.2f)
                            isFilled -> MaterialTheme.colorScheme.surface
                            else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                        }

                        val boxBorderColor = when {
                            isError -> MaterialTheme.colorScheme.error
                            isActive -> MaterialTheme.colorScheme.primary
                            isFilled -> MaterialTheme.colorScheme.primary.copy(alpha = 0.3f)
                            else -> MaterialTheme.colorScheme.outlineVariant
                        }

                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .weight(1f)
                                .padding(horizontal = 4.dp)
                                .height(64.dp)
                                .clip(RoundedCornerShape(16.dp))
                                .background(boxBackgroundColor)
                                .border(
                                    width = if (isActive || isError) 2.dp else 1.dp,
                                    color = boxBorderColor,
                                    shape = RoundedCornerShape(16.dp),
                                ),
                        ) {
                            Text(
                                text = digit?.toString() ?: "",
                                style = MaterialTheme.typography.headlineMedium,
                                color = when {
                                    isError -> MaterialTheme.colorScheme.error
                                    else -> MaterialTheme.colorScheme.onSurface
                                },
                            )
                        }
                    }
                }
                // Underlying BasicTextField is invisible but receives input
                Box(modifier = Modifier.matchParentSize()) {
                    innerText()
                }
            }
        },
    )
}

// ═══════════════════════════════════════════════════════════════
// Autofill extension — SMS OTP auto-read from Play Services
// ═══════════════════════════════════════════════════════════════

@OptIn(ExperimentalComposeUiApi::class)
private fun Modifier.autofill(
    autofillTypes: List<AutofillType>,
    onFill: ((String) -> Unit),
) = composed {
    val autofill = LocalAutofill.current
    val autofillNode = remember {
        AutofillNode(onFill = onFill, autofillTypes = autofillTypes)
    }
    LocalAutofillTree.current += autofillNode
    this.onGloballyPositioned {
        autofillNode.boundingBox = it.boundsInWindow()
    }.onFocusChanged { focusState ->
        autofill?.run {
            if (focusState.isFocused) {
                requestAutofillForNode(autofillNode)
            } else {
                cancelAutofillForNode(autofillNode)
            }
        }
    }
}

@Composable
private fun AndroidViewLayoutDirectionReset(content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalLayoutDirection provides LayoutDirection.Ltr,
        content = content,
    )
}
