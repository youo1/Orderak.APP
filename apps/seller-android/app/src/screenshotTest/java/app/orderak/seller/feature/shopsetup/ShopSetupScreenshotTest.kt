package app.orderak.seller.feature.shopsetup

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.phone.Country
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.remote.BusinessCategoryDto
import app.orderak.seller.data.remote.CityCatalogSuggestionDto
import com.android.tools.screenshot.PreviewTest

/**
 * The second screen a new seller ever sees, in both its steps and every state.
 *
 * It took a `ShopSetupViewModel` all the way down into both step composables,
 * so neither step could be drawn without a Hilt graph — which is why a screen
 * with a taxonomy call, a city search, a slug check, three loading states and
 * three error states had renders of none of them.
 *
 * `ShopSetupActions` is what replaced that: thirteen no-op-defaulted lambdas in
 * one value, so `ShopSetupActions()` renders either step.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

private val EGYPT = Country(iso = "EG", flag = "🇪🇬", dialCode = "20", name = "مصر")

private val CATEGORIES = listOf(
    BusinessCategoryDto(id = "c1", key = "fashion", name = "أزياء", version = 3),
    BusinessCategoryDto(id = "c2", key = "beauty", name = "تجميل", version = 3),
    BusinessCategoryDto(id = "c3", key = "food", name = "أكل", version = 3),
    BusinessCategoryDto(id = "c4", key = "home", name = "مستلزمات بيت", version = 3),
)

private val CITIES = listOf(
    CityCatalogSuggestionDto(
        city_id = 1,
        name = "القاهرة",
        canonical_name = "Cairo",
        native_name = "القاهرة",
        state_name = "القاهرة",
        country_iso = "EG",
    ),
    CityCatalogSuggestionDto(
        city_id = 2,
        name = "الجيزة",
        canonical_name = "Giza",
        native_name = "الجيزة",
        state_name = "الجيزة",
        country_iso = "EG",
    ),
)

/** Step 1 filled in far enough to continue. */
private val ACCOUNT = ShopSetupUiState(
    step = 1,
    fullName = "منى عبد الله",
    birthYear = 1994,
    email = "mona@example.com",
    country = EGYPT,
)

/** Step 2 with the taxonomy loaded and a city chosen. */
private val STORE = ShopSetupUiState(
    step = 2,
    fullName = "منى عبد الله",
    birthYear = 1994,
    name = "بوتيك منى",
    slug = "mona-boutique",
    slugAvailability = SlugAvailability.AVAILABLE,
    country = EGYPT,
    categories = CATEGORIES,
    categoryId = "c1",
    categoryKey = "fashion",
    categoryName = "أزياء",
    city = "القاهرة",
    cityCatalogId = 1,
)

@Composable
private fun setup(state: ShopSetupUiState, dark: Boolean = false) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            ShopSetupContent(state = state, actions = ShopSetupActions(), onExit = {})
        }
    }
}

// ================= step 1: the account =================

/** Empty, which is how a seller actually meets it. */
@PreviewTest
@Preview(name = "Setup account empty", locale = "ar")
@Composable
fun setupAccountEmpty() = setup(ShopSetupUiState(step = 1, country = EGYPT))

@PreviewTest
@Preview(name = "Setup account light", locale = "ar")
@Composable
fun setupAccountLight() = setup(ACCOUNT)

@PreviewTest
@Preview(name = "Setup account dark", locale = "ar")
@Composable
fun setupAccountDark() = setup(ACCOUNT, dark = true)

/**
 * An email that is not one.
 *
 * `emailValid` treats blank as valid — email is optional here — so this state
 * exists only once something has been typed, which is exactly the case a
 * render is the cheapest way to check.
 */
@PreviewTest
@Preview(name = "Setup account invalid email", locale = "ar")
@Composable
fun setupAccountInvalidEmail() = setup(ACCOUNT.copy(email = "mona@@example"))

@PreviewTest
@Preview(name = "Setup account saving", locale = "ar")
@Composable
fun setupAccountSaving() = setup(ACCOUNT.copy(saving = true))

// ================= step 2: the store =================

