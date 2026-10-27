package app.orderak.seller.feature.operations

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.data.remote.AnnouncementDto
import app.orderak.seller.data.remote.DeletionRequestDto
import app.orderak.seller.data.remote.DeviceDto
import app.orderak.seller.data.remote.PasskeyDto
import app.orderak.seller.data.remote.SupportMessageDto
import app.orderak.seller.data.remote.SupportTicketDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The account's pages, in Arabic: support, the ticket, announcements, deletion, devices, the assistant. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class AccountPagesContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int, vararg args: Any) = application.getString(id, *args)
    private fun has(text: String, substring: Boolean = false) =
        rule.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty()

    // ---- support ------------------------------------------------------------

    private val tickets = listOf(
        SupportTicketDto(id = 221, subject = "مشكلة في الدفع", status = "open", updated_at = "2026-10-26 10:00:00"),
        SupportTicketDto(id = 220, subject = "استفسار عن الخطة", status = "closed"),
    )

    @Test
    fun theTicketListShowsSubjectNumberAndAStatusChipAndOneBarOpensTheSheet() {
        var created: Pair<String, String>? = null
        rule.setContent {
            MaterialTheme {
                SupportContent(tickets, busy = false, error = null, onBack = {}, onRetry = {}, onTicket = {}, onCreate = { s, m -> created = s to m })
            }
        }
        assertTrue(has("مشكلة في الدفع"))
        assertTrue(has("#٢٢١", substring = true))
        rule.onAllNodesWithContentDescription(string(R.string.support_status_open)).assertCountEquals(1)
        rule.onAllNodesWithContentDescription(string(R.string.support_status_closed)).assertCountEquals(1)
        rule.onNodeWithText(string(R.string.support_new_ticket)).performClick()
        rule.waitForIdle()
        assertTrue(has(string(R.string.support_sheet_title)))
        rule.onNodeWithText(string(R.string.common_send)).assertIsNotEnabled()
        rule.onNodeWithText(string(R.string.support_subject), substring = true).performTextInput("سؤال")
        rule.onNodeWithText(string(R.string.support_message), substring = true).performTextInput("تفاصيل")
        rule.onNodeWithText(string(R.string.common_send)).performClick()
        rule.waitForIdle()
        assertEquals("سؤال" to "تفاصيل", created)
    }

    @Test
    fun noTicketsInvitesTheFirstOne() {
        rule.setContent {
            MaterialTheme {
                SupportContent(emptyList(), busy = false, error = null, onBack = {}, onRetry = {}, onTicket = {}, onCreate = { _, _ -> })
            }
        }
        rule.onAllNodesWithText(string(R.string.support_empty)).assertCountEquals(1)
    }

    // ---- the ticket -----------------------------------------------------------

    private fun ticketScreen(status: String, replyError: String? = null, sent: () -> Unit = {}) {
        rule.setContent {
            MaterialTheme {
                SupportTicketContent(
                    ticket = SupportTicketDto(id = 221, subject = "مشكلة في الدفع", status = status),
                    messages = listOf(
                        SupportMessageDto(1, "seller", "لم يصل الدفع"),
                        SupportMessageDto(2, "admin", "نراجع الأمر الآن"),
                    ),
                    busy = false, error = null, reply = "شكرًا", onReplyChange = {}, onBack = {}, onRetry = {},
                    onSend = sent, replyError = replyError,
                )
            }
        }
    }

    @Test
    fun theConversationIsBubblesAndAnOpenTicketHasAComposer() {
        var sent = 0
        ticketScreen("open", sent = { sent++ })
        assertTrue(has("لم يصل الدفع"))
        assertTrue(has("نراجع الأمر الآن"))
        rule.onNodeWithContentDescription(string(R.string.common_send)).performClick()
        assertEquals(1, sent)
    }

    @Test
    fun aClosedTicketReplacesTheComposerWithTheSentenceThatSaysSo() {
        ticketScreen("closed")
        assertTrue(has(string(R.string.support_closed_notice)))
        rule.onAllNodesWithContentDescription(string(R.string.common_send)).assertCountEquals(0)
    }

    @Test
    fun aRefusedReplyIsSaidAboveTheComposerAndTheTextStays() {
        ticketScreen("open", replyError = "network_unavailable")
        assertTrue(has(string(R.string.support_reply_failed)))
        assertTrue(has("شكرًا"))
    }

    // ---- announcements -----------------------------------------------------------

    private val news = listOf(
        AnnouncementDto(1, """{"ar":"صيانة مجدولة","en":"Maintenance"}""", """{"ar":"الخدمة ستعود خلال ساعة","en":"Back in an hour"}""", is_read = true),
        AnnouncementDto(2, """{"ar":"ميزة جديدة","en":"New"}""", """{"ar":"أضفنا التصنيفات","en":"Categories"}""", is_read = false),
    )

    @Test
    fun unreadAnnouncementsComeFirstAndOpeningOneMarksItRead() {
        val read = mutableListOf<Long>()
        rule.setContent {
            MaterialTheme { AnnouncementsContent(news, busy = false, error = null, onBack = {}, onRetry = {}, onRead = { read += it }) }
        }
        val unread = rule.onNodeWithText("ميزة جديدة").fetchSemanticsNode().positionInRoot.y
        val old = rule.onNodeWithText("صيانة مجدولة").fetchSemanticsNode().positionInRoot.y
        assertTrue("unread above read", unread < old)
        rule.onAllNodesWithContentDescription(string(R.string.announcement_new)).assertCountEquals(1)
        rule.onNodeWithText("ميزة جديدة").performClick()
        assertEquals(listOf(2L), read)
    }

    @Test
    fun noAnnouncementsSaysNothingIsNew() {
        rule.setContent {
            MaterialTheme { AnnouncementsContent(emptyList(), busy = false, error = null, onBack = {}, onRetry = {}, onRead = {}) }
        }
        rule.onAllNodesWithText(string(R.string.announcements_empty)).assertCountEquals(1)
    }

    // ---- deletion status --------------------------------------------------------------

    @Test
    fun aDeletionRequestIsAThreeStepTimelineWithItsDates() {
        rule.setContent {
            MaterialTheme {
                DeletionStatusContent(
                    request = DeletionRequestDto(id = "d1", status = "verified", requested_at = "2026-10-20 09:00:00", verified_at = "2026-10-21 09:00:00", deadline_at = "2026-11-20 09:00:00"),
                    loaded = true, busy = false, error = null, onBack = {}, onRetry = {},
                )
            }
        }
        for (id in listOf(R.string.deletion_step_submitted, R.string.deletion_step_verified, R.string.deletion_step_completes)) {
            assertTrue(string(id), has(string(id)))
        }
        assertTrue(has(string(R.string.deletion_kept_title)))
    }

    @Test
    fun noRequestSaysSoAndPointsToTheAccount() {
        rule.setContent {
            MaterialTheme { DeletionStatusContent(request = null, loaded = true, busy = false, error = null, onBack = {}, onRetry = {}) }
        }
        assertTrue(has(string(R.string.deletion_status_none)))
        assertTrue(has(string(R.string.deletion_none_pointer)))
    }

    @Test
    fun beforeTheAnswerArrivesItDoesNotClaimThereIsNoRequest() {
        rule.setContent {
            MaterialTheme { DeletionStatusContent(request = null, loaded = false, busy = false, error = null, onBack = {}, onRetry = {}) }
        }
        rule.onAllNodesWithText(string(R.string.deletion_status_none)).assertCountEquals(0)
    }

    // ---- devices --------------------------------------------------------------------------

    private val devices = listOf(
        DeviceDto(row_id = 0, device_label = "Pixel 8", platform = "android"),
        DeviceDto(row_id = 5, device_label = "Redmi Note 12", platform = "android"),
    )
    private val passkeys = listOf(PasskeyDto(id = "p1", label = "هاتفي", backed_up = true))

    @Test
    fun thisDeviceIsMarkedAndOthersCanBeSignedOutAfterAsking() {
        val revoked = mutableListOf<Long>()
        rule.setContent {
            MaterialTheme {
                DevicesContent(devices, passkeys, busy = false, error = null, canAddPasskey = true, onBack = {}, onRetry = {}, onReauthenticate = {}, onAddPasskey = {}, onRenamePasskey = { _, _ -> }, onDeletePasskey = {}, onRevokeDevice = { revoked += it })
            }
        }
        rule.onAllNodesWithContentDescription(string(R.string.device_primary)).assertCountEquals(1)
        rule.onNodeWithText(string(R.string.device_revoke)).performClick()
        rule.waitForIdle()
        assertEquals(0, revoked.size)
        assertTrue(has(string(R.string.device_revoke_confirm)))
        rule.onNodeWithTag("orderak.sheet.confirm").performClick()
        rule.waitForIdle()
        assertEquals(listOf(5L), revoked)
    }

    @Test
    fun aPasskeyHasAnOverflowToRenameOrRemoveAndRemovingAsksFirst() {
        val deleted = mutableListOf<String>()
        rule.setContent {
            MaterialTheme {
                DevicesContent(devices, passkeys, busy = false, error = null, canAddPasskey = true, onBack = {}, onRetry = {}, onReauthenticate = {}, onAddPasskey = {}, onRenamePasskey = { _, _ -> }, onDeletePasskey = { deleted += it }, onRevokeDevice = {})
            }
        }
        rule.onNodeWithContentDescription(string(R.string.categories_row_more, "هاتفي")).performClick()
        rule.waitForIdle()
        rule.onNodeWithText(string(R.string.passkey_revoke)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("orderak.sheet.confirm").performClick()
        rule.waitForIdle()
        assertEquals(listOf("p1"), deleted)
    }

    @Test
    fun creatingAPasskeyIsOfferedOnlyWhereTheyWork() {
        rule.setContent {
            MaterialTheme {
                DevicesContent(devices, passkeys, busy = false, error = null, canAddPasskey = false, onBack = {}, onRetry = {}, onReauthenticate = {}, onAddPasskey = {}, onRenamePasskey = { _, _ -> }, onDeletePasskey = {}, onRevokeDevice = {})
            }
        }
        rule.onAllNodesWithText(string(R.string.passkeys_add)).assertCountEquals(0)
    }

    // ---- the assistant ----------------------------------------------------------------------

    @Test
    fun theAssistantSaysAnswersCanBeWrongAndAnEmptyChatSaysWhatToAsk() {
        rule.setContent {
            MaterialTheme {
                AiAssistantContent(emptyList(), null, busy = false, error = null, input = "", onInputChange = {}, onBack = {}, onSend = {}, onRetry = {}, onReset = {})
            }
        }
        assertTrue(has(string(R.string.ai_disclosure)))
        assertTrue(has(string(R.string.ai_empty_hint)))
    }

    @Test
    fun startingOverAsksFirstInASheet() {
        var reset = 0
        rule.setContent {
            MaterialTheme {
                AiAssistantContent(listOf(true to "كم بعت اليوم؟", false to "٣ طلبات"), null, busy = false, error = null, input = "", onInputChange = {}, onBack = {}, onSend = {}, onRetry = {}, onReset = { reset++ })
            }
        }
        rule.onNodeWithContentDescription(string(R.string.ai_reset)).performClick()
        rule.waitForIdle()
        assertEquals(0, reset)
        assertTrue(has(string(R.string.ai_reset_body)))
        rule.onNodeWithTag("orderak.sheet.confirm").performClick()
        rule.waitForIdle()
        assertEquals(1, reset)
    }

    @Test
    fun whileAnAnswerIsBeingWrittenATypingBubbleStandsInTheConversation() {
        rule.setContent {
            MaterialTheme {
                AiAssistantContent(listOf(true to "كم بعت اليوم؟"), null, busy = true, error = null, input = "", onInputChange = {}, onBack = {}, onSend = {}, onRetry = {}, onReset = {})
            }
        }
        assertTrue(has("كم بعت اليوم؟"))
        assertTrue(has(string(R.string.ai_typing)))
    }
}
