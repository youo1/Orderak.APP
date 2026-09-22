package app.orderak.seller.data.catalog

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

private val Context.legacyReconcileStore by preferencesDataStore(name = "legacy_product_reconcile")

/**
 * What became of one product that predates the product routes.
 *
 * `UNSENT` is the only state that blocks adoption. The other two are both
 * endings: one where the product now exists on the server, and one where the
 * seller was shown it and chose to let it go.
 */
@Serializable
enum class LegacyReconcileState { UNSENT, CONVERTED, REFUSED }

/**
 * One legacy row's reconciliation record.
 *
 * [idempotencyKey] is minted once, when the row is first queued, and reused on
 * every attempt. That is what makes the whole job safe to repeat: a create whose
 * response was lost resolves to the product the server already made rather than
 * a second one.
 */
@Serializable
data class LegacyReconcileRecord(
    val idempotencyKey: String,
    val state: LegacyReconcileState,
    val lastError: String? = null,
)

/**
 * Per-row durable state for the one-time legacy catalogue reconciliation.
 *
 * WHY THIS IS NOT A ROOM COLUMN
 *   The obvious place for this is a column on `products`. It cannot go there:
 *   Room's schema is versioned and exported, the whole of Phase 3 deliberately
 *   stays on version 10, and adding a column the schema does not declare is a
 *   migration Room does not know it has performed. An earlier draft of the plan
 *   proposed exactly that, alongside the words "Room stays at v10", which cannot
 *   both be true.
 *
 * WHY NOT A SINGLE FLAG
 *   Because the gate this feeds is a count over rows:
 *
 *       after Job 1:  count(state == UNSENT) == 0
 *
 *   A boolean cannot express that, and a log line loses it on the next launch.
 *   Every legacy row ends in exactly one of two terminal states, or the job is
 *   not finished — and the difference between "finished" and "we stopped
 *   looking" is the difference between a migration and data loss.
 *
 * WHY IT IS ALLOWED TO BE A PREFERENCES BLOB
 *   The set is bounded by the plan's own product limit and is written once per
 *   row during a one-time job. This store is deleted with the migration itself
 *   when Room moves to version 11, so it is scaffolding with a stated end date
 *   rather than a second source of truth taking root.
 */
@Singleton
class LegacyReconcileStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : LegacyReconcileRecords {

    private val json = Json { ignoreUnknownKeys = true }

    /** Every record this device holds, keyed by the local product row id. */
    override suspend fun all(): Map<Long, LegacyReconcileRecord> {
        val raw = context.legacyReconcileStore.data.first()[RECORDS] ?: return emptyMap()
        return runCatching { json.decodeFromString<Map<Long, LegacyReconcileRecord>>(raw) }
            // A blob that will not decode is scaffolding, not seller data. Losing
            // it costs one repeated reconciliation attempt, which the idempotency
            // key makes harmless; treating it as fatal would strand the device.
            .getOrDefault(emptyMap())
    }

    override suspend fun record(localId: Long): LegacyReconcileRecord? = all()[localId]

    override suspend fun put(localId: Long, record: LegacyReconcileRecord) {
        val updated = all() + (localId to record)
        context.legacyReconcileStore.edit { it[RECORDS] = json.encodeToString(updated) }
    }

    /** The count the Phase 4 gate is stated in terms of. */
    override suspend fun unsentCount(): Int = all().values.count { it.state == LegacyReconcileState.UNSENT }

    /** Rows the seller was shown and chose to discard, so a screen can say so. */
    suspend fun refused(): Map<Long, LegacyReconcileRecord> =
        all().filterValues { it.state == LegacyReconcileState.REFUSED }

    /** Called once the migration is over and the records describe nothing. */
    suspend fun clear() {
        context.legacyReconcileStore.edit { it.remove(RECORDS) }
    }

    private companion object {
        val RECORDS = stringPreferencesKey("records")
    }
}
