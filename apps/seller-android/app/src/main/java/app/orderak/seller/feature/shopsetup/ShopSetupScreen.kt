package app.orderak.seller.feature.shopsetup

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShopSetupScreen(
    onDone: () -> Unit,
    onExit: () -> Unit,
    onReauthenticate: () -> Unit,
    viewModel: ShopSetupViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val locale = LocalConfiguration.current.locales[0]
    val activity = LocalContext.current.findActivity()

    LaunchedEffect(locale) { viewModel.onLocaleChanged(locale) }
    LaunchedEffect(state.reauthenticationRequired) {
        if (state.reauthenticationRequired) onReauthenticate()
    }
    LaunchedEffect(state.completed, state.showPasskeyInvite) {
        if (state.completed && !state.showPasskeyInvite) onDone()
    }
    BackHandler {
        if (state.step == 2) viewModel.back() else onExit()
    }

    if (state.showPasskeyInvite) {
        OnboardingPasskeySheet(
            state = state,
            onCreate = { activity?.let(viewModel::createPasskey) },
            onSkip = viewModel::skipPasskey,
        )
    }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(
                        if (state.step == 1) {
                            stringResource(R.string.setup_account_title)
                        } else {
                            stringResource(R.string.setup_store_title)
                        },
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = if (state.step == 2) viewModel::back else onExit,
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            stringResource(R.string.common_back),
                        )
                    }
                },
            )
        },
        bottomBar = {
            Surface(tonalElevation = 2.dp) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .imePadding()
                        .padding(horizontal = 24.dp, vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Button(
                        onClick = if (state.step == 1) viewModel::next else viewModel::finish,
                        enabled = if (state.step == 1) {
                            !state.saving
                        } else {
                            state.canFinishStore && !state.saving
                        },
                        modifier = Modifier.fillMaxWidth().widthIn(max = 560.dp).height(56.dp),
                    ) {
                        if (state.saving) {
                            CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        } else {
                            Text(
                                stringResource(
                                    if (state.step == 1) R.string.setup_next
                                    else R.string.setup_start_selling,
                                ),
                            )
                        }
                    }
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val progress by animateFloatAsState(
                    targetValue = if (state.step == 1) 0.5f else 1f,
                    label = "onboarding_progress",
                )
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.setup_step_indicator, state.step),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(28.dp))

                if (state.step == 1) {
                    AccountInformationStep(state, viewModel)
                } else {
                    StoreInformationStep(state, viewModel)
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun AccountInformationStep(
    state: ShopSetupUiState,
    viewModel: ShopSetupViewModel,
) {
    var showYearDialog by rememberSaveable { mutableStateOf(false) }

    Text(
        stringResource(R.string.setup_account_subtitle),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(28.dp))
    OutlinedTextField(
        value = state.fullName,
        onValueChange = viewModel::onFullNameChanged,
        label = { Text(stringResource(R.string.setup_full_name_label)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().onboardingAutofill(
            listOf(AutofillType.PersonFullName),
            viewModel::onFullNameChanged,
        ),
        isError = state.fullName.isNotBlank() && state.fullName.trim().length !in 3..80,
    )
    Spacer(Modifier.height(16.dp))
    val openYearLabel = stringResource(R.string.setup_birth_year_open_description)
    Box(Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = state.birthYear?.toString().orEmpty(),
            onValueChange = {},
            label = { Text(stringResource(R.string.setup_birth_year_label)) },
            placeholder = { Text(stringResource(R.string.setup_birth_year_placeholder)) },
            trailingIcon = {
                Icon(Icons.Default.ArrowDropDown, contentDescription = null)
            },
            readOnly = true,
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Box(
            modifier = Modifier
                .matchParentSize()
                .clickable(
                    onClickLabel = openYearLabel,
                    role = Role.Button,
                    onClick = { showYearDialog = true },
                ),
        )
    }
    Spacer(Modifier.height(16.dp))
    OutlinedTextField(
        value = state.email,
        onValueChange = viewModel::onEmailChanged,
        label = { Text(stringResource(R.string.setup_email_label)) },
        supportingText = { Text(stringResource(R.string.setup_email_private_help)) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        singleLine = true,
        modifier = Modifier.fillMaxWidth().onboardingAutofill(
            listOf(AutofillType.EmailAddress),
            viewModel::onEmailChanged,
        ),
        isError = !state.emailValid,
    )
    SetupError(state.error)
    Spacer(Modifier.height(30.dp))
    OnboardingLegalText()
    Spacer(Modifier.height(16.dp))

    if (showYearDialog) {
        YearOfBirthDialog(
            selectedYear = state.birthYear,
            onDismiss = { showYearDialog = false },
            onSelected = {
                viewModel.onBirthYearChanged(it)
                showYearDialog = false
            },
        )
    }
}

@Composable
private fun YearOfBirthDialog(
    selectedYear: Int?,
    onDismiss: () -> Unit,
    onSelected: (Int) -> Unit,
) {
    val currentYear = remember { currentUtcYear() }
    val years = remember(currentYear) { birthYearOptions(currentYear) }
    val selectedIndex = selectedYear
        ?.let { currentYear - it }
        ?.coerceIn(0, years.lastIndex)
        ?: 0
    val gridState = rememberLazyGridState(initialFirstVisibleItemIndex = selectedIndex)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.setup_birth_year_title)) },
        text = {
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                state = gridState,
                modifier = Modifier.fillMaxWidth().heightIn(max = 420.dp),
            ) {
                items(years, key = { it }) { year ->
                    FilterChip(
                        selected = selectedYear == year,
                        onClick = { onSelected(year) },
                        label = {
                            Text(
                                text = year.toString(),
                                textAlign = TextAlign.Center,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        },
                        modifier = Modifier.padding(4.dp),
                    )
                }
            }
        },
        confirmButton = {},
    )
}

