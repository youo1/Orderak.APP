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
    version = 8,
    exportSchema = false,
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
     * The app is unpublished, so no database anywhere holds data worth keeping
     * and every install is a first install. There are no migrations for that
     * reason: schema 8 is simply the schema, not the end of a chain. Anything
     * older on a development handset is dropped and rebuilt on next launch.
     *
     * Without the fallback, an older database throws `IllegalStateException: A
     * migration from N to 8 was required but not found` the first time a DAO is
     * touched, which reads as a random crash rather than a stale schema.
     *
     * This has to be revisited at first release. From that point a missing
     * migration means real seller data destroyed on upgrade, so the fallback
     * comes out and migrations are written from whatever version shipped.
     */
    @Provides @Singleton
    fun database(@ApplicationContext context: Context): OrderakDatabase =
        Room.databaseBuilder(context, OrderakDatabase::class.java, "orderak.db")
            .fallbackToDestructiveMigration(dropAllTables = true)
            .build()

    @Provides fun productDao(db: OrderakDatabase) = db.productDao()
    @Provides fun categoryDao(db: OrderakDatabase) = db.categoryDao()
    @Provides fun orderDao(db: OrderakDatabase) = db.orderDao()
    @Provides fun customerDao(db: OrderakDatabase) = db.customerDao()
    @Provides fun paymentDao(db: OrderakDatabase) = db.paymentDao()
}
