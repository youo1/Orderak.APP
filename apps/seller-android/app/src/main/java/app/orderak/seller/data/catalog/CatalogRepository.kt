package app.orderak.seller.data.catalog

import app.orderak.seller.data.db.ProductDao
import app.orderak.seller.data.db.ProductEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CatalogRepository @Inject constructor(
    private val productDao: ProductDao
) {
    val products: Flow<List<ProductEntity>> = productDao.all()
    /** Reactive product count for lightweight UI (dashboard) — not the full list. */
    val productCount: Flow<Int> = productDao.count()
    suspend fun productsOnce(): List<ProductEntity> = productDao.allOnce()
    suspend fun byId(id: Long): ProductEntity? = productDao.byId(id)
    suspend fun save(product: ProductEntity): Long = productDao.upsert(product)
    suspend fun delete(id: Long) = productDao.delete(id)
}
