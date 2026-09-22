package app.orderak.seller.feature.operations

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.R
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.billing.BillingState
import app.orderak.seller.data.remote.DeletionRequestDto
import app.orderak.seller.data.remote.DeviceDto
import app.orderak.seller.data.remote.PasskeyDto
import app.orderak.seller.data.remote.SupportMessageDto
import app.orderak.seller.data.remote.SupportTicketDto
import com.android.tools.screenshot.PreviewTest

/**
 * The five remaining account pages, in every state their contracts declare.
 *
 * Each had a different version of the same problem:
 *
 *   support-ticket   passed no busy and no error to OperationPage at all, and
 *                    its view model discarded `result.error` without looking.
 *                    Two declared states that did not exist.
 *   deletion-status  null means "you have no deletion request" AND "not read
 *                    yet", and it is the seed — so a seller with a pending
 *                    request was told they had none.
 *   subscription     `config?.plan_name ?: "Free"` with no loading state: the
 *                    same free-plan claim حسابي made, on the page whose whole
 *                    subject is what the seller pays.
 *   devices          two lists, and `!busy && a.isEmpty() && b.isEmpty()` is
 *                    true before either request starts.
 *   ai-assistant     declared an empty state and drew the disclosure over
 *                    blank space.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

// ================= support ticket =================

private val TICKET = SupportTicketDto(
    id = 1,
    subject = "الأوردر مش ظاهر في الكتالوج",
    status = "open",
    priority = "high",
)

private val THREAD = listOf(
    SupportMessageDto(id = 1, sender = "منى", body = "الأوردر اتسجل بس مش ظاهر.", created_at = "2026-09-14"),
    SupportMessageDto(id = 2, sender = "الدعم", body = "بنراجع الموضوع دلوقتي.", created_at = "2026-09-14"),
)

@Composable
private fun ticket(
    messages: List<SupportMessageDto>?,
    ticket: SupportTicketDto? = TICKET,
    busy: Boolean = false,
    error: String? = null,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            SupportTicketContent(
                ticket = ticket,
                messages = messages,
                busy = busy,
                error = error,
                reply = "",
                onReplyChange = {},
                onBack = {},
                onRetry = {},
                onSend = {},
            )
        }
    }
}

@PreviewTest
@Preview(name = "Ticket loading light", locale = "ar")
@Composable
fun ticketLoadingLight() = ticket(messages = null, ticket = null)

@PreviewTest
@Preview(name = "Ticket loading dark", locale = "ar")
@Composable
fun ticketLoadingDark() = ticket(messages = null, ticket = null, dark = true)

@PreviewTest
@Preview(name = "Ticket content light", locale = "ar")
@Composable
fun ticketContentLight() = ticket(messages = THREAD)

@PreviewTest
@Preview(name = "Ticket content dark", locale = "ar")
@Composable
fun ticketContentDark() = ticket(messages = THREAD, dark = true)

/** A closed ticket has no reply box — the thread is a record, not a conversation. */
@PreviewTest
@Preview(name = "Ticket closed", locale = "ar")
@Composable
fun ticketClosed() = ticket(messages = THREAD, ticket = TICKET.copy(status = "closed"))

@PreviewTest
@Preview(name = "Ticket error light", locale = "ar")
@Composable
fun ticketErrorLight() = ticket(messages = emptyList(), error = "network_unavailable")

@PreviewTest
@Preview(name = "Ticket error dark", locale = "ar")
@Composable
fun ticketErrorDark() = ticket(messages = emptyList(), error = "network_unavailable", dark = true)

// ================= deletion status =================

@Composable
private fun deletion(
    request: DeletionRequestDto?,
    loaded: Boolean = true,
    error: String? = null,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            DeletionStatusContent(
                request = request,
                loaded = loaded,
                busy = false,
                error = error,
                onBack = {},
                onRetry = {},
            )
        }
    }
}

/** Not loaded — which is NOT the same as "you have no deletion request". */
@PreviewTest
@Preview(name = "Deletion loading light", locale = "ar")
@Composable
fun deletionLoadingLight() = deletion(request = null, loaded = false)

@PreviewTest
@Preview(name = "Deletion loading dark", locale = "ar")
@Composable
fun deletionLoadingDark() = deletion(request = null, loaded = false, dark = true)

