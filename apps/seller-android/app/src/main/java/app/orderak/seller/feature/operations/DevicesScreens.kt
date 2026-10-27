package app.orderak.seller.feature.operations
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.text.style.TextDirection
import app.orderak.seller.core.text.formatAgo
import app.orderak.seller.core.ui.BottomSheet
import app.orderak.seller.core.ui.ConfirmSheet
import app.orderak.seller.core.ui.ConfirmSheetState
import app.orderak.seller.core.ui.SectionHeader
import app.orderak.seller.core.ui.SemanticChip
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.SheetAction
import app.orderak.seller.core.ui.TextField
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import app.orderak.seller.R
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.core.ui.PlanUsageRowItem
import app.orderak.seller.core.ui.planUsageRows
import app.orderak.seller.core.locale.AppLocales
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.backendErrorResource
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.billing.FeatureKeys
import app.orderak.seller.data.billing.BillingManager
import app.orderak.seller.data.billing.BillingState
import app.orderak.seller.data.auth.PasskeyClient
import app.orderak.seller.data.auth.PasskeyResult
import app.orderak.seller.data.remote.AnnouncementDto
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.DeletionRequestDto
import app.orderak.seller.data.remote.DeviceDto
import app.orderak.seller.data.remote.EntitlementDto
import app.orderak.seller.data.remote.PasskeyDto
import app.orderak.seller.data.remote.ProductTranslationDto
import app.orderak.seller.data.remote.SupportMessageDto
import app.orderak.seller.data.remote.SupportTicketDto
import app.orderak.seller.data.session.SessionStore
import app.orderak.seller.data.session.SessionLogoutManager
import app.orderak.seller.app.navigation.SupportTicketRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.intOrNull
import javax.inject.Inject
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.ui.theme.LocalOrderakLayout
import app.orderak.seller.core.ui.EmptyState
import app.orderak.seller.core.ui.EmptyStateKind

@Composable
fun DevicesScreen(
    onBack: () -> Unit,
    onReauthenticate: () -> Unit,
    /**
     * A plan limit refused something, named by its entitlement key: the same callback
     * `ProductsScreen` and `CategoriesScreen` take, so at `max_concurrent_devices` a seller has
     * somewhere to go from the screen that counts the devices.
     */
    onLimitReached: (String) -> Unit = {},
    vm: OperationsViewModel = hiltViewModel(),
) {
    val items by vm.devices.collectAsStateWithLifecycle()
    val passkeys by vm.passkeys.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val config by vm.entitlements.config.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findActivity()
    val deviceLimit = config?.let(::planUsageRows)
        ?.firstOrNull { it.key == FeatureKeys.MAX_CONCURRENT_DEVICES }
    LaunchedEffect(Unit) { vm.loadDevices() }

    DevicesContent(
        items = items,
        passkeys = passkeys,
        busy = busy,
        error = error,
        canAddPasskey = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P,
        onBack = onBack,
        onRetry = vm::loadDevices,
        onReauthenticate = onReauthenticate,
        onAddPasskey = { activity?.let(vm::createPasskey) },
        onRenamePasskey = vm::renamePasskey,
        onDeletePasskey = vm::deletePasskey,
        onRevokeDevice = vm::revokeDevice,
        deviceLimit = deviceLimit,
        purchaseOpen = vm.entitlements.isPurchaseOpen(),
        limitReached = deviceLimit?.limit?.let { deviceLimit.used >= it } == true,
        upgradeAvailable = vm.entitlements.nextUpgradePlanKey() != null,
        onLimitReached = { onLimitReached(FeatureKeys.MAX_CONCURRENT_DEVICES) },
    )
}

/** What the page may be asked about one row; the sheet that confirms it is raised here. */
private sealed interface DeviceSheet {
    data class Revoke(val rowId: Long, val label: String?) : DeviceSheet
    data class PasskeyMenu(val id: String) : DeviceSheet
    data class PasskeyRename(val id: String, val label: String) : DeviceSheet
    data class PasskeyDelete(val id: String) : DeviceSheet
}

