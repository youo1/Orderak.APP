import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { handleAuthV2Routes, handleEmailVerification } from "../src/domains/identity/auth-v2";
import { sha256Hex } from "../src/domains/identity/auth";
import { createSchema } from "./helpers";

// randomToken() is mocked to a deterministic, logged sequence so a test can
// learn the raw token behind an email-change link without depending on how
// (or whether) the email transport is mocked, and without needing to know the
// name of the pending-email-change table the implementer chooses.
const { generatedTokens, nextToken } = vi.hoisted(() => {
	const generatedTokens: string[] = [];
	let counter = 0;
	return {
		generatedTokens,
		nextToken: () => {
			const token = `test-token-${counter++}`;
			generatedTokens.push(token);
			return token;
		},
	};
});
vi.mock("../src/domains/identity/auth", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/domains/identity/auth")>();
	return { ...actual, randomToken: nextToken };
});

const DEVICE_SECRET = "device-secret-with-enough-entropy";
let testEnv: TestEnv;
let firebasePhone = "";
let phoneSeq = 9000;

function uniquePhone(): string {
	phoneSeq += 1;
	return `+20100123${phoneSeq}`;
}

function freshFirebaseToken(): string {
	const payload = btoa(JSON.stringify({ auth_time: Math.floor(Date.now() / 1000) }))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
	return `header.${payload}.signature`;
}

