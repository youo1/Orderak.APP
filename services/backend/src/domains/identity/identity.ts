type SellerIdentityRow = {
	id: string;
	seller_id: string;
	provider_subject: string;
	verified_phone_e164: string;
	status: string;
};

// Public store identifiers remain colocated here for compatibility. Authentication
// ownership below is deliberately separate from URL identity: neither internal
// seller IDs nor phone numbers are exposed in public links.
export const STORE_PUBLIC_COLUMNS =
	"id, store_code, country_code, store_name, slug, public_identifier, phone, " +
	"whatsapp, instapay, vfcash, description, email, website, address, logo_url, cover_url";
export const PUBLIC_SITE_URL = "https://orderak.app";
/**
 * Slugs a store may not claim, because the first path segment is also how the
 * public Worker addresses its own pages.
 *
 * A store reached at `/{slug}` is only reachable there if no literal route
 * matches first. public-router.ts registers `/terms`, `/privacy`,
 * `/delete-account` and `/c/:identifier` ahead of `/:pid`, and the Worker
 * handles `/verify-email` and `/.well-known/*` before routing reaches the
 * router at all — so a store that claimed one of those names would pass slug
 * validation, be told the name was available, and then be permanently
 * unreachable at its own short URL with no error anywhere to explain why.
 *
 * The list guards the alias, not the store: `/{country}-{slug}-{code}` is the
 * canonical public identifier and always resolves regardless.
 */
export const RESERVED_SLUGS = new Set([
	"api", "admin", "adminx", "c", "p", "s", "health", "www", "app", "orderak",
	"static", "assets", "favicon", "robots", "sitemap", "media", "offers", "branches",
	"tables", "events", "coupons", "services",
	// Literal routes the Worker answers itself. Absent until 2026-08-22, so all
	// six were claimable and every one of them shadowed a real page.
	"terms", "privacy", "delete-account", "verify-email", "well-known", "theme",
]);
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ARABIC_MAP: Record<string, string> = {
	"ا": "a", "أ": "a", "إ": "e", "آ": "a", "ء": "a", "ئ": "e", "ؤ": "o",
	"ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh",
	"د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh",
	"ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh",
	"ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n",
	"ه": "h", "و": "w", "ي": "y", "ى": "a", "ة": "a", "ﻻ": "la",
	"٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

export function newUuid(): string { return crypto.randomUUID(); }
function randomCode(length: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	let value = "";
	for (const byte of bytes) value += CODE_ALPHABET[byte % CODE_ALPHABET.length];
	return value;
}
export function newStoreCode(length = 8): string { return randomCode(length); }
export async function uniqueStoreCode(env: Env): Promise<string> {
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const code = randomCode(attempt < 5 ? 8 : 10);
		const row = await env.orderak_db.prepare("SELECT id FROM sellers WHERE store_code=? COLLATE NOCASE").bind(code).first();
		if (!row) return code;
	}
	return `${randomCode(8)}${Date.now().toString(36).slice(-2).toUpperCase()}`;
}
export function newResourceCode(prefix: "c" | "p", length = 6): string { return `${prefix}-${randomCode(length)}`; }
export async function uniqueResourceCode(env: Env, prefix: "c" | "p"): Promise<string> {
	const table = prefix === "c" ? "categories" : "products";
	const column = prefix === "c" ? "category_code" : "product_code";
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const code = newResourceCode(prefix, attempt < 5 ? 6 : 8);
		const row = await env.orderak_db.prepare(`SELECT id FROM ${table} WHERE ${column}=? COLLATE NOCASE`).bind(code).first();
		if (!row) return code;
	}
	return newResourceCode(prefix, 8);
}
export function transliterate(input: string): string {
	let value = "";
	for (const character of String(input ?? "")) value += ARABIC_MAP[character] ?? character;
	return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}
