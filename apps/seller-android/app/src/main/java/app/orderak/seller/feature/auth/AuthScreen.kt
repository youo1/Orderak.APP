package app.orderak.seller.feature.auth

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.PreviewScreenSizes
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.R
import app.orderak.seller.core.locale.AppLocales
import app.orderak.seller.core.phone.Countries
import app.orderak.seller.core.phone.Country
import app.orderak.seller.core.ui.OrderakShippedLocalePreviews
import app.orderak.seller.core.ui.theme.OrderakTheme

@Composable
fun AuthScreen(
    onNewSeller: () -> Unit,
    onExistingSeller: () -> Unit,
    onBack: () -> Unit = {},
    viewModel: AuthViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findActivity()
    AuthScreenContent(
        state = state,
        onNewSeller = onNewSeller,
        onExistingSeller = onExistingSeller,
        onBack = onBack,
        dispatch = viewModel::dispatch,
        onPasskeySignIn = { activity?.let(viewModel::signInWithPasskey) },
        onCreatePasskey = { activity?.let(viewModel::createPasskey) },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthScreenContent(
    state: AuthUiState,
    onNewSeller: () -> Unit,
    onExistingSeller: () -> Unit,
    onBack: () -> Unit,
    dispatch: (AuthEvent) -> Unit,
    onPasskeySignIn: () -> Unit = {},
    onCreatePasskey: () -> Unit = {},
) {
    var showCountryPicker by rememberSaveable { mutableStateOf(false) }
    var showLanguage by remember { mutableStateOf(false) }
    var helpExpanded by remember { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current

    LaunchedEffect(state) {
        (state as? AuthUiState.Success)?.let {
            if (it.isNewSeller) onNewSeller() else onExistingSeller()
        }
    }

    if (showCountryPicker) {
        CountryPickerSheet(
            selected = when (state) {
                is AuthUiState.EnterPhone -> state.country
                is AuthUiState.EnterOtp -> state.country
                else -> Countries.default
            },
            onSelected = {
                dispatch(AuthEvent.CountrySelected(it))
                showCountryPicker = false
            },
            onDismiss = { showCountryPicker = false },
        )
    }

    if (showLanguage) {
        LanguageSheet(onDismiss = { showLanguage = false })
    }

    if (state is AuthUiState.PasskeyInvite) {
        PasskeyInviteSheet(
            state = state,
            onCreate = onCreatePasskey,
            onSkip = { dispatch(AuthEvent.SkipPasskey) },
        )
    }

    if (state is AuthUiState.Welcome) {
        WelcomeScreen(
            state = state,
            onCreateStore = { dispatch(AuthEvent.StartPhone) },
            onSignIn = onPasskeySignIn,
            onChooseLanguage = { showLanguage = true },
        )
        return
    }

    val phoneBack = when (state) {
        is AuthUiState.EnterPhone -> { { dispatch(AuthEvent.BackToWelcome) } }
        is AuthUiState.EnterOtp -> { { dispatch(AuthEvent.ChangeNumber) } }
        else -> onBack
    }
    BackHandler(enabled = state is AuthUiState.EnterPhone || state is AuthUiState.EnterOtp) {
        phoneBack()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(onClick = phoneBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.common_back))
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { helpExpanded = true }) {
                            Icon(Icons.Default.MoreVert, stringResource(R.string.auth_help))
                        }
                        DropdownMenu(
                            expanded = helpExpanded,
                            onDismissRequest = { helpExpanded = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.auth_faq)) },
                                onClick = {
                                    helpExpanded = false
                                    uriHandler.openUri("https://orderak.app/help")
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.auth_contact_support)) },
                                onClick = {
                                    helpExpanded = false
                                    uriHandler.openUri("mailto:support@orderak.app")
                                },
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        bottomBar = {
            val button = when (state) {
                is AuthUiState.EnterPhone -> Triple(
                    R.string.auth_send_code,
                    state.isValid && !state.isSending,
                    state.isSending,
                )
                is AuthUiState.EnterOtp -> Triple(
                    R.string.auth_verify_code,
                    canVerifyOtp(state.code, state.isVerifying),
                    state.isVerifying,
                )
                else -> null
            }
            button?.let { (label, enabled, loading) ->
                Surface(tonalElevation = 2.dp) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .imePadding()
                            .padding(horizontal = 24.dp, vertical = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        AuthButton(
                            onClick = {
                                dispatch(
                                    if (state is AuthUiState.EnterPhone) {
                                        AuthEvent.RequestOtp
                                    } else {
                                        AuthEvent.VerifyOtp
                                    },
                                )
                            },
                            enabled = enabled,
                            isLoading = loading,
                            label = stringResource(label),
                            modifier = Modifier.fillMaxWidth().widthIn(max = 560.dp),
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentAlignment = Alignment.TopCenter,
        ) {
            when (state) {
                is AuthUiState.EnterPhone -> PhoneVerificationContent(
                    state = state,
                    onCountryPicker = { showCountryPicker = true },
                    dispatch = dispatch,
                )
                is AuthUiState.EnterOtp -> PhoneVerificationContent(
                    state = state,
                    onCountryPicker = { showCountryPicker = true },
                    dispatch = dispatch,
                )
                is AuthUiState.PasskeyInvite, is AuthUiState.Success -> CircularProgressIndicator(
                    modifier = Modifier.padding(top = 120.dp),
                )
                is AuthUiState.Welcome -> Unit
            }
        }
    }
}

internal fun canVerifyOtp(code: String, isVerifying: Boolean): Boolean =
    code.length == AuthViewModel.OTP_LENGTH && !isVerifying

@Composable
private fun WelcomeScreen(
    state: AuthUiState.Welcome,
    onCreateStore: () -> Unit,
    onSignIn: () -> Unit,
    onChooseLanguage: () -> Unit,
) {
    val compactHeight = LocalConfiguration.current.screenHeightDp < 600
    val currentLanguage = AppLocales.supported
        .firstOrNull { it.tag == AppLocales.currentTag() }
        ?.nativeName
        ?: "English"
    Box(Modifier.fillMaxSize()) {
        TextButton(
            onClick = onChooseLanguage,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .statusBarsPadding()
                .padding(horizontal = 12.dp, vertical = 4.dp)
                .zIndex(2f),
        ) {
            Icon(
                Icons.Outlined.Language,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.widthIn(min = 8.dp))
            Text(currentLanguage)
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 560.dp)
                .align(Alignment.TopCenter)
                .verticalScroll(rememberScrollState())
                .padding(
                    start = 24.dp,
                    top = if (compactHeight) 72.dp else 112.dp,
                    end = 24.dp,
                    bottom = 240.dp,
                ),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(
                painter = painterResource(R.drawable.ic_orderak_logo),
                contentDescription = stringResource(R.string.app_name),
                modifier = Modifier.size(if (compactHeight) 80.dp else 112.dp),
            )
            Spacer(Modifier.height(if (compactHeight) 16.dp else 28.dp))
            Text(
                stringResource(R.string.welcome_value),
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                stringResource(R.string.welcome_subtitle),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .widthIn(max = 560.dp)
                .navigationBarsPadding()
                .padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Button(
                onClick = onCreateStore,
                enabled = !state.isPasskeyLoading,
                modifier = Modifier.fillMaxWidth().height(54.dp),
            ) {
                Text(stringResource(R.string.welcome_create_store))
            }
            Spacer(Modifier.height(12.dp))
            OutlinedButton(
                onClick = onSignIn,
                enabled = !state.isPasskeyLoading,
                modifier = Modifier.fillMaxWidth().height(54.dp),
            ) {
                if (state.isPasskeyLoading) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Outlined.Fingerprint, contentDescription = null)
                    Spacer(Modifier.widthIn(min = 8.dp))
                    Text(stringResource(R.string.welcome_sign_in))
                }
            }
            if (state.showOtpFallback) {
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = onCreateStore) {
                    Text(stringResource(R.string.welcome_otp_fallback))
                }
            }
            AuthErrorText(state.error)
        }
    }
}

