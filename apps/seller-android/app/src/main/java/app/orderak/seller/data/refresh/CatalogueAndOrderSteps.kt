package app.orderak.seller.data.refresh

/**
 * What each step of the catalogue-and-orders pass reported.
 *
 * Every field is "did this step finish cleanly", never "did it matter". A
 * refresh that was correctly skipped and a refresh that failed both report
 * false, because the caller's only use for these is deciding whether the whole
 * pass may be called complete — and neither of those is.
 */
internal data class CatalogueAndOrderOutcome(
    val reconciled: Boolean,
    val stockDrained: Boolean,
    val catalogueRefreshed: Boolean,
    val ordersPushed: Boolean,
)

/**
 * The order of the four steps that touch the catalogue and the order queue,
 * extracted so the one property that matters can be tested without standing up
 * a database, an API and nine other collaborators.
 *
 * THE SAFETY PROPERTY, WHICH IS THE ORDER ITSELF
 *   A product that predates the product routes exists on this device and nowhere
 *   else. Replacing the cache with the server's list before converting it
 *   destroys it. So: convert, drain, then adopt — and adopt only if nothing is
 *   left unconverted. That gate is [reconcile]'s return value and it is not
 *   negotiable.
 *
 * THE PROPERTY THIS FUNCTION EXISTS TO PIN
 *   **The order queue drains whatever the catalogue did.**
 *
 *   Orders are Class B: the device genuinely holds a sale the server has not
 *   acknowledged, and posting it is the one thing here that must not wait on
 *   anything. Before the cutover it did wait — the class this replaced returned
 *   early on a failed catalogue pull, with the order push sitting below that
 *   return, so a seller with a catalogue problem silently stopped delivering
 *   orders. That is a Class A failure taking a Class B command down with it, and
 *   it is the exact coupling the two classes exist to forbid. See ADR-012.
 *
 *   Nothing in the four lines below makes that visible, which is why they are a
 *   named function with a test rather than four statements in a longer one. A
 *   future `if` around [drainOrders] would read as tidy and would reintroduce
 *   the defect.
 *
 * Every parameter is a suspending lambda rather than an interface: this decides
 * ordering and nothing else, and it should not be able to reach anything it was
 * not handed.
 */
internal suspend fun runCatalogueAndOrderSteps(
    reconcile: suspend () -> Boolean,
    drainStock: suspend () -> Boolean,
    refreshCatalogue: suspend () -> Boolean,
    drainOrders: suspend () -> Boolean,
): CatalogueAndOrderOutcome {
    // Legacy rows first, then stock, then the server's catalogue.
    val reconciled = reconcile()
    val stockDrained = drainStock()
    // Only if nothing is left unconverted. `false` here means "not attempted",
    // and the caller treats that as an incomplete pass rather than a failure to
    // report — the next pass tries again.
    val catalogueRefreshed = if (reconciled) refreshCatalogue() else false

    // Unconditional, and deliberately after the catalogue work rather than
    // before it: an order names its products by their server-assigned code, and
    // a legacy product has none until the reconciliation has run. An order whose
    // products are still codeless simply stays pending for one more pass.
    //
    // "After" is not "depending on". This line runs when every step above
    // failed.
    val ordersPushed = drainOrders()

    return CatalogueAndOrderOutcome(
        reconciled = reconciled,
        stockDrained = stockDrained,
        catalogueRefreshed = catalogueRefreshed,
        ordersPushed = ordersPushed,
    )
}
