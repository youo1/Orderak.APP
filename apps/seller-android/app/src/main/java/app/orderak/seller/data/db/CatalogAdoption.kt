package app.orderak.seller.data.db

/**
 * Fold one product as the server holds it onto the local row that already holds
 * it, or onto a fresh row when this device has never seen it.
 *
 * The server's copy is authoritative for everything the catalogue is made of —
 * name, price, stock, availability, category, the public image URL. Three
 * fields are not part of the catalogue and belong to this device alone:
 *
 *  * [ProductEntity.imagePath] is a path inside this app's private storage. The
 *    file it names exists on one phone; carrying the server's null over it would
 *    lose the local original and leave the product rendering from the network.
 *  * [ProductEntity.categoryId] is the local categories-table row id. The server
 *    round-trips `categoryCode`, and the local id is resolved from it elsewhere;
 *    overwriting it with null here would detach the product from its category
 *    until that resolution ran again.
 *  * [ProductEntity.createdAt] is what the catalogue is ordered by on screen.
 *    Replacing it with "now" on every adoption would reshuffle the seller's
 *    list each time a second device downloaded.
 *
 * `id = 0` for an unmatched product is Room's "allocate one": the row id this
 * device gives it is its own business, and is never the id another device gave
 * the same product. That is the whole point — [ProductEntity.remoteUuid] and
 * [ProductEntity.productCode] are the identity, and `id` stops being one.
 */
fun adoptedProduct(server: ProductEntity, local: ProductEntity?): ProductEntity =
    if (local == null) {
        server.copy(id = 0)
    } else {
        server.copy(
            id = local.id,
            imagePath = local.imagePath,
            categoryId = local.categoryId,
            createdAt = local.createdAt,
        )
    }
