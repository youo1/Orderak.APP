package app.orderak.seller.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
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
    // v7: optimistic stock revision + explicit local stock-dirty marker.
    version = 7,
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
    private val MIGRATION_6_7 = object : Migration(6, 7) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE products ADD COLUMN syncedStockVersion INTEGER")
            db.execSQL("ALTER TABLE products ADD COLUMN stockDirty INTEGER NOT NULL DEFAULT 0")
        }
    }

    @Provides @Singleton
    fun database(@ApplicationContext context: Context): OrderakDatabase =
        Room.databaseBuilder(context, OrderakDatabase::class.java, "orderak.db")
            .addMigrations(MIGRATION_6_7)
            .build()

    @Provides fun productDao(db: OrderakDatabase) = db.productDao()
    @Provides fun categoryDao(db: OrderakDatabase) = db.categoryDao()
    @Provides fun orderDao(db: OrderakDatabase) = db.orderDao()
    @Provides fun customerDao(db: OrderakDatabase) = db.customerDao()
    @Provides fun paymentDao(db: OrderakDatabase) = db.paymentDao()
}
