package app.orderak.seller.data.db

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The first real migration this app has ever performed, and the only step in the
 * catalogue migration with no rollback.
 *
 * Room cannot downgrade, and `fallbackToDestructiveMigrationOnDowngrade` is
 * deliberately not configured, so an older APK over a version 11 database throws
 * at open. Everything that can be checked has to be checked before it ships.
 *
 * WHAT THIS COVERS AND WHAT IT DOES NOT
 *   It runs the exact statements the app runs — `MIGRATION_10_11_SQL` is
 *   declared in main source and executed from there, so there is no second copy
 *   to drift — against a database built from Room's own exported schema 10, and
 *   compares the result to exported schema 11 the way Room does.
 *
 *   It cannot catch a missing `addMigrations` entry, a wrong
 *   `@Database(version = …)`, or a DAO that no longer matches its entity. Those
 *   are Room runtime concerns and need the instrumented test. This is the half
 *   that CI can run, and it is the half that has been missing.
 */
class Migration10To11Test {

    private fun migrated() = RoomSchemaHarness.databaseAt(10).also {
        RoomSchemaHarness.migrate(it, OrderakMigrations.MIGRATION_10_11_SQL)
    }

    // ---- The schema itself ----------------------------------------------

    @Test
    fun `the migration produces exactly schema 11`() {
        assertEquals(emptyList<String>(), RoomSchemaHarness.schemaDifferences(migrated(), 11))
    }

    @Test
    fun `the products index survives the recreate`() {
        // DROP TABLE takes its indices with it, and the products list and the
        // dashboard both sort on this one. Losing it costs no data and no
        // correctness — the app simply gets slower in a way nobody attributes to
        // a migration six months later.
        val db = migrated()
        val indices = RoomSchemaHarness.column(
            db,
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='products'",
        )
        assertTrue("index_products_createdAt must be rebuilt", indices.contains("index_products_createdAt"))
    }

    // ---- The reason this migration exists --------------------------------

    @Test
    fun `an unsent order keeps its product code through the migration`() {
        // The whole point. Posting an order used to resolve the product through
        // the cache; after this the line carries the code itself, so rebuilding
        // the cache cannot strand the command.
        val db = RoomSchemaHarness.databaseAt(10)
        seedProduct(db, id = 5, code = "p-COLA1234")
        seedUnsentOrder(db, id = 1, key = "order-key-1")
        seedItem(db, orderId = 1, productId = 5)

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_10_11_SQL)

