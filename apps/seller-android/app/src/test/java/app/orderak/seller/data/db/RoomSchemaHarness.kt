package app.orderak.seller.data.db

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.sql.Connection
import java.sql.DriverManager

/**
 * Runs a Room migration on the JVM, against the schemas Room itself exported.
 *
 * WHY THIS EXISTS
 *   This app has never performed a Room migration. Version 10 is where
 *   `fallbackToDestructiveMigrationFrom(1..9)` stops, so every schema change so
 *   far was allowed to destroy the database; the next one may not be, because
 *   the database now holds orders the server has not acknowledged.
 *
 *   The usual tool for this is `MigrationTestHelper`, which needs an emulator.
 *   `android-ci.yml` runs none — `connectedStagingDebugAndroidTest` is recorded
 *   there as a local-only gate — so a migration tested only that way is a
 *   migration tested only by whoever remembered to run it. This harness runs in
 *   the ordinary unit-test task that every pull request already runs.
 *
 * WHAT IT IS AND IS NOT
 *   It is plain SQLite through JDBC, driven by the same `createSql` strings Room
 *   wrote into `app/schemas/N.json`, and it compares the result the way Room
 *   does — by structure read from `PRAGMA`, not by statement text. See
 *   [schemaDifferences] for why that distinction is the whole difference between
 *   a useful harness and one people learn to work around.
 *
 *   It is not a test of Room's runtime. It cannot catch a missing entry in
 *   `addMigrations`, a wrong `@Database(version = …)`, or a DAO that does not
 *   match the entity. Those need the instrumented test, and the header of the
 *   migration test says so rather than letting this look like full cover.
 */
object RoomSchemaHarness {

    private val json = Json { ignoreUnknownKeys = true }

    private val schemaDir = File("schemas/app.orderak.seller.data.db.OrderakDatabase")

    /** Every table in an exported schema, as `tableName` to its `CREATE TABLE`. */
    fun exportedTables(version: Int): Map<String, String> {
        val file = File(schemaDir, "$version.json")
        require(file.isFile) { "No exported schema for version $version at ${file.path}" }
        val entities = json.parseToJsonElement(file.readText())
            .jsonObject.getValue("database").jsonObject.getValue("entities").jsonArray
        return entities.associate { entity ->
            val table = entity.jsonObject.getValue("tableName").jsonPrimitive.content
            // Room stores the statement with a placeholder so one entity can back
            // several tables. Substituting it here is what makes the string
            // executable, and is exactly what Room does at runtime.
            table to entity.jsonObject.getValue("createSql").jsonPrimitive.content
                .replace("\${TABLE_NAME}", table)
        }
    }

    /** The indices an exported schema declares, so a migration cannot quietly drop one. */
    fun exportedIndices(version: Int): Set<String> {
        val file = File(schemaDir, "$version.json")
        val entities = json.parseToJsonElement(file.readText())
            .jsonObject.getValue("database").jsonObject.getValue("entities").jsonArray
        return entities.flatMap { entity ->
            val table = entity.jsonObject.getValue("tableName").jsonPrimitive.content
            entity.jsonObject["indices"]?.jsonArray.orEmpty().map { index ->
                index.jsonObject.getValue("createSql").jsonPrimitive.content
                    .replace("\${TABLE_NAME}", table)
            }
        }.toSet()
    }

    /**
     * An in-memory database built at [version], ready for a migration to run on.
     *
     * Foreign keys are on, as Room turns them on: a migration that drops a table
     * a live reference points at should fail here rather than on a phone.
     */
    fun databaseAt(version: Int): Connection {
        val connection = DriverManager.getConnection("jdbc:sqlite::memory:")
        connection.createStatement().use { it.execute("PRAGMA foreign_keys = ON") }
        connection.createStatement().use { statement ->
            for (create in exportedTables(version).values) statement.execute(create)
            for (index in exportedIndices(version)) statement.execute(index)
        }
        return connection
    }

    /** Run one migration's statements, in order, as Room would. */
    fun migrate(connection: Connection, statements: List<String>) {
        connection.createStatement().use { statement ->
            for (sql in statements) statement.execute(sql)
        }
    }

