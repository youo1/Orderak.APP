package app.orderak.seller.data.demo

import app.orderak.seller.data.db.CategoryEntity
import app.orderak.seller.data.db.CustomerEntity
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.data.db.OrderItemEntity
import app.orderak.seller.data.db.PaymentEntity
import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.domain.OrderStatus
import app.orderak.seller.domain.PayMethod

/**
 * The shop a reviewer sees.
 *
 * This is not filler. Every row is chosen to put one of the migration's claims
 * on screen, so looking at the app is a way of checking them:
 *
 *  - **18 of 20 products.** The usage meter has to read as warning, not danger,
 *    and the store surface has to say the limit without offering a checkout —
 *    purchase is closed platform-wide, so an upgrade button here would be a
 *    403 with a nicer label.
 *  - **All six order statuses, deliberately unsorted.** The priority rail
 *    claims a seller can answer "which of these need me?" without reading the
 *    colours. A pre-sorted list would answer it for them.
 *  - **Two products below their reorder point.** Low stock is a semantic
 *    surface: colour, icon, text and a container outline, never colour alone.
 *  - **Three orders with verified transfer references.** OCR receipt assistance
 *    is on this plan, so its gate must show the feature, not a lock.
 *  - **An unpaid order older than the rest.** The dashboard's "needs you"
 *    count is what the today surface exists for.
 *
 * Timestamps are relative to seeding so the list never looks abandoned.
 */
internal object DemoData {

    const val SHOP_NAME = "بيت الحلويات"
    const val SHOP_SLUG = "bayt-el-halawiyat"
    const val INSTAPAY_HANDLE = "bayt.halawiyat@instapay"

    /** Hour offsets back from "now", so the newest order is 40 minutes old. */
    private const val MINUTE = 60_000L
    private const val HOUR = 60 * MINUTE
    private const val DAY = 24 * HOUR

    fun categories(): List<CategoryEntity> = listOf(
        CategoryEntity(name = "حلويات شرقية", categoryCode = "c-orntl", slug = "oriental", sortOrder = 1),
        CategoryEntity(name = "كيك وجاتوه", categoryCode = "c-cakes", slug = "cakes", sortOrder = 2),
        CategoryEntity(name = "بسكويت", categoryCode = "c-bscts", slug = "biscuits", sortOrder = 3),
        CategoryEntity(name = "مشروبات", categoryCode = "c-drnks", slug = "drinks", sortOrder = 4),
    )

    /**
     * Eighteen products against a limit of twenty.
     *
     * `stock = 2` and `stock = 1` are the two that must render as low without
     * relying on colour; `available = false` is the one that is out entirely.
     */
    fun products(now: Long, categoryIds: List<Long>): List<ProductEntity> {
        val (oriental, cakes, biscuits, drinks) = categoryIds
        fun p(
            name: String,
            price: Long,
            stock: Int,
            category: Long,
            code: String,
            ageDays: Long,
            available: Boolean = true,
            description: String? = null,
        ) = ProductEntity(
            name = name,
            description = description,
            priceMinor = price,
            stock = stock,
            available = available,
            categoryId = category,
            categoryCode = code,
            productCode = "DEMO-${name.hashCode().toUInt().toString(16).uppercase().take(6)}",
            createdAt = now - ageDays * DAY,
        )

        return listOf(
            p("كنافة بالمانجو", 18_000, 12, oriental, "oriental", 42, description = "كنافة ناعمة بقشطة ومانجو طازة"),
            p("بسبوسة بالقشطة", 9_500, 25, oriental, "oriental", 40),
            p("بقلاوة بالفستق", 26_000, 8, oriental, "oriental", 38, description = "فستق حلبي، تُقطع عند الطلب"),
            p("هريسة جوز الهند", 7_500, 30, oriental, "oriental", 35),
            p("أم علي", 12_000, 2, oriental, "oriental", 33, description = "تحضر ساخنة — الكمية محدودة"),
            p("زلابيا", 6_000, 40, oriental, "oriental", 30),
            p("تورتة شوكولاتة", 45_000, 5, cakes, "cakes", 28, description = "٢٤ سم — تكفي ١٠ أفراد"),
            p("تشيز كيك فراولة", 38_000, 6, cakes, "cakes", 26),
            p("ريد فيلفت", 42_000, 1, cakes, "cakes", 24, description = "آخر قطعة"),
            p("كب كيك (٦ قطع)", 15_000, 18, cakes, "cakes", 21),
            p("براوني", 11_000, 14, cakes, "cakes", 19),
            p("بيتي فور سادة", 8_000, 22, biscuits, "biscuits", 17),
            p("بيتي فور بالشوكولاتة", 9_000, 20, biscuits, "biscuits", 15),
            p("غريبة", 7_000, 16, biscuits, "biscuits", 12),
            p("كحك بالعجمية", 13_500, 0, biscuits, "biscuits", 10, available = false, description = "موسمي — يرجع قريب"),
            p("عصير مانجو طازة", 4_500, 35, drinks, "drinks", 8),
            p("سحلب", 5_000, 28, drinks, "drinks", 5),
            p("قهوة تركي", 3_500, 50, drinks, "drinks", 3),
        )
    }

