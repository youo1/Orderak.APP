// ============================================================
// Admin authentication: PBKDF2 passwords, RFC-6238 TOTP 2FA,
// HS256 JWT sessions, and role-based access control (RBAC).
//
// All crypto uses WebCrypto (crypto.subtle) — no npm deps, runs
// natively on the Cloudflare edge. Beginner-friendly and self-contained.
// ============================================================

// ---------- base64url helpers ----------

export function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
	const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let s = "";
	for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
	s = s.replace(/-/g, "+").replace(/_/g, "/");
	while (s.length % 4) s += "=";
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

const enc = new TextEncoder();

/** Cryptographically secure URL-safe token. */
export function randomToken(byteLength = 32): string {
	return b64urlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** Keyed hash for opaque sessions, recovery codes, invitations, and CSRF. */
export async function keyedHash(value: string, pepper: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(pepper),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return b64urlEncode(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}

async function aesKey(base64Key: string, usage: Array<"encrypt" | "decrypt">): Promise<CryptoKey> {
	const raw = b64urlDecode(base64Key);
	if (raw.byteLength !== 32) throw new Error("admin_totp_key_must_be_32_bytes");
	return crypto.subtle.importKey("raw", raw, "AES-GCM", false, usage);
}

/** AES-256-GCM secret envelope: version.iv.ciphertext (all URL-safe base64). */
export async function encryptSecret(value: string, base64Key: string, version: number): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(base64Key, ["encrypt"]), enc.encode(value));
	return `${version}.${b64urlEncode(iv)}.${b64urlEncode(encrypted)}`;
}

export async function decryptSecret(envelope: string, keyForVersion: (version: number) => string | undefined): Promise<string> {
	const [versionRaw, ivRaw, cipherRaw] = envelope.split(".");
	const version = Number(versionRaw);
	const keyValue = keyForVersion(version);
	if (!Number.isInteger(version) || !ivRaw || !cipherRaw || !keyValue) throw new Error("admin_totp_key_unavailable");
	const clear = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: b64urlDecode(ivRaw) },
		await aesKey(keyValue, ["decrypt"]),
		b64urlDecode(cipherRaw),
	);
	return new TextDecoder().decode(clear);
}

// ---------- PBKDF2 password hashing ----------

// Cloudflare Workers WebCrypto rejects PBKDF2 iteration counts above 100,000.
// Passwords also require MFA, so keep the portable maximum and prevent an
// automatic rehash from turning a valid password into a server error.
export const ADMIN_PBKDF2_ITERATIONS = 100_000;

/** Hash a password → "pbkdf2$<iter>$<saltB64url>$<hashB64url>". */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const bits = await deriveBits(password, salt, ADMIN_PBKDF2_ITERATIONS);
	return `pbkdf2$${ADMIN_PBKDF2_ITERATIONS}$${b64urlEncode(salt)}$${b64urlEncode(bits)}`;
}

/** Verify a password against a stored "pbkdf2$..." string (constant-time). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
	const iter = parseInt(parts[1], 10) || ADMIN_PBKDF2_ITERATIONS;
	const salt = b64urlDecode(parts[2]);
	const expected = b64urlDecode(parts[3]);
	const actual = new Uint8Array(await deriveBits(password, salt, iter));
	return timingSafeEqual(actual, expected);
}

export function passwordNeedsRehash(stored: string): boolean {
	const parts = stored.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2") return true;
	const iter = parseInt(parts[1], 10);
	return !Number.isFinite(iter) || iter < ADMIN_PBKDF2_ITERATIONS;
}

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
	const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
	return crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
		key,
		256,
	);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

// ---------- HS256 JWT (admin session tokens) ----------

export interface AdminClaims {
	sub: number; // admin id
	email: string;
	role: AdminRole;
	name?: string;
	lang?: string;
	sid?: string;
	exp: number; // unix seconds
	iat: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
		"verify",
	]);
}

/** Sign an admin JWT valid for `ttlSec` seconds (default 8h). */
export async function signJwt(claims: Omit<AdminClaims, "exp" | "iat">, secret: string, ttlSec = 28800): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "HS256", typ: "JWT" };
	const payload: AdminClaims = { ...claims, iat: now, exp: now + ttlSec };
	const h = b64urlEncode(enc.encode(JSON.stringify(header)));
	const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
	const data = `${h}.${p}`;
	const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data));
	return `${data}.${b64urlEncode(sig)}`;
}

/** Verify a JWT and return its claims, or null if invalid/expired. */
export async function verifyJwt(token: string, secret: string): Promise<AdminClaims | null> {
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	const data = `${parts[0]}.${parts[1]}`;
	const ok = await crypto.subtle.verify(
		"HMAC",
		await hmacKey(secret),
		b64urlDecode(parts[2]),
		enc.encode(data),
	);
	if (!ok) return null;
	try {
		const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as AdminClaims;
		if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
		return claims;
	} catch {
		return null;
	}
}

// ---------- RFC-6238 TOTP (Google Authenticator compatible) ----------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a random base32 TOTP secret. */
export function generateTotpSecret(len = 20): string {
	const bytes = crypto.getRandomValues(new Uint8Array(len));
	let bits = "";
	for (const b of bytes) bits += b.toString(2).padStart(8, "0");
	let out = "";
	for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
	return out;
}