/**
 * Every way into this account, and a way to close any of them.
 *
 * A top bar with back; the device meter; الأجهزة (the device, its platform and version, when it
 * was last used, "هذا الجهاز" on this phone and "تسجيل خروجه" on the others); then مفاتيح المرور
 * (label, kind and dates, an overflow to rename or remove) with "إنشاء مفتاح مرور" under the
 * list. Revoking a device and removing a passkey ask first, in sheets, and say what happens.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevicesContent(
    items: List<DeviceDto>?,
    passkeys: List<PasskeyDto>?,
    busy: Boolean,
    error: String?,
    canAddPasskey: Boolean,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onReauthenticate: () -> Unit,
    onAddPasskey: () -> Unit,
    onRenamePasskey: (String, String) -> Unit,
    onDeletePasskey: (String) -> Unit,
    onRevokeDevice: (Long) -> Unit,
    deviceLimit: PlanUsageRow? = null,
    purchaseOpen: Boolean = false,
    limitReached: Boolean = false,
    upgradeAvailable: Boolean = false,
    onLimitReached: () -> Unit = {},
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    var sheet by remember { mutableStateOf<DeviceSheet?>(null) }
    OperationPage(
        title = stringResource(R.string.devices_title),
        onBack = onBack,
        busy = busy || items == null || passkeys == null,
        error = error,
        onRetry = if (error == "recent_auth_required") onReauthenticate else onRetry,
        isEmpty = items?.isEmpty() == true && passkeys?.isEmpty() == true,
        empty = {
            EmptyState(kind = EmptyStateKind.Empty, title = stringResource(R.string.common_empty))
        },
    ) {
        deviceLimit?.let { row ->
            PlanUsageRowItem(row)
            if (limitReached) {
                Banner(
                    state = BannerState.LockedByPlan,
                    title = stringResource(R.string.paywall_limit_devices),
                    message = if (upgradeAvailable) {
                        stringResource(
                            R.string.devices_limit_body,
                            formatCount(row.limit ?: row.used, locale),
                            formatCount(row.used, locale),
                        )
                    } else {
                        stringResource(R.string.devices_limit_body_max_plan, formatCount(row.limit ?: row.used, locale))
                    },
                    actionLabel = if (upgradeAvailable) {
                        stringResource(if (purchaseOpen) R.string.upgrade_now else R.string.paywall_view_plans)
                    } else null,
                    onAction = if (upgradeAvailable) onLimitReached else null,
                )
            }
        }

        SectionHeader(title = stringResource(R.string.devices_section))
        items.orEmpty().forEach { d ->
            Surface(
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surfaceContainerLowest,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.padding(spacing.space3),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(spacing.space3),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(spacing.space1)) {
                        Text(
                            d.device_label ?: stringResource(R.string.device_unknown),
                            style = MaterialTheme.typography.titleSmall.copy(textDirection = TextDirection.Content),
                        )
                        val detail = listOfNotNull(
                            d.platform,
                            d.app_version,
                            serverMillis(d.last_used_at)?.let { formatAgo(it, System.currentTimeMillis(), locale) },
                        ).joinToString(" · ")
                        if (detail.isNotBlank()) {
                            Text(
                                detail,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (d.row_id != 0L) {
                        TextButton(
                            onClick = { sheet = DeviceSheet.Revoke(d.row_id, d.device_label) },
                            modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                        ) {
                            Text(stringResource(R.string.device_revoke), color = MaterialTheme.colorScheme.error)
                        }
                    } else {
                        SemanticChip(SemanticRole.Info, stringResource(R.string.device_primary))
                    }
                }
            }
        }

        SectionHeader(title = stringResource(R.string.passkeys_settings_title))
        passkeys.orEmpty().forEach { passkey ->
            Surface(
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surfaceContainerLowest,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.padding(start = spacing.space3),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f).padding(vertical = spacing.space3), verticalArrangement = Arrangement.spacedBy(spacing.space1)) {
                        Text(
                            passkey.label ?: stringResource(R.string.passkey_unnamed),
                            style = MaterialTheme.typography.titleSmall.copy(textDirection = TextDirection.Content),
                        )
                        val detail = listOfNotNull(
                            passkeyTypeLabel(passkey),
                            passkey.last_used_at?.let { serverMillis(it) }?.let { formatAgo(it, System.currentTimeMillis(), locale) },
                        ).joinToString(" · ")
                        Text(
                            detail,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(
                        onClick = { sheet = DeviceSheet.PasskeyMenu(passkey.id) },
                        modifier = Modifier.size(spacing.minimumTouchTarget),
                    ) {
                        Icon(
                            Icons.Outlined.MoreVert,
                            contentDescription = stringResource(
                                R.string.categories_row_more,
                                passkey.label ?: stringResource(R.string.passkey_unnamed),
                            ),
                        )
                    }
                }
            }
        }
        // Drawn only where passkeys work; the help line says what they are for.
        if (canAddPasskey) {
            Text(
                stringResource(R.string.passkeys_settings_help),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(
                onClick = onAddPasskey,
                modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
            ) { Text(stringResource(R.string.passkeys_add)) }
        }
    }

    val open = sheet
    if (open != null) {
        ModalBottomSheet(
            onDismissRequest = { sheet = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            val passkey = (open as? DeviceSheet.PasskeyMenu)?.id?.let { id -> passkeys?.firstOrNull { it.id == id } }
            when (open) {
                is DeviceSheet.Revoke -> ConfirmSheet(
                    state = ConfirmSheetState.Destructive,
                    title = stringResource(R.string.device_revoke_title, open.label ?: stringResource(R.string.device_unknown)),
                    message = stringResource(R.string.device_revoke_confirm),
                    confirmLabel = stringResource(R.string.device_revoke),
                    cancelLabel = stringResource(R.string.common_cancel),
                    onConfirm = { onRevokeDevice(open.rowId); sheet = null },
                    onCancel = { sheet = null },
                )
                is DeviceSheet.PasskeyMenu -> if (passkey == null) {
                    sheet = null
                } else {
                    BottomSheet(
                        title = passkey.label ?: stringResource(R.string.passkey_unnamed),
                        actions = listOf(
                            SheetAction(
                                stringResource(R.string.passkey_rename),
                                { sheet = DeviceSheet.PasskeyRename(passkey.id, passkey.label.orEmpty()) },
                                Icons.Outlined.Edit,
                            ),
                            SheetAction(
                                stringResource(R.string.passkey_revoke),
                                { sheet = DeviceSheet.PasskeyDelete(passkey.id) },
                                Icons.Outlined.Delete,
                            ),
                        ),
                        closeLabel = stringResource(R.string.sheet_close),
                        onClose = { sheet = null },
                    )
                }
                is DeviceSheet.PasskeyRename -> {
                    var label by rememberSaveable(open.id) { mutableStateOf(open.label) }
                    Column(
                        Modifier.fillMaxWidth().padding(spacing.space4),
                        verticalArrangement = Arrangement.spacedBy(spacing.space3),
                    ) {
                        Text(
                            stringResource(R.string.passkey_rename),
                            style = MaterialTheme.typography.titleLarge,
                            modifier = Modifier.semantics { heading() },
                        )
                        TextField(
                            value = label,
                            onValueChange = { label = it.take(60) },
                            label = stringResource(R.string.passkey_label),
                        )
                        Button(
                            enabled = label.trim().isNotEmpty(),
                            onClick = { onRenamePasskey(open.id, label); sheet = null },
                            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                        ) { Text(stringResource(R.string.product_save_bar)) }
                        TextButton(
                            onClick = { sheet = null },
                            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                        ) { Text(stringResource(R.string.common_cancel)) }
                    }
                }
                is DeviceSheet.PasskeyDelete -> ConfirmSheet(
                    state = ConfirmSheetState.Destructive,
                    title = stringResource(R.string.passkey_revoke),
                    message = stringResource(R.string.passkey_revoke_confirm),
                    confirmLabel = stringResource(R.string.common_delete),
                    cancelLabel = stringResource(R.string.common_cancel),
                    onConfirm = { onDeletePasskey(open.id); sheet = null },
                    onCancel = { sheet = null },
                )
            }
        }
    }
}

@Composable
private fun passkeyTypeLabel(passkey: PasskeyDto): String =
    if (passkey.backed_up) {
        stringResource(R.string.passkey_synced)
    } else {
        stringResource(R.string.passkey_device_bound)
    }
