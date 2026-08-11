package app.orderak.seller.feature.auth

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.phone.Country
import com.google.i18n.phonenumbers.PhoneNumberUtil

/**
 * Phone stage shared by editable entry and the locked inline-OTP state:
 * country code, formatted phone value, validation, device hint, and help.
 *
 * Every color comes from [MaterialTheme.colorScheme];
 * every text style from [MaterialTheme.typography].
 */
@Composable
fun AuthPhoneForm(
    phone: String,
    country: Country,
    isValid: Boolean,
    isSending: Boolean,
    error: AuthError?,
    enabled: Boolean = true,
    onCountrySelected: (Country) -> Unit,
    onPhoneChanged: (String) -> Unit,
    onShowCountryPicker: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    var phoneHintFailed by rememberSaveable { mutableStateOf(false) }
    val phoneHintHelper = PhoneHintHelper.rememberPhoneHintLauncher(
        onResult = { full ->
            phoneHintFailed = false
            val detected = app.orderak.seller.core.phone.Countries.fromE164(full)
            val resolved = detected ?: country
            onCountrySelected(resolved)
            onPhoneChanged(full.removePrefix("+${resolved.dialCode}"))
        },
        onFailure = {
            phoneHintFailed = true
        },
    )

    val focusRequester = remember { FocusRequester() }

    Column(modifier = modifier) {
        // ── 1. Phone field ─────────────────────────────────────────
        AndroidViewLayoutDirectionReset {
            OutlinedTextField(
                value = phone,
                onValueChange = {
                    if (enabled && !isSending) {
                        phoneHintFailed = false
                        onPhoneChanged(it)
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
                label = { Text(stringResource(R.string.auth_phone_label)) },
                placeholder = { Text(stringResource(R.string.auth_phone_hint)) },
                enabled = enabled && !isSending,
                leadingIcon = {
                    CountryCodeChip(
                        country = country,
                        enabled = enabled && !isSending,
                        onClick = onShowCountryPicker,
                    )
                },
                trailingIcon = {
                    AnimatedVisibility(
                        visible = isValid && error == null,
                        enter = fadeIn(tween(300)) + expandVertically(),
                        exit = fadeOut(tween(300)) + shrinkVertically(),
                    ) {
                        Icon(
                            imageVector = Icons.Default.CheckCircle,
                            contentDescription = stringResource(R.string.cd_valid_number),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                },
                isError = error != null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                visualTransformation = remember(country.iso) {
                    phoneNumberVisualTransformation(country.iso)
                },
                singleLine = true,
                shape = RoundedCornerShape(20.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedBorderColor = MaterialTheme.colorScheme.surfaceVariant,
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    errorContainerColor = MaterialTheme.colorScheme.error.copy(alpha = 0.05f),
                    errorBorderColor = MaterialTheme.colorScheme.error,
                ),
            )
        }

        // ── 2. Inline error ───────────────────────────────────────
        AuthErrorText(error = error)

        if (enabled) {
            Spacer(Modifier.height(20.dp))
            TextButton(
                onClick = {
                    PhoneHintHelper.show(
                        context = context,
                        onLaunch = { phoneHintHelper.launch(it) },
                        onFailure = { phoneHintFailed = true },
                    )
                },
                enabled = !isSending,
            ) {
                Icon(
                    imageVector = Icons.Outlined.PhoneAndroid,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.auth_use_my_number),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            AnimatedVisibility(visible = phoneHintFailed) {
                Text(
                    text = stringResource(R.string.auth_phone_hint_unavailable),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Spacer(Modifier.height(12.dp))
            TextButton(
                onClick = { uriHandler.openUri("mailto:support@orderak.app") },
                enabled = !isSending,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.HelpOutline,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.auth_trouble),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// Private sub-components
// ═══════════════════════════════════════════════════════════════

private fun phoneNumberVisualTransformation(regionIso: String) = VisualTransformation { text ->
    val digits = text.text
    val formatter = PhoneNumberUtil.getInstance().getAsYouTypeFormatter(regionIso)
    var formatted = ""
    digits.forEach { digit -> formatted = formatter.inputDigit(digit) }

    val originalToTransformed = IntArray(digits.length + 1)
    var digitCount = 0
    formatted.forEachIndexed { index, character ->
        if (character.isDigit() && digitCount < digits.length) {
            digitCount++
            originalToTransformed[digitCount] = index + 1
        }
    }
    val mapping = object : OffsetMapping {
        override fun originalToTransformed(offset: Int): Int =
            originalToTransformed[offset.coerceIn(0, digits.length)]

        override fun transformedToOriginal(offset: Int): Int =
            formatted.take(offset.coerceIn(0, formatted.length))
                .count(Char::isDigit)
                .coerceAtMost(digits.length)
    }
    TransformedText(AnnotatedString(formatted), mapping)
}

@Composable
private fun CountryCodeChip(
    country: Country,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .padding(start = 6.dp, end = 6.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.8f))
            .clickable(enabled = enabled) { onClick() }
            .sizeIn(minHeight = 44.dp)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(
            text = "${country.flag} +${country.dialCode}",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.width(4.dp))
        Icon(
            imageVector = Icons.Default.ArrowDropDown,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun MarketingOptInSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .sizeIn(minHeight = 56.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
            .toggleable(
                value = checked,
                onValueChange = onCheckedChange,
                role = Role.Switch,
            )
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Text(
            text = stringResource(R.string.auth_marketing_opt_in),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(16.dp))
        Switch(
            checked = checked,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
                checkedTrackColor = MaterialTheme.colorScheme.primary,
            ),
        )
    }
}

@Composable
private fun AndroidViewLayoutDirectionReset(content: @Composable () -> Unit) {
    CompositionLocalProvider(
        LocalLayoutDirection provides LayoutDirection.Ltr,
        content = content,
    )
}
