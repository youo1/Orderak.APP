package app.orderak.seller.data.remote

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.Cache
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    /**
     * On-disk HTTP cache.
     *
     * Small on purpose: only conditional GETs land here. Seller mutations are
     * POSTs, which OkHttp never caches, and every credentialed route returns
     * either no cache-control or `private, max-age=0, must-revalidate` — the
     * latter being exactly what a cache should revalidate rather than skip.
     */
    private const val CACHE_BYTES = 10L * 1024 * 1024

    @Provides
    @Singleton
    fun provideOkHttpClient(@ApplicationContext context: Context): OkHttpClient {
        return OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            // readTimeout bounds the gap between two reads, not the call. A slow
            // trickle could run well past thirty seconds of wall clock without
            // ever tripping it, which on a phone reads as the app having hung.
            .callTimeout(45, TimeUnit.SECONDS)
            // The cache was disabled outright (`.cache(null)`) while the backend
            // does the conditional-request work properly — /api/v1/config returns
            // an ETag with `private, max-age=0, must-revalidate`, media is served
            // immutable, and ETag is in Access-Control-Expose-Headers. Only
            // EntitlementRepository took advantage of any of it, by hand. The
            // sellers this is built for are on metered mobile data, so re-sending
            // a payload the device already has is a cost paid for nothing.
            .cache(Cache(File(context.cacheDir, "http"), CACHE_BYTES))
            // Ordering matters. CredentialVaryInterceptor is a *network*
            // interceptor so it sees the response before the cache stores it —
            // an application interceptor would rewrite Vary after the write and
            // guard nothing. RetryInterceptor is an *application* interceptor so
            // a retry goes back through the cache rather than straight to the
            // wire, and so it is not invoked separately for each redirect.
            .addNetworkInterceptor(CredentialVaryInterceptor())
            .addInterceptor(RetryInterceptor())
            .build()
    }
}
