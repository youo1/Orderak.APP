package app.orderak.seller.data.remote

import android.os.Build
import app.orderak.seller.BuildConfig
import app.orderak.seller.core.platform.ClientContext
import app.orderak.seller.core.platform.ClientContextProvider
import app.orderak.seller.data.session.SessionStore
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AndroidClientContextProvider @Inject constructor(
    private val sessionStore: SessionStore,
) : ClientContextProvider {
    override suspend fun current() = ClientContext(
        installationId = sessionStore.getOrCreateDeviceId(),
        deviceLabel = (Build.MODEL ?: "Android").take(80),
        platform = "android",
        appVersion = BuildConfig.VERSION_NAME.take(40),
        versionCode = BuildConfig.VERSION_CODE.toLong(),
    )

    override fun newRequestId(): String = UUID.randomUUID().toString()
}

@Module
@InstallIn(SingletonComponent::class)
abstract class ClientContextModule {
    @Binds
    @Singleton
    abstract fun bindClientContextProvider(
        implementation: AndroidClientContextProvider,
    ): ClientContextProvider
}
