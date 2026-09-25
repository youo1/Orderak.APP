package app.orderak.seller.data.db

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * This app's first real schema migration.
 *
 * Everything before version 10 was covered by
 * `fallbackToDestructiveMigrationFrom(1..9)` — Room threw the database away and
 * rebuilt it, which was acceptable while it held nothing the server did not
 * already have. It is not acceptable now: the database holds orders the server
 * has not acknowledged, and those exist nowhere else.
 *
 * WHAT IT DOES, AND THE ONE THING IT IS FOR
 *   `order_items` gains `productCode`. Posting an unsent order resolved the
 *   product through the cache — `productDao().byId(item.productId)` — and a
 *   command that needs the cache to be interpretable is not durable.
 *
 *   The sequence that breaks it is not hypothetical. A product created before
 *   the product routes has no code. The reconciliation converts it by POSTing
 *   it, and writes the server's answer as a NEW cache row, because nothing
 *   matched a code the local row had never had. The catalogue refresh then
 *   deletes every row without a code — which is the original row. Its id is now
 *   unreachable, so the order referencing it resolves to nothing and stays
 *   `NotReady` for ever, silently.
 *
 *   Carrying the code on the item removes the dependency entirely.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not make `products.productCode` the primary key, and it does not
 *   drop `products.id`, `stockDirty` or `syncedStockVersion` — all of which the
 *   plan called for.
 *
 *   A Room migration runs when the database is opened. The reconciliation that
 *   gives a legacy product its code runs afterwards, from the app. So a
 *   migration requiring every product to have a code would throw on exactly the
 *   devices that still have products without one — before the code that supplies
 *   them could run — and the app would not open at all. "Blocked until 95% of
 *   devices have reconciled" does not help the other 5%, and the failure is a
 *   brick rather than a degradation.
 *
 *   `stockDirty` and `syncedStockVersion` stay for the same ordering reason: the
 *   drain that empties them runs after this, and dropping them here discards a
 *   pending stock edit on any device that upgrades across both changes at once.
 *
 *   What is dropped is only what nothing reads: `products.remoteUuid` (its one
 *   query had no callers), `products.categoryId` (the server's `categoryCode` is
 *   what travels), and `customers.dirty` (customer edits are online-only now, so
 *   nothing sets it and nothing queries it).
 */
object OrderakMigrations {

    /**
     * The statements, in order, exactly as they run.
     *
     * Declared here rather than inside [MIGRATION_10_11] so the test executes the
     * same strings the app does. Two copies of a migration is how a tested
     * migration and a shipped migration become different things.
     */
    val MIGRATION_10_11_SQL: List<String> = listOf(
        // 1. The column, and the backfill — in that order and before anything
        //    else, because the backfill reads `products` as it stands today.
        "ALTER TABLE `order_items` ADD COLUMN `productCode` TEXT",
        """
        UPDATE `order_items`
           SET `productCode` = (
             SELECT p.`productCode` FROM `products` p WHERE p.`id` = `order_items`.`productId`
           )
        """.trimIndent(),

        // 2. products, minus remoteUuid and categoryId.
        //
        //    A twelve-step recreate rather than DROP COLUMN: Room compares the
        //    table it finds against the one it expects, and pre-API-31 devices
        //    ship a SQLite without DROP COLUMN at all. `id` is carried across
        //    unchanged by the INSERT ... SELECT, which is what keeps every
        //    order_items.productId still pointing at the row it always did.
        """
        CREATE TABLE `products_new` (
          `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          `name` TEXT NOT NULL,
          `description` TEXT,
          `priceMinor` INTEGER NOT NULL,
          `currency` TEXT NOT NULL,
          `stock` INTEGER NOT NULL,
          `discountType` TEXT,
          `discountValue` REAL,
          `imagePath` TEXT,
          `imageUrl` TEXT,
          `available` INTEGER NOT NULL,
          `productCode` TEXT,
          `syncedStockVersion` INTEGER,
          `stockDirty` INTEGER NOT NULL DEFAULT 0,
          `categoryCode` TEXT,
          `createdAt` INTEGER NOT NULL
        )
        """.trimIndent(),
        """
        INSERT INTO `products_new` (
          `id`, `name`, `description`, `priceMinor`, `currency`, `stock`,
          `discountType`, `discountValue`, `imagePath`, `imageUrl`, `available`,
          `productCode`, `syncedStockVersion`, `stockDirty`, `categoryCode`, `createdAt`
        )
        SELECT
          `id`, `name`, `description`, `priceMinor`, `currency`, `stock`,
          `discountType`, `discountValue`, `imagePath`, `imageUrl`, `available`,
          `productCode`, `syncedStockVersion`, `stockDirty`, `categoryCode`, `createdAt`
        FROM `products`
        """.trimIndent(),
        "DROP TABLE `products`",
        "ALTER TABLE `products_new` RENAME TO `products`",
        // DROP TABLE takes the table's indices with it. Rebuilding this is not
        // optional tidying: the products list and the dashboard both sort on it.
        "CREATE INDEX IF NOT EXISTS `index_products_createdAt` ON `products` (`createdAt`)",

        // 3. customers, minus dirty.
        """
        CREATE TABLE `customers_new` (
          `customerKey` TEXT PRIMARY KEY NOT NULL,
          `phone` TEXT NOT NULL,
          `phoneE164` TEXT,
          `phoneStatus` TEXT NOT NULL,
          `name` TEXT,
          `altContact` TEXT,
          `note` TEXT,
          `createdAt` INTEGER NOT NULL,
          `updatedAt` INTEGER NOT NULL
        )
        """.trimIndent(),
        """
        INSERT INTO `customers_new` (
          `customerKey`, `phone`, `phoneE164`, `phoneStatus`, `name`,
          `altContact`, `note`, `createdAt`, `updatedAt`
        )
        SELECT
          `customerKey`, `phone`, `phoneE164`, `phoneStatus`, `name`,
          `altContact`, `note`, `createdAt`, `updatedAt`
        FROM `customers`
        """.trimIndent(),
        "DROP TABLE `customers`",
        "ALTER TABLE `customers_new` RENAME TO `customers`",
    )