/** Loaded, and there genuinely is no request. The sentence the seed used to fake. */
@PreviewTest
@Preview(name = "Deletion none light", locale = "ar")
@Composable
fun deletionNoneLight() = deletion(request = null)

@PreviewTest
@Preview(name = "Deletion none dark", locale = "ar")
@Composable
fun deletionNoneDark() = deletion(request = null, dark = true)

/** A pending request — the case the old seed hid for as long as the call took. */
@PreviewTest
@Preview(name = "Deletion pending", locale = "ar")
@Composable
fun deletionPending() = deletion(
    request = DeletionRequestDto(
        id = "d1",
        status = "pending",
        requested_at = "2026-09-10",
        deadline_at = "2026-10-10",
    ),
)

@PreviewTest
@Preview(name = "Deletion error light", locale = "ar")
@Composable
fun deletionErrorLight() = deletion(request = null, error = "network_unavailable")

@PreviewTest
@Preview(name = "Deletion error dark", locale = "ar")
@Composable
fun deletionErrorDark() = deletion(request = null, error = "network_unavailable", dark = true)

// ================= subscription =================

private val USAGE = listOf(
    PlanUsageRow(key = "max_products", label = R.string.usage_products, used = 14, limit = 20),
    PlanUsageRow(key = "max_orders", label = R.string.usage_orders_month, used = 132, limit = null),
)

@Composable
private fun subscription(
    planName: String?,
    purchaseOpen: Boolean = false,
    billingState: BillingState = BillingState.Disabled,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            SubscriptionContent(
                planName = planName,
                subscriptionStatus = "active",
                currentPeriodEnd = "2026-10-01",
                pendingEffectiveAt = null,
                usage = if (planName == null) emptyList() else USAGE,
                billingState = billingState,
                purchaseOpen = purchaseOpen,
                onBack = {},
                onViewPlans = {},
                onRecoverPurchases = {},
            )
        }
    }
}

@PreviewTest
@Preview(name = "Subscription loading light", locale = "ar")
@Composable
fun subscriptionLoadingLight() = subscription(planName = null)

@PreviewTest
@Preview(name = "Subscription loading dark", locale = "ar")
@Composable
fun subscriptionLoadingDark() = subscription(planName = null, dark = true)

/** A paid plan, because a "Free" fixture would render identically to the bug. */
@PreviewTest
@Preview(name = "Subscription content light", locale = "ar")
@Composable
fun subscriptionContentLight() = subscription(planName = "Pro")

@PreviewTest
@Preview(name = "Subscription content dark", locale = "ar")
@Composable
fun subscriptionContentDark() = subscription(planName = "Pro", dark = true)

/**
 * Purchasing closed, which is the real state today.
 *
 * The banner has to carry a way to the plan list: PlansScreen exists precisely
 * to be read while buying is off, and this screen declared it as an exit with
 * no control that reached it.
 */
@PreviewTest
@Preview(name = "Subscription purchase closed", locale = "ar")
@Composable
fun subscriptionPurchaseClosed() = subscription(planName = "Free", purchaseOpen = false)

@PreviewTest
@Preview(name = "Subscription purchase open", locale = "ar")
@Composable
fun subscriptionPurchaseOpen() =
    subscription(planName = "Free", purchaseOpen = true, billingState = BillingState.Ready)

/** A purchase the server has not confirmed yet — money moved, entitlement has not. */
@PreviewTest
@Preview(name = "Subscription verifying", locale = "ar")
@Composable
fun subscriptionVerifying() =
    subscription(planName = "Pro", purchaseOpen = true, billingState = BillingState.Verifying)

@PreviewTest
@Preview(name = "Subscription billing error", locale = "ar")
@Composable
fun subscriptionBillingError() = subscription(
    planName = "Pro",
    purchaseOpen = true,
    billingState = BillingState.Error("verification_failed"),
)

// ================= devices =================

private val DEVICES = listOf(
    DeviceDto(row_id = 0, device_label = "Samsung A54", platform = "Android", app_version = "1.4.0", last_used_at = "2026-09-16"),
    DeviceDto(row_id = 7, device_label = "Xiaomi Redmi 12", platform = "Android", app_version = "1.3.2", last_used_at = "2026-09-02"),
)

private val PASSKEYS = listOf(
    PasskeyDto(id = "p1", label = "الموبايل", device_type = "platform", backed_up = true, last_used_at = "2026-09-16"),
)

