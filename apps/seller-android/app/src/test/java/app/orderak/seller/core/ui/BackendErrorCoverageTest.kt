package app.orderak.seller.core.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Every error code the backend can answer with has an answer here.
 *
 * WHY A TEST AND NOT A CODE REVIEW
 *   `backendErrorResource` mapped seven codes while the seller Worker emitted
 *   over a hundred, so every code that mattered — payment_unavailable,
 *   stale_catalog, bulk_deletion_unconfirmed, stock_changed — rendered as
 *   "something went wrong". Nothing detected that, because nothing could: one
 *   side is TypeScript and the other is Kotlin, and no check in the repository
 *   looked at both.
 *
 *   `contracts/error-codes/seller-v1.json` is generated from the Worker's own
 *   source by tooling/repository/extract-backend-error-codes.mjs and committed,
 *   so this test reads what the server actually says rather than a description
 *   of it. A code the backend gains without an answer here fails the build.
 *
 * WHY IT READS A FILE FROM THE REPOSITORY
 *   Because the alternative is a copy of the list in Kotlin, which is a second
 *   source of truth that can only drift — and drift silently, into a passing
 *   test run. The Node check runs the same comparison in CI so a missing answer
 *   is caught without the Android toolchain; this half catches it from the side
 *   where BackendErrors.kt is actually edited.
 */
class BackendErrorCoverageTest {

    private fun repoRoot(): File {
        // Unit tests run with the module directory as the working directory.
        var dir: File? = File("").absoluteFile
        while (dir != null && !File(dir, "contracts/error-codes/seller-v1.json").exists()) {
            dir = dir.parentFile
        }
        requireNotNull(dir) { "Could not locate the repository root from ${File("").absolutePath}" }
        return dir
    }

    private fun backendCodes(): List<String> {
        val json = File(repoRoot(), "contracts/error-codes/seller-v1.json").readText()
        // Deliberately not a JSON parser: the file has one shape, this needs one
        // field from it, and a dependency here would be a dependency the whole
        // unit-test source set carries for a single regex.
        return Regex("\"code\"\\s*:\\s*\"([^\"]+)\"")
            .findAll(json)
            .map { it.groupValues[1] }
            .toList()
    }

    @Test
    fun `the generated inventory is present and substantial`() {
        // A guard against the file being emptied or the regex silently matching
        // nothing, which would make every assertion below vacuously true.
        val codes = backendCodes()
        assertTrue("expected a populated inventory, got ${codes.size}", codes.size > 100)
    }

    @Test
    fun `every backend error code is answered or deliberately generic`() {
        val unanswered = backendCodes()
            .filterNot { it in MAPPED_CODES || it in INTENTIONALLY_GENERIC }
        assertTrue(
            "These backend error codes have no answer in BackendErrors.kt:\n" +
                unanswered.joinToString("\n") { "  $it" } +
                "\n\nGive each a message, or add it to INTENTIONALLY_GENERIC with a reason.",
            unanswered.isEmpty(),
        )
    }

    @Test
    fun `a mapped code actually resolves to a non-generic message`() {
        // MAPPED_CODES is a declaration; this is the check that it is true. A key
        // listed there but missing from the `when` would otherwise satisfy the
        // coverage test while still rendering as "something went wrong".
        val generic = backendErrorResource("a_code_no_branch_matches")
        val mislabelled = MAPPED_CODES.filter { backendErrorResource(it) == generic }
        assertTrue(
            "Listed in MAPPED_CODES but falling through to the generic message:\n" +
                mislabelled.joinToString("\n") { "  $it" },
            mislabelled.isEmpty(),
        )
    }

    @Test
    fun `the two sets do not overlap`() {
        // A code cannot be both answered and deliberately generic. If it is, one
        // of the two lists is a leftover.
        val both = MAPPED_CODES intersect INTENTIONALLY_GENERIC
        assertTrue("Declared in both sets: $both", both.isEmpty())
    }

    @Test
    fun `an unknown code still produces a sentence`() {
        // Fails closed in the direction that matters: a seller sees a message,
        // never a blank or a crash, for a code nobody has mapped yet.
        assertTrue(backendErrorResource(null) != 0)
        assertTrue(backendErrorResource("never_seen_before") != 0)
    }
}
