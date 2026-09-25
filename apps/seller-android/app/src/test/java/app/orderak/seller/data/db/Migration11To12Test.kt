package app.orderak.seller.data.db

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * DATA-004 / NET-3: `discountValue` becomes an integer (ADR-009), and
 * `products.productCode` / `categories.categoryCode` each get a defensive
 * unique index — not closing a live exploit (every write path already looks
 * up a row by its code before upserting), but turning a future write path
 * that skips that lookup into a loud failure instead of a silent duplicate.
 *
 * The `DELETE` this migration runs immediately before each index is the part
 * worth testing hardest: if a duplicate already exists on some device for any
 * reason this migration did not anticipate, the index creation itself must
 * not be what throws and bricks the app on open.
 */
class Migration11To12Test {

    private fun migrated() = RoomSchemaHarness.databaseAt(11).also {
        RoomSchemaHarness.migrate(it, OrderakMigrations.MIGRATION_11_12_SQL)
    }

    // ---- The schema itself ------------------------------------------------

    @Test
    fun `the migration produces exactly schema 12`() {
        assertEquals(emptyList<String>(), RoomSchemaHarness.schemaDifferences(migrated(), 12))
    }

    @Test
    fun `the products createdAt index survives the recreate`() {
        val indices = RoomSchemaHarness.column(
            migrated(),
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='products'",
        )
        assertTrue("index_products_createdAt must be rebuilt", indices.contains("index_products_createdAt"))
    }

    // ---- discountValue: REAL -> INTEGER ------------------------------------

    @Test
    fun `a whole-number discount survives as an integer`() {
        val db = RoomSchemaHarness.databaseAt(11)
        seedProduct(db, id = 1, code = "p-COLA1234", discountValue = 750.0)

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_11_12_SQL)

        assertEquals(listOf("750"), RoomSchemaHarness.column(db, "SELECT discountValue FROM products"))
    }

    @Test
    fun `a stray fractional discount is truncated rather than left as text SQLite would misread`() {
        // Should never occur in practice — the server has only ever sent whole
        // numbers here — but a migration touching live data has to say what it
        // does with a value it does not expect rather than leave the column
        // holding a REAL under an INTEGER-affinity type, which SQLite permits
        // silently and Room's Long-typed column would then fail to read.
        val db = RoomSchemaHarness.databaseAt(11)
        seedProduct(db, id = 1, code = "p-COLA1234", discountValue = 750.6)

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_11_12_SQL)

        assertEquals(listOf("750"), RoomSchemaHarness.column(db, "SELECT discountValue FROM products"))
    }

    @Test
    fun `no discount set stays null`() {
        val db = RoomSchemaHarness.databaseAt(11)
        seedProduct(db, id = 1, code = "p-COLA1234", discountValue = null)

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_11_12_SQL)

        assertEquals(listOf(null), RoomSchemaHarness.column(db, "SELECT discountValue FROM products"))
    }

    // ---- The defensive de-dup, and the index it protects -------------------

    @Test
    fun `a genuine duplicate product code is de-duplicated before the index would refuse it`() {
        val db = RoomSchemaHarness.databaseAt(11)
        seedProduct(db, id = 1, code = "p-DUP0001", name = "Cola (older row)")
        seedProduct(db, id = 2, code = "p-DUP0001", name = "Cola (newer row)")

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_11_12_SQL)

        // The lower id survives — same rule an order_items reference that
        // outlives its product already tolerates (see the 10->11 test on
        // that), and picking one deterministically is what makes this
        // migration idempotent if it were ever hand-run twice.
        assertEquals(listOf("1"), RoomSchemaHarness.column(db, "SELECT id FROM products WHERE productCode='p-DUP0001'"))
        assertEquals(1, RoomSchemaHarness.column(db, "SELECT id FROM products").size)
    }

    @Test
    fun `multiple unconverted legacy rows with no code are not treated as duplicates`() {
        // NULL productCode is what "not yet reconciled" means (see
        // LegacyCatalogueReconciler). SQLite does not treat two NULLs as
        // equal in a UNIQUE index, and this migration must not either.
        val db = RoomSchemaHarness.databaseAt(11)
        seedProduct(db, id = 1, code = null, name = "Legacy A")
        seedProduct(db, id = 2, code = null, name = "Legacy B")

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_11_12_SQL)

        assertEquals(2, RoomSchemaHarness.column(db, "SELECT id FROM products").size)
    }

    @Test
    fun `an order line naming the deleted half of a duplicate is tolerated, not fatal`() {
        val db = RoomSchemaHarness.databaseAt(11)
        seedProduct(db, id = 1, code = "p-DUP0001")
        seedProduct(db, id = 2, code = "p-DUP0001")
        RoomSchemaHarness.exec(
            db,
            "INSERT INTO order_items (orderId, productId, productName, qty, priceMinor) " +
                "VALUES (1, 2, 'Cola', 1, 1500)",
        )

        // Must not throw: there is no declared foreign key from order_items.
        // productId to products.id (see Entities.kt), so the dangling
        // reference this creates is the same, already-accepted "product
        // already gone" case the 10->11 migration test covers.
        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_11_12_SQL)

        assertEquals(listOf("2"), RoomSchemaHarness.column(db, "SELECT productId FROM order_items"))
    }

    @Test
    fun `a genuine duplicate category code is de-duplicated the same way`() {
        val db = RoomSchemaHarness.databaseAt(11)
        seedCategory(db, id = 1, code = "c-DUP0001", name = "Drinks (older row)")
        seedCategory(db, id = 2, code = "c-DUP0001", name = "Drinks (newer row)")

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_11_12_SQL)

        assertEquals(listOf("1"), RoomSchemaHarness.column(db, "SELECT id FROM categories WHERE categoryCode='c-DUP0001'"))
        assertEquals(1, RoomSchemaHarness.column(db, "SELECT id FROM categories").size)
    }

    @Test
    fun `distinct product and category codes are never touched by the de-dup`() {
        val db = RoomSchemaHarness.databaseAt(11)
        seedProduct(db, id = 1, code = "p-A1")
        seedProduct(db, id = 2, code = "p-A2")
        seedProduct(db, id = 3, code = "p-A3")
        seedCategory(db, id = 1, code = "c-A1")
        seedCategory(db, id = 2, code = "c-A2")

        RoomSchemaHarness.migrate(db, OrderakMigrations.MIGRATION_11_12_SQL)

        assertEquals(3, RoomSchemaHarness.column(db, "SELECT id FROM products").size)
        assertEquals(2, RoomSchemaHarness.column(db, "SELECT id FROM categories").size)
    }

    // ---- Fixtures ----------------------------------------------------------

    private fun seedProduct(
        db: java.sql.Connection,
        id: Long,
        code: String?,
        name: String = "Cola",
        discountValue: Double? = null,
    ) = RoomSchemaHarness.exec(
        db,
        "INSERT INTO products (id, name, priceMinor, currency, stock, available, productCode, " +
            "stockDirty, discountValue, createdAt) VALUES (" +
            "$id, '$name', 1500, 'EGP', 10, 1, ${code?.let { "'$it'" } ?: "NULL"}, " +
            "0, ${discountValue ?: "NULL"}, 0)",
    )

    private fun seedCategory(db: java.sql.Connection, id: Long, code: String?, name: String = "Drinks") =
        RoomSchemaHarness.exec(
            db,
            "INSERT INTO categories (id, name, categoryCode, sortOrder, createdAt) VALUES (" +
                "$id, '$name', ${code?.let { "'$it'" } ?: "NULL"}, 0, 0)",
        )
}