async function routePost(
	path: string,
	body: Record<string, unknown>,
	headers: Record<string, string> = {},
): Promise<Response> {
	const request = new Request(`https://api.orderak.app${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.90", ...headers },
		body: JSON.stringify(body),
	});
	const response = await handleAuthV2Routes(request, testEnv, new URL(request.url), createExecutionContext());
	if (!response) throw new Error(`route_not_handled:${path}`);
	return response;
}

async function profile(
	method: "GET" | "PATCH",
	body: Record<string, unknown> | null,
	headers: Record<string, string>,
): Promise<Response> {
	const init: RequestInit = { method, headers: { "cf-connecting-ip": "203.0.113.90", ...headers } };
	if (body != null) {
		init.headers = { ...(init.headers as Record<string, string>), "content-type": "application/json" };
		init.body = JSON.stringify(body);
	}
	const request = new Request("https://api.orderak.app/api/v1/account/profile", init);
	const response = await handleAuthV2Routes(request, testEnv, new URL(request.url), createExecutionContext());
	if (!response) throw new Error("route_not_handled:/api/v1/account/profile");
	return response;
}

async function verifyLink(token: string): Promise<Response> {
	const request = new Request(`https://orderak.app/verify-email?token=${encodeURIComponent(token)}`);
	const response = await handleEmailVerification(request, testEnv, new URL(request.url));
	if (!response) throw new Error("route_not_handled:/verify-email");
	return response;
}

interface Account {
	phone: string;
	recentAuth: string;
}

async function onboardSeller(fullName: string, email?: string): Promise<Account> {
	const phone = uniquePhone();
	firebasePhone = phone;
	const started = await routePost("/api/v1/auth/phone/complete", {
		id_token: freshFirebaseToken(),
		phone,
		device_secret: DEVICE_SECRET,
	});
	expect(started.status).toBe(200);
	const onboardingToken = String((await started.json<Record<string, unknown>>()).onboarding_token);
	const auth = { authorization: `Bearer ${onboardingToken}` };
	const accountBody: Record<string, unknown> = { full_name: fullName, age_confirmed: true, terms_accepted: true };
	if (email) accountBody.email = email;
	const account = await routePost("/api/v1/onboarding/account", accountBody, auth);
	expect(account.status).toBe(200);
	const completed = await routePost("/api/v1/onboarding/complete", {
		device_secret: DEVICE_SECRET,
		store_name: `${fullName} Shop`,
		country_iso: "EG",
	}, auth);
	expect(completed.status).toBe(200);
	const body = await completed.json<Record<string, unknown>>();
	return { phone, recentAuth: String(body.recent_auth_token) };
}

function creds(account: Account, extra: Record<string, string> = {}): Record<string, string> {
	return { "x-orderak-phone": account.phone, "x-orderak-secret": DEVICE_SECRET, ...extra };
}

function credsWithAuth(account: Account): Record<string, string> {
	return creds(account, { "x-orderak-recent-auth": account.recentAuth });
}

beforeEach(async () => {
	await createSchema();
	firebasePhone = "";
	testEnv = Object.create(env) as TestEnv;
	testEnv.FIREBASE_WEB_API_KEY = "test-key";
	testEnv.ONBOARDING_ENABLED = "true";
	testEnv.STATIC_CITY_CATALOG_ENABLED = "true";
	vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (!url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup")) {
			throw new Error(`unexpected_fetch:${url}`);
		}
		// Each onboarding seller gets its own Firebase UID, derived from its own
		// phone. idx_auth_identity_provider_subject (migration 032) is unique on
		// (provider, provider_subject); a shared localId across sellers would
		// make every multi-seller case in this file fail on that constraint
		// before it ever reached an email assertion.
		return Response.json({ users: [{ localId: `firebase-uid-${firebasePhone}`, phoneNumber: firebasePhone }] });
	}));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("GET/PATCH /api/v1/account/profile", () => {
	it("changes the name immediately without recent auth, and GET reflects it; an invalid name is rejected unchanged", async () => {
		const seller = await onboardSeller("Original Name", "original@example.com");

		const invalid = await profile("PATCH", { full_name: "ab" }, creds(seller));
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toMatchObject({ code: "invalid_full_name" });

		const patched = await profile("PATCH", { full_name: "Updated Name" }, creds(seller));
		expect(patched.status).toBe(200);
		expect(await patched.json()).toEqual({
			full_name: "Updated Name",
			email_private: "original@example.com",
			email_verified: false,
			pending_email_private: null,
		});

		const got = await profile("GET", null, creds(seller));
		expect(await got.json()).toEqual({
			full_name: "Updated Name",
			email_private: "original@example.com",
			email_verified: false,
			pending_email_private: null,
		});
	});

	it("keeps the current email until the change link is opened, then swaps it exactly once", async () => {
		const seller = await onboardSeller("Email Seller", "old@example.com");

		const patched = await profile("PATCH", { email_private: "new@example.com" }, credsWithAuth(seller));
		expect(patched.status).toBe(200);
		expect(await patched.json()).toEqual({
			full_name: "Email Seller",
			email_private: "old@example.com",
			email_verified: false,
			pending_email_private: "new@example.com",
		});

		const beforeConfirm = await profile("GET", null, creds(seller));
		expect(await beforeConfirm.json()).toMatchObject({
			email_private: "old@example.com",
			pending_email_private: "new@example.com",
		});

		const token = generatedTokens[generatedTokens.length - 1];
		const confirmed = await verifyLink(token);
		expect(confirmed.status).toBe(200);

		const afterConfirm = await profile("GET", null, creds(seller));
		expect(await afterConfirm.json()).toEqual({
			full_name: "Email Seller",
			email_private: "new@example.com",
			email_verified: true,
			pending_email_private: null,
		});

		const replay = await verifyLink(token);
		expect(replay.status).toBe(400);
		const stillConfirmed = await profile("GET", null, creds(seller));
		expect(await stillConfirmed.json()).toMatchObject({ email_private: "new@example.com" });
	});

	it("a newer email-change request supersedes the earlier pending link", async () => {
		const seller = await onboardSeller("Supersede Seller", "orig@example.com");

		await profile("PATCH", { email_private: "first@example.com" }, credsWithAuth(seller));
		const firstToken = generatedTokens[generatedTokens.length - 1];

		const second = await profile("PATCH", { email_private: "second@example.com" }, credsWithAuth(seller));
		expect(second.status).toBe(200);
		const secondToken = generatedTokens[generatedTokens.length - 1];
		expect(secondToken).not.toBe(firstToken);

		const staleConfirm = await verifyLink(firstToken);
		expect(staleConfirm.status).toBe(400);
		const stillPending = await profile("GET", null, creds(seller));
		expect(await stillPending.json()).toMatchObject({
			email_private: "orig@example.com",
			pending_email_private: "second@example.com",
		});

		const freshConfirm = await verifyLink(secondToken);
		expect(freshConfirm.status).toBe(200);
		const done = await profile("GET", null, creds(seller));
		expect(await done.json()).toMatchObject({ email_private: "second@example.com", pending_email_private: null });
	});

	it("confirmation refuses an address another seller acquired in the meantime, leaving the profile unchanged", async () => {
		const sellerA = await onboardSeller("Racer A", "a@example.com");
		const sellerB = await onboardSeller("Racer B", "b@example.com");

		const requestA = await profile("PATCH", { email_private: "race@example.com" }, credsWithAuth(sellerA));
		expect(requestA.status).toBe(200);
		const tokenA = generatedTokens[generatedTokens.length - 1];

		const requestB = await profile("PATCH", { email_private: "race@example.com" }, credsWithAuth(sellerB));
		expect(requestB.status).toBe(200);
		const tokenB = generatedTokens[generatedTokens.length - 1];

		const confirmB = await verifyLink(tokenB);
		expect(confirmB.status).toBe(200);

		const confirmA = await verifyLink(tokenA);
		expect(confirmA.status).toBe(400);

		const profileA = await profile("GET", null, creds(sellerA));
		expect(await profileA.json()).toEqual({
			full_name: "Racer A",
			email_private: "a@example.com",
			email_verified: false,
			pending_email_private: null,
		});
		const profileB = await profile("GET", null, creds(sellerB));
		expect(await profileB.json()).toMatchObject({ email_private: "race@example.com", email_verified: true });
	});

	it("refuses a pending email already used by another seller, case-insensitively, at request time", async () => {
		const sellerA = await onboardSeller("Requester", "req@example.com");
		await onboardSeller("Holder", "taken@example.com");

		const conflict = await profile("PATCH", { email_private: "TAKEN@EXAMPLE.COM" }, credsWithAuth(sellerA));
		expect(conflict.status).toBe(409);
		expect(await conflict.json()).toMatchObject({ code: "email_in_use" });

		const unchanged = await profile("GET", null, creds(sellerA));
		expect(await unchanged.json()).toEqual({
			full_name: "Requester",
			email_private: "req@example.com",
			email_verified: false,
			pending_email_private: null,
		});
	});

	it("requires recent authentication for an email change and rate-limits to three requests per rolling hour", async () => {
		const seller = await onboardSeller("Limited Seller", "limited@example.com");

		const noAuth = await profile("PATCH", { email_private: "attempt@example.com" }, creds(seller));
		expect(noAuth.status).toBe(401);
		expect(await noAuth.json()).toMatchObject({ code: "recent_auth_required" });

		for (const address of ["one@example.com", "two@example.com", "three@example.com"]) {
			const ok = await profile("PATCH", { email_private: address }, credsWithAuth(seller));
			expect(ok.status).toBe(200);
		}
		const limited = await profile("PATCH", { email_private: "four@example.com" }, credsWithAuth(seller));
		expect(limited.status).toBe(429);
		expect(await limited.json()).toMatchObject({ code: "rate_limited" });
	});

	it("an omitted email leaves it unchanged; an empty email is invalid; an email equal to the current one is a no-op that sends nothing", async () => {
		const seller = await onboardSeller("NoOp Seller", "current@example.com");

		const omitted = await profile("PATCH", { full_name: "NoOp Seller Two" }, creds(seller));
		expect(omitted.status).toBe(200);
		expect(await omitted.json()).toMatchObject({ email_private: "current@example.com", pending_email_private: null });

		const empty = await profile("PATCH", { email_private: "" }, credsWithAuth(seller));
		expect(empty.status).toBe(400);
		expect(await empty.json()).toMatchObject({ code: "invalid_email" });

		const before = generatedTokens.length;
		const sameEmail = await profile("PATCH", { email_private: "CURRENT@EXAMPLE.COM" }, creds(seller));
		expect(sameEmail.status).toBe(200);
		expect(await sameEmail.json()).toEqual({
			full_name: "NoOp Seller Two",
			email_private: "current@example.com",
			email_verified: false,
			pending_email_private: null,
		});
		expect(generatedTokens.length).toBe(before);
	});

	it("validates every supplied field before applying any change", async () => {
		const seller = await onboardSeller("Validate Seller", "validate@example.com");
		const before = generatedTokens.length;

		const response = await profile(
			"PATCH",
			{ full_name: "Valid New Name", email_private: "not-an-email" },
			credsWithAuth(seller),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "invalid_email" });
		expect(generatedTokens.length).toBe(before);

		const unchanged = await profile("GET", null, creds(seller));
		expect(await unchanged.json()).toEqual({
			full_name: "Validate Seller",
			email_private: "validate@example.com",
			email_verified: false,
			pending_email_private: null,
		});
	});

	it("an expired email-change link fails and leaves the profile unchanged", async () => {
		const seller = await onboardSeller("Expired Link Seller", "expired-current@example.com");
		const sellerRow = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?")
			.bind(seller.phone).first<{ id: string }>();
		const rawToken = "expired-pending-email-token";
		await env.orderak_db.prepare(
			`INSERT INTO pending_email_changes(id,seller_id,email,token_hash,created_at,expires_at,used_at,superseded_at)
			 VALUES(?,?,?,?,datetime('now','-2 days'),datetime('now','-1 day'),NULL,NULL)`,
		).bind(crypto.randomUUID(), sellerRow!.id, "expired-new@example.com", await sha256Hex(rawToken)).run();

		const result = await verifyLink(rawToken);
		expect(result.status).toBe(400);

		const unchanged = await profile("GET", null, creds(seller));
		expect(await unchanged.json()).toMatchObject({
			email_private: "expired-current@example.com",
			pending_email_private: null,
		});
	});

	it("an unknown email-change link fails and leaves the profile unchanged", async () => {
		const seller = await onboardSeller("Unknown Link Seller", "unknown-link@example.com");

		const result = await verifyLink("this-token-was-never-issued-by-anything");
		expect(result.status).toBe(400);

		const unchanged = await profile("GET", null, creds(seller));
		expect(await unchanged.json()).toMatchObject({
			email_private: "unknown-link@example.com",
			pending_email_private: null,
		});
	});

	it("a verification link for an address the seller has since replaced reports failure, not success", async () => {
		const seller = await onboardSeller("Replaced Address Seller", "replaced@example.com");
		const sellerRow = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?")
			.bind(seller.phone).first<{ id: string }>();
		// An unused resend link for the original address, issued before the change.
		const oldLink = "link-for-the-replaced-address";
		await env.orderak_db.prepare(
			`INSERT INTO email_verification_tokens(id,seller_id,email,token_hash,kind,expires_at)
			 VALUES(?,?,?,?,'resend',datetime('now','+24 hours'))`,
		).bind(crypto.randomUUID(), sellerRow!.id, "replaced@example.com", await sha256Hex(oldLink)).run();

		await profile("PATCH", { email_private: "replacement@example.com" }, credsWithAuth(seller));
		const confirmed = await verifyLink(generatedTokens[generatedTokens.length - 1]);
		expect(confirmed.status).toBe(200);

		// The trigger from migration 033 matches the current address, so this link
		// can verify nothing; the page must not tell the seller it did.
		const stale = await verifyLink(oldLink);
		expect(stale.status).toBe(400);
		const after = await profile("GET", null, creds(seller));
		expect(await after.json()).toMatchObject({ email_private: "replacement@example.com", email_verified: true });
	});
});

