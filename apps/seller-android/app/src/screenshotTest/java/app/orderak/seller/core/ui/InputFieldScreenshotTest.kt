package app.orderak.seller.core.ui

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * The text-entry kit: TextField, PhoneField, MoneyField and OtpField.
 *
 * Each preview is one state of one field, in the eight-variant matrix
 * (`FeedbackPreviews`). The states a field has are its look when nothing is
 * typed, when something is, when it is wrong, and when it is switched off.
 */
@Composable
private fun previewDark(): Boolean =
    (LocalConfiguration.current.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES

@Composable
private fun FieldPreview(content: @Composable () -> Unit) {
    OrderakTheme(darkTheme = previewDark()) {
        Surface {
            Column(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                content()
            }
        }
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun textFieldEmpty() {
    FieldPreview {
        TextField(
            value = "",
            onValueChange = {},
            label = stringResource(R.string.field_preview_name_label),
            required = true,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun textFieldFilled() {
    FieldPreview {
        TextField(
            value = stringResource(R.string.field_preview_name_value),
            onValueChange = {},
            label = stringResource(R.string.field_preview_name_label),
            required = true,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun textFieldRequiredError() {
    FieldPreview {
        TextField(
            value = "",
            onValueChange = {},
            label = stringResource(R.string.field_preview_name_label),
            required = true,
            helper = stringResource(R.string.field_preview_name_helper),
            error = stringResource(R.string.field_preview_name_error),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun textFieldHelperAndCounter() {
    FieldPreview {
        TextField(
            value = stringResource(R.string.field_preview_name_value),
            onValueChange = {},
            label = stringResource(R.string.field_preview_name_label),
            helper = stringResource(R.string.field_preview_name_helper),
            maxLength = 60,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun textFieldDisabled() {
    FieldPreview {
        TextField(
            value = stringResource(R.string.field_preview_name_value),
            onValueChange = {},
            label = stringResource(R.string.field_preview_name_label),
            enabled = false,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun phoneFieldEmpty() {
    FieldPreview {
        PhoneField(
            dialCode = "+20",
            countryDescription = stringResource(R.string.field_preview_country),
            number = "",
            onNumberChange = {},
            onPickCountry = {},
            label = stringResource(R.string.field_preview_phone_label),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun phoneFieldFilled() {
    FieldPreview {
        PhoneField(
            dialCode = "+20",
            countryDescription = stringResource(R.string.field_preview_country),
            number = "1012345678",
            onNumberChange = {},
            onPickCountry = {},
            label = stringResource(R.string.field_preview_phone_label),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun phoneFieldError() {
    FieldPreview {
        PhoneField(
            dialCode = "+20",
            countryDescription = stringResource(R.string.field_preview_country),
            number = "10123",
            onNumberChange = {},
            onPickCountry = {},
            label = stringResource(R.string.field_preview_phone_label),
            error = stringResource(R.string.field_preview_phone_error),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun moneyFieldFilled() {
    FieldPreview {
        MoneyField(
            value = "1250.5",
            onValueChange = {},
            label = stringResource(R.string.field_preview_price_label),
            currency = stringResource(R.string.field_preview_currency),
            fractionDigits = 2,
            required = true,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun moneyFieldError() {
    FieldPreview {
        MoneyField(
            value = "",
            onValueChange = {},
            label = stringResource(R.string.field_preview_price_label),
            currency = stringResource(R.string.field_preview_currency),
            fractionDigits = 2,
            required = true,
            error = stringResource(R.string.field_preview_price_error),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun otpFieldEmpty() {
    FieldPreview {
        Text(stringResource(R.string.auth_otp_title), style = MaterialTheme.typography.titleMedium)
        OtpField(value = "", onValueChange = {}, label = stringResource(R.string.auth_otp_title))
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun otpFieldPartial() {
    FieldPreview {
        Text(stringResource(R.string.auth_otp_title), style = MaterialTheme.typography.titleMedium)
        OtpField(value = "482", onValueChange = {}, label = stringResource(R.string.auth_otp_title))
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun otpFieldError() {
    FieldPreview {
        OtpField(
            value = "482913",
            onValueChange = {},
            label = stringResource(R.string.auth_otp_title),
            error = stringResource(R.string.field_preview_otp_error),
        )
    }
}
