import { describe, expect, it } from "vitest";
import {
	ADMIN_PBKDF2_ITERATIONS,
	hashPassword,
	passwordNeedsRehash,
	verifyPassword,
	UNKNOWN_ACCOUNT_HASH,
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

describe("verifyPassword is total", () => {
	// It runs on the admin login path and b64urlDecode raises on input that is
	// not base64url, so a stored value that was truncated — or the unknown-account
	// dummy edited to something that no longer decodes — turned "wrong password"
	// into an unhandled 500.
	it("returns false rather than throwing on a malformed stored hash", async () => {
		for (const stored of [
			"",
			"garbage",
			"pbkdf2$100000$$",
			"pbkdf2$100000$!!!!$!!!!",
			"pbkdf2$100000$AAAA",
			"scrypt$100000$AAAA$AAAA",
		]) {
			await expect(verifyPassword("whatever", stored), stored).resolves.toBe(false);
		}
	});

	it("refuses every password against the unknown-account hash", async () => {
		// Its job is to cost the same PBKDF2 work as a real account while matching
		// nothing, so that an unknown email is not distinguishable by timing.
		expect(UNKNOWN_ACCOUNT_HASH.split("$")).toHaveLength(4);
		expect(await verifyPassword("", UNKNOWN_ACCOUNT_HASH)).toBe(false);
		expect(await verifyPassword("correct horse battery staple", UNKNOWN_ACCOUNT_HASH)).toBe(false);
	});

	it("still accepts a password against its own hash", async () => {
		const stored = await hashPassword("a-real-admin-password");
		expect(await verifyPassword("a-real-admin-password", stored)).toBe(true);
		expect(await verifyPassword("not-it", stored)).toBe(false);
	});
});