describe("Migration 063 clears stored birth years", () => {
	// 063_clear_stored_birth_years.sql does not exist on the unchanged tree, so
	// this glob matches nothing until the migration is added — a glob over a
	// not-yet-existing path is valid and lets this test fail cleanly before the
	// change instead of refusing to compile.
	const MIGRATION_063 = import.meta.glob("../migrations/063_clear_stored_birth_years.sql", {
		query: "?raw",
		import: "default",
		eager: true,
	}) as Record<string, string>;

	it("marks eligible legacy account_saved sessions before nulling birth years, and never drops either column", () => {
		const files = Object.values(MIGRATION_063);
		expect(files).toHaveLength(1);
		const sql = files[0];
		expect(sql).not.toMatch(/drop\s+column/i);

		// Checked at statement level, not by character offset: the marking
		// statement ("UPDATE onboarding_sessions SET age_confirmation_source=…")
		// and the onboarding_sessions birth_year-clearing statement both start
		// with the literal "UPDATE onboarding_sessions", so a single sql.search()
		// per regex can only ever report the position of whichever one occurs
		// first, making a naive character-offset comparison between them
		// unsatisfiable for any migration that does both. Splitting on `;` (the
		// migration has no semicolons inside strings) and comparing statement
		// indices instead avoids that ambiguity.
		const statements = sql.split(";");
		const markStatementIndex = statements.findIndex((statement) =>
			/UPDATE\s+onboarding_sessions/i.test(statement) &&
			/status\s*=\s*'account_saved'/i.test(statement) &&
			/age_confirmation_source\s*=\s*'android_onboarding_v2_legacy_birth_year'/i.test(statement),
		);
		const nullSessionStatementIndex = statements.findIndex((statement) =>
			/UPDATE\s+onboarding_sessions/i.test(statement) &&
			/SET[\s\S]*?birth_year\s*=\s*NULL/i.test(statement) &&
			!/age_confirmation_source\s*=\s*'android_onboarding_v2_legacy_birth_year'/i.test(statement),
		);
		const nullProfileStatementIndex = statements.findIndex((statement) =>
			/UPDATE\s+seller_profiles/i.test(statement) &&
			/SET[\s\S]*?birth_year\s*=\s*NULL/i.test(statement),
		);

		expect(markStatementIndex).toBeGreaterThanOrEqual(0);
		expect(nullSessionStatementIndex).toBeGreaterThanOrEqual(0);
		expect(nullProfileStatementIndex).toBeGreaterThanOrEqual(0);
		expect(nullSessionStatementIndex).toBeGreaterThan(markStatementIndex);
		expect(nullProfileStatementIndex).toBeGreaterThan(markStatementIndex);
	});
});

