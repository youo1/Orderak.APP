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
     */
    suspend fun replaceAll(remote: List<CategoryDto>) = categoryDao.replaceAll(
        remote.map {
            CategoryEntity(
                name = it.name,
                categoryCode = it.category_code,
                slug = it.slug,
                sortOrder = it.sort_order,
            )
        },
    )
}
