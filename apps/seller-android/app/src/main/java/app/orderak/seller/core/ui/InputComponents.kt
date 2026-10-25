package app.orderak.seller.core.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.LayoutDirection
import app.orderak.seller.core.text.arabicIndicLocale
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import java.util.Locale

/** The number of digits in a phone number that the field accepts: E.164 allows fifteen. */
private const val PhoneMaxDigits = 15

/** The longest money amount the field accepts, digits and separator together. */
private const val MoneyMaxLength = 12

/** The length of the code a seller types to verify their phone. */
const val OtpCodeLength = 6

/** A count in the locale's own digits, isolated from the paragraph direction. */
private fun isolated(text: String): String = "\u2066$text\u2069"

/**
 * The text a field draws under itself: the error if there is one, otherwise the
 * helper, with a counter at the end when the field has a limit.
 */
@Composable
private fun FieldSupport(
    helper: String?,
    error: String?,
    count: Int?,
    limit: Int?,
) {
    val locale = LocalConfiguration.current.locales[0]
    val message = error ?: helper
    if (message == null && limit == null) return
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(
            text = message.orEmpty(),
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodySmall,
            color = if (error != null) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
        if (limit != null && count != null) {
            Text(
                text = isolated("${formatCount(count, locale)}/${formatCount(limit, locale)}"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Calls [onLeave] once each time the field loses focus after having it. */
private fun Modifier.onLeave(onLeave: (() -> Unit)?): Modifier = composed {
    var hadFocus by remember { mutableStateOf(false) }
    onFocusChanged { state ->
        if (hadFocus && !state.isFocused) onLeave?.invoke()
        hadFocus = state.isFocused
    }
}

/**
 * Types a value.
 *
 * An outlined field with a label, a required mark, a helper line, an error that
 * replaces the helper, an optional counter, and an optional prefix and suffix.
 * The error is also exposed as the field's semantic error, so a screen reader
 * says what is wrong, not only that something is.
 *
 * Validation is the screen's: [onLeave] is called when the field is left, so an
 * error can be shown then and not while the seller is still typing.
 */
@Composable
fun TextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    required: Boolean = false,
    helper: String? = null,
    error: String? = null,
    maxLength: Int? = null,
    prefix: String? = null,
    suffix: String? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    onLeave: (() -> Unit)? = null,
) {
    FieldInput(
        value = value,
        onValueChange = onValueChange,
        label = label,
        modifier = modifier,
        required = required,
        helper = helper,
        error = error,
        maxLength = maxLength,
        prefix = prefix,
        suffix = suffix,
        enabled = enabled,
        singleLine = singleLine,
        keyboardOptions = keyboardOptions,
        visualTransformation = visualTransformation,
        onLeave = onLeave,
        showSupport = true,
    )
}

/** The outlined field itself; [showSupport] is false where the caller draws the text under it. */
@Composable
private fun FieldInput(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier,
    required: Boolean,
    helper: String?,
    error: String?,
    maxLength: Int?,
    prefix: String?,
    suffix: String?,
    enabled: Boolean,
    singleLine: Boolean,
    keyboardOptions: KeyboardOptions,
    visualTransformation: VisualTransformation,
    onLeave: (() -> Unit)?,
    showSupport: Boolean,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { next ->
            if (maxLength == null || next.length <= maxLength) onValueChange(next)
        },
        label = { Text(if (required) "$label *" else label) },
        prefix = prefix?.let { { Text(it) } },
        suffix = suffix?.let { { Text(it) } },
        supportingText = if (showSupport && (helper != null || error != null || maxLength != null)) {
            { FieldSupport(helper = helper, error = error, count = value.length, limit = maxLength) }
        } else {
            null
        },
        isError = error != null,
        enabled = enabled,
        singleLine = singleLine,
        keyboardOptions = keyboardOptions,
        visualTransformation = visualTransformation,
        modifier = modifier
            .fillMaxWidth()
            .onLeave(onLeave)
            .semantics { if (error != null) error(error) },
    )
}

/**
 * Types a phone number: a country button, then the number.
 *
 * The button shows the dialling code and opens the country picker, which the
 * screen owns. The number is always laid out left to right, even in Arabic, and
 * is digits only: Arabic-Indic digits are turned into Latin ones as they are
 * typed, because the number is stored and sent as digits.
 */
@Composable
fun PhoneField(
    dialCode: String,
    countryDescription: String,
    number: String,
    onNumberChange: (String) -> Unit,
    onPickCountry: () -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    helper: String? = null,
    error: String? = null,
    enabled: Boolean = true,
    onLeave: (() -> Unit)? = null,
) {
    val spacing = LocalOrderakSpacing.current
    Column(modifier.fillMaxWidth()) {
        // The whole row reads left to right, as a phone number does: the dialling
        // code, then the digits. The text under it keeps the reader's direction.
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(spacing.space2),
                verticalAlignment = Alignment.Top,
            ) {
                OutlinedButton(
                    onClick = onPickCountry,
                    enabled = enabled,
                    // The field's own corner, so the button and the field read as one row.
                    shape = OutlinedTextFieldDefaults.shape,
                    border = BorderStroke(
                        spacing.space1 / 4,
                        if (error != null) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.outline
                        },
                    ),
                    modifier = Modifier
                        .heightIn(min = spacing.space16 - spacing.space2)
                        .semantics { contentDescription = "$countryDescription $dialCode" }
                        .testTag("orderak.phone.country"),
                ) {
                    Text(isolated(dialCode), style = MaterialTheme.typography.bodyLarge)
                    Icon(Icons.Filled.ArrowDropDown, contentDescription = null)
                }
                FieldInput(
                    value = number,
                    onValueChange = { raw -> onNumberChange(latinDigits(raw).take(PhoneMaxDigits)) },
                    label = label,
                    modifier = Modifier.weight(1f).testTag("orderak.phone.number"),
                    required = false,
                    helper = helper,
                    error = error,
                    maxLength = null,
                    prefix = null,
                    suffix = null,
                    enabled = enabled,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    visualTransformation = VisualTransformation.None,
                    onLeave = onLeave,
                    showSupport = false,
                )
            }
        }
        Box(Modifier.padding(horizontal = spacing.space4).padding(top = spacing.space1)) {
            FieldSupport(helper = helper, error = error, count = null, limit = null)
        }
    }
}