internal fun birthYearOptions(currentYear: Int = currentUtcYear()): List<Int> =
    (currentYear downTo 1900).toList()

internal fun onboardingStoreLinkPreview(countryIso: String, slug: String): String =
    "https://orderak.app/${countryIso.uppercase()}-$slug-••••••••"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StoreInformationStep(
    state: ShopSetupUiState,
    viewModel: ShopSetupViewModel,
) {
    var categoryExpanded by rememberSaveable { mutableStateOf(false) }
    var cityExpanded by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(state.cityCatalogId) {
        if (state.cityCatalogId != null) cityExpanded = false
    }

    Text(
        stringResource(R.string.setup_store_heading),
        style = MaterialTheme.typography.headlineSmall,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(6.dp))
    Text(
        stringResource(R.string.setup_store_subtitle),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(24.dp))
    OutlinedTextField(
        value = state.name,
        onValueChange = viewModel::onNameChanged,
        label = { Text(stringResource(R.string.setup_shop_name_label)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(8.dp))
    Text(
        text = stringResource(R.string.setup_store_link_preview),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    )
    Text(
        text = onboardingStoreLinkPreview(state.country.iso, state.slug),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
    )
    Text(
        text = when (state.slugAvailability) {
            SlugAvailability.CHECKING -> stringResource(R.string.setup_slug_checking)
            SlugAvailability.AVAILABLE -> stringResource(R.string.setup_slug_available)
            SlugAvailability.TAKEN -> stringResource(R.string.setup_slug_taken)
            SlugAvailability.INVALID -> stringResource(R.string.setup_slug_invalid)
            SlugAvailability.OFFLINE -> stringResource(R.string.setup_slug_offline)
            SlugAvailability.IDLE -> stringResource(R.string.setup_slug_help)
        },
        style = MaterialTheme.typography.bodySmall,
        color = if (state.slugAvailability in setOf(SlugAvailability.TAKEN, SlugAvailability.INVALID)) {
            MaterialTheme.colorScheme.error
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
        modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
    )
    Spacer(Modifier.height(18.dp))

    ExposedDropdownMenuBox(
        expanded = categoryExpanded,
        onExpandedChange = { categoryExpanded = it },
        modifier = Modifier.fillMaxWidth(),
    ) {
        OutlinedTextField(
            value = state.categoryName.orEmpty(),
            onValueChange = {},
            readOnly = true,
            singleLine = true,
            label = { Text(stringResource(R.string.setup_category_label)) },
            placeholder = { Text(stringResource(R.string.setup_category_placeholder)) },
            trailingIcon = {
                ExposedDropdownMenuDefaults.TrailingIcon(expanded = categoryExpanded)
            },
            isError = state.taxonomyError,
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable, true),
        )
        ExposedDropdownMenu(
            expanded = categoryExpanded,
            onDismissRequest = { categoryExpanded = false },
            modifier = Modifier.heightIn(max = 360.dp),
        ) {
            if (state.taxonomyLoading && state.categories.isEmpty()) {
                DropdownMenuItem(
                    text = {
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            strokeWidth = 2.dp,
                        )
                    },
                    onClick = {},
                    enabled = false,
                )
            }
            state.categories.forEach { category ->
                DropdownMenuItem(
                    text = { Text(category.name) },
                    onClick = {
                        viewModel.onCategorySelected(category)
                        categoryExpanded = false
                    },
                    contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding,
                )
            }
            if (state.taxonomyError) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.common_retry)) },
                    onClick = viewModel::retryTaxonomy,
                )
            }
        }
    }

    Spacer(Modifier.height(14.dp))

    ExposedDropdownMenuBox(
        expanded = cityExpanded,
        onExpandedChange = { expanded ->
            cityExpanded = expanded
            if (
                expanded &&
                state.cityCatalogId == null &&
                state.citySuggestions.isEmpty() &&
                !state.citySearching
            ) {
                viewModel.retryCitySearch()
            }
        },
        modifier = Modifier.fillMaxWidth(),
    ) {
        OutlinedTextField(
            value = state.city,
            onValueChange = {
                cityExpanded = true
                viewModel.onCityChanged(it)
            },
            singleLine = true,
            label = { Text(stringResource(R.string.setup_city_label)) },
            placeholder = { Text(stringResource(R.string.setup_city_placeholder)) },
            trailingIcon = {
                ExposedDropdownMenuDefaults.TrailingIcon(expanded = cityExpanded)
            },
            isError = state.cityError,
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryEditable, true),
        )
        ExposedDropdownMenu(
            expanded = cityExpanded,
            onDismissRequest = { cityExpanded = false },
            modifier = Modifier.heightIn(max = 380.dp),
        ) {
            when {
                state.citySearching -> DropdownMenuItem(
                    text = {
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            strokeWidth = 2.dp,
                        )
                    },
                    onClick = {},
                    enabled = false,
                )
                state.cityError -> DropdownMenuItem(
                    text = {
                        Text(
                            stringResource(R.string.setup_city_search_error),
                            color = MaterialTheme.colorScheme.error,
                        )
                    },
                    onClick = viewModel::retryCitySearch,
                )
                state.city.trim().length >= 2 &&
                    state.citySuggestions.isEmpty() &&
                    state.cityCatalogId == null -> DropdownMenuItem(
                    text = { Text(stringResource(R.string.setup_city_no_results)) },
                    onClick = {},
                    enabled = false,
                )
                state.city.isBlank() -> DropdownMenuItem(
                    text = { Text(stringResource(R.string.setup_city_search)) },
                    onClick = {},
                    enabled = false,
                )
            }
            state.citySuggestions.forEach { suggestion ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(suggestion.name)
                            suggestion.state_name?.takeIf(String::isNotBlank)?.let {
                                Text(
                                    it,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    },
                    onClick = { viewModel.onCitySelected(suggestion) },
                    contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding,
                )
            }
            if (
                state.city.trim().length >= 2 &&
                state.cityCatalogId == null &&
                !state.citySearching
            ) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.setup_city_use_manual, state.city.trim())) },
                    onClick = {
                        viewModel.useManualCity()
                        cityExpanded = false
                    },
                )
            }
            DropdownMenuItem(
                text = {
                    Text(
                        stringResource(R.string.setup_city_data_attribution),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.End,
                        modifier = Modifier.fillMaxWidth(),
                    )
                },
                onClick = {},
                enabled = false,
            )
        }
    }
    Text(
        stringResource(R.string.setup_city_country_from_phone, state.country.name),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
    )
    SetupError(state.error)
}

