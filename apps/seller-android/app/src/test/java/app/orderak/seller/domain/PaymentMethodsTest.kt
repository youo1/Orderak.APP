package app.orderak.seller.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The payment methods a store may record an order under.
 *
 * WHAT WENT WRONG
 *   The new-order screen rendered `PayMethod.entries` — all four — and
 *   pre-selected VF_CASH. The server accepts COD always, VF_CASH only for a
 *   store that has configured a Vodafone Cash number, INSTAPAY only with an
 *   InstaPay handle, and FAWRY for nobody. Onboarding collects neither payout
 *   detail, so a seller who finished sign-up and recorded their first order was
 *   refused with `payment_unavailable` on a method the app had chosen for them
 *   — and the refused order could then never be advanced, cancelled or removed.
 *
 *   These assertions are the rule from catalog.ts createOrder(), which is the
 *   authority. If that rule changes, one of these fails.
 */
class PaymentMethodsTest {

    @Test
    fun `a store with no payout details may still take cash`() {
        // The case every new seller is in the moment onboarding completes.
        assertEquals(listOf(PayMethod.COD), availablePayMethods(vfcash = null, instapay = null))
    }

    @Test
    fun `blank is the same as absent`() {
        // SessionStore returns "" for a field the seller cleared, and the server
        // tests `String(store.vfcash ?? "").trim()` — so an empty string is not
        // a configured payout method on either side.
        assertEquals(listOf(PayMethod.COD), availablePayMethods(vfcash = "", instapay = "   "))
    }

    @Test
    fun `a configured payout method is offered`() {
        assertEquals(
            listOf(PayMethod.COD, PayMethod.VF_CASH),
            availablePayMethods(vfcash = "01000000000", instapay = null),
        )
        assertEquals(
            listOf(PayMethod.COD, PayMethod.INSTAPAY),
            availablePayMethods(vfcash = null, instapay = "seller@instapay"),
        )
        assertEquals(
            listOf(PayMethod.COD, PayMethod.VF_CASH, PayMethod.INSTAPAY),
            availablePayMethods(vfcash = "01000000000", instapay = "seller@instapay"),
        )
    }

    @Test
    fun `FAWRY is never offered, because the server never accepts it`() {
        // It stays in the enum so orders recorded under it before this change
        // still decode from Room, and it is unreachable from the picker.
        val everyConfiguration = listOf(
            availablePayMethods(null, null),
            availablePayMethods("01000000000", null),
            availablePayMethods(null, "seller@instapay"),
            availablePayMethods("01000000000", "seller@instapay"),
        )
        assertTrue(everyConfiguration.none { PayMethod.FAWRY in it })
    }

    @Test
    fun `the default selection is one the server always accepts`() {
        // The property that matters. The previous default was VF_CASH, which the
        // server refuses for any store without a Vodafone Cash number — so the
        // pre-selected value was itself the thing that got the order rejected.
        for (vfcash in listOf(null, "01000000000")) {
            for (instapay in listOf(null, "seller@instapay")) {
                val available = availablePayMethods(vfcash, instapay)
                assertEquals(PayMethod.COD, resolvePayMethod(available, current = null))
            }
        }
    }

    @Test
    fun `a deliberate selection survives a reread of the store details`() {
        val available = availablePayMethods("01000000000", "seller@instapay")
        assertEquals(PayMethod.INSTAPAY, resolvePayMethod(available, current = PayMethod.INSTAPAY))
    }

    @Test
    fun `a selection the store can no longer use falls back rather than being sent`() {
        // The seller picked Vodafone Cash, then cleared the number in Store
        // Information. Keeping the stale selection would post an order the server
        // refuses.
        val available = availablePayMethods(vfcash = null, instapay = null)
        assertFalse(PayMethod.VF_CASH in available)
        assertEquals(PayMethod.COD, resolvePayMethod(available, current = PayMethod.VF_CASH))
    }
}
