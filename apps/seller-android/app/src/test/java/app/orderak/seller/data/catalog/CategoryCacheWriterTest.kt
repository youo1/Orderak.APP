package app.orderak.seller.data.catalog

import app.orderak.seller.data.db.CategoryEntity
import app.orderak.seller.data.remote.CategoryDto
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same guard as `ProductCacheWriterTest`, for the category list; see there for why. */
class CategoryCacheWriterTest {

    @Test
    fun `an empty response over an existing category list is refused`() {
        val existing = listOf(CategoryEntity(name = "Drinks", categoryCode = "c-A1"))
        assertTrue(refusesEmptyCategoryReplacement(remote = emptyList(), existing = existing))
    }

    @Test
    fun `an empty response over no categories is accepted`() {
        assertFalse(refusesEmptyCategoryReplacement(remote = emptyList(), existing = emptyList()))
    }

    @Test
    fun `a non-empty response is never refused`() {
        val existing = listOf(CategoryEntity(name = "Drinks", categoryCode = "c-A1"), CategoryEntity(name = "Snacks", categoryCode = "c-A2"))
        val remote = listOf(CategoryDto(category_code = "c-A1", name = "Drinks"))
        assertFalse(refusesEmptyCategoryReplacement(remote = remote, existing = existing))
    }
}