export function slugify(input: string): string {
	return transliterate(String(input ?? "")).toLowerCase().trim().replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "")
		.slice(0, 40).replace(/-+$/g, "");
}
export function cleanSlug(input: string): string {
	const value = slugify(input);
	return value.length >= 3 && !RESERVED_SLUGS.has(value) ? value : "";
}
export async function slugIsFree(env: Env, slug: string, exceptStoreId?: string): Promise<boolean> {
	if (RESERVED_SLUGS.has(slug)) return false;
	const row = await env.orderak_db.prepare("SELECT id FROM sellers WHERE slug=? COLLATE NOCASE")
		.bind(slug).first<{ id: string }>();
	return !row || (exceptStoreId != null && row.id === exceptStoreId);
}
export async function uniqueSlug(env: Env, base: string, exceptStoreId?: string): Promise<string> {
	const root = (base || `store-${Date.now().toString(36)}`).slice(0, 36);
	if (await slugIsFree(env, root, exceptStoreId)) return root;
	for (let suffix = 2; suffix <= 9; suffix += 1) {
		const candidate = `${root}-${suffix}`;
		if (await slugIsFree(env, candidate, exceptStoreId)) return candidate;
	}
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const candidate = `${root}-${Math.random().toString(36).slice(2, 6)}`;
		if (await slugIsFree(env, candidate, exceptStoreId)) return candidate;
	}
	return `${root}-${Date.now().toString(36).slice(-5)}`;
}
export async function slugSuggestions(env: Env, base: string): Promise<string[]> {
	const values: string[] = [];
	for (let suffix = 2; values.length < 3 && suffix <= 20; suffix += 1) {
		const candidate = `${base}-${suffix}`.slice(0, 40);
		if (await slugIsFree(env, candidate)) values.push(candidate);
	}
	while (values.length < 3) {
		const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 40);
		if (await slugIsFree(env, candidate) && !values.includes(candidate)) values.push(candidate);
	}
	return values;
}
export function buildPublicIdentifier(countryIso: string, slug: string, storeCode: string): string {
	return `${(countryIso || "XX").toUpperCase()}-${slugify(slug) || "store"}-${storeCode.toUpperCase()}`;
}
export function storeUrl(publicIdentifier: string): string { return `${PUBLIC_SITE_URL}/${publicIdentifier}`; }
export function countryIsoFromPhone(phone: string): string {
	const digits = String(phone ?? "").replace(/\D/g, "");
	if (/^201|^010|^011|^012|^015/.test(digits)) return "EG";
	const countries: Array<[string, string]> = [["966", "SA"], ["971", "AE"], ["965", "KW"], ["974", "QA"], ["973", "BH"], ["968", "OM"], ["962", "JO"], ["961", "LB"], ["964", "IQ"], ["963", "SY"], ["967", "YE"], ["970", "PS"]];
	return countries.find(([prefix]) => digits.startsWith(prefix))?.[1] ?? "XX";
}
export function normalizeCountryIso(input: unknown): string {
	const value = String(input ?? "").trim().toUpperCase();
	return /^[A-Z]{2}$/.test(value) ? value : "XX";
}
export async function findStoreByIdentifier(env: Env, ident: string): Promise<Record<string, unknown> | null> {
	const value = String(ident ?? "").trim();
	if (!value) return null;
	let store = await env.orderak_db.prepare(
		`SELECT ${STORE_PUBLIC_COLUMNS} FROM sellers WHERE public_identifier=? COLLATE NOCASE`,
	).bind(value).first<Record<string, unknown>>();
	if (store) return store;
	const code = value.split("-").pop() ?? "";
	if (code && code !== value) {
		store = await env.orderak_db.prepare(
			`SELECT ${STORE_PUBLIC_COLUMNS} FROM sellers WHERE store_code=? COLLATE NOCASE`,
		).bind(code).first<Record<string, unknown>>();
		if (store) return store;
	}
	return env.orderak_db.prepare(
		`SELECT ${STORE_PUBLIC_COLUMNS} FROM sellers WHERE slug=? COLLATE NOCASE OR store_code=? COLLATE NOCASE`,
	).bind(value, value).first<Record<string, unknown>>();
}

export type IdentityMigrationIssueCode =
	| "missing_firebase_subject"
	| "invalid_phone_e164"
	| "phone_conflict"
	| "firebase_subject_conflict"
	| "write_failed";

export interface IdentityReadiness {
	active_sellers_without_identity: number;
	unresolved_identity_issues: number;
	organizations_without_route: number;
	ready: boolean;
}

export function authIdentityV2Enabled(env: Env): boolean {
	return env.AUTH_IDENTITY_ENABLED === "true";
}

export function validE164(phone: string): boolean {
	return /^\+[1-9]\d{7,14}$/.test(phone);
}

