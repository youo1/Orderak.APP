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

/** The four-plan comparison. Read-only while purchase is closed. */
@Serializable data object PlansRoute

/**
 * The moment a seller hits a plan limit.
 *
 * Carries the entitlement key the server refused on, not the numbers. The
 * snapshot the app already holds has the limit, the usage and what remains for
 * that key; passing them through navigation would mean two sources for one fact
 * and a back-stack entry that goes stale the moment a sync lands.
 */
@Serializable data class PaywallRoute(val limitKey: String)
@Serializable data object AiAssistantRoute
@Serializable data object SellerProfileRoute
