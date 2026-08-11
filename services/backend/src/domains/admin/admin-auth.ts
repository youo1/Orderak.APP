import { Hono } from "hono";
import { jsonResponse, constantTimeEqual, checkRateLimit } from "../../platform/http/shared";
import { pickLocale, t, type Locale } from "../../platform/localization/i18n";
import {
	hashPassword,
	passwordNeedsRehash,
	verifyPassword,
	verifyJwt,
	generateTotpSecret,
	verifyTotp,
	totpUri,
	sha256Hex,
	hasPermission,
	permissionsForRole,
	randomToken,
	keyedHash,
	encryptSecret,
	decryptSecret,
	ALL_ROLES,
	type AdminClaims,
	type AdminRole,
} from "../identity/auth";
import type { AdminSessionResponse } from "../../../../../contracts/typescript/admin";

const MIN_PASSWORD_LEN = 12;
const IDLE_SECONDS = 15 * 60;
const ABSOLUTE_SECONDS = 8 * 60 * 60;
const MFA_CHALLENGE_SECONDS = 5 * 60;
const RECOVERY_CODE_COUNT = 10;
const BREAK_GLASS_IPS_REQUIRED_ERROR = { error: "break_glass_source_forbidden" };

async function jsonObject(request: Request): Promise<Record<string, unknown>> {
	return request.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
}

type AdminChallengeKind = "mfa" | "enrollment";

async function createAdminChallenge(
	env: AdminWorkerEnv,
	kind: AdminChallengeKind,
	adminId: number,
	ttlSeconds: number,
): Promise<string> {
	const token = randomToken();
	await env.orderak_db.prepare(
		`INSERT INTO admin_auth_challenges(id,admin_id,kind,expires_at)
		 VALUES(?,?,?,datetime('now', ?))`,
	).bind(await sha256Hex(token), adminId, kind, `+${ttlSeconds} seconds`).run();
	return token;
}

async function loadAdminChallenge(
	env: AdminWorkerEnv,
	kind: AdminChallengeKind,
	token: string,
): Promise<{ id: string; adminId: number } | null> {
	if (!token) return null;
	const id = await sha256Hex(token);
	const row = await env.orderak_db.prepare(
		`UPDATE admin_auth_challenges SET attempts=attempts+1
		 WHERE id=? AND kind=? AND consumed_at IS NULL AND expires_at>datetime('now') AND attempts<5
		 RETURNING admin_id`,
	).bind(id, kind).first<{ admin_id: number }>();
	return row ? { id, adminId: Number(row.admin_id) } : null;
}

async function consumeAdminChallenge(
	env: AdminWorkerEnv,
	id: string,
	kind: AdminChallengeKind,
	adminId: number,
): Promise<boolean> {
	const row = await env.orderak_db.prepare(
		`UPDATE admin_auth_challenges SET consumed_at=datetime('now')
		 WHERE id=? AND kind=? AND admin_id=? AND consumed_at IS NULL AND expires_at>datetime('now')
		 RETURNING id`,
	).bind(id, kind, adminId).first<{ id: string }>();
	return Boolean(row);
}

export interface AdminRow {
	id: number;
	email: string;
	name: string | null;
	password_hash: string;
	role: AdminRole;
	lang: string;
	timezone?: string | null;
	totp_secret: string | null;
	totp_secret_ciphertext?: string | null;
	totp_key_version?: number | null;
	totp_enabled: number;
	mfa_required?: number;
	must_change_password?: number;
	password_expires_at?: string | null;
	recovery_codes_acknowledged_at?: string | null;
	active: number;
}

type SessionRow = AdminRow & {
	session_id: string;
	created_at: string;
	expires_at: string;
	idle_expires_at: string;
	csrf_hash: string;
};

