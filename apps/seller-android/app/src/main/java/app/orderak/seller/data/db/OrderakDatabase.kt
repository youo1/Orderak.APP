package app.orderak.seller.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/** Room = single source of truth (Plan §3.4). Backend sync joins in the backend stage. */
@Database(
    entities = [
        ProductEntity::class, CategoryEntity::class, CustomerEntity::class,
        OrderEntity::class, OrderItemEntity::class, PaymentEntity::class,
    ],
    // v8: money columns carry minor units plus a currency (ADR-009).
    // v9: orders carry the idempotency key they are posted under, so a retry
    //     after a dropped response returns the order already written rather
    //     than creating a second one.
    // v10: customers are a row the seller edits, keyed by the normalised phone
    //     rather than the raw one, and carrying the fields the editor writes.
    version = 10,
    // Exported so the next schema change has something to write a migration
    // against, and so the migration can be tested rather than asserted.
    exportSchema = true,
)
abstract class OrderakDatabase : RoomDatabase() {
    abstract fun productDao(): ProductDao
    abstract fun categoryDao(): CategoryDao
    abstract fun orderDao(): OrderDao
    abstract fun customerDao(): CustomerDao
    abstract fun paymentDao(): PaymentDao
}

@Module
@InstallIn(SingletonComponent::class)
object DbModule {
    /**
     * Schema 10 is the release baseline, and the destructive fallback stops here.
     *
     * The blanket `fallbackToDestructiveMigration` this replaces was correct
     * while the app was unpublished: no database anywhere held anything worth
     * keeping, and a developer with a stale handset wanted it dropped rather
     * than a crash reading `IllegalStateException: A migration from N to 10 was
     * required but not found`.
     *
     * It stops being correct the moment a signed build reaches a real seller.
     * From then on the local database holds their catalogue, their customers and
     * - the part that is not recoverable by syncing - orders recorded offline
     * that have not reached the server yet. A blanket fallback would destroy all
     * of it on the next schema change, silently, as a routine app update.
     *
     * So the fallback is now scoped to versions 1 through 9: every schema that
     * only ever existed on a development machine. Version 10 onward requires a
     * real migration, and its absence is a loud failure rather than a data loss
     * nobody notices.
     *
     * Adding a schema change from here means: bump the version, write the
     * Migration, add it to `addMigrations`, and test it against the exported
     * schema JSON in `app/schemas`.
     */
    @Provides @Singleton
    fun database(@ApplicationContext context: Context): OrderakDatabase =
        Room.databaseBuilder(context, OrderakDatabase::class.java, "orderak.db")
            .fallbackToDestructiveMigrationFrom(
                dropAllTables = true,
                1, 2, 3, 4, 5, 6, 7, 8, 9,
            )
            .build()

    @Provides fun productDao(db: OrderakDatabase) = db.productDao()
    @Provides fun categoryDao(db: OrderakDatabase) = db.categoryDao()
    @Provides fun orderDao(db: OrderakDatabase) = db.orderDao()
    @Provides fun customerDao(db: OrderakDatabase) = db.customerDao()
    @Provides fun paymentDao(db: OrderakDatabase) = db.paymentDao()
}
