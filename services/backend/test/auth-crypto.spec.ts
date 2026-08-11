import { describe, expect, it } from "vitest";
import {
	ADMIN_PBKDF2_ITERATIONS,
	hashPassword,
	passwordNeedsRehash,
	verifyPassword,
} from "../src/domains/identity/auth";

describe("admin password hashing", () => {
	it("uses the Cloudflare Workers-compatible PBKDF2 ceiling", async () => {
		expect(ADMIN_PBKDF2_ITERATIONS).toBe(100_000);
		const encoded = await hashPassword("Permanent-Password-2026!");
		expect(encoded).toMatch(/^pbkdf2\$100000\$/);
		expect(await verifyPassword("Permanent-Password-2026!", encoded)).toBe(true);
		expect(passwordNeedsRehash(encoded)).toBe(false);
	});

	it("only requests a portable upgrade for hashes below the ceiling", () => {
		expect(passwordNeedsRehash("pbkdf2$99999$AAAA$AAAA")).toBe(true);
		expect(passwordNeedsRehash("pbkdf2$100000$AAAA$AAAA")).toBe(false);
		expect(passwordNeedsRehash("pbkdf2$310000$AAAA$AAAA")).toBe(false);
	});
});
