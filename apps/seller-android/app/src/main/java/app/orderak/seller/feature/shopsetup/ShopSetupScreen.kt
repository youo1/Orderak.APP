package app.orderak.seller.feature.shopsetup

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.R
import app.orderak.seller.core.share.copyLink
import app.orderak.seller.core.share.shareStoreLink
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.BottomActionBar
import app.orderak.seller.core.ui.CheckboxRow
import app.orderak.seller.core.ui.KeyValueRow
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.StepItem
import app.orderak.seller.core.ui.StepList
import app.orderak.seller.core.ui.TextField
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.colors
import app.orderak.seller.core.ui.theme.LocalOrderakLayout
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

/**
 * The setup: one screen that turns a verified number into a working store link, then a ready
 * screen. [onDone] leaves for the app; [onAddFirstProduct] leaves for the app and opens the
 * product form.
 */
@Composable
fun ShopSetupScreen(
    onDone: () -> Unit,
    onExit: () -> Unit,
    onReauthenticate: () -> Unit,
    onAddFirstProduct: () -> Unit = onDone,
    viewModel: ShopSetupViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val locale = LocalConfiguration.current.locales[0]
    val context = LocalContext.current
    val activity = context.findActivity()

    LaunchedEffect(locale) { viewModel.onLocaleChanged(locale) }
    LaunchedEffect(state.reauthenticationRequired) {
        if (state.reauthenticationRequired) onReauthenticate()
    }
    // Once the store exists there is nothing to go back to: back is "later".
    BackHandler { if (state.completed) onDone() else onExit() }

    if (state.showPasskeyInvite) {
        OnboardingPasskeySheet(
            state = state,
            onCreate = { activity?.let(viewModel::createPasskey) },
            onSkip = viewModel::skipPasskey,
        )
    }

    ShopSetupContent(
        state = state,
        actions = ShopSetupActions(
            onFullNameChanged = viewModel::onFullNameChanged,
            onAgeConfirmedChanged = viewModel::onAgeConfirmedChanged,
            onNameChanged = viewModel::onNameChanged,
            create = viewModel::create,
            share = { url -> shareStoreLink(context, state.name, url) },
            copy = { url -> copyLink(context, url) },
            addFirstProduct = onAddFirstProduct,
            later = onDone,
        ),
        onExit = onExit,
    )
}

/** Everything the setup can ask for, as data; every field defaults to a no-op. */
data class ShopSetupActions(
    val onFullNameChanged: (String) -> Unit = {},
    val onAgeConfirmedChanged: (Boolean) -> Unit = {},
    val onNameChanged: (String) -> Unit = {},
    val create: () -> Unit = {},
    val share: (String) -> Unit = {},
    val copy: (String) -> Unit = {},
    val addFirstProduct: () -> Unit = {},
    val later: () -> Unit = {},
)

/**
 * The setup, as a function of its state: the one step before the store exists, the ready screen
 * after it.
 *
 * The locale effect, the reauthentication effect, the back handler and the passkey sheet stay in
 * [ShopSetupScreen]: each is a transition or a conversation, and none is a state of this page.
 */
@Composable
fun ShopSetupContent(
    state: ShopSetupUiState,
    actions: ShopSetupActions,
    onExit: () -> Unit,
) {
    if (state.completed) {
        ReadyScreen(state, actions)
    } else {
        CreateScreen(state, actions, onExit)
    }
}

