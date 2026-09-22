package app.orderak.seller.data.db

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The customer list aggregation, run as SQL against Room's own exported schema.
 *
 * WHY THIS EXISTS
 *   `customers_crm.customer_list_and_order_history` sat in the behaviour-debt
 *   baseline reading "Customers are derived on-device by aggregating orders.
 *   Neither the aggregation nor the screen is covered." The screen is covered by
 *   CustomersScreenshotTest now; this is the aggregation.
 *
 *   It executes [CUSTOMER_SUMMARIES_SQL] — the same string the DAO's `@Query`
 *   carries — through [RoomSchemaHarness], which builds the real tables from
 *   `app/schemas/11.json`. A test that retyped the statement would be testing
 *   the copy, which is the point the migration harness next door already makes.
 *
 * WHAT IT CANNOT SEE
 *   Room's runtime: the row mapping onto [CustomerSummary], the Flow, the DAO
 *   wiring. Those need the instrumented test this repo does not run. What it
 *   does see is every decision the statement makes, and each one of them was
 *   wrong at some point.
 */
class CustomerSummariesTest {

    private fun db() = RoomSchemaHarness.databaseAt(11)

    private fun customer(c: java.sql.Connection, key: String, phone: String, name: String?) {
        RoomSchemaHarness.exec(
            c,
            "INSERT INTO customers (customerKey, phone, name, phoneStatus, createdAt, updatedAt) " +
                "VALUES ('$key', '$phone', ${name?.let { "'$it'" } ?: "NULL"}, 'valid', 0, 0)",
        )
    }

    private fun order(
        c: java.sql.Connection,
        id: Long,
        phone: String,
        totalMinor: Long,
        currency: String = "EGP",
        status: String = "DONE",
    ) {
        RoomSchemaHarness.exec(
            c,
            "INSERT INTO orders (id, buyerPhone, status, payMethod, totalMinor, currency, createdAt) " +
                "VALUES ($id, '$phone', '$status', 'CASH', $totalMinor, '$currency', 0)",
        )
    }

    private fun summaries(c: java.sql.Connection, column: String): List<String?> =
        RoomSchemaHarness.column(
            c,
            // The real statement, wrapped so one column comes back per row in
            // the order the statement itself decided.
            "SELECT $column FROM ($CUSTOMER_SUMMARIES_SQL)",
        )

    @Test
    fun `a customer with orders carries their count and total`() {
        val c = db()
        customer(c, "EG-1", "01000000001", "منى")
        order(c, 1, "01000000001", 45_000)
        order(c, 2, "01000000001", 30_000)

        assertEquals(listOf("2"), summaries(c, "ordersCount"))
        assertEquals(listOf("75000"), summaries(c, "totalMinor"))
        assertEquals(listOf("1"), summaries(c, "currencyCount"))
        assertEquals(listOf("EGP"), summaries(c, "currency"))
    }

    @Test
    fun `a cancelled order counts for nothing`() {
        // Not merely excluded from the total: excluded from the COUNT too, so a
        // customer whose only order was cancelled does not read as having
        // ordered once.
        val c = db()
        customer(c, "EG-1", "01000000001", "منى")
        order(c, 1, "01000000001", 45_000)
        order(c, 2, "01000000001", 99_000, status = "CANCELLED")

        assertEquals(listOf("1"), summaries(c, "ordersCount"))
        assertEquals(listOf("45000"), summaries(c, "totalMinor"))
    }

    @Test
    fun `a customer whose every order was cancelled still appears`() {
        // LEFT JOIN, not INNER. The row exists because an order arrived, and
        // dropping the person because it was later cancelled loses a customer
        // the seller has actually dealt with.
        val c = db()
        customer(c, "EG-1", "01000000001", "منى")
        order(c, 1, "01000000001", 45_000, status = "CANCELLED")

        assertEquals(listOf("EG-1"), summaries(c, "customerKey"))
        assertEquals(listOf("0"), summaries(c, "ordersCount"))
        assertEquals(listOf("0"), summaries(c, "totalMinor"))
        assertEquals(listOf("0"), summaries(c, "currencyCount"))
    }

    @Test
    fun `orders in two currencies report a count of two, so the screen can withhold the total`() {
        // The defect this column exists for. SUM over minor units across
        // currencies is a number of nothing: 150 EGP plus 15.000 KWD came out as
        // 30000 and the list sorted on it. The query cannot fix that, so it
        // reports the fact and the screen withholds the total.
        val c = db()
        customer(c, "EG-1", "01000000001", "منى")
        order(c, 1, "01000000001", 15_000, currency = "EGP")
        order(c, 2, "01000000001", 15_000, currency = "KWD")

        assertEquals(listOf("2"), summaries(c, "currencyCount"))
        assertEquals(listOf("2"), summaries(c, "ordersCount"))
    }

    @Test
    fun `the join is on the phone the order carries, not the customer key`() {
        // `orders.buyerPhone` holds what the buyer typed and nothing rewrites
        // it, so joining on the key would match no orders at all.
        val c = db()
        customer(c, "EG-SOMETHING-ELSE", "01000000001", "منى")
        order(c, 1, "01000000001", 45_000)

        assertEquals(listOf("1"), summaries(c, "ordersCount"))
    }

    @Test
    fun `a customer with no name is still listed`() {
        // The phone is the identity; the name is optional and arrives later.
        val c = db()
        customer(c, "EG-1", "01000000001", name = null)
        order(c, 1, "01000000001", 45_000)

        assertEquals(listOf(null), summaries(c, "name"))
        assertEquals(listOf("01000000001"), summaries(c, "phone"))
    }

    @Test
    fun `the list is ordered by total, biggest first`() {
        val c = db()
        customer(c, "EG-1", "01000000001", "منى")
        customer(c, "EG-2", "01000000002", "أحمد")
        order(c, 1, "01000000001", 10_000)
        order(c, 2, "01000000002", 90_000)

        assertEquals(listOf("EG-2", "EG-1"), summaries(c, "customerKey"))
    }
}
