package app.orderak.seller.feature.operations

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.remote.AnnouncementDto
import app.orderak.seller.data.remote.ProductTranslationDto
import app.orderak.seller.data.remote.SupportTicketDto
import com.android.tools.screenshot.PreviewTest

/**
 * Three of the account surface's pages, in every state their contracts declare.
 *
 * WHAT THE NULLABLE LISTS ARE FOR
 *   All three computed `isEmpty = !busy && items.isEmpty()`, and both halves
 *   were true before anything started loading: `_busy` seeds false and the lists
 *   seeded `emptyList()`. So "nothing here yet" rendered at a seller who had
 *   tickets, announcements or translations, every time they opened the page,
 *   for as long as the request took.
 *
 *   `_busy` could not simply seed true instead — six screens share it and
 *   AiAssistantScreen never loads on entry, so it would spin there forever. The
 *   list knowing whether it has been read is the fix that works for all of them.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

private val TICKETS = listOf(
    SupportTicketDto(
        id = 1,
        subject = "الأوردر مش ظاهر في الكتالوج",
        status = "open",
        priority = "high",
        last_message = "شكراً للتواصل، بنراجع الموضوع دلوقتي.",
    ),
    SupportTicketDto(
        id = 2,
        subject = "تغيير رقم الموبايل",
        status = "closed",
        priority = "normal",
        last_message = "تم التغيير بنجاح.",
    ),
)

private val ANNOUNCEMENTS = listOf(
    AnnouncementDto(
        id = 1,
        title_i18n = """{"ar":"تحديث جديد","en":"New update"}""",
        body_i18n = """{"ar":"بقى تقدر تشارك الكتالوج بلينك واحد.","en":"You can now share your catalogue with one link."}""",
        is_read = false,
    ),
    AnnouncementDto(
        id = 2,
        title_i18n = """{"ar":"صيانة مجدولة","en":"Scheduled maintenance"}""",
        body_i18n = """{"ar":"الخدمة هترجع خلال ساعة.","en":"Service returns within an hour."}""",
        is_read = true,
    ),
)

private val TRANSLATIONS = listOf(
    ProductTranslationDto(
        product_code = "AB-01",
        source_name = "عباية كلوش أسود",
        lang = "en",
        name = "Black flared abaya",
        translation_status = "reviewed",
    ),
    ProductTranslationDto(
        product_code = "TR-04",
        source_name = "طرحة شيفون",
        lang = "en",
        name = null,
        translation_status = "missing",
    ),
)

// ================= support =================

@Composable
private fun support(
    tickets: List<SupportTicketDto>?,
    busy: Boolean = false,
    error: String? = null,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            SupportContent(
                tickets = tickets,
                busy = busy,
                error = error,
                onBack = {},
                onRetry = {},
                onTicket = {},
                onNew = {},
            )
        }
    }
}

/** null, not emptyList() — this is the render the whole change exists for. */
@PreviewTest
@Preview(name = "Support loading light", locale = "ar")
@Composable
fun supportLoadingLight() = support(tickets = null)

@PreviewTest
@Preview(name = "Support loading dark", locale = "ar")
@Composable
fun supportLoadingDark() = support(tickets = null, dark = true)

@PreviewTest
@Preview(name = "Support content light", locale = "ar")
@Composable
fun supportContentLight() = support(tickets = TICKETS)

@PreviewTest
@Preview(name = "Support content dark", locale = "ar")
@Composable
fun supportContentDark() = support(tickets = TICKETS, dark = true)

/** Read, and genuinely empty. It carries the action, because opening a ticket is the point. */
@PreviewTest
@Preview(name = "Support empty light", locale = "ar")
@Composable
fun supportEmptyLight() = support(tickets = emptyList())

@PreviewTest
@Preview(name = "Support empty dark", locale = "ar")
@Composable
fun supportEmptyDark() = support(tickets = emptyList(), dark = true)

@PreviewTest
@Preview(name = "Support error light", locale = "ar")
@Composable
fun supportErrorLight() = support(tickets = emptyList(), error = "network_unavailable")

@PreviewTest
@Preview(name = "Support error dark", locale = "ar")
@Composable
fun supportErrorDark() = support(tickets = emptyList(), error = "network_unavailable", dark = true)