@Composable
private fun CreateScreen(state: ShopSetupUiState, actions: ShopSetupActions, onExit: () -> Unit) {
    val layout = LocalOrderakLayout.current
    val spacing = LocalOrderakSpacing.current
    Scaffold(
        topBar = {
            TopBar(
                title = stringResource(R.string.setup_bar_title),
                onBack = onExit,
                backDescription = stringResource(R.string.common_back),
            )
        },
        bottomBar = {
            BottomActionBar(
                primaryLabel = stringResource(R.string.setup_create_store),
                onPrimary = actions.create,
                primaryEnabled = state.canCreate && !state.saving,
                disabledReason = if (!state.canCreate && !state.saving) stringResource(R.string.setup_bar_reason) else null,
            )
        },
    ) { padding ->
        // Creating the store replaces the form rather than covering it, so a second tap cannot
        // create a second store and nothing hidden behind a scrim is left for a screen reader.
        // What was typed lives in the state, so the form comes back whole if creation fails.
        if (state.saving) {
            Column(
                Modifier.fillMaxSize().padding(padding),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CircularProgressIndicator()
                Spacer(Modifier.height(spacing.space4))
                Text(stringResource(R.string.setup_creating), style = MaterialTheme.typography.titleMedium)
            }
        } else {
            Box(Modifier.fillMaxSize().padding(padding)) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .imePadding()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = spacing.space6, vertical = spacing.space4),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Column(
                        modifier = Modifier.widthIn(max = layout.contentMaxWidth).fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(spacing.space4),
                    ) {
                        Text(
                            stringResource(R.string.setup_headline),
                            style = MaterialTheme.typography.headlineSmall,
                            modifier = Modifier.semantics { heading() },
                        )
                        Text(
                            stringResource(R.string.setup_subline),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (state.error != null && !state.saving) {
                            // Creation failed: everything typed is kept, and the bar still works as the retry.
                            Banner(
                                state = BannerState.Error,
                                title = stringResource(R.string.setup_create_failed),
                                message = setupErrorText(state.error),
                                actionLabel = if (state.canCreate) stringResource(R.string.common_retry) else null,
                                onAction = if (state.canCreate) actions.create else null,
                            )
                        }
                        // The link as it will be: the name in the middle, a permanent code added on
                        // creation. The server makes the real one, so there is no "name taken" here.
                        TextField(
                            value = state.name,
                            onValueChange = actions.onNameChanged,
                            label = stringResource(R.string.setup_shop_name_label),
                            required = true,
                            helper = stringResource(
                                R.string.setup_link_help,
                                onboardingStoreLinkPreview(state.country.iso, onboardingSlugify(state.name).ifBlank { "…" }),
                            ),
                            enabled = !state.saving,
                        )
                        TextField(
                            value = state.fullName,
                            onValueChange = actions.onFullNameChanged,
                            label = stringResource(R.string.setup_full_name_label),
                            required = true,
                            helper = stringResource(R.string.setup_full_name_help),
                            enabled = !state.saving,
                        )
                        // The statement is the canonical wording the server records.
                        CheckboxRow(
                            label = stringResource(R.string.setup_age_confirm),
                            checked = state.ageConfirmed,
                            onCheckedChange = actions.onAgeConfirmedChanged,
                            enabled = !state.saving,
                        )
                        // The country is the phone's, shown as a line of text rather than a field.
                        KeyValueRow(label = stringResource(R.string.setup_country_line), value = state.country.name)
                        OnboardingLegalText()
                    }
                }
            }
        }
    }
}

@Composable
private fun ReadyScreen(state: ShopSetupUiState, actions: ShopSetupActions) {
    val layout = LocalOrderakLayout.current
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    val colors = SemanticRole.Success.colors()
    Scaffold(
        bottomBar = {
            BottomActionBar(
                primaryLabel = stringResource(R.string.setup_add_first_product),
                onPrimary = actions.addFirstProduct,
                secondaryLabel = stringResource(R.string.setup_later),
                onSecondary = actions.later,
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = spacing.space6, vertical = spacing.space6),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier.widthIn(max = layout.contentMaxWidth).fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(spacing.space4),
            ) {
                Surface(shape = CircleShape, color = colors.container, modifier = Modifier.size(spacing.space16)) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = colors.onContainer)
                    }
                }
                Text(
                    stringResource(R.string.setup_ready_title),
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.semantics { heading() },
                )
                state.storeUrl?.let { url ->
                    Text(
                        url,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.primary,
                        textAlign = TextAlign.Center,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(spacing.space2)) {
                        Button(
                            onClick = { actions.share(url) },
                            modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                        ) {
                            Icon(Icons.Outlined.Share, contentDescription = null)
                            Text(stringResource(R.string.setup_share), Modifier.padding(start = spacing.space2))
                        }
                        OutlinedButton(
                            onClick = { actions.copy(url) },
                            modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                        ) {
                            Icon(Icons.Outlined.ContentCopy, contentDescription = null)
                            Text(stringResource(R.string.setup_copy), Modifier.padding(start = spacing.space2))
                        }
                    }
                }
                // What is left, in the order that gets a store selling: only the first is done.
                Surface(
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.surfaceContainerLowest,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(spacing.space4), verticalArrangement = Arrangement.spacedBy(spacing.space3)) {
                        Text(
                            stringResource(R.string.setup_checklist_title, formatCount(1, locale), formatCount(4, locale)),
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.semantics { heading() },
                        )
                        StepList(
                            steps = listOf(
                                StepItem(stringResource(R.string.struct_setup_created), stringResource(R.string.struct_setup_created_detail), done = true),
                                StepItem(stringResource(R.string.struct_setup_product), stringResource(R.string.struct_setup_product_detail), done = false),
                                StepItem(stringResource(R.string.setup_step_payment), stringResource(R.string.setup_step_payment_detail), done = false),
                                StepItem(stringResource(R.string.setup_step_city), stringResource(R.string.setup_step_city_detail), done = false),
                            ),
                        )
                    }
                }
            }
        }
    }
}

