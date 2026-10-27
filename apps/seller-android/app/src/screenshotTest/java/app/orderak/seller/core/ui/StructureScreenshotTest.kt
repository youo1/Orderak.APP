package app.orderak.seller.core.ui

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.money.Money
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * The structure and data kit: TopBar, BottomNav, BottomActionBar, Fab,
 * SectionHeader, SettingsRow, KeyValueRow, MetricTile, StatusStepper, StepList,
 * MoneyText, CountText, Avatar, Thumbnail, ChatBubble and Composer. Each preview
 * is one state, in the eight-variant matrix.
 */
@Composable
private fun previewDark(): Boolean =
    (LocalConfiguration.current.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES

@Composable
private fun StructurePreview(padded: Boolean = true, content: @Composable () -> Unit) {
    OrderakTheme(darkTheme = previewDark()) {
        Surface {
            Column(
                modifier = Modifier.fillMaxWidth().padding(if (padded) 16.dp else 0.dp),
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
fun topBarBack() {
    StructurePreview(padded = false) {
        TopBar(
            title = stringResource(R.string.struct_title_orders),
            subtitle = stringResource(R.string.field_preview_name_value),
            onBack = {},
            backDescription = stringResource(R.string.common_back),
            actions = listOf(
                TopBarAction(Icons.Outlined.Search, stringResource(R.string.struct_action_search), {}),
                TopBarAction(Icons.Outlined.Share, stringResource(R.string.struct_action_share), {}),
            ),
            onOverflow = {},
            overflowDescription = stringResource(R.string.struct_overflow),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun topBarLarge() {
    StructurePreview(padded = false) {
        TopBar(
            title = stringResource(R.string.struct_title_orders),
            subtitle = stringResource(R.string.field_preview_name_value),
            large = true,
            actions = listOf(
                TopBarAction(Icons.Outlined.Notifications, stringResource(R.string.struct_action_announcements), {}, dot = true),
            ),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun bottomNavFiveSurfaces() {
    StructurePreview(padded = false) {
        BottomNav(
            items = listOf(
                NavItem(stringResource(R.string.struct_nav_today), Icons.Outlined.Home, Icons.Filled.Home),
                NavItem(stringResource(R.string.struct_nav_orders), Icons.Outlined.ShoppingBag, Icons.Filled.ShoppingBag, badge = 3),
                NavItem(stringResource(R.string.struct_nav_store), Icons.Outlined.Storefront, Icons.Filled.Storefront),
                NavItem(stringResource(R.string.struct_nav_customers), Icons.Outlined.People, Icons.Filled.People),
                NavItem(stringResource(R.string.struct_nav_account), Icons.Outlined.Person, Icons.Filled.Person, dot = true),
            ),
            selectedIndex = 1,
            onSelect = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun bottomActionBarWithSummary() {
    StructurePreview(padded = false) {
        BottomActionBar(
            primaryLabel = stringResource(R.string.struct_bar_register),
            onPrimary = {},
            summaryLabel = stringResource(R.string.struct_bar_total),
            summaryValue = "1,250",
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun bottomActionBarDisabled() {
    StructurePreview(padded = false) {
        BottomActionBar(
            primaryLabel = stringResource(R.string.struct_bar_register),
            onPrimary = {},
            primaryEnabled = false,
            disabledReason = stringResource(R.string.struct_bar_reason),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun bottomActionBarTwoActions() {
    StructurePreview(padded = false) {
        BottomActionBar(
            primaryLabel = stringResource(R.string.struct_bar_register),
            onPrimary = {},
            secondaryLabel = stringResource(R.string.common_cancel),
            onSecondary = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun fabExtended() {
    StructurePreview {
        Fab(label = stringResource(R.string.struct_fab_new_order), icon = Icons.Outlined.Add, onClick = {})
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun sectionHeaderWithAction() {
    StructurePreview {
        SectionHeader(
            title = stringResource(R.string.struct_section_latest),
            count = 12,
            actionLabel = stringResource(R.string.struct_section_all),
            onAction = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun settingsRows() {
    StructurePreview(padded = false) {
        SettingsRow(
            title = stringResource(R.string.struct_settings_devices),
            onClick = {},
            icon = Icons.Outlined.Devices,
            value = "2",
        )
        SettingsRow(
            title = stringResource(R.string.struct_settings_language),
            onClick = {},
            icon = Icons.Outlined.Language,
            value = stringResource(R.string.struct_settings_language_value),
        )
        SettingsRow(
            title = stringResource(R.string.struct_settings_delete),
            onClick = {},
            icon = Icons.Outlined.Delete,
            danger = true,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun keyValueRows() {
    StructurePreview {
        KeyValueRow(stringResource(R.string.struct_kv_subtotal), "1,200")
        KeyValueRow(stringResource(R.string.struct_kv_delivery), "50")
        KeyValueRow(stringResource(R.string.struct_bar_total), "1,250", emphasised = true)
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun metricTileContent() {
    StructurePreview {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MetricTile(stringResource(R.string.choice_preview_filter_new), 12, SemanticRole.Info, {}, Modifier.weight(1f))
            MetricTile(stringResource(R.string.choice_preview_filter_unpaid), 3, SemanticRole.Warning, {}, Modifier.weight(1f))
            MetricTile(stringResource(R.string.choice_preview_filter_ready), 5, SemanticRole.Success, {}, Modifier.weight(1f))
        }
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun metricTileNotRead() {
    StructurePreview {
        MetricTile(
            label = stringResource(R.string.choice_preview_filter_new),
            value = null,
            role = SemanticRole.Info,
            onClick = {},
            notReadDescription = stringResource(R.string.struct_not_read),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun metricTileLoading() {
    StructurePreview {
        MetricTile(
            label = stringResource(R.string.choice_preview_filter_new),
            value = null,
            role = SemanticRole.Info,
            onClick = {},
            loading = true,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun statusStepperCurrent() {
    StructurePreview {
        StatusStepper(
            steps = listOf(
                stringResource(R.string.struct_step_new),
                stringResource(R.string.struct_step_confirmed),
                stringResource(R.string.struct_step_paid),
                stringResource(R.string.struct_step_shipped),
                stringResource(R.string.struct_step_completed),
            ),
            currentIndex = 2,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun statusStepperCancelled() {
    StructurePreview {
        StatusStepper(
            steps = emptyList(),
            currentIndex = 0,
            cancelledLabel = stringResource(R.string.struct_step_cancelled),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun stepListSetup() {
    StructurePreview {
        StepList(
            steps = listOf(
                StepItem(stringResource(R.string.struct_setup_created), stringResource(R.string.struct_setup_created_detail), done = true),
                StepItem(stringResource(R.string.struct_setup_product), stringResource(R.string.struct_setup_product_detail), done = false),
                StepItem(stringResource(R.string.struct_setup_share), stringResource(R.string.struct_setup_share_detail), done = false),
            ),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun moneyAndCountText() {
    StructurePreview {
        MoneyText(Money(125050, "EGP"))
        MoneyText(Money(15000, "KWD"))
        CountText(value = 1250)
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun avatarAndThumbnail() {
    StructurePreview {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(name = stringResource(R.string.field_preview_name_value))
            Thumbnail()
        }
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun chatBubbles() {
    StructurePreview {
        ChatBubble(text = stringResource(R.string.struct_chat_theirs), mine = false, time = stringResource(R.string.struct_chat_time))
        ChatBubble(text = stringResource(R.string.struct_chat_mine), mine = true, time = stringResource(R.string.struct_chat_time))
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun composerOpen() {
    StructurePreview(padded = false) {
        Composer(
            value = "",
            onValueChange = {},
            onSend = {},
            placeholder = stringResource(R.string.struct_composer_placeholder),
            sendDescription = stringResource(R.string.common_send),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun composerClosed() {
    StructurePreview(padded = false) {
        Composer(
            value = "",
            onValueChange = {},
            onSend = {},
            placeholder = stringResource(R.string.struct_composer_placeholder),
            sendDescription = stringResource(R.string.common_send),
            closedLabel = stringResource(R.string.error_ticket_closed),
        )
    }
}
