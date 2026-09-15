package app.orderak.seller.data.db

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The harness, tested before anything is trusted to it.
 *
 * WHY THIS COMES FIRST
 *   Room 10 is where `fallbackToDestructiveMigrationFrom(1..9)` stops, so the
 *   next schema change is this app's first real migration — and it is the one
 *   step in the whole catalogue migration with no rollback. Room cannot
 *   downgrade and `fallbackToDestructiveMigrationOnDowngrade` is deliberately
 *   unset, so an older APK over a newer database throws at open.
 *
 *   A harness written in the same change as the migration it verifies proves
 *   nothing: both are new, and a harness that silently passes everything looks
 *   exactly like a migration that is correct. So the harness lands on its own,
 *   and these tests are the evidence that it can fail.
 *
 * WHY THERE IS NO `Migration(10, 11)` IN THIS CHANGE
 *   The plan called for landing this against a no-op `Migration(10, 11)` and
 *   reverting it afterwards. That is a device-corrupting move and it is not done
 *   here.
 *
 *   Room records the version it reached in the database. A device that ran a
 *   no-op 10 → 11 sits at version 11 holding version 10's tables, and it will
 *   never run 10 → 11 again — so when the real migration ships under that same
 *   number, that device never receives it. Room then finds an identity hash it
 *   does not recognise and refuses to open the database at all. Shipping a
 *   version bump and later changing what that version means is how a working
 *   install stops working.
 *
 *   The fixtures below are declared in test source instead. They exercise every
 *   path the harness has without any of them ever reaching a build.
 */
class RoomSchemaHarnessTest {

    @Test
    fun `the exported schema is readable and describes the tables the app has`() {
        val tables = RoomSchemaHarness.exportedTables(10)
        assertEquals(
            setOf("products", "categories", "customers", "orders", "order_items", "payments"),
            tables.keys,
        )
        // The placeholder Room writes must be gone, or nothing here is executable.
        assertTrue(tables.values.none { it.contains("\${TABLE_NAME}") })
    }

    @Test
    fun `a database built at version 10 matches version 10`() {
        // The control. If this ever fails, every other result in this file is
        // meaningless, because the comparison itself is broken.
        val db = RoomSchemaHarness.databaseAt(10)
        assertEquals(emptyList<String>(), RoomSchemaHarness.schemaDifferences(db, 10))
    }

    @Test
    fun `a migration that changes nothing leaves the schema at version 10`() {
        val db = RoomSchemaHarness.databaseAt(10)
        RoomSchemaHarness.migrate(db, emptyList())
        assertEquals(emptyList<String>(), RoomSchemaHarness.schemaDifferences(db, 10))
    }

    @Test
    fun `a migration that adds a column is caught`() {
        // The shape of the real one. A column the exported schema does not
        // declare must be reported, or a migration could add anything it liked
        // and the comparison would shrug.
        val db = RoomSchemaHarness.databaseAt(10)
        RoomSchemaHarness.migrate(db, listOf("ALTER TABLE order_items ADD COLUMN productCode TEXT"))

        val problems = RoomSchemaHarness.schemaDifferences(db, 10)
        assertEquals(1, problems.size)
        assertTrue(problems.single().startsWith("order_items: structure differs"))
    }

    @Test
    fun `a migration that drops a table is caught`() {
        val db = RoomSchemaHarness.databaseAt(10)
        RoomSchemaHarness.migrate(db, listOf("DROP TABLE payments"))

        val problems = RoomSchemaHarness.schemaDifferences(db, 10)
        assertEquals(listOf("payments: missing after the migration"), problems)
    }

    @Test
    fun `a migration that leaves an extra table behind is caught`() {
        // The twelve-step recreate is `CREATE products_new`, copy, `DROP
        // products`, rename. Forgetting the rename leaves both, and the database
        // still opens and still answers queries — from the wrong table.
        val db = RoomSchemaHarness.databaseAt(10)
        RoomSchemaHarness.migrate(db, listOf("CREATE TABLE products_new (`id` INTEGER PRIMARY KEY)"))

        val problems = RoomSchemaHarness.schemaDifferences(db, 10)
        assertEquals(listOf("products_new: present but not in schema 10"), problems)
    }

    @Test
    fun `data written before a migration can be read after it`() {
        // What the migration tests will actually assert. An unsent order is a
        // command the server has not acknowledged; if a recreate loses it, the
        // seller loses a sale and nothing says so.
        val db = RoomSchemaHarness.databaseAt(10)
        RoomSchemaHarness.exec(
            db,
            "INSERT INTO orders (id, buyerPhone, status, payMethod, totalMinor, currency, " +
                "createdAt, idempotencyKey) VALUES (1, '+201000000000', 'NEW', 'COD', 1500, 'EGP', 0, 'key-1')",
        )

        RoomSchemaHarness.migrate(db, listOf("ALTER TABLE order_items ADD COLUMN productCode TEXT"))

        assertEquals(
            listOf("key-1"),
            RoomSchemaHarness.column(db, "SELECT idempotencyKey FROM orders"),
        )
    }

    @Test
    fun `whitespace alone is not reported as a schema difference`() {
        // Room writes its statements one way and SQLite echoes them back
        // another. If that counted as a difference, every migration would fail
        // and the harness would be useless — and the first person to hit it
        // would reasonably relax the comparison rather than the formatting.
        //
        // This is the twelve-step recreate in miniature, including the step most
        // easily forgotten: DROP TABLE takes the table's indices with it, so a
        // recreate that rebuilds only the table leaves the database an index
        // short. The first version of this test did exactly that, and the
        // harness caught it — which is the behaviour the next test pins.
        val db = RoomSchemaHarness.databaseAt(10)
        val exported = RoomSchemaHarness.exportedTables(10).getValue("payments")
        val indices = RoomSchemaHarness.exportedIndices(10).filter { it.contains("payments") }
        RoomSchemaHarness.migrate(
            db,
            listOf("DROP TABLE payments", exported.replace(", ", ",   ")) + indices,
        )
        assertEquals(emptyList<String>(), RoomSchemaHarness.schemaDifferences(db, 10))
    }

    @Test
    fun `a recreate that forgets to rebuild an index is caught`() {
        // The step above, left out. The table is correct, every column is
        // correct, and the database opens — it is simply slower and no longer
        // enforces what the index enforced. Nothing else in the build would say
        // so, which is exactly why this is worth a test of its own.
        val db = RoomSchemaHarness.databaseAt(10)
        val exported = RoomSchemaHarness.exportedTables(10).getValue("payments")
        RoomSchemaHarness.migrate(db, listOf("DROP TABLE payments", exported))

        val problems = RoomSchemaHarness.schemaDifferences(db, 10)
        assertEquals(1, problems.size)
        assertTrue(problems.single().startsWith("payments: structure differs"))
    }
}