/** The digits of [raw] as Latin digits, with every other character dropped. */
internal fun latinDigits(raw: String): String = buildString {
    for (char in raw) {
        when (char) {
            in '0'..'9' -> append(char)
            in '٠'..'٩' -> append('0' + (char - '٠'))
            in '۰'..'۹' -> append('0' + (char - '۰'))
        }
    }
}

/**
 * The amount a seller typed, as the canonical text the screen keeps: Latin
 * digits and at most one `.`, with no more than [fractionDigits] after it. A
 * currency with no minor unit ([fractionDigits] of 0) takes no separator at all.
 */
internal fun moneyText(raw: String, fractionDigits: Int): String {
    val whole = StringBuilder()
    val fraction = StringBuilder()
    var afterSeparator = false
    for (char in raw) {
        val separator = char == '.' || char == ',' || char == '٫'
        // A currency with no minor unit has nothing after the separator to keep.
        if (separator && fractionDigits == 0) break
        when {
            char in '0'..'9' || char in '٠'..'٩' || char in '۰'..'۹' -> {
                val digit = latinDigits(char.toString())
                if (afterSeparator) fraction.append(digit) else whole.append(digit)
            }
            // The decimal separator in every form a keyboard produces.
            separator && !afterSeparator -> afterSeparator = true
        }
    }
    val kept = fraction.take(fractionDigits)
    val text = if (afterSeparator) "$whole.$kept" else whole.toString()
    return text.take(MoneyMaxLength)
}

/** Draws the canonical amount in the locale's own digits and decimal separator. */
private class LocaleDigits(private val locale: Locale) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val arabic = arabicIndicLocale(locale) != locale || locale.language == "ar"
        val drawn = buildString {
            for (char in text.text) {
                when {
                    char in '0'..'9' -> append(formatCount(char - '0', locale))
                    char == '.' && arabic -> append('٫')
                    else -> append(char)
                }
            }
        }
        // Every character maps to exactly one character, so the cursor keeps its place.
        return TransformedText(AnnotatedString(drawn), OffsetMapping.Identity)
    }
}