function cookieValue(request: Request, name: string): string {
	return decodeURIComponent((request.headers.get("cookie") ?? "")
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name}=`))
		?.slice(name.length + 1) ?? "");
}

function sessionPepper(env: AdminWorkerEnv): string | null {
	return env.ADMIN_SESSION_PEPPER ?? (env.LOCAL_ADMIN_ENABLED === "true" ? env.ADMIN_JWT_SECRET ?? null : null);
}

function recoveryPepper(env: AdminWorkerEnv): string | null {
	return env.ADMIN_RECOVERY_PEPPER ?? (env.LOCAL_ADMIN_ENABLED === "true" ? env.ADMIN_JWT_SECRET ?? null : null);
}

function breakGlassSourceAllowed(request: Request, env: AdminWorkerEnv): boolean {
	if (env.LOCAL_ADMIN_ENABLED === "true") return true;
	const ip = request.headers.get("cf-connecting-ip")?.trim() ?? "";
	const allowlist = String(env.ADMIN_BREAK_GLASS_IP_ALLOWLIST ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	return !!ip && allowlist.includes(ip);
}

function requireBreakGlassAccess(request: Request, env: AdminWorkerEnv): Response | null {
	const key = request.headers.get("x-admin-key") ?? "";
	if (!env.ADMIN_API_KEY || !constantTimeEqual(key, env.ADMIN_API_KEY)) {
		return jsonResponse({ error: "unauthorized" }, 401);
	}
	if (!breakGlassSourceAllowed(request, env)) {
		return jsonResponse(BREAK_GLASS_IPS_REQUIRED_ERROR, 403);
	}
	return null;
}

function keyForVersion(env: AdminWorkerEnv, version: number): string | undefined {
	if (version === 1) return env.ADMIN_TOTP_KEY_V1;
	if (version === 2) return env.ADMIN_TOTP_KEY_V2;
	return undefined;
}

function currentTotpKey(env: AdminWorkerEnv): { version: number; key: string } | null {
	const version = Math.max(1, Number(env.ADMIN_TOTP_KEY_CURRENT ?? "1") || 1);
	const key = keyForVersion(env, version);
	return key ? { version, key } : null;
}

async function totpSecret(env: AdminWorkerEnv, row: AdminRow): Promise<string | null> {
	if (row.totp_secret_ciphertext) {
		return decryptSecret(row.totp_secret_ciphertext, (version) => keyForVersion(env, version));
	}
	return row.totp_secret;
}

function claims(row: AdminRow, sid?: string, createdAt?: string, expiresAt?: string): AdminClaims {
	return {
		sub: row.id,
		email: row.email,
		role: row.role,
		name: row.name ?? undefined,
		lang: row.lang,
		sid,
		iat: createdAt ? Math.floor(Date.parse(createdAt.replace(" ", "T") + "Z") / 1000) : 0,
		exp: expiresAt ? Math.floor(Date.parse(expiresAt.replace(" ", "T") + "Z") / 1000) : 0,
	};
}

export async function resolveAdmin(request: Request, env: AdminWorkerEnv): Promise<AdminClaims | null> {
	// Backward-compatible bearer JWTs exist only in explicitly local test/dev mode.
	const bearer = request.headers.get("authorization") ?? "";
	if (env.LOCAL_ADMIN_ENABLED === "true" && bearer.startsWith("Bearer ") && env.ADMIN_JWT_SECRET) {
		return verifyJwt(bearer.slice(7), env.ADMIN_JWT_SECRET);
	}

	const token = cookieValue(request, "__Host-orderak_admin_session") || cookieValue(request, "orderak_admin_session");
	const pepper = sessionPepper(env);
	if (!token || !pepper) return null;
	const tokenHash = await keyedHash(token, pepper);
	const row = await env.orderak_db.prepare(
		`SELECT u.*,s.id AS session_id,s.created_at,s.expires_at,s.idle_expires_at,s.csrf_hash
		 FROM admin_sessions s JOIN admin_users u ON u.id=s.admin_id
		 WHERE s.token_hash=? AND s.revoked_at IS NULL AND u.active=1
		 AND s.expires_at>datetime('now') AND s.idle_expires_at>datetime('now') LIMIT 1`,
	).bind(tokenHash).first<SessionRow>();
	if (!row) return null;
	await env.orderak_db.prepare(
		"UPDATE admin_sessions SET last_used_at=datetime('now'),idle_expires_at=datetime('now',?) WHERE id=?",
	).bind(`+${IDLE_SECONDS} seconds`, row.session_id).run();
	return claims(row, row.session_id, row.created_at, row.expires_at);
}

export async function validateAdminMutation(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response | null> {
	if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
	if (env.LOCAL_ADMIN_ENABLED === "true" && request.headers.get("authorization")?.startsWith("Bearer ")) return null;
	const origin = request.headers.get("origin");
	const referer = request.headers.get("referer");
	const expected = env.ADMIN_ORIGIN ?? "https://admin.orderak.app";
	if (origin ? origin !== expected : !referer?.startsWith(`${expected}/`)) {
		return jsonResponse({ error: "invalid_origin" }, 403);
	}
	if (!admin.sid) return jsonResponse({ error: "invalid_session" }, 401);
	const csrf = request.headers.get("x-csrf-token") ?? "";
	const pepper = sessionPepper(env);
	if (!csrf || !pepper) return jsonResponse({ error: "csrf_required" }, 403);
	const csrfHash = await keyedHash(csrf, pepper);
	const found = await env.orderak_db.prepare(
		"SELECT 1 ok FROM admin_sessions WHERE id=? AND csrf_hash=? AND revoked_at IS NULL",
	).bind(admin.sid, csrfHash).first();
	return found ? null : jsonResponse({ error: "csrf_invalid" }, 403);
}

// Takes the shared Env, not AdminWorkerEnv: this writes only to orderak_db,
// and seller-facing code in api-store.ts and seller-operations.ts records audit
// entries through it from the public Worker. Typing it to the admin surface
// would fence off a legitimate caller.
export async function auditDb(
	env: Env,
	admin: AdminClaims | null,
	action: string,
	details: Record<string, unknown> = {},
	request?: Request,
): Promise<void> {
	const safe = { ...details };
	for (const key of ["password", "token", "secret", "totp", "recovery_code", "csrf"]) delete safe[key];
	console.log(JSON.stringify({ kind: "admin_audit", action, admin_id: admin?.sub ?? null, entity: safe.entity, entity_id: safe.entity_id }));
	try {
		await env.orderak_db.prepare(
			`INSERT INTO admin_audit (admin_id,action,entity,entity_id,details_json,ip)
			 VALUES(?,?,?,?,?,?)`,
		).bind(
			admin?.sub || null,
			action,
			(safe.entity as string) ?? null,
			safe.entity_id != null ? String(safe.entity_id) : null,
			JSON.stringify(safe),
			request?.headers.get("cf-connecting-ip") ?? null,
		).run();
	} catch (error) {
		console.error(JSON.stringify({ kind: "admin_audit_error", action, message: error instanceof Error ? error.message : "unknown" }));
	}
}

export function requirePermission(admin: AdminClaims | null, permission: string, lang: Locale): Response | null {
	if (!admin) return jsonResponse({ error: "unauthorized", message: t(lang, "errors.unauthorized") }, 401);
	return hasPermission(admin.role, permission) ? null : jsonResponse({ error: "forbidden", message: t(lang, "errors.forbidden") }, 403);
}

/** Password + current TOTP proof used to mint short-lived, action-bound approvals. */
export async function verifyFreshAdminAuth(env: AdminWorkerEnv, admin: AdminClaims, password: string, code: string): Promise<boolean> {
	const row = await env.orderak_db.prepare("SELECT * FROM admin_users WHERE id=? AND active=1").bind(admin.sub).first<AdminRow>();
	const secret = row ? await totpSecret(env, row) : null;
	return Boolean(row && secret && await verifyPassword(password, row.password_hash) && await verifyTotp(secret, code));
}

/**
 * Admin authentication routes, mounted by admin.ts BEFORE the identity
 * middleware — these endpoints establish a session, so they cannot require one.
 *
 * The original guarded on the /auth/ prefix and returned null outside it, then
 * 404'd anything unmatched inside it. The scoped catch-all at the bottom keeps
 * that split: /auth/* terminates here, everything else falls through.
 */
export const authApp = new Hono<{ Bindings: AdminWorkerEnv }>();
const au = authApp;
const A = "/api/admin/v1/auth";
const lang = (c: { req: { url: string; raw: Request } }) => pickLocale(c.req.raw, new URL(c.req.url));

au.post(`${A}/bootstrap`, (c) => bootstrap(c.req.raw, c.env, lang(c)));
au.post(`${A}/login`, (c) => login(c.req.raw, c.env, lang(c)));
au.post(`${A}/mfa`, (c) => mfa(c.req.raw, c.env, lang(c)));
au.post(`${A}/enroll`, (c) => enrollMfa(c.req.raw, c.env, lang(c)));
au.post(`${A}/recovery`, (c) => recoverMfa(c.req.raw, c.env, lang(c)));
au.get(`${A}/me`, (c) => me(c.req.raw, c.env));
au.post(`${A}/logout`, (c) => logout(c.req.raw, c.env));
au.post(`${A}/password`, (c) => changePassword(c.req.raw, c.env, lang(c)));
au.post(`${A}/password/reset`, (c) => resetPassword(c.req.raw, c.env, lang(c)));
au.post(`${A}/recovery-codes`, (c) => regenerateRecoveryCodes(c.req.raw, c.env, lang(c)));
au.post(`${A}/recovery-codes/acknowledge`, (c) => acknowledgeRecoveryCodes(c.req.raw, c.env));

// Terminating 404 scoped to /auth/*, so other admin paths still fall through.
au.all(`${A}/*`, () => jsonResponse({ error: "not_found" }, 404));

async function me(request: Request, env: AdminWorkerEnv): Promise<Response> {
	const admin = await resolveAdmin(request, env);
	if (!admin) return jsonResponse({ error: "unauthorized" }, 401);
	const row = await env.orderak_db.prepare("SELECT * FROM admin_users WHERE id=?").bind(admin.sub).first<AdminRow>();
	if (!row) return jsonResponse({ error: "unauthorized" }, 401);
	const session = admin.sid ? await env.orderak_db.prepare("SELECT csrf_hash FROM admin_sessions WHERE id=?").bind(admin.sid).first<{ csrf_hash: string }>() : null;
	// The current raw CSRF token cannot be recovered from its hash. Rotate it for /me.
	let csrf = "";
	if (admin.sid && session) {
		csrf = randomToken(24);
		const pepper = sessionPepper(env);
		if (pepper) await env.orderak_db.prepare("UPDATE admin_sessions SET csrf_hash=? WHERE id=?").bind(await keyedHash(csrf, pepper), admin.sid).run();
	}
	return sessionResponse(row, csrf);
}

async function bootstrap(request: Request, env: AdminWorkerEnv, lang: Locale): Promise<Response> {
	const denied = requireBreakGlassAccess(request, env);
	if (denied) return denied;
	const existing = await env.orderak_db.prepare("SELECT COUNT(*) c FROM admin_users").first<{ c: number }>();
	if ((existing?.c ?? 0) > 0) return jsonResponse({ error: "already_bootstrapped" }, 409);
	const body = await jsonObject(request);
	const email = String(body.email ?? "").trim().toLowerCase();
	const password = String(body.password ?? "");
	if (!email || password.length < MIN_PASSWORD_LEN) return jsonResponse({ error: "email_and_strong_password_required" }, 400);
	await env.orderak_db.prepare(
		`INSERT INTO admin_users(email,name,password_hash,role,lang,active,mfa_required,must_change_password,password_expires_at)
		 VALUES(?,?,?,'owner',?,1,1,1,datetime('now','+7 days'))`,
	).bind(email, String(body.name ?? "Owner"), await hashPassword(password), lang).run();
	await auditDb(env, null, "admin.bootstrap", { email }, request);
	return jsonResponse({ ok: true, email, role: "owner", mfa_enrollment_required: true }, 201);
}

async function login(request: Request, env: AdminWorkerEnv, lang: Locale): Promise<Response> {
	const body = await jsonObject(request);
	const email = String(body.email ?? "").trim().toLowerCase();
	const password = String(body.password ?? "");
	const ip = request.headers.get("cf-connecting-ip") ?? "noip";
	if (!(await checkRateLimit(env, `adminlogin:ip:${ip}`, 30, 300))) return jsonResponse({ error: "rate_limited" }, 429);
	if (email && !(await checkRateLimit(env, `adminlogin:account:${email}`, 10, 900))) return jsonResponse({ error: "rate_limited" }, 429);
	if (!(await checkRateLimit(env, `adminlogin:${ip}:${email}`, 15, 300))) return jsonResponse({ error: "rate_limited" }, 429);
	const row = await env.orderak_db.prepare("SELECT * FROM admin_users WHERE email=? AND active=1").bind(email).first<AdminRow>();
	const ok = await verifyPassword(password, row?.password_hash ?? "pbkdf2$100000$AAAA$AAAA");
	if (!row || !ok) {
		await auditDb(env, null, "admin.login_failed", { email }, request);
		return jsonResponse({ error: "bad_credentials", message: t(lang, "admin.login.bad") }, 401);
	}
	if (passwordNeedsRehash(row.password_hash)) {
		const refreshedHash = await hashPassword(password);
		await env.orderak_db.prepare(
			"UPDATE admin_users SET password_hash=?,updated_at=datetime('now') WHERE id=?",
		).bind(refreshedHash, row.id).run();
		row.password_hash = refreshedHash;
	}
	if (row.must_change_password === 1 && row.password_expires_at && Date.parse(`${row.password_expires_at.replace(" ", "T")}Z`) <= Date.now()) {
		await auditDb(env, claims(row), "admin.handoff_password_expired", {}, request);
		return jsonResponse({ error: "handoff_password_expired" }, 403);
	}
	if (!row.totp_enabled) return beginEnrollment(env, row);
	const challenge = await createAdminChallenge(env, "mfa", row.id, MFA_CHALLENGE_SECONDS);
	return jsonResponse({ ok: true, mfa_required: true, mfa_token: challenge, message: t(lang, "admin.login.mfa_required") });
}

async function beginEnrollment(env: AdminWorkerEnv, row: AdminRow): Promise<Response> {
	const activeKey = currentTotpKey(env);
	if (!activeKey) return jsonResponse({ error: "server_misconfigured", detail: "admin TOTP key unavailable" }, 500);
	const secret = generateTotpSecret();
	const encrypted = await encryptSecret(secret, activeKey.key, activeKey.version);
	await env.orderak_db.prepare(
		"UPDATE admin_users SET totp_secret=NULL,totp_secret_ciphertext=?,totp_key_version=?,totp_enabled=0 WHERE id=?",
	).bind(encrypted, activeKey.version, row.id).run();
	const token = await createAdminChallenge(env, "enrollment", row.id, 10 * 60);
	return jsonResponse({ ok: true, mfa_enrollment_required: true, enrollment_token: token, secret, otpauth_uri: totpUri(secret, row.email) });
}

async function mfa(request: Request, env: AdminWorkerEnv, lang: Locale): Promise<Response> {
	const body = await jsonObject(request);
	const challenge = String(body.mfa_token ?? "");
	const code = String(body.code ?? "");
	const loaded = await loadAdminChallenge(env, "mfa", challenge);
	if (!loaded) return jsonResponse({ error: "expired", message: t(lang, "admin.login.mfa_bad") }, 401);
	if (!(await checkRateLimit(env, `mfatry:${loaded.id}`, 5, 300))) {
		await consumeAdminChallenge(env, loaded.id, "mfa", loaded.adminId);
		return jsonResponse({ error: "expired" }, 401);
	}
	const row = await env.orderak_db.prepare("SELECT * FROM admin_users WHERE id=? AND active=1").bind(loaded.adminId).first<AdminRow>();
	const secret = row ? await totpSecret(env, row) : null;
	if (!row || !secret || !(await verifyTotp(secret, code))) {
		await auditDb(env, null, "admin.mfa_failed", { email: row?.email }, request);
		return jsonResponse({ error: "bad_code", message: t(lang, "admin.login.mfa_bad") }, 401);
	}
	if (!(await consumeAdminChallenge(env, loaded.id, "mfa", row.id))) {
		return jsonResponse({ error: "expired", message: t(lang, "admin.login.mfa_bad") }, 401);
	}
	return issueSession(env, row, request);
}

async function enrollMfa(request: Request, env: AdminWorkerEnv, lang: Locale): Promise<Response> {
	const body = await jsonObject(request);
	const token = String(body.enrollment_token ?? "");
	const loaded = await loadAdminChallenge(env, "enrollment", token);
	if (!loaded) return jsonResponse({ error: "expired" }, 401);
	if (!(await checkRateLimit(env, `enrolltry:${loaded.id}`, 5, 600))) return jsonResponse({ error: "rate_limited" }, 429);
	const row = await env.orderak_db.prepare("SELECT * FROM admin_users WHERE id=? AND active=1").bind(loaded.adminId).first<AdminRow>();
	const secret = row ? await totpSecret(env, row) : null;
	if (!row || !secret || !(await verifyTotp(secret, String(body.code ?? "")))) return jsonResponse({ error: "bad_code", message: t(lang, "admin.login.mfa_bad") }, 400);
	if (!(await consumeAdminChallenge(env, loaded.id, "enrollment", row.id))) return jsonResponse({ error: "expired" }, 401);
	await env.orderak_db.prepare("UPDATE admin_users SET totp_enabled=1,mfa_required=1,recovery_codes_acknowledged_at=NULL,updated_at=datetime('now') WHERE id=?").bind(row.id).run();
	const recoveryCodes = await replaceRecoveryCodes(env, row.id);
	await auditDb(env, claims(row), "admin.mfa_enrolled", {}, request);
	return issueSession(env, { ...row, totp_enabled: 1 }, request, recoveryCodes);
}

async function recoverMfa(request: Request, env: AdminWorkerEnv, lang: Locale): Promise<Response> {
	const body = await jsonObject(request);
	const email = String(body.email ?? "").trim().toLowerCase();
	const password = String(body.password ?? "");
	const code = String(body.recovery_code ?? "").replace(/\s/g, "").toUpperCase();
	const ip = request.headers.get("cf-connecting-ip") ?? "noip";
	if (!(await checkRateLimit(env, `adminrecovery:${ip}:${email}`, 5, 900))) return jsonResponse({ error: "rate_limited" }, 429);
	if (email && !(await checkRateLimit(env, `adminrecovery:account:${email}`, 5, 900))) return jsonResponse({ error: "rate_limited" }, 429);
	const row = await env.orderak_db.prepare("SELECT * FROM admin_users WHERE email=? AND active=1").bind(email).first<AdminRow>();
	const pepper = recoveryPepper(env);
	if (!row || !pepper || !(await verifyPassword(password, row.password_hash))) return jsonResponse({ error: "recovery_failed" }, 401);
	if (passwordNeedsRehash(row.password_hash)) {
		const refreshedHash = await hashPassword(password);
		await env.orderak_db.prepare(
			"UPDATE admin_users SET password_hash=?,updated_at=datetime('now') WHERE id=?",
		).bind(refreshedHash, row.id).run();
	}
	const hash = await keyedHash(code, pepper);
	const found = await env.orderak_db.prepare("SELECT id FROM admin_recovery_codes WHERE admin_id=? AND code_hash=? AND used_at IS NULL").bind(row.id, hash).first<{ id: string }>();
	if (!found) return jsonResponse({ error: "recovery_failed" }, 401);
	await env.orderak_db.batch([
		env.orderak_db.prepare("UPDATE admin_recovery_codes SET used_at=datetime('now') WHERE id=?").bind(found.id),
		env.orderak_db.prepare("UPDATE admin_sessions SET revoked_at=datetime('now'),revocation_reason='mfa_recovery' WHERE admin_id=? AND revoked_at IS NULL").bind(row.id),
		env.orderak_db.prepare("UPDATE admin_users SET totp_enabled=0,totp_secret=NULL,totp_secret_ciphertext=NULL WHERE id=?").bind(row.id),
	]);
	await createSecurityAlert(env, "high", "mfa_recovery", `admin:${row.id}`, "Administrator used an MFA recovery code", { admin_id: row.id });
	await auditDb(env, claims(row), "admin.mfa_recovery", {}, request);
	return beginEnrollment(env, { ...row, totp_enabled: 0, totp_secret: null, totp_secret_ciphertext: null });
}

async function issueSession(env: AdminWorkerEnv, row: AdminRow, request: Request, recoveryCodes?: string[]): Promise<Response> {
	const pepper = sessionPepper(env);
	if (!pepper) return jsonResponse({ error: "server_misconfigured", detail: "ADMIN_SESSION_PEPPER not set" }, 500);
	const token = randomToken();
	const csrf = randomToken(24);
	const id = crypto.randomUUID();
	await env.orderak_db.batch([
		env.orderak_db.prepare(
			`INSERT INTO admin_sessions(id,admin_id,token_hash,csrf_hash,expires_at,idle_expires_at,ip,user_agent,last_used_at)
			 VALUES(?,?,?,?,datetime('now',?),datetime('now',?),?,?,datetime('now'))`,
		).bind(id, row.id, await keyedHash(token, pepper), await keyedHash(csrf, pepper), `+${ABSOLUTE_SECONDS} seconds`, `+${IDLE_SECONDS} seconds`, request.headers.get("cf-connecting-ip"), request.headers.get("user-agent")),
		env.orderak_db.prepare("UPDATE admin_users SET last_login_at=datetime('now') WHERE id=?").bind(row.id),
	]);
	await auditDb(env, claims(row, id), "admin.login_ok", {}, request);
	const response = sessionResponse(row, csrf, recoveryCodes);
	return withSessionCookie(response, token, request);
}

function sessionResponse(row: AdminRow, csrf: string, recoveryCodes?: string[]): Response {
	const payload: AdminSessionResponse & { recovery_codes?: string[] } = {
		ok: true,
		admin: {
			id: row.id,
			email: row.email,
			name: row.name,
			role: row.role,
			lang: row.lang,
			timezone: row.timezone || "Africa/Cairo",
			mfaEnabled: row.totp_enabled === 1,
			mustChangePassword: row.must_change_password === 1,
			recoveryCodesAcknowledged: Boolean(row.recovery_codes_acknowledged_at),
		},
		permissions: permissionsForRole(row.role),
		csrf_token: csrf,
		server_time: new Date().toISOString(),
		...(recoveryCodes ? { recovery_codes: recoveryCodes } : {}),
	};
	return jsonResponse(payload);
}

async function logout(request: Request, env: AdminWorkerEnv): Promise<Response> {
	const admin = await resolveAdmin(request, env);
	if (admin) {
		const invalid = await validateAdminMutation(request, env, admin);
		if (invalid) return invalid;
	}
	if (admin?.sid) await env.orderak_db.prepare("UPDATE admin_sessions SET revoked_at=datetime('now'),revocation_reason='logout' WHERE id=?").bind(admin.sid).run();
	await auditDb(env, admin, "admin.logout", {}, request);
	return withSessionCookie(jsonResponse({ ok: true }), "", request, 0);
}

async function changePassword(request: Request, env: AdminWorkerEnv, lang: Locale): Promise<Response> {
	const admin = await resolveAdmin(request, env);
	if (!admin) return jsonResponse({ error: "unauthorized" }, 401);
	const invalid = await validateAdminMutation(request, env, admin); if (invalid) return invalid;
	const body = await jsonObject(request);
	const currentPassword = String(body.current_password ?? "");
	const newPassword = String(body.new_password ?? "");
	const code = String(body.totp_code ?? "");
	if (newPassword.length < MIN_PASSWORD_LEN) return jsonResponse({ error: "weak_password", message: t(lang, "admin.password.weak") }, 400);
	const row = await env.orderak_db.prepare("SELECT * FROM admin_users WHERE id=? AND active=1").bind(admin.sub).first<AdminRow>();
	const secret = row ? await totpSecret(env, row) : null;
	if (!row || !secret || !(await verifyPassword(currentPassword, row.password_hash)) || !(await verifyTotp(secret, code))) {
		await auditDb(env, admin, "admin.password_change_failed", {}, request);
		return jsonResponse({ error: "fresh_auth_failed" }, 403);
	}
	await env.orderak_db.batch([
		env.orderak_db.prepare("UPDATE admin_users SET password_hash=?,must_change_password=0,password_expires_at=NULL,updated_at=datetime('now') WHERE id=?").bind(await hashPassword(newPassword), row.id),
		env.orderak_db.prepare("UPDATE admin_sessions SET revoked_at=datetime('now'),revocation_reason='password_changed' WHERE admin_id=? AND id<>? AND revoked_at IS NULL").bind(row.id, admin.sid ?? ""),
	]);
	await auditDb(env, admin, "admin.password_changed", {}, request);
	return jsonResponse({ ok: true });
}

async function acknowledgeRecoveryCodes(request: Request, env: AdminWorkerEnv): Promise<Response> {
	const admin = await resolveAdmin(request, env);
	if (!admin?.sid) return jsonResponse({ error: "unauthorized" }, 401);
	const invalid = await validateAdminMutation(request, env, admin); if (invalid) return invalid;
	const row = await env.orderak_db.prepare("SELECT totp_enabled FROM admin_users WHERE id=?").bind(admin.sub).first<{ totp_enabled: number }>();
	if (!row?.totp_enabled) return jsonResponse({ error: "mfa_enrollment_required" }, 409);
	await env.orderak_db.prepare("UPDATE admin_users SET recovery_codes_acknowledged_at=datetime('now'),updated_at=datetime('now') WHERE id=?").bind(admin.sub).run();
	await auditDb(env, admin, "admin.recovery_codes_acknowledged", { entity: "admin", entity_id: admin.sub }, request);
	return jsonResponse({ ok: true });
}

async function regenerateRecoveryCodes(request: Request, env: AdminWorkerEnv, _lang: Locale): Promise<Response> {
	const admin = await resolveAdmin(request, env);
	if (!admin) return jsonResponse({ error: "unauthorized" }, 401);
	const invalid = await validateAdminMutation(request, env, admin); if (invalid) return invalid;
	const body = await jsonObject(request);
	const row = await env.orderak_db.prepare("SELECT * FROM admin_users WHERE id=?").bind(admin.sub).first<AdminRow>();
	const secret = row ? await totpSecret(env, row) : null;
	if (!row || !secret || !(await verifyPassword(String(body.current_password ?? ""), row.password_hash)) || !(await verifyTotp(secret, String(body.totp_code ?? "")))) return jsonResponse({ error: "fresh_auth_failed" }, 403);
	const codes = await replaceRecoveryCodes(env, row.id);
	await auditDb(env, admin, "admin.recovery_codes_regenerated", {}, request);
	return jsonResponse({ ok: true, recovery_codes: codes });
}

async function replaceRecoveryCodes(env: AdminWorkerEnv, adminId: number): Promise<string[]> {
	const pepper = recoveryPepper(env);
	if (!pepper) throw new Error("ADMIN_RECOVERY_PEPPER not set");
	const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomToken(12).replace(/[-_]/g, "").slice(0, 16).toUpperCase());
	const statements = [
		env.orderak_db.prepare("DELETE FROM admin_recovery_codes WHERE admin_id=?").bind(adminId),
		env.orderak_db.prepare("UPDATE admin_users SET recovery_codes_acknowledged_at=NULL,updated_at=datetime('now') WHERE id=?").bind(adminId),
	];
	for (const code of codes) statements.push(env.orderak_db.prepare("INSERT INTO admin_recovery_codes(id,admin_id,code_hash) VALUES(?,?,?)").bind(crypto.randomUUID(), adminId, await keyedHash(code, pepper)));
	await env.orderak_db.batch(statements);
	return codes;
}

async function resetPassword(request: Request, env: AdminWorkerEnv, lang: Locale): Promise<Response> {
	const denied = requireBreakGlassAccess(request, env);
	if (denied) return denied;
	const body = await jsonObject(request);
	const email = String(body.email ?? "").trim().toLowerCase();
	const password = String(body.new_password ?? "");
	const ticket = String(body.incident_id ?? "").trim();
	if (!email || password.length < MIN_PASSWORD_LEN || !ticket) return jsonResponse({ error: "email_strong_password_and_incident_required" }, 400);
	const row = await env.orderak_db.prepare("SELECT id FROM admin_users WHERE email=?").bind(email).first<{ id: number }>();
	if (!row) return jsonResponse({ error: "not_found" }, 404);
	await env.orderak_db.batch([
		env.orderak_db.prepare("UPDATE admin_users SET password_hash=?,totp_secret=NULL,totp_secret_ciphertext=NULL,totp_enabled=0,recovery_codes_acknowledged_at=NULL,must_change_password=1,password_expires_at=datetime('now','+7 days') WHERE id=?").bind(await hashPassword(password), row.id),
		env.orderak_db.prepare("UPDATE admin_sessions SET revoked_at=datetime('now'),revocation_reason='break_glass' WHERE admin_id=? AND revoked_at IS NULL").bind(row.id),
		env.orderak_db.prepare("DELETE FROM admin_recovery_codes WHERE admin_id=?").bind(row.id),
	]);
	await createSecurityAlert(env, "critical", "break_glass", `admin:${row.id}`, "Break-glass administrator recovery used", { admin_id: row.id, incident_id: ticket });
	await auditDb(env, null, "admin.break_glass", { entity: "admin", entity_id: row.id, incident_id: ticket }, request);
	return jsonResponse({ ok: true, email, mfa_reenrollment_required: true });
}

export async function createSecurityAlert(env: AdminWorkerEnv, severity: string, kind: string, fingerprint: string, title: string, details: Record<string, unknown>): Promise<void> {
	const current = await env.orderak_db.prepare("SELECT id FROM security_alerts WHERE fingerprint=? AND status='open' AND last_seen_at>datetime('now','-15 minutes') ORDER BY last_seen_at DESC LIMIT 1").bind(fingerprint).first<{ id: string }>();
	if (current) {
		await env.orderak_db.prepare("UPDATE security_alerts SET occurrence_count=occurrence_count+1,last_seen_at=datetime('now'),details_json=? WHERE id=?").bind(JSON.stringify(details), current.id).run();
	} else {
		await env.orderak_db.prepare("INSERT INTO security_alerts(id,severity,kind,fingerprint,title,details_json) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), severity, kind, fingerprint, title, JSON.stringify(details)).run();
	}
}

function withSessionCookie(response: Response, token: string, request: Request, maxAge = ABSOLUTE_SECONDS): Response {
	const secure = new URL(request.url).protocol === "https:";
	const name = secure ? "__Host-orderak_admin_session" : "orderak_admin_session";
	const headers = new Headers(response.headers);
	headers.append("set-cookie", `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export { ALL_ROLES };
