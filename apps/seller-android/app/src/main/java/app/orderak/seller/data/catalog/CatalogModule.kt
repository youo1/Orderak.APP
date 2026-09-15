package app.orderak.seller.data.catalog

import app.orderak.seller.data.db.OrderakDatabase
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Ties the reconciliation's ports to the things that actually do the work.
 *
 * The bindings are one line each and the indirection buys exactly one thing:
 * the legacy reconciliation becomes a unit that can be driven without a device.
 * That matters more here than almost anywhere else in the app, because the
 * legacy path is the one nobody exercises by hand — a fresh install has no
 * legacy rows, so the only way to reach it on a device is to have been running
 * the app before the migration.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class CatalogModule {

    @Binds
    abstract fun bindLegacyReconcileRecords(impl: LegacyReconcileStore): LegacyReconcileRecords

    companion object {
        /**
         * Products, read through the repository rather than the DAO.
         *
         * Taking a `ProductDao` here would have been the shorter line and the
         * cache-write-boundary guard refused it — correctly. The list of files
         * permitted to hold a product DAO is short on purpose, and a Hilt module
         * is not a cache writer; letting it hold one to save an indirection is
         * exactly the erosion that list exists to stop.
         *
         * `CatalogRepository` already holds the DAO, already reads, and is
         * already on that list for reading. So the reconciliation now reaches
         * products through it, and `LegacyCatalogueReconciler` came off the
         * holder list entirely — one fewer file that can touch a DAO than before
         * this change.
         */
        @Provides
        @Singleton
        fun provideLegacyProductSource(catalog: CatalogRepository): LegacyProductSource =
            LegacyProductSource { catalog.productsOnce() }

        /**
         * Creating a product, which is all the reconciliation may do.
         *
         * Narrowed on purpose. [ProductWriteRepository] can also replace, delete
         * and adjust stock, and none of those is something a one-time migration
         * of rows the server has never seen should be able to reach.
         */
        @Provides
        @Singleton
        fun provideProductCreating(writes: ProductWriteRepository): ProductCreating =
            ProductCreating { draft, key -> writes.create(draft, key) }

        /**
         * Filling in a converted product's code on the orders that name it.
         *
         * Narrowed to the single DAO call, for the same reason the create above
         * is narrowed: a one-time migration of rows the server has never seen
         * should not be able to reach anything else on an order.
         */
        @Provides
        @Singleton
        fun provideOrderLineStamping(db: OrderakDatabase): OrderLineStamping =
            OrderLineStamping { localId, code -> db.orderDao().stampProductCode(localId, code) }
    }
}
