package app.orderak.seller.core.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What the money and phone fields let through, as pure text rules.
 *
 * The screen keeps the amount as canonical text (Latin digits, one `.`), so a
 * seller typing in Arabic-Indic digits, or with the Arabic decimal separator,
 * must arrive as the same text a Latin keyboard would produce.
 */
class InputFieldTextRulesTest {

    @Test
    fun arabicIndicDigitsBecomeLatinDigits() {
        assertEquals("1012345678", latinDigits("١٠١٢٣٤٥٦٧٨"))
        assertEquals("1012345678", latinDigits("۱۰۱۲۳۴۵۶۷۸"))
    }

    @Test
    fun everythingThatIsNotADigitIsDropped() {
        assertEquals("20101", latinDigits("+20 (101)"))
        assertEquals("", latinDigits("abc"))
    }

    @Test
    fun aMoneyAmountKeepsTwoDecimalsAndNoMore() {
        assertEquals("12.50", moneyText("12.504", fractionDigits = 2))
        assertEquals("12.5", moneyText("12.5", fractionDigits = 2))
    }

    @Test
    fun theArabicDecimalSeparatorAndTheCommaAreTheSameAsADot() {
        assertEquals("12.5", moneyText("١٢٫٥", fractionDigits = 2))
        assertEquals("12.5", moneyText("12,5", fractionDigits = 2))
    }

    @Test
    fun aSecondSeparatorIsIgnored() {
        assertEquals("12.55", moneyText("12.5.5", fractionDigits = 2))
    }

    @Test
    fun aCurrencyWithoutAMinorUnitTakesNoSeparator() {
        assertEquals("1250", moneyText("1250.75", fractionDigits = 0))
    }

    @Test
    fun lettersAreDropped() {
        assertEquals("15", moneyText("1a5b", fractionDigits = 2))
    }

    @Test
    fun aTypedSeparatorAloneIsKeptSoTheSellerCanKeepTyping() {
        assertEquals("12.", moneyText("12.", fractionDigits = 2))
    }
}
