package app.orderak.seller.data.demo

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import app.orderak.seller.BuildConfig
import app.orderak.seller.data.billing.EntitlementRepository
import app.orderak.seller.data.db.OrderItemEntity
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.session.SessionStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

private val Context.demoStore by preferencesDataStore(name = "demo_data")

/**
 * Fills a local database so the app can be reviewed with a shop in it.
 *
 * Two properties make this safe to ship in a staging build, and both are
 * enforced rather than documented:
 *
 * 1. **It cannot run in production.** `BuildConfig.DEMO_SELLER_PHONE` is empty
 *    for the production flavour, and `verifyDemoDataContract` fails the build
 *    if that ever stops being true. [isDemoSeller] is the only entry point and
 *    it returns false on an empty constant, whatever phone is signed in.
 *
 * 2. **Nothing it writes reaches the backend.** `SyncRepository.doSync` pushes
 *    the product catalogue as a full mirror, so seeded products would otherwise
 *    be uploaded to the seller's real account and — worse — a mirror push from
 *    a demo device would *delete* the products that are genuinely there.
 *    [isDemoSeller] gates sync off entirely for this account.
 *
 * The seed runs once. A reviewer who wants it back can clear app data, which is
 * also the only way to get out of demo mode.
 */
@Singleton
class DemoDataSeeder @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val db: OrderakDatabase,
    private val sessionStore: SessionStore,
    private val entitlementRepository: EntitlementRepository,
) {

    /**
     * True when this build carries demo data and the signed-in seller is the
     * account it belongs to.
     *
     * Callers use this to decide whether to seed *and* whether to sync, so the
     * two answers cannot drift apart.
     */
    suspend fun isDemoSeller(): Boolean {
        if (BuildConfig.DEMO_SELLER_PHONE.isEmpty()) return false
        val phone = sessionStore.phone.first() ?: return false
        return normalize(phone) == normalize(BuildConfig.DEMO_SELLER_PHONE)
    }

    /** Egyptian numbers arrive as 010…, +2010… or 2010… depending on the path. */
    private fun normalize(phone: String): String =
        phone.filter(Char::isDigit).takeLast(10)

    suspend fun seedIfNeeded() {
        if (!isDemoSeller()) return
        if (context.demoStore.data.first()[SEEDED] == true) return

        withContext(Dispatchers.IO) {
            val now = System.currentTimeMillis()

            val categoryIds = DemoData.categories().map { db.categoryDao().upsert(it) }
            val productIds = DemoData.products(now, categoryIds)
                .associate { it.name to db.productDao().upsert(it) }

            DemoData.customers(now).forEach { db.customerDao().insertIgnore(it) }

            for (demo in DemoData.orders(now)) {
                val orderId = db.orderDao().insert(demo.order)
                db.orderDao().insertItems(
                    demo.items.mapNotNull { (name, qty) ->
                        val productId = productIds[name] ?: return@mapNotNull null
                        OrderItemEntity(
                            orderId = orderId,
                            productId = productId,
                            productName = name,
                            qty = qty,
                            priceMinor = unitPrice(name, now, categoryIds),
                        )
                    },
                )
                demo.payment?.let { db.paymentDao().insert(it.copy(orderId = orderId)) }
            }

            // Names the shop the catalogue belongs to. Onboarding is not
            // skipped — a reviewer should still see it — but whatever name it
            // left behind is replaced, so the top bar, the share sheet and the
            // catalogue link all describe the same shop.
            sessionStore.saveStoreInfo(shopName = DemoData.SHOP_NAME)
            sessionStore.saveSlug(DemoData.SHOP_SLUG)
            sessionStore.savePayout(DemoData.INSTAPAY_HANDLE, "")
            entitlementRepository.acceptConfig(DemoEntitlements.config())
        }

        context.demoStore.edit { it[SEEDED] = true }
    }

    /** Prices live with the products; look the row up rather than repeat it. */
    private fun unitPrice(name: String, now: Long, categoryIds: List<Long>): Long =
        DemoData.products(now, categoryIds).firstOrNull { it.name == name }?.priceMinor ?: 0L

    private companion object {
        val SEEDED = booleanPreferencesKey("demo_seeded_v1")
    }
}
