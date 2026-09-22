package app.orderak.seller.feature.settings

import app.orderak.seller.data.session.LocalSessionSnapshot

/**
 * What a profile save writes: the four edited fields, over the shop the seller
 * already has.
 *
 * WHY THIS IS A VALUE AND NOT A METHOD BODY
 *   `SellerProfileViewModel.save` calls `sessionStore.saveShop`, which takes the
 *   SHOP's name, category, city, country and logo alongside the seller's own
 *   details. Those five are not on this screen and are re-supplied from the
 *   session snapshot — so the whole correctness of this save is that it carries
 *   them through unchanged. Get one wrong and editing a birth year erases a shop
 *   name.
 *
 *   That decision was inline in a `viewModelScope.launch`, so nothing could
 *   check it. It is a pure function of the snapshot and four strings now, which
 *   is the shape this codebase already uses for decisions worth pinning
 *   (`ProductWriteDecision`, `CatalogueAndOrderSteps`).
 */
data class ProfileSave(
    val name: String,
    val category: String,
    val city: String,
    val countryIso: String,
    val logoUri: String?,
    val fullName: String,
    val email: String?,
    val birthYear: String?,
    val profilePhotoUri: String?,
)

/**
 * @param snapshot what the session already holds — the shop half is carried
 *   through untouched, because this screen does not edit it.
 */
fun profileSave(
    snapshot: LocalSessionSnapshot,
    fullName: String,
    email: String?,
    birthYear: String?,
    profilePhotoUri: String?,
): ProfileSave = ProfileSave(
    // The shop, carried through. `orEmpty()` rather than a placeholder: an empty
    // string is what the store had, and inventing one here would write a shop
    // name nobody chose.
    name = snapshot.shopName.orEmpty(),
    category = snapshot.category.orEmpty(),
    city = snapshot.city.orEmpty(),
    // The one default, and it is a real one: the app ships to Egypt and a store
    // with no country cannot be addressed at all.
    countryIso = snapshot.countryIso ?: "EG",
    logoUri = snapshot.logoUri,
    // The seller's own, as edited. Blank becomes null for the three optional
    // fields, so clearing one clears it rather than storing "".
    fullName = fullName.trim(),
    email = email?.trim()?.ifBlank { null },
    birthYear = birthYear?.trim()?.ifBlank { null },
    profilePhotoUri = profilePhotoUri?.trim()?.ifBlank { null },
)
