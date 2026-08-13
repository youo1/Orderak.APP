import { beforeEach, describe, expect, it } from "vitest";
import { archiveAuditBatch, verifyAuditArchives } from "../src/domains/admin/admin-control-plane";
import { signJwt, type AdminRole } from "../src/domains/identity/auth";
import adminWorker from "../src/entrypoints/admin-worker";
import { callWorker, createSchema, env } from "./helpers";

async function adminFetch(path: string, role: AdminRole, init: RequestInit = {}): Promise<Response> {
	const token = await signJwt({ sub: 1, email: `${role}@example.test`, role }, env.ADMIN_JWT_SECRET || "test-admin-secret");
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${token}`);
	headers.set("content-type", "application/json");
	return callWorker(adminWorker, new Request(`https://admin.orderak.app${path}`, { ...init, headers }), env);
}

/**
 * Rotating ADMIN_AUDIT_SIGNING_KEY used to destroy the verifiability of every
 * archive already written, because nothing recorded which key produced a
 * signature. Migration 043 adds signing_key_version, and these tests hold the
 * property that migration exists for: an archive written under one key still
 * verifies after the Worker has moved to the next one.
 *
 * The test that matters is "verifies a pre-rotation archive after rotating".
 * The others exist so a failure there is diagnosable rather than just red.
 */

const KEY_V1 = "audit-signing-key-version-one-at-least-thirty-two-bytes";
const KEY_V2 = "audit-signing-key-version-two-at-least-thirty-two-bytes";

async function seedAuditEvents(count: number): Promise<void> {
	for (let index = 0; index < count; index++) {
		await env.orderak_db.prepare(
			"INSERT INTO admin_audit(admin_id,action,entity,entity_id,details_json) VALUES(?,?,?,?,?)",
		).bind(1, "test.event", "test", String(index), JSON.stringify({ index })).run();
	}
}

describe("audit archive signing key rotation", () => {
	beforeEach(async () => {
		await createSchema();
		env.ADMIN_AUDIT_SIGNING_KEY = KEY_V1;
		env.ADMIN_AUDIT_KEY_V2 = undefined;
		env.ADMIN_AUDIT_KEY_CURRENT = undefined;
	});

	it("signs with version 1 by default and records it", async () => {
		await seedAuditEvents(3);
		await archiveAuditBatch(env);

		const row = await env.orderak_db.prepare("SELECT signing_key_version FROM admin_audit_exports").first<{ signing_key_version: number }>();
		expect(row?.signing_key_version).toBe(1);
	});

	it("puts the key version in R2 metadata as well as D1", async () => {
		await seedAuditEvents(3);
		await archiveAuditBatch(env);

		const row = await env.orderak_db.prepare("SELECT object_key FROM admin_audit_exports").first<{ object_key: string }>();
		const object = await env.orderak_audit!.head(row!.object_key);
		// Either store alone is a single point of failure for verifiability.
		expect(object?.customMetadata?.signingKeyVersion).toBe("1");
	});

	it("verifies an archive and stamps verified_at", async () => {
		await seedAuditEvents(3);
		await archiveAuditBatch(env);

		const results = await verifyAuditArchives(env);
		expect(results).toHaveLength(1);
		expect(results[0].ok).toBe(true);

		const row = await env.orderak_db.prepare("SELECT verified_at FROM admin_audit_exports").first<{ verified_at: string | null }>();
		expect(row?.verified_at).toBeTruthy();
	});

	it("verifies a pre-rotation archive after rotating to version 2", async () => {
		// Written under version 1.
		await seedAuditEvents(3);
		await archiveAuditBatch(env);

		// Rotate: version 2 configured and made current. Version 1 stays set,
		// which is the whole reason the old archive remains checkable.
		env.ADMIN_AUDIT_KEY_V2 = KEY_V2;
		env.ADMIN_AUDIT_KEY_CURRENT = "2";

		// Written under version 2.
		await seedAuditEvents(3);
		await archiveAuditBatch(env);

		const rows = await env.orderak_db.prepare("SELECT signing_key_version FROM admin_audit_exports ORDER BY last_audit_id").all<{ signing_key_version: number }>();
		expect(rows.results.map((row) => row.signing_key_version)).toEqual([1, 2]);

		const results = await verifyAuditArchives(env);
		expect(results).toHaveLength(2);
		// Both verify: each against the key version recorded against it, not
		// against whichever key happens to be current.
		expect(results.every((result) => result.ok)).toBe(true);
	});

	it("reports key_unavailable rather than a signature failure when the version's key is gone", async () => {
		await seedAuditEvents(3);
		await archiveAuditBatch(env);

		// Simulates removing version 1 too early after a rotation.
		env.ADMIN_AUDIT_SIGNING_KEY = undefined;
		env.ADMIN_AUDIT_KEY_V2 = KEY_V2;
		env.ADMIN_AUDIT_KEY_CURRENT = "2";

		const results = await verifyAuditArchives(env);
		expect(results[0].ok).toBe(false);
		// Not signature_mismatch: the archive may be perfectly intact, and
		// calling a configuration gap a tampering signal would send someone to
		// the wrong incident.
		expect(results[0].reason).toBe("key_unavailable");
	});

	it("detects a tampered archive body as a hash mismatch", async () => {
		await seedAuditEvents(3);
		await archiveAuditBatch(env);

		const row = await env.orderak_db.prepare("SELECT object_key FROM admin_audit_exports").first<{ object_key: string }>();
		await env.orderak_audit!.put(row!.object_key, JSON.stringify({ version: 1, events: ["tampered"] }));

		const results = await verifyAuditArchives(env);
		expect(results[0].ok).toBe(false);
		expect(results[0].reason).toBe("hash_mismatch");
	});

	it("detects a swapped signature as a signature mismatch", async () => {
		await seedAuditEvents(3);
		await archiveAuditBatch(env);

		// Body untouched, so the content hash still matches; only the recorded
		// signature is wrong. This is the case the hash check cannot catch.
		await env.orderak_db.prepare("UPDATE admin_audit_exports SET signature=?").bind("00".repeat(32)).run();

		const results = await verifyAuditArchives(env);
		expect(results[0].ok).toBe(false);
		expect(results[0].reason).toBe("signature_mismatch");
	});

	it("refuses to archive when the current version has no key configured", async () => {
		await seedAuditEvents(3);
		env.ADMIN_AUDIT_KEY_CURRENT = "2";
		env.ADMIN_AUDIT_KEY_V2 = undefined;

		// Failing loudly here beats writing an unsigned or wrongly-signed
		// archive that only reveals itself at verification time.
		await expect(archiveAuditBatch(env)).rejects.toThrow("admin_audit_signing_key_missing");
	});
});

