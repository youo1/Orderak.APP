package app.orderak.seller.core.images

import android.content.Context
import android.net.Uri
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/** Copies picked images into app storage so they survive gallery changes. */
@Singleton
class ImageStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {
    suspend fun persist(uri: Uri, prefix: String): String? = withContext(Dispatchers.IO) {
        runCatching {
            val dir = File(context.filesDir, "images").apply { mkdirs() }
            val file = File(dir, "${prefix}_${System.currentTimeMillis()}.jpg")
            context.contentResolver.openInputStream(uri)?.use { input ->
                file.outputStream().use { input.copyTo(it) }
            }
            file.absolutePath
        }.getOrNull()
    }

    /** Polish: remove orphaned files when a product/photo is replaced or deleted. */
    suspend fun delete(path: String?) = withContext(Dispatchers.IO) {
        if (path.isNullOrBlank()) return@withContext
        runCatching { File(path).delete() }
    }

    /**
     * Remove every stored image. Part of signing out.
     *
     * delete() has exactly two callers, both in ProductEditViewModel, so product
     * photos were tidied and payment proofs never were: a buyer's transfer
     * receipt persisted here from the moment it was attached until the app was
     * uninstalled. Signing out cleared the Room database and left the images
     * beside it, so the next person to hold the handset could not see the order
     * but could still open the picture of the payment for it.
     *
     * The directory rather than a list of paths: what is here is defined by what
     * persist() wrote, and reconstructing that from tables that have just been
     * cleared is a way to miss the rows that were already gone.
     */
    suspend fun clear() = withContext(Dispatchers.IO) {
        runCatching { File(context.filesDir, "images").deleteRecursively() }
    }
}
