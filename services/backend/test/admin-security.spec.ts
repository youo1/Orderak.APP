import { beforeEach, describe, expect, it } from "vitest";
import { env, createSchema, callWorker } from "./helpers";
import adminWorker from "../src/entrypoints/admin-worker";

const BASE = "https://admin.orderak.app";
const PASSWORD = "One-Time-Password-2026!";
const NEW_PASSWORD = "Permanent-Password-2026!";

async function call(path: string, init: RequestInit = {}): Promise<Response> {
	return callWorker(adminWorker, new Request(`${BASE}${path}`, init), env);
}

async function enrolledOwner(): Promise<{ cookie: string; csrf: string; secret: string; enrollmentToken: string; enrollmentCode: string }> {
	const bootstrap = await call("/api/admin/v1/auth/bootstrap", { method: "POST", headers: { "x-admin-key": "bootstrap-key", "cf-connecting-ip": "127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ email: "owner@orderak.app", password: PASSWORD, name: "Owner" }) });
	expect(bootstrap.status).toBe(201);
	const login = await call("/api/admin/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", cookie: "__Host-orderak_admin_session=fixed-by-attacker" }, body: JSON.stringify({ email: "owner@orderak.app", password: PASSWORD }) });
	const enrollment = await login.json<{ enrollment_token: string; secret: string }>();
	const code = await totp(enrollment.secret);
	const response = await call("/api/admin/v1/auth/enroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enrollment_token: enrollment.enrollment_token, code }) });
	expect(response.status).toBe(200);
	const payload = await response.clone().json<{ csrf_token: string; recovery_codes: string[]; admin: { recoveryCodesAcknowledged: boolean } }>();
	expect(payload.recovery_codes).toHaveLength(10);
	// Freshly enrolled: the codes have been shown but not acknowledged. The client
	// needs this to tell an interrupted enrollment from a finished one.
	expect(payload.admin.recoveryCodesAcknowledged).toBe(false);
	const setCookie = response.headers.get("set-cookie") ?? "";
	expect(setCookie).toContain("__Host-orderak_admin_session=");
	expect(setCookie).toContain("HttpOnly");
	expect(setCookie).toContain("Secure");
	expect(setCookie).toContain("SameSite=Strict");
	expect(setCookie).not.toContain("fixed-by-attacker");
	const cookie = setCookie.split(";")[0];
	const acknowledged = await call("/api/admin/v1/auth/recovery-codes/acknowledge", { method: "POST", headers: { cookie, origin: BASE, "x-csrf-token": payload.csrf_token, "content-type": "application/json" }, body: "{}" });
	expect(acknowledged.status).toBe(200);
	// /me issues a fresh CSRF token, so the one from enrollment is stale after
	// this call. Return the current one or every CSRF-protected request the
	// caller makes afterwards is rejected with 403.
	const current = await (await call("/api/admin/v1/auth/me", { headers: { cookie } })).json<{ csrf_token: string; admin: { recoveryCodesAcknowledged: boolean } }>();
	expect(current.admin.recoveryCodesAcknowledged).toBe(true);
	return { cookie, csrf: current.csrf_token, secret: enrollment.secret, enrollmentToken: enrollment.enrollment_token, enrollmentCode: code };
}

describe("admin browser security contract", () => {
	beforeEach(async () => {
		await createSchema();
		env.ADMIN_API_KEY = "bootstrap-key";
		env.ADMIN_SESSION_PEPPER = "session-pepper-with-at-least-thirty-two-characters";
		env.ADMIN_RECOVERY_PEPPER = "recovery-pepper-with-at-least-thirty-two-characters";
		env.ADMIN_TOTP_KEY_CURRENT = "1";
		env.ADMIN_TOTP_KEY_V1 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
		env.ADMIN_EXPORT_SIGNING_KEY = "export-signing-key-at-least-thirty-two-characters";
		env.ADMIN_ORIGIN = BASE;
		env.LOCAL_ADMIN_ENABLED = "false";
		env.ADMIN_BREAK_GLASS_IP_ALLOWLIST = "127.0.0.1";
	});

	it("rotates fixation input, rejects CSRF, and rejects a revoked session", async () => {
		const owner = await enrolledOwner();
		const noOrigin = await call("/api/admin/v1/auth/logout", { method: "POST", headers: { cookie: owner.cookie } });
		expect(noOrigin.status).toBe(403);
		const wrongCsrf = await call("/api/admin/v1/auth/logout", { method: "POST", headers: { cookie: owner.cookie, origin: BASE, "x-csrf-token": "wrong" } });
		expect(wrongCsrf.status).toBe(403);
		const me = await call("/api/admin/v1/auth/me", { headers: { cookie: owner.cookie } });
		const session = await me.json<{ csrf_token: string }>();
		const logout = await call("/api/admin/v1/auth/logout", { method: "POST", headers: { cookie: owner.cookie, origin: BASE, "x-csrf-token": session.csrf_token } });
		expect(logout.status).toBe(200);
		expect((await call("/api/admin/v1/auth/me", { headers: { cookie: owner.cookie } })).status).toBe(401);
	});

	it("stores MFA challenges in D1 and consumes enrollment tokens exactly once", async () => {
		const owner = await enrolledOwner();
		const replay = await call("/api/admin/v1/auth/enroll", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ enrollment_token: owner.enrollmentToken, code: owner.enrollmentCode }),
		});
		expect(replay.status).toBe(401);
		expect(await env.orderak_db.prepare(
			"SELECT kind,consumed_at FROM admin_auth_challenges WHERE kind='enrollment'",
		).first()).toMatchObject({ kind: "enrollment" });
	});

	it("requires first-use password replacement and makes invitations single-use", async () => {
		const owner = await enrolledOwner();
		expect((await call("/api/admin/v1/access/admins", { headers: { cookie: owner.cookie } })).status).toBe(428);
		const code = await totp(owner.secret);
		const changed = await call("/api/admin/v1/auth/password", { method: "POST", headers: { cookie: owner.cookie, origin: BASE, "x-csrf-token": owner.csrf, "content-type": "application/json" }, body: JSON.stringify({ current_password: PASSWORD, new_password: NEW_PASSWORD, totp_code: code }) });
		expect(changed.status).toBe(200);
		const me = await call("/api/admin/v1/auth/me", { headers: { cookie: owner.cookie } });
		const session = await me.json<{ csrf_token: string }>();
		const invited = await call("/api/admin/v1/access/invitations", { method: "POST", headers: { cookie: owner.cookie, origin: BASE, "x-csrf-token": session.csrf_token, "content-type": "application/json" }, body: JSON.stringify({ email: "support@orderak.app", role: "support", name: "Support" }) });
		expect(invited.status).toBe(201);
		const invitation = await invited.json<{ invitation_token: string }>();
		const accept = () => call("/api/admin/v1/auth/invitation/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invitation_token: invitation.invitation_token, password: "Support-Password-2026!" }) });
		expect((await accept()).status).toBe(200);
		expect((await accept()).status).toBe(403);
	});

	it("requires fresh owner authentication for sensitive exports and consumes download tokens once", async () => {
		const owner = await enrolledOwner();
		const changed = await call("/api/admin/v1/auth/password", { method: "POST", headers: { cookie: owner.cookie, origin: BASE, "x-csrf-token": owner.csrf, "content-type": "application/json" }, body: JSON.stringify({ current_password: PASSWORD, new_password: NEW_PASSWORD, totp_code: await totp(owner.secret) }) });
		expect(changed.status).toBe(200);
		const session = await (await call("/api/admin/v1/auth/me", { headers: { cookie: owner.cookie } })).json<{ csrf_token: string }>();
		await env.orderak_audit!.put("exports/sensitive.csv", "\ufeff\"id\"\r\n\"1\"\r\n");
		await env.orderak_db.prepare("INSERT INTO admin_exports(id,export_type,classification,filters_json,status,row_count,byte_count,r2_key,expires_at,requested_by) VALUES('sensitive','audit','sensitive','{}','completed',1,16,'exports/sensitive.csv',datetime('now','+1 day'),1)").run();
		const headers = { cookie: owner.cookie, origin: BASE, "x-csrf-token": session.csrf_token, "content-type": "application/json" };
		expect((await call("/api/admin/v1/exports/sensitive/download", { method: "POST", headers, body: "{}" })).status).toBe(403);
		const authorization = await call("/api/admin/v1/action-authorizations", { method: "POST", headers, body: JSON.stringify({ action: "export.sensitive", entity_id: "audit", payload_hash: "download", password: NEW_PASSWORD, totp_code: await totp(owner.secret) }) });
		expect(authorization.status).toBe(200);
		const { authorization_id } = await authorization.json<{ authorization_id: string }>();
		const download = await call("/api/admin/v1/exports/sensitive/download", { method: "POST", headers: { ...headers, "x-admin-action-authorization": authorization_id }, body: "{}" });
		expect(download.status).toBe(200);
		const { download_url } = await download.json<{ download_url: string }>();
		expect((await call(download_url, { headers: { cookie: owner.cookie } })).status).toBe(200);
		expect((await call(download_url, { headers: { cookie: owner.cookie } })).status).toBe(403);
		await env.orderak_db.prepare("INSERT INTO admin_exports(id,export_type,classification,filters_json,status,r2_key,expires_at,requested_by) VALUES('expired','stores','internal','{}','completed','exports/sensitive.csv',datetime('now','-1 minute'),1)").run();
		expect((await call("/api/admin/v1/exports/expired/download", { method: "POST", headers, body: "{}" })).status).toBe(404);
	});
});

async function totp(secret: string): Promise<string> {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const char of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
	const key = new Uint8Array(Math.floor(bits.length / 8));
	for (let index = 0; index < key.length; index++) key[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
	let counter = Math.floor(Date.now() / 1000 / 30);
	const message = new Uint8Array(8);
	for (let index = 7; index >= 0; index--) { message[index] = counter & 0xff; counter = Math.floor(counter / 256); }
	const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
	const hash = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, message));
	const offset = hash[hash.length - 1] & 0x0f;
	const binary = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
	return String(binary % 1_000_000).padStart(6, "0");
}