/**
 * The function above was correct and tested from the day it was written, and
 * still did nothing on a live system, because no route called it. These tests
 * cover the wiring rather than the logic — the gap Phase 7b exposed when the
 * rotation runbook asked for a verification that could not be run.
 */
describe("audit archive verification endpoint", () => {
	beforeEach(async () => {
		await createSchema();
		env.ADMIN_AUDIT_SIGNING_KEY = KEY_V1;
		env.ADMIN_AUDIT_KEY_V2 = undefined;
		env.ADMIN_AUDIT_KEY_CURRENT = undefined;
	});

	it("is reachable and reports a passing archive", async () => {
		await seedAuditEvents(3);
		await archiveAuditBatch(env);

		const response = await adminFetch("/api/admin/v1/security/audit-archives/verify", "owner", { method: "POST" });
		expect(response.status).toBe(200);
		const body = await response.json<{ checked: number; failed: number; results: { ok: boolean }[] }>();
		expect(body.checked).toBe(1);
		expect(body.failed).toBe(0);
		expect(body.results[0].ok).toBe(true);
	});

	it("stamps verified_at through the endpoint, not just the function", async () => {
		await seedAuditEvents(3);
		await archiveAuditBatch(env);
		await adminFetch("/api/admin/v1/security/audit-archives/verify", "owner", { method: "POST" });

		const row = await env.orderak_db.prepare("SELECT verified_at FROM admin_audit_exports").first<{ verified_at: string | null }>();
		expect(row?.verified_at).toBeTruthy();
	});

	it("verifies a pre-rotation archive through the endpoint after rotating to v2", async () => {
		await seedAuditEvents(3);
		await archiveAuditBatch(env);

		// Rotate exactly as staging did in Phase 7b: add V2, make it current,
		// keep V1 set.
		env.ADMIN_AUDIT_KEY_V2 = KEY_V2;
		env.ADMIN_AUDIT_KEY_CURRENT = "2";

		const response = await adminFetch("/api/admin/v1/security/audit-archives/verify", "owner", { method: "POST" });
		const body = await response.json<{ failed: number; results: { ok: boolean; signing_key_version: number }[] }>();
		expect(body.failed).toBe(0);
		expect(body.results[0].signing_key_version).toBe(1);
	});

	it("reports integrity failures as 200 with a reason, not as a server error", async () => {
		await seedAuditEvents(3);
		await archiveAuditBatch(env);
		await env.orderak_db.prepare("UPDATE admin_audit_exports SET signature=?").bind("00".repeat(32)).run();

		const response = await adminFetch("/api/admin/v1/security/audit-archives/verify", "owner", { method: "POST" });
		// A 5xx here would read as "the endpoint is broken" and get muted.
		expect(response.status).toBe(200);
		const body = await response.json<{ failed: number; results: { reason?: string }[] }>();
		expect(body.failed).toBe(1);
		expect(body.results[0].reason).toBe("signature_mismatch");
	});

	it("is gated on security:manage", async () => {
		expect((await adminFetch("/api/admin/v1/security/audit-archives/verify", "readonly", { method: "POST" })).status).toBe(403);
	});
});
