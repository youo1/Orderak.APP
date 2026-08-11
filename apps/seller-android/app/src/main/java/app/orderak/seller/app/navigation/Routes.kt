package app.orderak.seller.app.navigation

import kotlinx.serialization.Serializable

@Serializable data object SplashRoute
@Serializable data object AuthRoute
@Serializable data object ShopSetupRoute
@Serializable data object MainRoute
@Serializable data class ProductEditRoute(val id: Long = -1)
@Serializable data object NewOrderRoute
@Serializable data class OrderDetailsRoute(val id: Long)
@Serializable data class CustomerRoute(val phone: String)
@Serializable data object SettingsRoute
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
