package app.orderak.seller.data.remote

/**
 * What a mirror push's answer means for this device's catalogue baseline.
 *
 * WHY THIS IS A TYPE AND NOT FOUR LINES INSIDE doSync
 *   Because those four lines contradicted each other, silently, for as long as
 *   they existed:
 *
 *       if (!push.ok && push.error == "stale_catalog") {
 *           sessionStore.clearCatalogBaseline()
 *           lastPushedProductsHash = null
 *       }
 *       push.catalog_version?.let { sessionStore.saveCatalogBaseline(phone, it) }
 *
 *   The 409 that says "you are behind" carries `catalog_version` too — the
 *   server is telling the client where the store now stands — so the clear was
 *   undone on the very next line. The device ended up holding a baseline equal
 *   to the server's current version WITHOUT having downloaded anything; the next
 *   sync saw a baseline present and skipped the protective download; and the
 *   push that followed sent this device's stale mirror against a baseline that
 *   now matched. The server accepted it and deleted every product the device had
 *   never seen — which is exactly the loss the baseline mechanism exists to
 *   prevent.
 *
 *   Expressed as a decision, that bug is not writable: [Redownload] carries no
 *   version, so there is nothing for a caller to save.
 *
 * WHY THE SERVER'S VERSION IS TAKEN ONLY ON ACCEPTANCE
 *   An accepted push moves the store's version, so the baseline this device just
 *   used is spent and the new one is the honest successor — the device has seen
 *   every write up to it, because it made the last one. A refusal's version
 *   describes a catalogue this device has NOT seen. The two numbers look
 *   identical and mean opposite things.
 */
sealed interface CatalogPushDecision {

    /**
     * The push landed. [catalogVersion] is the store's version after this write,
     * and is safe to adopt as the next baseline.
     */
    data class Accepted(val catalogVersion: Long?) : CatalogPushDecision

    /**
     * This device is behind the server and must download before pushing again.
     *
     * Deliberately carries no version. Retrying with the baseline that was just
     * refused would fail identically forever; adopting the one the refusal
     * carried would skip the download and re-arm the wipe.
     */
    data object Redownload : CatalogPushDecision

    /**
     * The push would delete most of the catalogue, and the server wants a person
     * to say so. [deleting] and [of] are its own counts, carried through so the
     * prompt can name real numbers — a confirmation that cannot say what it is
     * confirming is one people click through.
     */
    data class ConfirmDeletion(val deleting: Int, val of: Int) : CatalogPushDecision

    /**
     * Anything else. The baseline is left exactly as it is and the next sync
     * tries again — correct for a dropped connection, and harmless for a refusal
     * that needs a fix elsewhere.
     */
    data class Failed(val code: String?) : CatalogPushDecision
}

/**
 * Read a mirror push's answer.
 *
 * `stale_stock` is deliberately NOT a baseline problem: the push landed, the
 * catalogue metadata was written, and only some compare-and-set stock writes
 * were refused. The server returns the new `catalog_version` with it and the
 * client rebases the conflicting rows — see ProductDao.applySync. Treating it
 * as a failure would throw away a baseline the device is entitled to.
 */
fun decideCatalogPush(push: ProductsSyncRes): CatalogPushDecision = when {
    push.ok -> CatalogPushDecision.Accepted(push.catalog_version)
    push.error == "stale_stock" -> CatalogPushDecision.Accepted(push.catalog_version)
    push.error == "stale_catalog" || push.error == "catalog_baseline_required" ->
        CatalogPushDecision.Redownload
    push.error == "bulk_deletion_unconfirmed" ->
        CatalogPushDecision.ConfirmDeletion(deleting = push.deleting ?: 0, of = push.of ?: 0)
    else -> CatalogPushDecision.Failed(push.error)
}