describe("Migration 064 creates only the pending email-change table", () => {
	// Both globs match nothing on the unchanged tree, so this fails cleanly
	// (empty arrays) rather than refusing to compile.
	const MIGRATION_064 = import.meta.glob("../migrations/064_pending_email_changes.sql", {
		query: "?raw",
		import: "default",
		eager: true,
	}) as Record<string, string>;
	const MIGRATION_063_CHECK = import.meta.glob("../migrations/063_clear_stored_birth_years.sql", {
		query: "?raw",
		import: "default",
		eager: true,
	}) as Record<string, string>;

	it("defines pending_email_changes with the required fields, kept out of the birth-year migration and out of email_verification_tokens", () => {
		const files064 = Object.values(MIGRATION_064);
		expect(files064).toHaveLength(1);
		const sql064 = files064[0];
		expect(sql064).toMatch(/CREATE TABLE\s+pending_email_changes/i);
		for (const column of ["id", "seller_id", "email", "token_hash", "created_at", "expires_at", "used_at", "superseded_at"]) {
			expect(sql064).toMatch(new RegExp(`\\b${column}\\b`, "i"));
		}
		expect(sql064).not.toMatch(/birth_year/i);
		expect(sql064).not.toMatch(/ALTER TABLE\s+email_verification_tokens/i);
		expect(sql064).not.toMatch(/ALTER TABLE\s+onboarding_sessions/i);
		expect(sql064).not.toMatch(/ALTER TABLE\s+seller_profiles/i);

		const files063 = Object.values(MIGRATION_063_CHECK);
		expect(files063).toHaveLength(1);
		expect(files063[0]).not.toMatch(/CREATE TABLE\s+pending_email_changes/i);
	});
});
