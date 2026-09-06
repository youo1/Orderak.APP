package app.orderak.seller.app.navigation

import kotlinx.serialization.Serializable

@Serializable data object SplashRoute
@Serializable data object AuthRoute
@Serializable data object ShopSetupRoute
@Serializable data object MainRoute
@Serializable data class ProductEditRoute(val id: Long = -1)
@Serializable data object NewOrderRoute
@Serializable data class OrderDetailsRoute(val id: Long)
/**
 * One customer, addressed by the key rather than the raw phone.
 *
 * The raw value is not an identity: two spellings of one number are one
 * customer and two strings, so navigating by it could open a row that does not
 * exist or the wrong one of a pair. See CustomerEntity.
 */
@Serializable data class CustomerRoute(val customerKey: String)
@Serializable data object StoreInfoRoute
@Serializable data object CategoriesRoute
@Serializable data object RestrictedAccountRoute
@Serializable data object SupportRoute
@Serializable data class SupportTicketRoute(val id: Long)
@Serializable data object AnnouncementsRoute
@Serializable data object CatalogLanguagesRoute
@Serializable data object DevicesRoute
@Serializable data object DeletionStatusRoute
@Serializable data object SubscriptionRoute
@Serializable data object AiAssistantRoute
@Serializable data object SellerProfileRoute