@Composable
private fun PhoneVerificationContent(
    state: AuthUiState,
    onCountryPicker: () -> Unit,
    dispatch: (AuthEvent) -> Unit,
) {
    val phoneState = state as? AuthUiState.EnterPhone
    val otpState = state as? AuthUiState.EnterOtp
    if (phoneState == null && otpState == null) return
    val country = phoneState?.country ?: otpState!!.country
    val phone = phoneState?.phone ?: otpState!!.phone
    val phoneLocked = otpState != null

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(max = 560.dp)
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(stringResource(R.string.auth_phone_entry_title), style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.auth_phone_reason),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))
        AuthPhoneForm(
            phone = phone,
            country = country,
            isValid = phoneState?.isValid ?: true,
            isSending = phoneState?.isSending ?: false,
            error = phoneState?.error,
            enabled = !phoneLocked,
            onCountrySelected = { dispatch(AuthEvent.CountrySelected(it)) },
            onPhoneChanged = { dispatch(AuthEvent.PhoneChanged(it)) },
            onShowCountryPicker = onCountryPicker,
            modifier = Modifier.fillMaxWidth(),
        )
        if (otpState != null) {
            Spacer(Modifier.height(8.dp))
            AuthOtpForm(
                phoneE164 = otpState.phoneE164,
                code = otpState.code,
                secondsLeft = otpState.secondsLeft,
                canResend = otpState.canResend,
                isVerifying = otpState.isVerifying,
                error = otpState.error,
                onCodeChanged = { dispatch(AuthEvent.CodeChanged(it)) },
                onResend = { dispatch(AuthEvent.ResendOtp) },
                onChangeNumber = { dispatch(AuthEvent.ChangeNumber) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PasskeyInviteSheet(
    state: AuthUiState.PasskeyInvite,
    onCreate: () -> Unit,
    onSkip: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onSkip) {
        Column(
            Modifier.fillMaxWidth().widthIn(max = 560.dp).align(Alignment.CenterHorizontally).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Outlined.Fingerprint, contentDescription = null, modifier = Modifier.size(44.dp))
            Spacer(Modifier.height(16.dp))
            Text(stringResource(R.string.passkey_invite_title), style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(
                    if (state.deferredForOnboarding) {
                        R.string.passkey_invite_deferred_body
                    } else {
                        R.string.passkey_invite_body
                    },
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            AuthErrorText(state.error)
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = onCreate,
                enabled = !state.isCreating,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (state.isCreating) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Text(
                    stringResource(
                        if (state.deferredForOnboarding) {
                            R.string.passkey_invite_deferred_create
                        } else {
                            R.string.passkey_invite_create
                        },
                    ),
                )
            }
            TextButton(onClick = onSkip, enabled = !state.isCreating) {
                Text(stringResource(R.string.passkey_invite_not_now))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CountryPickerSheet(
    selected: Country,
    onSelected: (Country) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val configuration = LocalConfiguration.current
    // Fall back to the Compose-observable locale, not java.util.Locale.getDefault():
    // the static default is not read observably, so the list would not recompose
    // when the user switches app language (NonObservableLocale lint).
    val fallbackLocale = androidx.compose.ui.text.intl.Locale.current.platformLocale
    val locale = if (configuration.locales.isEmpty) fallbackLocale else configuration.locales[0]
    val countries = remember(query, locale) {
        Countries.all(locale).filter {
            query.isBlank() ||
                it.name.contains(query, ignoreCase = true) ||
                it.iso.contains(query, ignoreCase = true) ||
                it.dialCode.startsWith(query.removePrefix("+"))
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
            Text(stringResource(R.string.country_picker_title), style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it.take(50) },
                label = { Text(stringResource(R.string.country_picker_search)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            LazyColumn(Modifier.fillMaxWidth().height(420.dp)) {
                items(countries, key = { it.iso }) { country ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelected(country) }
                            .padding(vertical = 14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text("${country.flag}  ${country.name}")
                        Text("+${country.dialCode}${if (country.iso == selected.iso) "  ✓" else ""}")
                    }
                }
            }
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@PreviewScreenSizes
@OrderakShippedLocalePreviews
@Composable
private fun WelcomePreview() {
    OrderakTheme {
        AuthScreenContent(
            state = AuthUiState.Welcome(),
            onNewSeller = {},
            onExistingSeller = {},
            onBack = {},
            dispatch = {},
        )
    }
}