@Composable
private fun OnboardingLegalText() {
    val uriHandler = LocalUriHandler.current
    val linkStyle = TextLinkStyles(
        style = SpanStyle(
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.Bold,
        ),
    )
    val text = buildAnnotatedString {
        append(stringResource(R.string.setup_legal_before_terms))
        append(' ')
        withLink(
            LinkAnnotation.Url(
                url = "https://orderak.app/terms",
                styles = linkStyle,
            ) { uriHandler.openUri("https://orderak.app/terms") },
        ) {
            append(stringResource(R.string.auth_terms_link))
        }
        append(' ')
        append(stringResource(R.string.setup_legal_between_links))
        append(' ')
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
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun SetupError(error: String?) {
    if (error.isNullOrBlank()) return
    val text = when (error) {
        "invalid_full_name" -> stringResource(R.string.setup_full_name_error)
        "invalid_email", "email_in_use" -> stringResource(R.string.setup_email_error)
        "invalid_birth_year" -> stringResource(R.string.setup_birth_year_error)
        "slug_taken" -> stringResource(R.string.setup_slug_taken)
        "network", "bad_response" -> stringResource(R.string.error_network)
        "passkey_failed" -> stringResource(R.string.auth_passkey_failed)
        "passkey_unavailable" -> stringResource(R.string.auth_passkey_unavailable)
        else -> stringResource(R.string.error_generic)
    }
    Text(
        text,
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OnboardingPasskeySheet(
    state: ShopSetupUiState,
    onCreate: () -> Unit,
    onSkip: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onSkip) {
        Column(
            modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Outlined.Fingerprint, contentDescription = null, modifier = Modifier.size(44.dp))
            Spacer(Modifier.height(14.dp))
            Text(stringResource(R.string.passkey_invite_title), style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.passkey_invite_body),
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            SetupError(state.error)
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = onCreate,
                enabled = !state.passkeyCreating,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (state.passkeyCreating) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Text(stringResource(R.string.passkey_invite_create))
            }
            TextButton(onClick = onSkip, enabled = !state.passkeyCreating) {
                Text(stringResource(R.string.passkey_invite_not_now))
            }
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@OptIn(ExperimentalComposeUiApi::class)
private fun Modifier.onboardingAutofill(
    types: List<AutofillType>,
    onFill: (String) -> Unit,
) = composed {
    val autofill = LocalAutofill.current
    val node = remember { AutofillNode(autofillTypes = types, onFill = onFill) }
    LocalAutofillTree.current += node
    onGloballyPositioned { node.boundingBox = it.boundsInWindow() }
        .onFocusChanged {
            if (it.isFocused) autofill?.requestAutofillForNode(node)
            else autofill?.cancelAutofillForNode(node)
        }
}