async function digest(value: string): Promise<string> {
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export const playAccountHash = digest;

export async function recordIdentityMigrationIssue(
	env: Env,
	sellerId: string,
	issueCode: IdentityMigrationIssueCode,
): Promise<void> {
	await env.orderak_db.prepare(
		`INSERT INTO identity_migration_issues(seller_id,issue_code)
		 VALUES(?,?)
		 ON CONFLICT(seller_id,issue_code) DO UPDATE SET
		 last_observed_at=datetime('now'),occurrence_count=occurrence_count+1,resolved_at=NULL`,
	).bind(sellerId, issueCode).run();
}

async function resolveSellerIssues(env: Env, sellerId: string): Promise<void> {
	await env.orderak_db.prepare(
		"UPDATE identity_migration_issues SET resolved_at=datetime('now') WHERE seller_id=? AND resolved_at IS NULL",
	).bind(sellerId).run();
}

export async function syncVerifiedFirebaseIdentity(
	env: Env,
	sellerId: string,
	providerSubject: string,
	phone: string,
): Promise<void> {
	if (!providerSubject) throw new Error("missing_firebase_subject");
	if (!validE164(phone)) throw new Error("invalid_phone_e164");
	const active = await env.orderak_db.prepare(
		`SELECT id,seller_id,provider_subject,verified_phone_e164,status
		 FROM seller_auth_identities WHERE seller_id=? AND provider='firebase_phone' AND status='active'`,
	).bind(sellerId).first<SellerIdentityRow>();
	if (active?.provider_subject === providerSubject && active.verified_phone_e164 === phone) {
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				"UPDATE seller_auth_identities SET verified_at=datetime('now'),updated_at=datetime('now') WHERE id=?",
			).bind(active.id),
			env.orderak_db.prepare(
				"UPDATE sellers SET phone=?,firebase_uid=?,updated_at=datetime('now') WHERE id=?",
			).bind(phone, providerSubject, sellerId),
		]);
		await resolveSellerIssues(env, sellerId);
		return;
	}
	const identityId = crypto.randomUUID();
	await env.orderak_db.batch([
		env.orderak_db.prepare(
			`UPDATE seller_auth_identities SET status='superseded',superseded_at=datetime('now'),updated_at=datetime('now')
			 WHERE seller_id=? AND provider='firebase_phone' AND status='active'`,
		).bind(sellerId),
		env.orderak_db.prepare(
			`INSERT INTO seller_auth_identities(
			 id,seller_id,provider,provider_subject,verified_phone_e164,status)
			 VALUES(?,?,'firebase_phone',?,?,'active')`,
		).bind(identityId, sellerId, providerSubject, phone),
		env.orderak_db.prepare(
			"UPDATE sellers SET phone=?,firebase_uid=?,updated_at=datetime('now') WHERE id=?",
		).bind(phone, providerSubject, sellerId),
	]);
	await resolveSellerIssues(env, sellerId);
}

export async function findSellerByVerifiedIdentity(
	env: Env,
	providerSubject: string,
	phone: string,
): Promise<Record<string, unknown> | null> {
	if (!authIdentityV2Enabled(env)) {
		return env.orderak_db.prepare("SELECT * FROM sellers WHERE phone=?").bind(phone).first<Record<string, unknown>>();
	}
	return env.orderak_db.prepare(
		`SELECT s.* FROM seller_auth_identities i
		 JOIN sellers s ON s.id=i.seller_id
		 WHERE i.provider='firebase_phone' AND i.status='active'
		 AND i.provider_subject=? AND i.verified_phone_e164=?`,
	).bind(providerSubject, phone).first<Record<string, unknown>>();
}

export async function newAccountFoundationStatements(
	env: Env,
	params: {
		sellerId: string;
		organizationId: string;
		memberId: string;
		phone: string;
		firebaseUid: string | null;
		storeName: string;
		locale: string;
	},
): Promise<D1PreparedStatement[]> {
	const statements: D1PreparedStatement[] = [];
	if (params.firebaseUid) {
		statements.push(env.orderak_db.prepare(
			`INSERT INTO seller_auth_identities(
			 id,seller_id,provider,provider_subject,verified_phone_e164,status)
			 VALUES(?,?,'firebase_phone',?,?,'active')`,
		).bind(crypto.randomUUID(), params.sellerId, params.firebaseUid, params.phone));
	}
	statements.push(
		env.orderak_db.prepare(
			"INSERT INTO organizations(id,name,owner_store_id,default_locale,play_account_hash) VALUES(?,?,?,?,?)",
		).bind(params.organizationId, params.storeName.slice(0, 100), params.sellerId, params.locale, await playAccountHash(params.organizationId)),
		env.orderak_db.prepare(
			"INSERT INTO organization_stores(organization_id,store_id,is_primary) VALUES(?,?,1)",
		).bind(params.organizationId, params.sellerId),
		env.orderak_db.prepare(
			"INSERT INTO organization_members(id,organization_id,seller_id,role,status) VALUES(?,?,?,'owner','active')",
		).bind(params.memberId, params.organizationId, params.sellerId),
		env.orderak_db.prepare(
			"INSERT INTO organization_routing(organization_id,shard_key,routing_version,migration_state) VALUES(?,'primary',1,'stable')",
		).bind(params.organizationId),
	);
	return statements;
}

