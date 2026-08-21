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
    private val MIGRATION_6_7 = object : Migration(6, 7) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE products ADD COLUMN syncedStockVersion INTEGER")
            db.execSQL("ALTER TABLE products ADD COLUMN stockDirty INTEGER NOT NULL DEFAULT 0")
        }
    }

    /**
     * ADR-009: `*Piasters` columns become `*Minor`, and the owning entities gain
     * a currency.
     *
     * WHY A TABLE REBUILD AND NOT `RENAME COLUMN`
     *   The server-side migration renames columns in place, because D1 runs a
     *   modern SQLite. This one cannot: `ALTER TABLE ... RENAME COLUMN` needs
     *   SQLite 3.25, which arrived on Android with API 30. `minSdk` here is 24 —
     *   set deliberately for "low-end EG devices coverage", which is the primary
     *   market. A rename would work on a developer's modern handset and crash on
     *   exactly the devices this app is built for.
     *
     *   Create-copy-drop-rename works on every version SQLite has shipped.
     *
     * `order_items` gains no currency column: a line item takes the currency of
     * the order above it, and a pair that can disagree is a pair that will.
     */
    private val MIGRATION_7_8 = object : Migration(7, 8) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL(
                """CREATE TABLE IF NOT EXISTS `products_new` (
                    `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                    `name` TEXT NOT NULL, `description` TEXT,
                    `priceMinor` INTEGER NOT NULL, `currency` TEXT NOT NULL DEFAULT 'EGP',
                    `stock` INTEGER NOT NULL, `discountType` TEXT, `discountValue` REAL,
                    `imagePath` TEXT, `imageUrl` TEXT, `available` INTEGER NOT NULL,
                    `productCode` TEXT, `remoteUuid` TEXT, `syncedStockVersion` INTEGER,
                    `stockDirty` INTEGER NOT NULL DEFAULT 0,
                    `categoryId` INTEGER, `categoryCode` TEXT, `createdAt` INTEGER NOT NULL)""",
            )
            db.execSQL(
                """INSERT INTO `products_new` (id,name,description,priceMinor,currency,stock,
                    discountType,discountValue,imagePath,imageUrl,available,productCode,
                    remoteUuid,syncedStockVersion,stockDirty,categoryId,categoryCode,createdAt)
                   SELECT id,name,description,pricePiasters,'EGP',stock,
                    discountType,discountValue,imagePath,imageUrl,available,productCode,
                    remoteUuid,syncedStockVersion,stockDirty,categoryId,categoryCode,createdAt
                   FROM `products`""",
            )
            db.execSQL("DROP TABLE `products`")
            db.execSQL("ALTER TABLE `products_new` RENAME TO `products`")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_products_createdAt` ON `products` (`createdAt`)")

            db.execSQL(
                """CREATE TABLE IF NOT EXISTS `orders_new` (
                    `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                    `remoteId` INTEGER, `buyerPhone` TEXT NOT NULL, `buyerName` TEXT,
                    `status` TEXT NOT NULL, `payMethod` TEXT NOT NULL,
                    `totalMinor` INTEGER NOT NULL, `currency` TEXT NOT NULL DEFAULT 'EGP',
                    `note` TEXT, `createdAt` INTEGER NOT NULL)""",
            )
            db.execSQL(
                """INSERT INTO `orders_new` (id,remoteId,buyerPhone,buyerName,status,payMethod,
                    totalMinor,currency,note,createdAt)
                   SELECT id,remoteId,buyerPhone,buyerName,status,payMethod,
                    totalPiasters,'EGP',note,createdAt FROM `orders`""",
            )
            db.execSQL("DROP TABLE `orders`")
            db.execSQL("ALTER TABLE `orders_new` RENAME TO `orders`")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_orders_status` ON `orders` (`status`)")

            db.execSQL(
                """CREATE TABLE IF NOT EXISTS `order_items_new` (
                    `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                    `orderId` INTEGER NOT NULL, `productId` INTEGER NOT NULL,
                    `productName` TEXT NOT NULL, `qty` INTEGER NOT NULL,
                    `priceMinor` INTEGER NOT NULL)""",
            )
            db.execSQL(
                """INSERT INTO `order_items_new` (id,orderId,productId,productName,qty,priceMinor)
                   SELECT id,orderId,productId,productName,qty,pricePiasters FROM `order_items`""",
            )
            db.execSQL("DROP TABLE `order_items`")
            db.execSQL("ALTER TABLE `order_items_new` RENAME TO `order_items`")
            db.execSQL("CREATE INDEX IF NOT EXISTS `index_order_items_orderId` ON `order_items` (`orderId`)")

            db.execSQL(
                """CREATE TABLE IF NOT EXISTS `payments_new` (
                    `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                    `orderId` INTEGER NOT NULL, `ref` TEXT NOT NULL,
                    `amountMinor` INTEGER NOT NULL, `currency` TEXT NOT NULL DEFAULT 'EGP',
                    `verified` INTEGER NOT NULL, `proofPath` TEXT,
                    `createdAt` INTEGER NOT NULL)""",
            )
            db.execSQL(
                """INSERT INTO `payments_new` (id,orderId,ref,amountMinor,currency,verified,proofPath,createdAt)
                   SELECT id,orderId,ref,amountPiasters,'EGP',verified,proofPath,createdAt FROM `payments`""",
            )
            db.execSQL("DROP TABLE `payments`")
            db.execSQL("ALTER TABLE `payments_new` RENAME TO `payments`")
            db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_payments_ref` ON `payments` (`ref`)")
        }
    }

    @Provides @Singleton
    fun database(@ApplicationContext context: Context): OrderakDatabase =
        Room.databaseBuilder(context, OrderakDatabase::class.java, "orderak.db")
            .addMigrations(MIGRATION_6_7, MIGRATION_7_8)
            .build()

    @Provides fun productDao(db: OrderakDatabase) = db.productDao()
    @Provides fun categoryDao(db: OrderakDatabase) = db.categoryDao()
    @Provides fun orderDao(db: OrderakDatabase) = db.orderDao()
    @Provides fun customerDao(db: OrderakDatabase) = db.customerDao()
    @Provides fun paymentDao(db: OrderakDatabase) = db.paymentDao()
}