// ================= announcements =================

@Composable
private fun announcements(
    items: List<AnnouncementDto>?,
    busy: Boolean = false,
    error: String? = null,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            AnnouncementsContent(
                items = items,
                busy = busy,
                error = error,
                onBack = {},
                onRetry = {},
                onRead = {},
            )
        }
    }
}

@PreviewTest
@Preview(name = "Announcements loading light", locale = "ar")
@Composable
fun announcementsLoadingLight() = announcements(items = null)

@PreviewTest
@Preview(name = "Announcements loading dark", locale = "ar")
@Composable
fun announcementsLoadingDark() = announcements(items = null, dark = true)

/** One unread and one read, so the marker has something to be distinct from. */
@PreviewTest
@Preview(name = "Announcements content light", locale = "ar")
@Composable
fun announcementsContentLight() = announcements(items = ANNOUNCEMENTS)

@PreviewTest
@Preview(name = "Announcements content dark", locale = "ar")
@Composable
fun announcementsContentDark() = announcements(items = ANNOUNCEMENTS, dark = true)

/**
 * Deliberately actionless.
 *
 * A seller cannot make an announcement happen, so there is nothing to offer —
 * the same rule as the customers surface, and the opposite of support above.
 */
@PreviewTest
@Preview(name = "Announcements empty light", locale = "ar")
@Composable
fun announcementsEmptyLight() = announcements(items = emptyList())

@PreviewTest
@Preview(name = "Announcements empty dark", locale = "ar")
@Composable
fun announcementsEmptyDark() = announcements(items = emptyList(), dark = true)

@PreviewTest
@Preview(name = "Announcements error light", locale = "ar")
@Composable
fun announcementsErrorLight() = announcements(items = emptyList(), error = "network_unavailable")

@PreviewTest
@Preview(name = "Announcements error dark", locale = "ar")
@Composable
fun announcementsErrorDark() =
    announcements(items = emptyList(), error = "network_unavailable", dark = true)

// ================= catalog languages =================

@Composable
private fun catalogLanguages(
    items: List<ProductTranslationDto>?,
    busy: Boolean = false,
    error: String? = null,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            CatalogLanguagesContent(
                items = items,
                lang = "en",
                busy = busy,
                error = error,
                onBack = {},
                onRetry = {},
                onLang = {},
                onEdit = {},
            )
        }
    }
}

@PreviewTest
@Preview(name = "Catalog languages loading light", locale = "ar")
@Composable
fun catalogLanguagesLoadingLight() = catalogLanguages(items = null)

@PreviewTest
@Preview(name = "Catalog languages loading dark", locale = "ar")
@Composable
fun catalogLanguagesLoadingDark() = catalogLanguages(items = null, dark = true)

/** One translated, one missing — the status is the reason to open the row. */
@PreviewTest
@Preview(name = "Catalog languages content light", locale = "ar")
@Composable
fun catalogLanguagesContentLight() = catalogLanguages(items = TRANSLATIONS)

@PreviewTest
@Preview(name = "Catalog languages content dark", locale = "ar")
@Composable
fun catalogLanguagesContentDark() = catalogLanguages(items = TRANSLATIONS, dark = true)

/**
 * The state this screen declared and did not have.
 *
 * With no products to translate it fell through to content and drew two language
 * buttons over blank space. The switcher stays visible here on purpose: nothing
 * in one language is a reason to try the other, not a dead end.
 */
@PreviewTest
@Preview(name = "Catalog languages empty light", locale = "ar")
@Composable
fun catalogLanguagesEmptyLight() = catalogLanguages(items = emptyList())

@PreviewTest
@Preview(name = "Catalog languages empty dark", locale = "ar")
@Composable
fun catalogLanguagesEmptyDark() = catalogLanguages(items = emptyList(), dark = true)

@PreviewTest
@Preview(name = "Catalog languages error light", locale = "ar")
@Composable
fun catalogLanguagesErrorLight() =
    catalogLanguages(items = emptyList(), error = "network_unavailable")

@PreviewTest
@Preview(name = "Catalog languages error dark", locale = "ar")
@Composable
fun catalogLanguagesErrorDark() =
    catalogLanguages(items = emptyList(), error = "network_unavailable", dark = true)
