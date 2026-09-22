package app.orderak.seller.feature.settings

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.remote.CategoryDto
import app.orderak.seller.data.remote.StoreDto
import com.android.tools.screenshot.PreviewTest

/**
 * The three pages reached from المتجر's settings, plus the seller's own profile.
 *
 * Two of them had a declared state that did not exist:
 *
 *   categories      declares an empty state and drew nothing for it — with the
 *                   list read and genuinely empty the LazyColumn rendered
 *                   nothing, leaving a seller looking at an add field over
 *                   blank space with no way to tell it apart from loading.
 *   seller-profile  declares a loading state and had none — every field seeds
 *                   "" and the session snapshot is read in a suspend call, so
 *                   the form drew with a blank phone number, the seller's own,
 *                   and filled it in a beat later.
 *
 * The other two were already honest and simply could not be drawn: `categories`
 * seeds `loading = true`, and `store-info` already waited on `store == null`
 * before composing its form.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

private val CATEGORIES = listOf(
    CategoryDto(category_code = "c-000001", name = "عبايات", product_count = 12),
    CategoryDto(category_code = "c-000002", name = "طرح", product_count = 4),
    CategoryDto(category_code = "c-000003", name = "فساتين سواريه", product_count = 0),
)

// ================= categories =================

@Composable
private fun categories(
    categories: List<CategoryDto>?,
    loading: Boolean = false,
    error: String? = null,
    purchaseOpen: Boolean = false,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            CategoriesContent(
                categories = categories,
                loading = loading,
                error = error,
                busy = false,
                storeUrl = "https://orderak.app/EG-mona-boutique",
                purchaseOpen = purchaseOpen,
                newName = "",
                onNewName = {},
                onCreate = {},
                onRename = { _, _ -> },
                onDelete = {},
                onLimitReached = {},
                onCopyLink = {},
                onShareLink = {},
                onBack = {},
            )
        }
    }
}

@PreviewTest
@Preview(name = "Categories loading light", locale = "ar")
@Composable
fun categoriesLoadingLight() = categories(categories = null, loading = true)

@PreviewTest
@Preview(name = "Categories loading dark", locale = "ar")
@Composable
fun categoriesLoadingDark() = categories(categories = null, loading = true, dark = true)

/** One category with no products in it, so the plural row has something to vary against. */
@PreviewTest
@Preview(name = "Categories content light", locale = "ar")
@Composable
fun categoriesContentLight() = categories(categories = CATEGORIES)

@PreviewTest
@Preview(name = "Categories content dark", locale = "ar")
@Composable
fun categoriesContentDark() = categories(categories = CATEGORIES, dark = true)

/** The state this screen declared and drew nothing for. */
@PreviewTest
@Preview(name = "Categories empty light", locale = "ar")
@Composable
fun categoriesEmptyLight() = categories(categories = emptyList())

@PreviewTest
@Preview(name = "Categories empty dark", locale = "ar")
@Composable
fun categoriesEmptyDark() = categories(categories = emptyList(), dark = true)

@PreviewTest
@Preview(name = "Categories error light", locale = "ar")
@Composable
fun categoriesErrorLight() = categories(categories = CATEGORIES, error = "network_unavailable")

@PreviewTest
@Preview(name = "Categories error dark", locale = "ar")
@Composable
fun categoriesErrorDark() =
    categories(categories = CATEGORIES, error = "network_unavailable", dark = true)

/**
 * A plan boundary, which is not a fault.
 *
 * It reads as a notice, keeps the existing categories on screen, and offers the
 * paywall in both purchase states — what the limit is and what the next plan
 * gives are worth reading whether or not anything is for sale.
 */
@PreviewTest
@Preview(name = "Categories limit reached", locale = "ar")
@Composable
fun categoriesLimitReached() =
    categories(categories = CATEGORIES, error = "plan_limit_reached")

@PreviewTest
@Preview(name = "Categories limit purchase open", locale = "ar")
@Composable
fun categoriesLimitPurchaseOpen() =
    categories(categories = CATEGORIES, error = "plan_limit_reached", purchaseOpen = true)

// ================= store info =================

private val STORE = StoreDto(
    store_name = "بوتيك منى",
    slug = "mona-boutique",
    country_code = "EG",
    store_code = "EG-A1B2C3",
    store_url = "https://orderak.app/EG-mona-boutique",
    description = "عبايات وفساتين سواريه",
    phone = "01000000001",
    whatsapp = "01000000001",
    email = "mona@example.com",
    website = "https://mona.example",
    address = "شارع الجمهورية، القاهرة",
    business_category_id = "bc-1",
)