function base32Decode(s: string): Uint8Array {
	s = s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
	let bits = "";
	for (const c of s) {
		const idx = B32.indexOf(c);
		if (idx < 0) continue;
		bits += idx.toString(2).padStart(5, "0");
	}
	const out = new Uint8Array(Math.floor(bits.length / 8));
	for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
	return out;
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
	const buf = new ArrayBuffer(8);
	const view = new DataView(buf);
	// JS bitwise is 32-bit; write high/low separately.
	view.setUint32(0, Math.floor(counter / 2 ** 32));
	view.setUint32(4, counter >>> 0);
	const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
	const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
	const offset = hmac[hmac.length - 1] & 0x0f;
	const bin =
		((hmac[offset] & 0x7f) << 24) |
		((hmac[offset + 1] & 0xff) << 16) |
		((hmac[offset + 2] & 0xff) << 8) |
		(hmac[offset + 3] & 0xff);
	return (bin % 1_000_000).toString().padStart(6, "0");
}

/** Verify a 6-digit TOTP code, allowing ±1 step (30s) of clock drift. */
export async function verifyTotp(secretB32: string, code: string, step = 30, window = 1): Promise<boolean> {
	if (!/^\d{6}$/.test(code)) return false;
	const secret = base32Decode(secretB32);
	const counter = Math.floor(Date.now() / 1000 / step);
	for (let w = -window; w <= window; w++) {
		if (await hotp(secret, counter + w) === code) return true;
	}
	return false;
}

/** Build an otpauth:// URI for QR enrollment. */
export function totpUri(secretB32: string, account: string, issuer = "Orderak"): string {
	const label = encodeURIComponent(`${issuer}:${account}`);
	const params = new URLSearchParams({ secret: secretB32, issuer, algorithm: "SHA1", digits: "6", period: "30" });
	return `otpauth://totp/${label}?${params.toString()}`;
}

/** sha256 hex, used for short-lived MFA challenge tokens etc. */
export async function sha256Hex(s: string): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
	return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- RBAC ----------

export type AdminRole = "owner" | "finance" | "support" | "readonly";

/**
 * Permission strings are "<resource>:<action>".
 * "*" means all. A role's set is checked by hasPermission().
 */
const ROLE_PERMISSIONS: Record<AdminRole, string[]> = {
	owner: ["*"],
	finance: [
		"dashboard:view",
		"sellers:view",
		"subscriptions:view",
		"subscriptions:manage",
		"plans:view",
		"plans:draft",
		"coupons:view",
		"coupons:manage",
		"affiliate:view",
		"affiliate:manage",
		"payouts:view",
		"payouts:manage",
		"ads:view",
		"analytics:view",
		"export:view",
		"export:manage",
		"audit:view",
		"emails:view",
		"emails:manage",
		"operations:view",
		"buyers:view",
		"flags:view",
		"versions:view",
		"capabilities:view",
		"content:view",
		"project:view",
		"theme:view",
	],
	support: [
		"dashboard:view",
		"sellers:view",
		"sellers:manage",
		"subscriptions:view",
		"support:view",
		"support:manage",
		"announcements:view",
		"announcements:manage",
		"content:view",
		"ads:view",
		"emails:view",
		"emails:manage",
		"deletions:view",
		"deletions:manage",
		"translations:view",
		"translations:manage",
		"devices:view",
		"devices:manage",
		"operations:view",
		"buyers:view",
		"buyers:manage",
		"flags:view",
		"versions:view",
		"capabilities:view",
		"project:view",
		"theme:view",
	],

	readonly: [
		"dashboard:view",
		"sellers:view",
		"subscriptions:view",
		"plans:view",
		"coupons:view",
		"affiliate:view",
		"payouts:view",
		"ads:view",
		"content:view",
		"announcements:view",
		"support:view",
		"analytics:view",
		"audit:view",
		"deletions:view",
		"translations:view",
		"devices:view",
		"operations:view",
		"buyers:view",
		"flags:view",
		"versions:view",
		"capabilities:view",
		"project:view",
		"errors:view",
		"theme:view",
	],
};

/** Does a role grant a permission? */
export function hasPermission(role: AdminRole, permission: string): boolean {
	const perms = ROLE_PERMISSIONS[role];
	if (!perms) return false;
	if (perms.includes("*")) return true;
	if (perms.includes(permission)) return true;
	if (permission === "theme:view" && (perms.includes("theme:manage") || perms.includes("theme:rollback"))) return true;
	if (permission === "theme:manage" && perms.includes("theme:rollback")) return true;
	// allow "resource:*" wildcards
	const resource = permission.split(":")[0];
	const internalReadResources = new Set(["roadmap", "tasks", "releases", "bugs", "screens", "endpoints", "prompts", "design", "docs"]);
	if (permission.endsWith(":view") && perms.includes("project:view") && internalReadResources.has(resource)) return true;
	return perms.includes(`${resource}:*`);
}

/** The full permission list for a role (for the UI to hide/show sections). */
export function permissionsForRole(role: AdminRole): string[] {
	return ROLE_PERMISSIONS[role] ?? [];
}

export const ALL_ROLES: AdminRole[] = ["owner", "finance", "support", "readonly"];
