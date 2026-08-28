package app.orderak.seller.core.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * Strips all saturation from whatever it wraps.
 *
 * Used to prove the rule the colour system is built on: colour repeats a signal,
 * it never carries one alone. If a chip stops being readable here, the design is
 * wrong — not the test.
 */
private fun Modifier.greyscale(): Modifier = drawWithContent {
    val paint = Paint().apply {
        colorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) })
    }
    drawContext.canvas.saveLayer(Rect(0f, 0f, size.width, size.height), paint)
    drawContent()
    drawContext.canvas.restore()
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ComponentGallery() {
    Surface {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
        ) {
            Text("Semantic chips", style = MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                SemanticChip(SemanticRole.Success, "مكتمل")
                SemanticChip(SemanticRole.Warning, "قرب الحد")
                SemanticChip(SemanticRole.Danger, "غير مدفوع")
                SemanticChip(SemanticRole.Info, "غير متصل")
                SemanticChip(SemanticRole.Commerce, "ترقية")
                SemanticChip(SemanticRole.Neutral, "قريباً")
            }

            Text("Feature availability", style = MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FeatureAvailabilityChip(FeatureAvailability.LockedByPlan, "ترقية", "قريباً")
                FeatureAvailabilityChip(FeatureAvailability.NotBuilt, "ترقية", "قريباً")
            }

            Text("Usage meters", style = MaterialTheme.typography.titleSmall)
            UsageMeter(label = "المنتجات", used = 14, limit = 20)
            UsageMeter(label = "طلبات الشهر", used = 43, limit = 50)
            UsageMeter(label = "الأجهزة", used = 1, limit = 1)

            Text("Notices", style = MaterialTheme.typography.titleSmall)
            NoticeBanner(
                role = SemanticRole.Warning,
                title = "شغّال من غير إنترنت",
                message = "بتشوف آخر بيانات متزامنة. أي تعديل هيتبعت أول ما الشبكة ترجع.",
            )
            NoticeBanner(
                role = SemanticRole.Commerce,
                title = "الترقية لسه مش متاحة",
                message = "الخطط المدفوعة مقفولة على مستوى المنصة دلوقتي.",
            )

            Text("Priority rows", style = MaterialTheme.typography.titleSmall)
            PriorityListRow(
                title = "منى عبد الله",
                subtitle = "من الكتالوج · من ساعتين",
                needsAction = true,
                trailing = { SemanticChip(SemanticRole.Success, "جديد") },
            )
            PriorityListRow(
                title = "أحمد يسري",
                subtitle = "من الكتالوج · 24 أغسطس",
                needsAction = false,
                trailing = { SemanticChip(SemanticRole.Neutral, "مكتمل") },
            )
        }
    }
}

/** Light scheme, Arabic RTL — the default a seller sees. */
@PreviewTest
@Preview(name = "Components light", locale = "ar")
@Composable
fun componentGalleryLight() {
    OrderakTheme(darkTheme = false) { ComponentGallery() }
}

/** Dark scheme. Containers darken and content lightens; nothing is inverted. */
@PreviewTest
@Preview(name = "Components dark", locale = "ar")
@Composable
fun componentGalleryDark() {
    OrderakTheme(darkTheme = true) { ComponentGallery() }
}

/**
 * The rule made checkable: with every hue removed, each chip, meter, banner and
 * row must still say what it means through its icon, its text and the filled or
 * hollow priority rail.
 */
@PreviewTest
@Preview(name = "Components greyscale", locale = "ar")
@Composable
fun componentGalleryGreyscale() {
    OrderakTheme(darkTheme = false) {
        Surface { Column(modifier = Modifier.greyscale()) { ComponentGallery() } }
    }
}
