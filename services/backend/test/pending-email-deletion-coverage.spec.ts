import { describe, expect, it } from "vitest";

// deletion.ts does not exist on the unchanged tree as an importable module
// under this exact path's current content (it has no pending_email_changes
// statement yet), so the pattern match below fails cleanly before the change.
const DELETION_SOURCE = import.meta.glob("../src/domains/identity/deletion.ts", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

describe("Account erasure removes pending email changes", () => {
	it("deletes pending_email_changes for the seller, the same way it deletes email_verification_tokens", () => {
		const files = Object.values(DELETION_SOURCE);
		expect(files).toHaveLength(1);
		const source = files[0];
		expect(source).toMatch(/DELETE\s+FROM\s+pending_email_changes\s+WHERE\s+seller_id\s*=\s*\?/i);
		expect(source).toMatch(/DELETE\s+FROM\s+email_verification_tokens\s+WHERE\s+seller_id\s*=\s*\?/i);
	});
});