export async function ensureOrganizationRoute(env: Env, organizationId: string): Promise<void> {
	await env.orderak_db.prepare(
		`INSERT OR IGNORE INTO organization_routing(organization_id,shard_key,routing_version,migration_state)
		 VALUES(?,'primary',1,'stable')`,
	).bind(organizationId).run();
}

export async function backfillOrganizationRouting(env: Env, limit = 100): Promise<number> {
	const { results } = await env.orderak_db.prepare(
		`SELECT o.id FROM organizations o
		 WHERE NOT EXISTS(SELECT 1 FROM organization_routing r WHERE r.organization_id=o.id)
		 ORDER BY o.created_at,o.id LIMIT ?`,
	).bind(Math.max(1, Math.min(500, limit))).all<{ id: string }>();
	let migrated = 0;
	for (const organization of results ?? []) {
		const result = await env.orderak_db.prepare(
			`INSERT OR IGNORE INTO organization_routing(organization_id,shard_key,routing_version,migration_state)
			 VALUES(?,'primary',1,'stable')`,
		).bind(organization.id).run();
		await env.orderak_db.prepare(
			"UPDATE organizations SET play_account_hash=COALESCE(play_account_hash,?),updated_at=datetime('now') WHERE id=?",
		).bind(await playAccountHash(organization.id), organization.id).run();
		migrated += Number(result.meta.changes ?? 0);
	}
	return migrated;
}

export async function backfillStableIdentities(env: Env, limit = 100): Promise<{ scanned: number; migrated: number; issues: number }> {
	const { results } = await env.orderak_db.prepare(
		`SELECT s.id,s.phone,s.firebase_uid
		 FROM sellers s
		 WHERE s.status='active' AND NOT EXISTS(
		   SELECT 1 FROM seller_auth_identities i
		   WHERE i.seller_id=s.id AND i.provider='firebase_phone' AND i.status='active'
		 ) ORDER BY s.created_at,s.id LIMIT ?`,
	).bind(Math.max(1, Math.min(500, limit))).all<{ id: string; phone: string; firebase_uid: string | null }>();
	let migrated = 0;
	let issues = 0;
	for (const seller of results ?? []) {
		let issue: IdentityMigrationIssueCode | null = null;
		if (!seller.firebase_uid) issue = "missing_firebase_subject";
		else if (!validE164(seller.phone)) issue = "invalid_phone_e164";
		if (issue) {
			await recordIdentityMigrationIssue(env, seller.id, issue);
			issues += 1;
			continue;
		}
		try {
			await syncVerifiedFirebaseIdentity(env, seller.id, seller.firebase_uid!, seller.phone);
			migrated += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			const code: IdentityMigrationIssueCode = message.includes("provider_subject")
				? "firebase_subject_conflict"
				: message.includes("verified_phone") || message.includes("active_phone")
					? "phone_conflict"
					: "write_failed";
			await recordIdentityMigrationIssue(env, seller.id, code);
			issues += 1;
		}
	}
	return { scanned: (results ?? []).length, migrated, issues };
}

export async function identityReadiness(env: Env): Promise<IdentityReadiness> {
	const [missingIdentity, issues, missingRoutes] = await Promise.all([
		env.orderak_db.prepare(
			`SELECT COUNT(*) count FROM sellers s WHERE s.status='active' AND NOT EXISTS(
			 SELECT 1 FROM seller_auth_identities i WHERE i.seller_id=s.id AND i.status='active')`,
		).first<{ count: number }>(),
		env.orderak_db.prepare(
			"SELECT COUNT(*) count FROM identity_migration_issues WHERE resolved_at IS NULL",
		).first<{ count: number }>(),
		env.orderak_db.prepare(
			`SELECT COUNT(*) count FROM organizations o WHERE NOT EXISTS(
			 SELECT 1 FROM organization_routing r WHERE r.organization_id=o.id)`,
		).first<{ count: number }>(),
	]);
	const result = {
		active_sellers_without_identity: Number(missingIdentity?.count ?? 0),
		unresolved_identity_issues: Number(issues?.count ?? 0),
		organizations_without_route: Number(missingRoutes?.count ?? 0),
		ready: false,
	};
	result.ready = result.active_sellers_without_identity === 0
		&& result.unresolved_identity_issues === 0
		&& result.organizations_without_route === 0;
	return result;
}