internal fun onboardingStoreLinkPreview(countryIso: String, slug: String): String =
    "orderak.app/${countryIso.uppercase()}-$slug-••••••••"

@Composable
private fun setupErrorText(error: String?): String = when (error) {
    "invalid_full_name" -> stringResource(R.string.setup_full_name_error)
    "age_confirmation_required" -> stringResource(R.string.setup_age_error)
    "network", "bad_response" -> stringResource(R.string.error_network)
    "passkey_failed" -> stringResource(R.string.auth_passkey_failed)
    "passkey_unavailable" -> stringResource(R.string.auth_passkey_unavailable)
    else -> stringResource(R.string.error_generic)
}

@Composable
private fun OnboardingLegalText() {
    val uriHandler = LocalUriHandler.current
    val spacing = LocalOrderakSpacing.current
    // The two documents are controls of their own, not links inside a sentence: each has a name a
    // screen reader can announce and a target a thumb can find.
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            stringResource(R.string.setup_legal_before_terms),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(spacing.space2)) {
            TextButton(
                onClick = { uriHandler.openUri("https://orderak.app/terms") },
                modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
            ) { Text(stringResource(R.string.auth_terms_link)) }
            TextButton(
                onClick = { uriHandler.openUri("https://orderak.app/privacy") },
                modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
            ) { Text(stringResource(R.string.auth_privacy_link)) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OnboardingPasskeySheet(
    state: ShopSetupUiState,
    onCreate: () -> Unit,
    onSkip: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onSkip) {
        OnboardingPasskeyContent(
            creating = state.passkeyCreating,
            error = state.error,
            onCreate = onCreate,
            onSkip = onSkip,
        )
    }
}

/**
 * The onboarding passkey invite, without the sheet around it.
 *
 * `ModalBottomSheet` is not captured by the screenshot harness, so nothing that rendered the
 * screen in its `showPasskeyInvite` state would have shown this sheet. The error is a raw wire
 * code resolved by this screen's own pipeline, which is why it is not merged with the auth sheet.
 */
@Composable
internal fun OnboardingPasskeyContent(
    creating: Boolean,
    error: String?,
    onCreate: () -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val layout = LocalOrderakLayout.current
    val spacing = LocalOrderakSpacing.current
    Column(
        modifier = modifier.widthIn(max = layout.contentMaxWidth).fillMaxWidth().padding(spacing.space6),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Outlined.Fingerprint, contentDescription = null, modifier = Modifier.size(spacing.iconHero))
        Spacer(Modifier.height(spacing.space4))
        Text(stringResource(R.string.passkey_invite_title), style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(spacing.space2))
        Text(
            stringResource(R.string.passkey_invite_body),
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!error.isNullOrBlank()) {
            Text(
                setupErrorText(error),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.fillMaxWidth().padding(top = spacing.space2),
            )
        }
        Spacer(Modifier.height(spacing.space6))
        Button(
            onClick = onCreate,
            enabled = !creating,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (creating) CircularProgressIndicator(Modifier.size(spacing.iconMedium), strokeWidth = 2.dp)
            else Text(stringResource(R.string.passkey_invite_create))
        }
        TextButton(onClick = onSkip, enabled = !creating) {
            Text(stringResource(R.string.passkey_invite_not_now))
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
