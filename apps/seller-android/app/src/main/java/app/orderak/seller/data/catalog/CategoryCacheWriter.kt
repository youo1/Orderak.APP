package app.orderak.seller.data.catalog

import app.orderak.seller.data.db.CategoryDao
import app.orderak.seller.data.db.CategoryEntity
import app.orderak.seller.data.remote.CategoryDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The only place a category row is written.
 *
 * Categories were already server-authoritative before this migration: the
 * settings screen creates, renames and deletes them through `/api/v1/categories`
 * and then re-reads the list. The local table exists so the product editor can
 * offer a picker without a round trip, which makes it a cache and nothing more.
 *
 * It gets a writer anyway, for the same reason products do. The rule "Room is a
 * cache" is only as good as the narrowest place it can be broken, and a
 * `categoryDao().upsert(...)` added to a view model in a year's time is exactly
 * how it would be. `verify-cache-write-boundary.mjs` forbids the mutating
 * category DAO calls anywhere but here.
 */
@Singleton
class CategoryCacheWriter @Inject constructor(
    private val categoryDao: CategoryDao,
) {

    /**
     * Take the server's list of categories as the complete set.
     *
     * Safe as a replacement — rather than the merge the catalogue needed — for
     * the reason a mirror never was: the server is stating what exists, not a
     * device guessing. `replaceAll` is one transaction, so a crash halfway
     * cannot leave a seller looking at a partial list.
     *
     * Refused, not applied, when the response is empty and this device already
     * holds categories. "The server genuinely has zero categories for this
     * store" and "the response was empty or wrong for a store that is not
     * empty" read identically from the payload alone, and only the first is
     * safe to act on by deleting everything. Returns false so the caller
     * treats the refresh as incomplete rather than as a seller's categories
     * having actually gone to zero.
     */
    suspend fun replaceAll(remote: List<CategoryDto>): Boolean {
        if (refusesEmptyCategoryReplacement(remote, categoryDao.allOnce())) return false
        categoryDao.replaceAll(
            remote.map {
                CategoryEntity(
                    name = it.name,
                    categoryCode = it.category_code,
                    slug = it.slug,
                    sortOrder = it.sort_order,
                )
            },
        )
        return true
    }
}

/** Same guard as `refusesEmptyProductReplacement` for products; see there for why. */
internal fun refusesEmptyCategoryReplacement(remote: List<CategoryDto>, existing: List<CategoryEntity>): Boolean =
    remote.isEmpty() && existing.isNotEmpty()