/**
 * Types a price.
 *
 * The screen keeps [value] as canonical text (`12.5`); the field draws it in the
 * locale's digits, takes Arabic-Indic digits as input, and refuses more decimals
 * than the currency has ([fractionDigits]: 2 for the pound, 0 for a currency with
 * no minor unit). The currency is the store's and sits at the end as a suffix.
 */
@Composable
fun MoneyField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    currency: String,
    fractionDigits: Int,
    modifier: Modifier = Modifier,
    required: Boolean = false,
    helper: String? = null,
    error: String? = null,
    enabled: Boolean = true,
    onLeave: (() -> Unit)? = null,
) {
    val locale = LocalConfiguration.current.locales[0]
    FieldInput(
        value = value,
        onValueChange = { raw -> onValueChange(moneyText(raw, fractionDigits)) },
        label = label,
        modifier = modifier,
        required = required,
        helper = helper,
        error = error,
        maxLength = null,
        prefix = null,
        suffix = currency,
        enabled = enabled,
        singleLine = true,
        keyboardOptions = KeyboardOptions(
            keyboardType = if (fractionDigits > 0) KeyboardType.Decimal else KeyboardType.Number,
        ),
        visualTransformation = remember(locale) { LocaleDigits(locale) },
        onLeave = onLeave,
        showSupport = true,
    )
}

/**
 * Types the code sent to the seller's phone: [OtpCodeLength] cells, left to
 * right even in Arabic, filled as the digits arrive.
 *
 * The typed digits are drawn by the cells; the text field underneath is
 * transparent and only receives input, and is named by [label] for a screen
 * reader. [error] colours the cells, says what is wrong under them, and is the
 * field's semantic error.
 */
@Composable
fun OtpField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    error: String? = null,
    enabled: Boolean = true,
) {
    val spacing = LocalOrderakSpacing.current
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(spacing.space2)) {
        // Only the cells are forced left to right; the error below keeps the
        // direction of the language it is written in.
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            BasicTextField(
                value = value,
                onValueChange = { raw ->
                    if (enabled) onValueChange(latinDigits(raw).take(OtpCodeLength))
                },
                // Transparent, not the background colour: no cell fill matches the
                // background, so a painted-over code would show through its cells.
                textStyle = TextStyle(color = Color.Transparent),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.NumberPassword,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = {}),
                enabled = enabled,
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics {
                        contentDescription = label
                        if (error != null) error(error)
                    },
                decorationBox = { input ->
                    Box(contentAlignment = Alignment.Center) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(spacing.space2),
                        ) {
                            repeat(OtpCodeLength) { index ->
                                OtpCell(
                                    digit = value.getOrNull(index),
                                    active = enabled && error == null && index == value.length,
                                    failed = error != null,
                                    modifier = Modifier.weight(1f),
                                )
                            }
                        }
                        Box(Modifier.matchParentSize()) { input() }
                    }
                },
            )
        }
        if (error != null) {
            Text(
                text = error,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun OtpCell(digit: Char?, active: Boolean, failed: Boolean, modifier: Modifier) {
    val spacing = LocalOrderakSpacing.current
    val colors = MaterialTheme.colorScheme
    val background = when {
        failed -> colors.errorContainer
        active -> colors.primaryContainer
        else -> colors.surface
    }
    val border = when {
        failed -> colors.error
        active -> colors.primary
        else -> colors.outline
    }
    // The active and failed cells have a thicker border: the state does not rest on colour alone.
    val width = if (active || failed) spacing.space1 / 2 else spacing.space1 / 4
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .heightIn(min = spacing.space16)
            .clip(MaterialTheme.shapes.large)
            .background(background)
            .border(width, border, MaterialTheme.shapes.large)
            .testTag("orderak.otp.cell"),
    ) {
        Text(
            text = digit?.toString().orEmpty(),
            style = MaterialTheme.typography.headlineMedium,
            color = if (failed) colors.onErrorContainer else colors.onSurface,
        )
    }
}