        assertEquals(
            listOf("p-COLA1234"),
            RoomSchemaHarness.column(db, "SELECT productCode FROM order_items"),
        )
    }

    @Test
    fun `an unsent order survives with its key and its unacknowledged state`() {
        val db = RoomSchemaHarness.databaseAt(10)
        seedProduct(db, id = 5, code = "p-COLA1234")
        seedUnsentOrder(db, id = 1, key = "order-key-1")

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_10_11_SQL)

        assertEquals(listOf("order-key-1"), RoomSchemaHarness.column(db, "SELECT idempotencyKey FROM orders"))
        // remoteId still null is what "the server has not seen this" means. A
        // migration that filled it in would mark a sale as delivered.
        assertEquals(listOf(null), RoomSchemaHarness.column(db, "SELECT remoteId FROM orders"))
    }

    @Test
    fun `a product that never synced does not fail the migration`() {
        // The case the plan wanted to treat as fatal, and the reason it must not
        // be. The reconciliation that gives this product a code runs from the
        // app, AFTER Room has opened the database. A migration that refused to
        // run without a code would throw before the code that supplies one could
        // execute — on exactly the devices that still have products without one.
        // The app would not open at all.
        val db = RoomSchemaHarness.databaseAt(10)
        seedProduct(db, id = 7, code = null)
        seedUnsentOrder(db, id = 2, key = "order-key-2")
        seedItem(db, orderId = 2, productId = 7)

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_10_11_SQL)

        // The product is still here, still codeless, and reachable by the id its
        // order line names — which is what lets the reconciliation convert it and
        // stamp the code afterwards.
        assertEquals(listOf("7"), RoomSchemaHarness.column(db, "SELECT id FROM products"))
        assertEquals(listOf(null), RoomSchemaHarness.column(db, "SELECT productCode FROM order_items"))
        assertEquals(listOf("7"), RoomSchemaHarness.column(db, "SELECT productId FROM order_items"))
    }

    @Test
    fun `an order line whose product is already gone is tolerated`() {
        // History rather than a command. A product deleted before the migration
        // leaves its past orders naming an id that resolves to nothing; those
        // orders are already on the server and want no code. Failing here would
        // block a migration over a row nobody is waiting on.
        val db = RoomSchemaHarness.databaseAt(10)
        seedUnsentOrder(db, id = 3, key = null, remoteId = 42)
        seedItem(db, orderId = 3, productId = 999)

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_10_11_SQL)

        assertEquals(listOf(null), RoomSchemaHarness.column(db, "SELECT productCode FROM order_items"))
    }

    // ---- What must not be touched ----------------------------------------

    @Test
    fun `payments are carried across untouched`() {
        // `payments` has no server counterpart at all: it is local, unsynced, and
        // lost on reinstall. A migration is the one moment it could be lost
        // without a reinstall, so it is asserted rather than assumed.
        val db = RoomSchemaHarness.databaseAt(10)
        RoomSchemaHarness.exec(
            db,
            "INSERT INTO payments (id, orderId, ref, amountMinor, currency, verified, createdAt) " +
                "VALUES (1, 3, 'INSTAPAY-9', 1500, 'EGP', 1, 0)",
        )

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_10_11_SQL)

        assertEquals(listOf("INSTAPAY-9"), RoomSchemaHarness.column(db, "SELECT ref FROM payments"))
    }

    @Test
    fun `a pending stock edit is carried across rather than dropped`() {
        // `stockDirty` and `syncedStockVersion` stay in schema 11 deliberately.
        // The drain that empties them runs from the app, after this; dropping
        // them here would discard a pending stock edit on any device that
        // upgrades across both changes at once.
        val db = RoomSchemaHarness.databaseAt(10)
        seedProduct(db, id = 5, code = "p-COLA1234", stockDirty = 1, syncedStockVersion = 4)

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_10_11_SQL)

        assertEquals(listOf("1"), RoomSchemaHarness.column(db, "SELECT stockDirty FROM products"))
        assertEquals(listOf("4"), RoomSchemaHarness.column(db, "SELECT syncedStockVersion FROM products"))
    }

    @Test
    fun `a discount set on a product is carried across`() {
        // Adopted into the API in Phase 1, so these are cached server values now
        // rather than device-only ones. A recreate that dropped them would lose a
        // discount the seller had set and the storefront was showing.
        val db = RoomSchemaHarness.databaseAt(10)
        seedProduct(db, id = 5, code = "p-COLA1234", discountType = "PERCENTAGE", discountValue = 750.0)

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_10_11_SQL)

        assertEquals(listOf("PERCENTAGE"), RoomSchemaHarness.column(db, "SELECT discountType FROM products"))
        assertEquals(listOf("750.0"), RoomSchemaHarness.column(db, "SELECT discountValue FROM products"))
    }

    @Test
    fun `a customer edited before the migration keeps its values`() {
        val db = RoomSchemaHarness.databaseAt(10)
        RoomSchemaHarness.exec(
            db,
            "INSERT INTO customers (customerKey, phone, phoneStatus, name, note, createdAt, updatedAt, dirty) " +
                "VALUES ('+201000000000', '01000000000', 'valid', 'Mona', 'regular', 0, 0, 1)",
        )

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_10_11_SQL)

        assertEquals(listOf("Mona"), RoomSchemaHarness.column(db, "SELECT name FROM customers"))
        assertEquals(listOf("regular"), RoomSchemaHarness.column(db, "SELECT note FROM customers"))
        // The flag itself is gone; the row it was set on is not.
        assertNull(RoomSchemaHarness.actualTables(db)["customers"]?.let { if (it.contains("dirty")) "still there" else null })
    }

    // ---- Fixtures --------------------------------------------------------

    private fun seedProduct(
        db: java.sql.Connection,
        id: Long,
        code: String?,
        stockDirty: Int = 0,
        syncedStockVersion: Long? = null,
        discountType: String? = null,
        discountValue: Double? = null,
    ) = RoomSchemaHarness.exec(
        db,
        "INSERT INTO products (id, name, priceMinor, currency, stock, available, productCode, " +
            "syncedStockVersion, stockDirty, discountType, discountValue, createdAt) VALUES (" +
            "$id, 'Cola', 1500, 'EGP', 10, 1, ${code?.let { "'$it'" } ?: "NULL"}, " +
            "${syncedStockVersion ?: "NULL"}, $stockDirty, " +
            "${discountType?.let { "'$it'" } ?: "NULL"}, ${discountValue ?: "NULL"}, 0)",
    )

    private fun seedUnsentOrder(db: java.sql.Connection, id: Long, key: String?, remoteId: Long? = null) =
        RoomSchemaHarness.exec(
            db,
            "INSERT INTO orders (id, remoteId, buyerPhone, status, payMethod, totalMinor, currency, " +
                "idempotencyKey, createdAt) VALUES ($id, ${remoteId ?: "NULL"}, '+201000000000', 'NEW', " +
                "'COD', 1500, 'EGP', ${key?.let { "'$it'" } ?: "NULL"}, 0)",
        )

    private fun seedItem(db: java.sql.Connection, orderId: Long, productId: Long) = RoomSchemaHarness.exec(
        db,
        "INSERT INTO order_items (orderId, productId, productName, qty, priceMinor) " +
            "VALUES ($orderId, $productId, 'Cola', 1, 1500)",
    )
}
