package app.orderak.seller.app

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import app.orderak.seller.data.billing.BillingManager
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class OrderakApp : Application(), Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var billingManager: BillingManager

    override fun onCreate() {
        super.onCreate()

        // The server catalog keeps this dormant while billing is disabled. Once
        // enabled, it reconciles Play purchases on every app start. Initialize
        // off the main thread to avoid ANR; BillingManager internally posts
        // callbacks to the main looper.
        kotlinx.coroutines.CoroutineScope(
            kotlinx.coroutines.Dispatchers.IO +
                kotlinx.coroutines.SupervisorJob()
        ).launch { billingManager.initialize() }
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()
}