    fun customers(now: Long): List<CustomerEntity> = listOf(
        CustomerEntity(phone = "01012345678", name = "منى عبد الله", createdAt = now - 45 * DAY),
        CustomerEntity(phone = "01122334455", name = "أحمد يسري", createdAt = now - 38 * DAY),
        CustomerEntity(phone = "01234567890", name = "كريم فؤاد", createdAt = now - 30 * DAY),
        CustomerEntity(phone = "01098765432", name = "هدى مصطفى", createdAt = now - 22 * DAY),
        CustomerEntity(phone = "01155667788", name = "سارة الشناوي", createdAt = now - 14 * DAY),
        CustomerEntity(phone = "01201020304", name = "محمود العزب", createdAt = now - 6 * DAY),
    )

    /** One order per status, plus the two that carry payment proof. */
    data class DemoOrder(
        val order: OrderEntity,
        val items: List<Pair<String, Int>>,
        val payment: PaymentEntity? = null,
    )

    fun orders(now: Long): List<DemoOrder> = listOf(
        // Newest first in creation time, but statuses interleaved on purpose.
        DemoOrder(
            order = OrderEntity(
                buyerPhone = "01201020304", buyerName = "محمود العزب",
                status = OrderStatus.NEW.name, payMethod = PayMethod.COD.name,
                totalMinor = 63_000, note = "التسليم بعد المغرب",
                createdAt = now - 40 * MINUTE,
            ),
            items = listOf("تورتة شوكولاتة" to 1, "عصير مانجو طازة" to 4),
        ),
        DemoOrder(
            order = OrderEntity(
                buyerPhone = "01155667788", buyerName = "سارة الشناوي",
                status = OrderStatus.PAID.name, payMethod = PayMethod.INSTAPAY.name,
                totalMinor = 38_000,
                createdAt = now - 3 * HOUR,
            ),
            items = listOf("تشيز كيك فراولة" to 1),
            payment = PaymentEntity(
                orderId = 0, ref = "INSTA-9F42C1", amountMinor = 38_000,
                verified = true, createdAt = now - 3 * HOUR + 12 * MINUTE,
            ),
        ),
        DemoOrder(
            order = OrderEntity(
                buyerPhone = "01098765432", buyerName = "هدى مصطفى",
                status = OrderStatus.CONFIRMED.name, payMethod = PayMethod.COD.name,
                totalMinor = 27_500,
                createdAt = now - 9 * HOUR,
            ),
            items = listOf("بسبوسة بالقشطة" to 2, "سحلب" to 1, "قهوة تركي" to 1),
        ),
        DemoOrder(
            order = OrderEntity(
                buyerPhone = "01234567890", buyerName = "كريم فؤاد",
                status = OrderStatus.SHIPPED.name, payMethod = PayMethod.VF_CASH.name,
                totalMinor = 26_000,
                createdAt = now - 1 * DAY - 2 * HOUR,
            ),
            items = listOf("بقلاوة بالفستق" to 1),
            payment = PaymentEntity(
                orderId = 0, ref = "VF-7731AA", amountMinor = 26_000,
                verified = true, createdAt = now - 1 * DAY - 1 * HOUR,
            ),
        ),
        DemoOrder(
            order = OrderEntity(
                buyerPhone = "01122334455", buyerName = "أحمد يسري",
                status = OrderStatus.DONE.name, payMethod = PayMethod.INSTAPAY.name,
                totalMinor = 87_500,
                createdAt = now - 2 * DAY - 5 * HOUR,
            ),
            items = listOf("تورتة شوكولاتة" to 1, "كب كيك (٦ قطع)" to 2, "براوني" to 1),
            payment = PaymentEntity(
                orderId = 0, ref = "INSTA-4B10E7", amountMinor = 87_500,
                verified = true, createdAt = now - 2 * DAY - 4 * HOUR,
            ),
        ),
        DemoOrder(
            order = OrderEntity(
                buyerPhone = "01012345678", buyerName = "منى عبد الله",
                status = OrderStatus.CANCELLED.name, payMethod = PayMethod.COD.name,
                totalMinor = 18_000, note = "المشتري أجّل المناسبة",
                createdAt = now - 4 * DAY,
            ),
            items = listOf("كنافة بالمانجو" to 1),
        ),
        // The one that has been waiting: unpaid and older than everything else.
        DemoOrder(
            order = OrderEntity(
                buyerPhone = "01012345678", buyerName = "منى عبد الله",
                status = OrderStatus.NEW.name, payMethod = PayMethod.INSTAPAY.name,
                totalMinor = 45_000, note = "في انتظار إثبات التحويل",
                createdAt = now - 6 * DAY - 3 * HOUR,
            ),
            items = listOf("ريد فيلفت" to 1, "قهوة تركي" to 1),
            // No payment row: the seller is still waiting for the transfer
            // screenshot. This is the order the today surface has to surface.
        ),
    )
}