    /**
     * Every table's `CREATE TABLE` as the database now actually holds it.
     *
     * Read from `sqlite_master`, which is the same text Room compares against its
     * expected schema when it opens a database. Room's internal tables are
     * excluded; they are not part of any entity.
     */
    fun actualTables(connection: Connection): Map<String, String> {
        val tables = mutableMapOf<String, String>()
        connection.createStatement().use { statement ->
            statement.executeQuery(
                "SELECT name, sql FROM sqlite_master WHERE type='table' " +
                    "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_metadata' " +
                    "AND name NOT LIKE 'room_%'",
            ).use { rows ->
                while (rows.next()) tables[rows.getString("name")] = rows.getString("sql")
            }
        }
        return tables
    }

    /** One column's value for every row, so data survival can be asserted directly. */
    fun column(connection: Connection, sql: String): List<String?> {
        val values = mutableListOf<String?>()
        connection.createStatement().use { statement ->
            statement.executeQuery(sql).use { rows ->
                while (rows.next()) values += rows.getString(1)
            }
        }
        return values
    }

    fun exec(connection: Connection, sql: String) {
        connection.createStatement().use { it.execute(sql) }
    }

    /**
     * Compare what a migration produced against what Room expects at [version].
     *
     * WHY THIS COMPARES STRUCTURE AND NOT THE STATEMENT TEXT
     *   The first version of this compared `CREATE TABLE` strings, and it failed
     *   a migration that was correct: SQLite echoes back the text it was given,
     *   so re-creating a table with the same columns and different spacing read
     *   as a schema change. A harness stricter than the thing it models is worse
     *   than none — the first person to hit that would reasonably relax the
     *   comparison, and the relaxation is what would then be trusted.
     *
     *   Room does not compare text either. `RoomOpenHelper` reads
     *   `PRAGMA table_info`, `PRAGMA index_list` and `PRAGMA foreign_key_list`
     *   and compares the structure it finds. So this builds a second database
     *   from the exported schema and compares the two the same way, which needs
     *   no parsing and cannot drift from what Room would accept.
     *
     * Returns the differences rather than asserting, so a test can state which
     * ones it means.
     */
    fun schemaDifferences(connection: Connection, version: Int): List<String> {
        val reference = databaseAt(version)
        return try {
            val expected = structureOf(reference)
            val actual = structureOf(connection)
            val problems = mutableListOf<String>()
            for ((table, want) in expected) {
                val got = actual[table]
                when {
                    got == null -> problems += "$table: missing after the migration"
                    got != want -> problems +=
                        "$table: structure differs. expected [$want] actual [$got]"
                }
            }
            for (table in actual.keys - expected.keys) problems += "$table: present but not in schema $version"
            problems
        } finally {
            reference.close()
        }
    }

    /**
     * Every table's columns and indices, in the form Room checks them.
     *
     * Column order is not part of the comparison — Room keys on name — so the
     * set is sorted. `dflt_value` and `pk` are included because a default or a
     * primary key silently lost in a twelve-step recreate is exactly the kind of
     * change that opens fine and then behaves differently.
     */
    private fun structureOf(connection: Connection): Map<String, String> {
        val tables = actualTables(connection).keys
        return tables.associateWith { table ->
            val columns = mutableListOf<String>()
            connection.createStatement().use { statement ->
                statement.executeQuery("PRAGMA table_info(`$table`)").use { rows ->
                    while (rows.next()) {
                        columns += listOf(
                            rows.getString("name"),
                            rows.getString("type"),
                            "notnull=" + rows.getInt("notnull"),
                            "default=" + (rows.getString("dflt_value") ?: "-"),
                            "pk=" + rows.getInt("pk"),
                        ).joinToString(" ")
                    }
                }
            }
            val indices = mutableListOf<String>()
            connection.createStatement().use { statement ->
                statement.executeQuery("PRAGMA index_list(`$table`)").use { rows ->
                    while (rows.next()) {
                        // Indices SQLite creates for UNIQUE constraints are named
                        // `sqlite_autoindex_*` and are implied by the columns
                        // above, so naming them again would double-count.
                        val name = rows.getString("name")
                        if (!name.startsWith("sqlite_autoindex")) {
                            indices += name + " unique=" + rows.getInt("unique")
                        }
                    }
                }
            }
            (columns.sorted() + indices.sorted()).joinToString(", ")
        }
    }
}