@Composable
private fun storeInfo(
    store: StoreDto?,
    slugState: String? = "available",
    busy: Boolean = false,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            StoreInfoContent(
                store = store,
                draft = StoreInfoDraft(
                    name = store?.store_name.orEmpty(),
                    slug = store?.slug.orEmpty(),
                    description = store?.description.orEmpty(),
                    whatsapp = store?.whatsapp.orEmpty(),
                    email = store?.email.orEmpty(),
                    website = store?.website.orEmpty(),
                    address = store?.address.orEmpty(),
                ),
                onDraft = {},
                phone = store?.phone.orEmpty(),
                busy = busy,
                slugState = slugState,
                storeUrl = store?.store_url,
                storeCode = store?.store_code,
                country = store?.country_code,
                businessSubcategories = emptyList(),
                businessSubcategoryExpanded = false,
                onSubcategoryExpanded = {},
                onSave = { _, _ -> },
                onPickLogo = {},
                onPickCover = {},
                onCopyLink = {},
                onShareLink = {},
                onBack = {},
            )
        }
    }
}

/**
 * The store has not arrived.
 *
 * Load-bearing rather than cosmetic: the ten draft fields are keyed on the
 * loaded store, so drawing the form early let a seller start typing their shop
 * name and have the whole form reset under them when the network answered.
 */
@PreviewTest
@Preview(name = "Store info loading light", locale = "ar")
@Composable
fun storeInfoLoadingLight() = storeInfo(store = null)

@PreviewTest
@Preview(name = "Store info loading dark", locale = "ar")
@Composable
fun storeInfoLoadingDark() = storeInfo(store = null, dark = true)

@PreviewTest
@Preview(name = "Store info content light", locale = "ar")
@Composable
fun storeInfoContentLight() = storeInfo(store = STORE)

@PreviewTest
@Preview(name = "Store info content dark", locale = "ar")
@Composable
fun storeInfoContentDark() = storeInfo(store = STORE, dark = true)

/**
 * The shop link a seller wants is taken.
 *
 * Save is disabled unless the slug is available OR unchanged — so an untouched
 * form is never blocked by a check it did not trigger.
 */
@PreviewTest
@Preview(name = "Store info slug taken", locale = "ar")
@Composable
fun storeInfoSlugTaken() = storeInfo(store = STORE.copy(slug = "taken-name"), slugState = "taken")

@PreviewTest
@Preview(name = "Store info saving", locale = "ar")
@Composable
fun storeInfoSaving() = storeInfo(store = STORE, busy = true)

// ================= seller profile =================

@Composable
private fun sellerProfile(
    loaded: Boolean,
    verification: String? = null,
    busy: Boolean = false,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            SellerProfileContent(
                phone = if (loaded) "01000000001" else "",
                loaded = loaded,
                busy = busy,
                savedEmail = if (loaded) "mona@example.com" else "",
                emailVerificationStatus = verification,
                fullName = if (loaded) "منى عبد الله" else "",
                email = if (loaded) "mona@example.com" else "",
                birthYear = if (loaded) "1994" else "",
                profilePhotoUri = "",
                onFullName = {},
                onEmail = {},
                onBirthYear = {},
                onProfilePhotoUri = {},
                onPickPhoto = {},
                onResendVerification = {},
                onSave = { _, _, _, _, _ -> },
                onBack = {},
                onReauthenticate = {},
            )
        }
    }
}

/** The state this screen declared and had none of. */
@PreviewTest
@Preview(name = "Seller profile loading light", locale = "ar")
@Composable
fun sellerProfileLoadingLight() = sellerProfile(loaded = false)

@PreviewTest
@Preview(name = "Seller profile loading dark", locale = "ar")
@Composable
fun sellerProfileLoadingDark() = sellerProfile(loaded = false, dark = true)

@PreviewTest
@Preview(name = "Seller profile content light", locale = "ar")
@Composable
fun sellerProfileContentLight() = sellerProfile(loaded = true)

@PreviewTest
@Preview(name = "Seller profile content dark", locale = "ar")
@Composable
fun sellerProfileContentDark() = sellerProfile(loaded = true, dark = true)

/** The verification mail could not be sent — the one error this page reports. */
@PreviewTest
@Preview(name = "Seller profile verification error", locale = "ar")
@Composable
fun sellerProfileVerificationError() = sellerProfile(loaded = true, verification = "error")

@PreviewTest
@Preview(name = "Seller profile saving", locale = "ar")
@Composable
fun sellerProfileSaving() = sellerProfile(loaded = true, busy = true)
