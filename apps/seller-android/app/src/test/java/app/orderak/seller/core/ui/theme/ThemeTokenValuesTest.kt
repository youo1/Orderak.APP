package app.orderak.seller.core.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * B2 moves these values into the generator. Android must render identically,
 * so every value Theme.kt exposes stays exactly what it was.
 */
class ThemeTokenValuesTest {

    @Test
    fun motionDurationsKeepTheirValuesAndReducedZeroesEveryOne() {
        val motion = OrderakMotion()
        assertEquals(0L, motion.instant.toLong())
        assertEquals(150L, motion.short.toLong())
        assertEquals(180L, motion.medium.toLong())
        assertEquals(200L, motion.long.toLong())
        val reduced = motion.reduced()
        assertEquals(0L, reduced.instant.toLong())
        assertEquals(0L, reduced.short.toLong())
        assertEquals(0L, reduced.medium.toLong())
        assertEquals(0L, reduced.long.toLong())
    }

    @Test
    fun spacingDefaultsKeepTheirValues() {
        val spacing = OrderakSpacing()
        assertEquals(0.dp, spacing.space0)
        assertEquals(4.dp, spacing.space1)
        assertEquals(8.dp, spacing.space2)
        assertEquals(12.dp, spacing.space3)
        assertEquals(16.dp, spacing.space4)
        assertEquals(24.dp, spacing.space6)
        assertEquals(32.dp, spacing.space8)
        assertEquals(40.dp, spacing.space10)
        assertEquals(48.dp, spacing.space12)
        assertEquals(64.dp, spacing.space16)
        assertEquals(48.dp, spacing.minimumTouchTarget)
        assertEquals(80.dp, spacing.fabClearance)
        assertEquals(56.dp, spacing.thumbnail)
        assertEquals(16.dp, spacing.iconSmall)
        assertEquals(20.dp, spacing.iconMedium)
        assertEquals(44.dp, spacing.iconHero)
    }

    @Test
    fun layoutSizesKeepTheirValues() {
        val layout = OrderakLayout()
        assertEquals(560.dp, layout.contentMaxWidth)
        assertEquals(720.dp, layout.wideLayoutMinWidth)
    }

    @Test
    fun pillShapeIsStillHalfTheHeight() {
        assertEquals(RoundedCornerShape(percent = 50), Shapes().full)
    }
}
