package app.orderak.seller.data.catalog

import app.orderak.seller.data.db.ProductDao
import app.orderak.seller.data.db.ProductEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Reads of the cached catalogue.
 *
 * Reads only. Writing a product is [app.orderak.seller.data.catalog
 * .ProductWriteRepository]'s job and goes to the server first; this used to
 * carry `save` and `delete` straight onto the DAO, which is what made the local
 * database look like the place products lived.
 */
@Singleton
class CatalogRepository @Inject constructor(
    private val productDao: ProductDao
) {
    val products: Flow<List<ProductEntity>> = productDao.all()
    /** Reactive product count for lightweight UI (dashboard) — not the full list. */
    val productCount: Flow<Int> = productDao.count()
    suspend fun productsOnce(): List<ProductEntity> = productDao.allOnce()
    suspend fun byId(id: Long): ProductEntity? = productDao.byId(id)
}