    val MIGRATION_10_11: Migration = object : Migration(10, 11) {
        override fun migrate(db: SupportSQLiteDatabase) {
            for (statement in MIGRATION_10_11_SQL) db.execSQL(statement)
        }
    }

    /**
     * `discountValue` becomes an integer (ADR-009 — money and percentage-like
     * fields are minor units or whole points, never floating point; this
     * column was the one place that had not caught up), and `productCode` /
     * `categoryCode` each get a defensive unique index.
     *
     * The indices are not closing a live exploit: every write path already
     * looks up a product or category by its code before upserting, so nothing
     * today should ever hit them. They exist so a future write path that
     * skips that lookup fails loudly instead of quietly duplicating a row —
     * see [ProductCacheWriter.refusesEmptyProductReplacement] and
     * [CategoryCacheWriter] for the sibling guard against the same class of
     * defect from the read side.
     *
     * The `DELETE` immediately before each index is defensive in the other
     * direction: if a duplicate somehow already exists on some device, the
     * index creation below must not be the thing that throws and bricks the
     * app on open. It keeps the row with the lowest `id` — the one every
     * order_items reference not pointing at that exact row already treats as
     * "the product is gone" (see the migration 10→11 test on that tolerance),
     * which is the existing, accepted behaviour for a missing product, not a
     * new one this migration introduces.
     */
    val MIGRATION_11_12_SQL: List<String> = listOf(
        // 1. products: discountValue REAL -> INTEGER. Same twelve-step
        //    recreate as migration 10->11, for the same reason: Room compares
        //    the table it finds against the one it expects, and SQLite has no
        //    ALTER COLUMN. CAST truncates any stray fractional value rather
        //    than leaving it stored as REAL under an INTEGER-affinity column,
        //    which is what SQLite would otherwise do silently.
        """
        CREATE TABLE `products_new` (
          `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          `name` TEXT NOT NULL,
          `description` TEXT,
          `priceMinor` INTEGER NOT NULL,
          `currency` TEXT NOT NULL,
          `stock` INTEGER NOT NULL,
          `discountType` TEXT,
          `discountValue` INTEGER,
          `imagePath` TEXT,
          `imageUrl` TEXT,
          `available` INTEGER NOT NULL,
          `productCode` TEXT,
          `syncedStockVersion` INTEGER,
          `stockDirty` INTEGER NOT NULL DEFAULT 0,
          `categoryCode` TEXT,
          `createdAt` INTEGER NOT NULL
        )
        """.trimIndent(),
        """
        INSERT INTO `products_new` (
          `id`, `name`, `description`, `priceMinor`, `currency`, `stock`,
          `discountType`, `discountValue`, `imagePath`, `imageUrl`, `available`,
          `productCode`, `syncedStockVersion`, `stockDirty`, `categoryCode`, `createdAt`
        )
        SELECT
          `id`, `name`, `description`, `priceMinor`, `currency`, `stock`,
          `discountType`, CAST(`discountValue` AS INTEGER), `imagePath`, `imageUrl`, `available`,
          `productCode`, `syncedStockVersion`, `stockDirty`, `categoryCode`, `createdAt`
        FROM `products`
        """.trimIndent(),
        "DROP TABLE `products`",
        "ALTER TABLE `products_new` RENAME TO `products`",
        // DROP TABLE takes the table's indices with it.
        "CREATE INDEX IF NOT EXISTS `index_products_createdAt` ON `products` (`createdAt`)",
        """
        DELETE FROM `products`
        WHERE `productCode` IS NOT NULL
          AND `id` NOT IN (SELECT MIN(`id`) FROM `products` WHERE `productCode` IS NOT NULL GROUP BY `productCode`)
        """.trimIndent(),
        "CREATE UNIQUE INDEX IF NOT EXISTS `index_products_productCode` ON `products` (`productCode`)",

        // 2. categories: no column change, so no rebuild — just the same
        //    defensive de-dup and unique index.
        """
        DELETE FROM `categories`
        WHERE `categoryCode` IS NOT NULL
          AND `id` NOT IN (SELECT MIN(`id`) FROM `categories` WHERE `categoryCode` IS NOT NULL GROUP BY `categoryCode`)
        """.trimIndent(),
        "CREATE UNIQUE INDEX IF NOT EXISTS `index_categories_categoryCode` ON `categories` (`categoryCode`)",
    )

    val MIGRATION_11_12: Migration = object : Migration(11, 12) {
        override fun migrate(db: SupportSQLiteDatabase) {
            for (statement in MIGRATION_11_12_SQL) db.execSQL(statement)
        }
    }
}
