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
}