@Composable
private fun devices(
    items: List<DeviceDto>?,
    passkeys: List<PasskeyDto>?,
    error: String? = null,
    canAdd: Boolean = true,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            DevicesContent(
                items = items,
                passkeys = passkeys,
                busy = false,
                error = error,
                selectedPasskeyId = passkeys?.firstOrNull()?.id,
                canAddPasskey = canAdd,
                onBack = {},
                onRetry = {},
                onReauthenticate = {},
                onAddPasskey = {},
                onSelectPasskey = {},
                onRename = {},
                onRevoke = {},
                onRevokeDevice = {},
            )
        }
    }
}

/** Either list still null means the page has not finished looking. */
@PreviewTest
@Preview(name = "Devices loading light", locale = "ar")
@Composable
fun devicesLoadingLight() = devices(items = null, passkeys = null)

@PreviewTest
@Preview(name = "Devices loading dark", locale = "ar")
@Composable
fun devicesLoadingDark() = devices(items = null, passkeys = null, dark = true)

@PreviewTest
@Preview(name = "Devices content light", locale = "ar")
@Composable
fun devicesContentLight() = devices(items = DEVICES, passkeys = PASSKEYS)

@PreviewTest
@Preview(name = "Devices content dark", locale = "ar")
@Composable
fun devicesContentDark() = devices(items = DEVICES, passkeys = PASSKEYS, dark = true)

/** Below Android 9 there is no passkey to add, so the control is disabled rather than hidden. */
@PreviewTest
@Preview(name = "Devices no passkey support", locale = "ar")
@Composable
fun devicesNoPasskeySupport() = devices(items = DEVICES, passkeys = emptyList(), canAdd = false)

/**
 * The error that is not a retry.
 *
 * "recent_auth_required" means sign in again, not try again, and this page
 * routes its retry button to reauthentication for exactly that code.
 */
@PreviewTest
@Preview(name = "Devices recent auth required", locale = "ar")
@Composable
fun devicesRecentAuthRequired() =
    devices(items = emptyList(), passkeys = emptyList(), error = "recent_auth_required")

@PreviewTest
@Preview(name = "Devices error dark", locale = "ar")
@Composable
fun devicesErrorDark() =
    devices(items = emptyList(), passkeys = emptyList(), error = "network_unavailable", dark = true)

// ================= ai assistant =================

@Composable
private fun assistant(
    messages: List<Pair<Boolean, String>>,
    busy: Boolean = false,
    error: String? = null,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            AiAssistantContent(
                messages = messages,
                entitlements = null,
                busy = busy,
                error = error,
                input = "",
                onInputChange = {},
                onBack = {},
                onSend = {},
                onReset = {},
            )
        }
    }
}

/**
 * Nothing loads on entry here, so an empty chat is the truth on arrival — which
 * is why `_busy` could not seed true for the six screens sharing it.
 */
@PreviewTest
@Preview(name = "Assistant empty light", locale = "ar")
@Composable
fun assistantEmptyLight() = assistant(messages = emptyList())

@PreviewTest
@Preview(name = "Assistant empty dark", locale = "ar")
@Composable
fun assistantEmptyDark() = assistant(messages = emptyList(), dark = true)

@PreviewTest
@Preview(name = "Assistant content light", locale = "ar")
@Composable
fun assistantContentLight() = assistant(
    messages = listOf(
        true to "كام منتج عندي مخزونه خلص؟",
        false to "عندك منتج واحد نفد مخزونه: فستان سواريه.",
    ),
)

@PreviewTest
@Preview(name = "Assistant content dark", locale = "ar")
@Composable
fun assistantContentDark() = assistant(
    messages = listOf(
        true to "كام منتج عندي مخزونه خلص؟",
        false to "عندك منتج واحد نفد مخزونه: فستان سواريه.",
    ),
    dark = true,
)

@PreviewTest
@Preview(name = "Assistant sending", locale = "ar")
@Composable
fun assistantSending() = assistant(messages = listOf(true to "كام أوردر النهاردة؟"), busy = true)

@PreviewTest
@Preview(name = "Assistant error light", locale = "ar")
@Composable
fun assistantErrorLight() = assistant(messages = emptyList(), error = "network_unavailable")

@PreviewTest
@Preview(name = "Assistant error dark", locale = "ar")
@Composable
fun assistantErrorDark() =
    assistant(messages = emptyList(), error = "network_unavailable", dark = true)