@PreviewTest
@Preview(name = "Setup store light", locale = "ar")
@Composable
fun setupStoreLight() = setup(STORE)

@PreviewTest
@Preview(name = "Setup store dark", locale = "ar")
@Composable
fun setupStoreDark() = setup(STORE, dark = true)

/** The taxonomy call is in flight, so no category can be chosen yet. */
@PreviewTest
@Preview(name = "Setup store taxonomy loading", locale = "ar")
@Composable
fun setupStoreTaxonomyLoading() = setup(
    STORE.copy(
        categories = emptyList(),
        categoryId = null,
        categoryName = null,
        taxonomyLoading = true,
    ),
)

/**
 * The taxonomy call failed.
 *
 * A seller cannot finish setup without a category, so this error has to carry a
 * retry — it is the one failure on this screen that blocks the whole flow.
 */
@PreviewTest
@Preview(name = "Setup store taxonomy error", locale = "ar")
@Composable
fun setupStoreTaxonomyError() = setup(
    STORE.copy(
        categories = emptyList(),
        categoryId = null,
        categoryName = null,
        taxonomyError = true,
    ),
)

/** City suggestions returned; picking one sets cityCatalogId and closes the list. */
@PreviewTest
@Preview(name = "Setup store city suggestions", locale = "ar")
@Composable
fun setupStoreCitySuggestions() = setup(
    STORE.copy(city = "الق", cityCatalogId = null, citySuggestions = CITIES),
)

@PreviewTest
@Preview(name = "Setup store city searching", locale = "ar")
@Composable
fun setupStoreCitySearching() = setup(
    STORE.copy(city = "الق", cityCatalogId = null, citySearching = true),
)

/**
 * The city search failed, and this one does NOT block the flow.
 *
 * `cityManualEntry` is the way through — a seller in a town the catalogue has
 * never heard of has to be able to type it, so the failure offers typing rather
 * than only retrying.
 */
@PreviewTest
@Preview(name = "Setup store city error", locale = "ar")
@Composable
fun setupStoreCityError() = setup(
    STORE.copy(city = "قرية صغيرة", cityCatalogId = null, cityError = true),
)

@PreviewTest
@Preview(name = "Setup store city manual", locale = "ar")
@Composable
fun setupStoreCityManual() = setup(
    STORE.copy(city = "قرية صغيرة", cityCatalogId = null, cityManualEntry = true),
)

/** The shop link a seller wants is already someone else's. */
@PreviewTest
@Preview(name = "Setup store slug taken", locale = "ar")
@Composable
fun setupStoreSlugTaken() = setup(STORE.copy(slugAvailability = SlugAvailability.TAKEN))

/**
 * The availability check could not run at all.
 *
 * Distinct from TAKEN: one says pick another name, the other says we do not
 * know yet. Showing the first when it is the second sends a seller off to
 * rename a shop that was never taken.
 */
@PreviewTest
@Preview(name = "Setup store slug offline", locale = "ar")
@Composable
fun setupStoreSlugOffline() = setup(STORE.copy(slugAvailability = SlugAvailability.OFFLINE))

@PreviewTest
@Preview(name = "Setup store slug checking", locale = "ar")
@Composable
fun setupStoreSlugChecking() = setup(STORE.copy(slugAvailability = SlugAvailability.CHECKING))

@PreviewTest
@Preview(name = "Setup store saving", locale = "ar")
@Composable
fun setupStoreSaving() = setup(STORE.copy(saving = true))

/** The finish call failed after everything was filled in correctly. */
@PreviewTest
@Preview(name = "Setup store error", locale = "ar")
@Composable
fun setupStoreError() = setup(STORE.copy(error = "network_unavailable"))

@PreviewTest
@Preview(name = "Setup store error dark", locale = "ar")
@Composable
fun setupStoreErrorDark() = setup(STORE.copy(error = "network_unavailable"), dark = true)

@PreviewTest
@Preview(name = "Setup store saving dark", locale = "ar")
@Composable
fun setupStoreSavingDark() = setup(STORE.copy(saving = true), dark = true)
