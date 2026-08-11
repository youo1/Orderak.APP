import { authSeller, jsonResponse, readCreds, type AuthenticatedSeller } from "../../platform/http/shared";
import { ensureOrganizationForStore, resolveEntitlements } from "../../domains/commerce/entitlements";
import {
	acquireProviderPermit,
	ProviderCircuitOpenError,
	recordProviderFailure,
	recordProviderSuccess,
} from "../../platform/resilience/provider-circuit";
import { requireTenantWrite, resolveTenantContext } from "../../platform/tenancy/tenant-routing";
import { verifyGoogleIdToken } from "../../platform/auth/local-jwt";

type Json = Record<string, unknown>;
type VerificationSource = "direct" | "rtdn" | "reconcile" | "admin";
type JobStatus = "queued" | "processing" | "retrying" | "applied_ack_pending" | "succeeded"
	| "terminal_failed" | "superseded" | "dead_lettered";

export interface PlayBillingQueueMessage {
	version: 1;
	jobId: string;
}

interface PlayContext {
	accessToken: string;
	packageName: string;
}

interface VerificationJob {
	id: string;
	organization_id: string | null;
	seller_id: string | null;
	purchase_token_hash: string;
	purchase_token_encrypted: string;
	source: VerificationSource;
	message_id: string | null;
	status: JobStatus;
	attempt_count: number;
	verification_generation: number | null;
	purchase_status: string | null;
	error_code: string | null;
	claim_token: string | null;
	claim_started_at: string | null;
	claim_expires_at: string | null;
	lease_reclaim_count: number;
	last_lease_reclaimed_at: string | null;
	requeued_from_job_id: string | null;
}

interface MappingRow extends Json {
	id: string;
	plan_id: string;
	plan_key: string;
	current_revision_id: string;
	product_id: string;
	base_plan_id: string;
}

interface ExistingPurchase {
	organization_id: string;
	subscription_id: string | null;
	purchase_token_encrypted: string;
	plan_revision_id: string | null;
	current_period_start: string | null;
	current_period_end: string | null;
}

interface AppliedPurchase {
	status: string;
	productId: string;
	needsAcknowledgement: boolean;
}

export interface VerificationOutcome {
	status: "succeeded" | "retry" | "terminal" | "superseded" | "active_lease";
	purchaseStatus?: string;
	errorCode?: string;
	retryAfterSeconds?: number;
	entitlementApplied?: boolean;
}

class PlayError extends Error {
	readonly retryable: boolean;
	readonly retryAfterSeconds: number;
	readonly security: boolean;

	constructor(code: string, options: { retryable?: boolean; retryAfterSeconds?: number; security?: boolean } = {}) {
		super(code);
		this.name = "PlayError";
		this.retryable = options.retryable === true;
		this.retryAfterSeconds = options.retryAfterSeconds ?? 30;
		this.security = options.security === true;
	}
}

const ACTIVE_STATES = new Set(["active", "grace", "canceled"]);
const RETRYABLE_HTTP = new Set([408, 409, 429]);
export const PLAY_VERIFICATION_LEASE_SECONDS = 120;

function logSignal(signal: string, details: Record<string, unknown> = {}, level: "info" | "error" = "info"): void {
	const record = JSON.stringify({ signal, ...details });
	if (level === "error") console.error(record); else console.info(record);
}

function b64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function utf8(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function fromB64url(value: string): Uint8Array {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function sha256(value: string): Promise<string> {
	return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(value))));
}

function pemBytes(pem: string): ArrayBuffer {
	const normalized = pem.replaceAll("\\n", "\n").replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
	return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)).buffer;
}

function timeoutSignal(milliseconds = 20_000): AbortSignal {
	return AbortSignal.timeout(milliseconds);
}

function retryDelay(attempt: number): number {
	return Math.min(21_600, 30 * (2 ** Math.max(0, attempt - 1)));
}

function lifecycleEnabled(env: Env): boolean {
	return env.GOOGLE_PLAY_LIFECYCLE_ENABLED === "true";
}

async function acquisitionEnabled(env: Env): Promise<boolean> {
	if (env.BILLING_ENABLED !== "true") return false;
	const row = await env.orderak_db.prepare("SELECT value_json FROM settings WHERE key='billing_enabled'")
		.first<{ value_json: string }>().catch(() => null);
	if (!row) return true;
	try { return JSON.parse(row.value_json) === true; } catch { return false; }
}

async function providerFetch(env: Env, input: string, init: RequestInit, errorPrefix: string): Promise<Response> {
	let permit;
	try {
		permit = await acquireProviderPermit(env, "google_play");
	} catch (error) {
		if (error instanceof ProviderCircuitOpenError) {
			throw new PlayError("google_play_temporarily_unavailable", {
				retryable: true,
				retryAfterSeconds: error.retryAfterSeconds,
			});
		}
		throw error;
	}
	let response: Response;
	try {
		response = await fetch(input, { ...init, signal: timeoutSignal() });
	} catch (error) {
		await recordProviderFailure(env, permit);
		const timeout = error instanceof DOMException && error.name === "TimeoutError";
		throw new PlayError(timeout ? `${errorPrefix}_timeout` : `${errorPrefix}_connection`, { retryable: true });
	}
	if (RETRYABLE_HTTP.has(response.status) || response.status >= 500) {
		await recordProviderFailure(env, permit);
		const retryAfter = Number(response.headers.get("retry-after"));
		throw new PlayError(`${errorPrefix}_${response.status}`, {
			retryable: true,
			retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 30,
		});
	}
	await recordProviderSuccess(env, permit);
	if (!response.ok) throw new PlayError(`${errorPrefix}_${response.status}`);
	return response;
}

async function googleContext(env: Env): Promise<PlayContext> {
	if (!env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY) {
		throw new PlayError("google_play_credentials_missing");
	}
	const now = Math.floor(Date.now() / 1000);
	const header = b64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
	const claim = b64url(utf8(JSON.stringify({
		iss: env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL,
		scope: "https://www.googleapis.com/auth/androidpublisher",
		aud: "https://oauth2.googleapis.com/token",
		iat: now,
		exp: now + 3600,
	})));
	const key = await crypto.subtle.importKey(
		"pkcs8",
		pemBytes(env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY),
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(`${header}.${claim}`));
	const assertion = `${header}.${claim}.${b64url(new Uint8Array(signature))}`;
	const response = await providerFetch(env, "https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
	}, "google_oauth");
	const token = await response.json<{ access_token?: string }>();
	if (!token.access_token) throw new PlayError("google_oauth_missing_token");
	return { accessToken: token.access_token, packageName: env.GOOGLE_PLAY_PACKAGE_NAME || "app.orderak.seller" };
}

async function getPlayPurchase(env: Env, context: PlayContext, purchaseToken: string): Promise<Json> {
	const response = await providerFetch(
		env,
		`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(context.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
		{ headers: { authorization: `Bearer ${context.accessToken}` } },
		"google_play_verify",
	);
	return response.json<Json>();
}

async function acknowledge(env: Env, context: PlayContext, productId: string, purchaseToken: string): Promise<void> {
	await providerFetch(
		env,
		`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(context.packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
		{
			method: "POST",
			headers: { authorization: `Bearer ${context.accessToken}`, "content-type": "application/json" },
			body: "{}",
		},
		"google_play_ack",
	);
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
	if (!env.GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY) throw new PlayError("google_play_encryption_key_missing");
	const raw = Uint8Array.from(atob(env.GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY), (character) => character.charCodeAt(0));
	if (raw.length !== 32) throw new PlayError("google_play_encryption_key_invalid");
	return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptToken(env: Env, token: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), utf8(token));
	return `${b64url(iv)}.${b64url(new Uint8Array(encrypted))}`;
}

async function decryptToken(env: Env, value: string): Promise<string> {
	const [iv, ciphertext] = value.split(".");
	if (!iv || !ciphertext) throw new PlayError("encrypted_token_invalid");
	try {
		const clear = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: fromB64url(iv) },
			await encryptionKey(env),
			fromB64url(ciphertext),
		);
		return new TextDecoder().decode(clear);
	} catch {
		throw new PlayError("encrypted_token_invalid");
	}
}

function normalizeState(value: unknown): string {
	const state = String(value ?? "");
	if (state === "SUBSCRIPTION_STATE_ACTIVE") return "active";
	if (state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") return "grace";
	if (state === "SUBSCRIPTION_STATE_CANCELED") return "canceled";
	if (state === "SUBSCRIPTION_STATE_ON_HOLD") return "on_hold";
	if (state === "SUBSCRIPTION_STATE_PAUSED") return "paused";
	if (state === "SUBSCRIPTION_STATE_EXPIRED") return "expired";
	if (state === "SUBSCRIPTION_STATE_PENDING") return "pending";
	return "revoked";
}

function basePlanId(item: Json): string {
	const offer = item.offerDetails as Json | undefined;
	return String(offer?.basePlanId ?? "");
}

function isFuture(value: unknown): boolean {
	if (!value) return false;
	const millis = Date.parse(String(value));
	return Number.isFinite(millis) && millis > Date.now();
}

function minDate(left: string | null, right: string | null): string | null {
	if (!left) return right;
	if (!right) return left;
	return Date.parse(left) <= Date.parse(right) ? left : right;
}

function maxDate(left: string | null, right: string | null): string | null {
	if (!left) return right;
	if (!right) return left;
	return Date.parse(left) >= Date.parse(right) ? left : right;
}

async function mappingForItem(env: Env, packageName: string, item: Json): Promise<MappingRow> {
	const productId = String(item.productId ?? "");
	const basePlan = basePlanId(item);
	if (!productId || !basePlan) throw new PlayError("unsupported_purchase_shape");
	const mapping = await env.orderak_db.prepare(
		`SELECT ppm.id,ppm.plan_id,ppm.product_id,ppm.base_plan_id,sp.plan_key,sp.current_revision_id
		 FROM play_product_mappings ppm JOIN subscription_plans sp ON sp.id=ppm.plan_id
		 WHERE ppm.product_id=? AND ppm.base_plan_id=? AND ppm.package_name=? AND ppm.active=1`,
	).bind(productId, basePlan, packageName).first<MappingRow>();
	if (!mapping) throw new PlayError("play_product_not_enabled");
	return mapping;
}

async function deferredMapping(env: Env, packageName: string, item: Json): Promise<MappingRow | null> {
	const deferred = item.deferredItemReplacement as Json | undefined;
	const productId = String(deferred?.productId ?? "");
	if (!productId) return null;
	const { results } = await env.orderak_db.prepare(
		`SELECT ppm.id,ppm.plan_id,ppm.product_id,ppm.base_plan_id,sp.plan_key,sp.current_revision_id
		 FROM play_product_mappings ppm JOIN subscription_plans sp ON sp.id=ppm.plan_id
		 WHERE ppm.product_id=? AND ppm.package_name=? AND ppm.active=1`,
	).bind(productId, packageName).all<MappingRow>();
	if ((results ?? []).length !== 1) throw new PlayError("unsupported_purchase_shape");
	return results![0];
}

function effectiveLineItem(purchase: Json): Json {
	const items = Array.isArray(purchase.lineItems) ? purchase.lineItems as Json[] : [];
	if (items.length === 0) throw new PlayError("unsupported_purchase_shape");
	const effective = items.filter((item) => isFuture(item.expiryTime));
	if (effective.length > 1) throw new PlayError("unsupported_purchase_shape");
	if (effective.length === 1) return effective[0];
	if (items.length === 1) return items[0];
	throw new PlayError("unsupported_purchase_shape");
}

async function beginGeneration(env: Env, organizationId: string): Promise<number> {
	const row = await env.orderak_db.prepare(
		`INSERT INTO billing_verification_heads(organization_id,latest_generation)
		 VALUES(?,1) ON CONFLICT(organization_id) DO UPDATE SET
		 latest_generation=latest_generation+1,updated_at=datetime('now')
		 RETURNING latest_generation`,
	).bind(organizationId).first<{ latest_generation: number }>();
	if (!row) throw new PlayError("verification_generation_failed", { retryable: true });
	return Number(row.latest_generation);
}

async function validatePaid3(env: Env, organizationId: string, mapping: MappingRow): Promise<void> {
	if (mapping.plan_key !== "paid3") return;
	const approval = await env.orderak_db.prepare(
		`SELECT 1 AS ok FROM organization_plan_approvals WHERE organization_id=? AND plan_id=? AND revoked_at IS NULL
		 AND (expires_at IS NULL OR expires_at>datetime('now'))`,
	).bind(organizationId, mapping.plan_id).first();
	if (!approval) throw new PlayError("paid3_sales_approval_required");
}

async function resolveOrganizationFromPurchase(env: Env, purchase: Json): Promise<string> {
	const external = purchase.externalAccountIdentifiers as Json | undefined;
	const accountHash = String(external?.obfuscatedExternalAccountId ?? "");
	if (!accountHash) throw new PlayError("play_account_binding_mismatch", { security: true });
	const organization = await env.orderak_db.prepare(
		"SELECT id FROM organizations WHERE play_account_hash=?",
	).bind(accountHash).first<{ id: string }>();
	if (!organization) throw new PlayError("play_account_binding_mismatch", { security: true });
	return organization.id;
}

async function applyVerifiedPurchase(
	env: Env,
	organizationId: string,
	purchaseToken: string,
	purchase: Json,
	generation: number,
): Promise<AppliedPurchase> {
	const packageName = env.GOOGLE_PLAY_PACKAGE_NAME || "app.orderak.seller";
	const item = effectiveLineItem(purchase);
	const mapping = await mappingForItem(env, packageName, item);
	const pendingMapping = await deferredMapping(env, packageName, item);
	await validatePaid3(env, organizationId, mapping);
	if (pendingMapping) await validatePaid3(env, organizationId, pendingMapping);

	const external = purchase.externalAccountIdentifiers as Json | undefined;
	if (external?.obfuscatedExternalAccountId && String(external.obfuscatedExternalAccountId) !== await sha256(organizationId)) {
		throw new PlayError("play_account_binding_mismatch", { security: true });
	}

	const tokenHash = await sha256(purchaseToken);
	const existing = await env.orderak_db.prepare(
		`SELECT pp.organization_id,pp.subscription_id,pp.purchase_token_encrypted,
		        os.plan_revision_id,os.current_period_start,os.current_period_end
		 FROM play_purchases pp LEFT JOIN organization_subscriptions os ON os.id=pp.subscription_id
		 WHERE pp.purchase_token_hash=?`,
	).bind(tokenHash).first<ExistingPurchase>();
	if (existing && existing.organization_id !== organizationId) {
		throw new PlayError("purchase_token_reused", { security: true });
	}

	const linkedTokenHash = purchase.linkedPurchaseToken ? await sha256(String(purchase.linkedPurchaseToken)) : null;
	const linked = linkedTokenHash ? await env.orderak_db.prepare(
		`SELECT pp.organization_id,pp.subscription_id,pp.purchase_token_encrypted,
		        os.plan_revision_id,os.current_period_start,os.current_period_end
		 FROM play_purchases pp LEFT JOIN organization_subscriptions os ON os.id=pp.subscription_id
		 WHERE pp.purchase_token_hash=?`,
	).bind(linkedTokenHash).first<ExistingPurchase>() : null;
	if (linkedTokenHash && !linked) throw new PlayError("linked_purchase_not_found");
	if (linked && linked.organization_id !== organizationId) {
		throw new PlayError("linked_purchase_cross_organization", { security: true });
	}

	const state = normalizeState(purchase.subscriptionState);
	const subscriptionId = existing?.subscription_id ?? crypto.randomUUID();
	const expiry = maxDate(item.expiryTime ? String(item.expiryTime) : null, linked?.current_period_end ?? null);
	const start = minDate(purchase.startTime ? String(purchase.startTime) : null, linked?.current_period_start ?? null);
	const encryptedToken = existing?.purchase_token_encrypted ?? await encryptToken(env, purchaseToken);
	const currentRevision = mapping.current_revision_id;
	const pendingRevision = pendingMapping?.current_revision_id ?? null;
	const pendingEffectiveAt = pendingRevision ? (item.expiryTime ? String(item.expiryTime) : null) : null;
	const orderId = item.latestSuccessfulOrderId ?? purchase.latestOrderId ?? null;
	const acknowledgementState = String(purchase.acknowledgementState ?? "");
	const purchaseId = crypto.randomUUID();
	const statements: D1PreparedStatement[] = [
		env.orderak_db.prepare(
			`INSERT INTO organization_subscriptions(
			 id,organization_id,plan_revision_id,pending_revision_id,pending_effective_at,source,status,
			 current_period_start,current_period_end,cancel_at_period_end,verification_generation)
			 VALUES(?,?,?,?,?,'google_play',?,?,?,?,?)
			 ON CONFLICT(id) DO UPDATE SET
			 plan_revision_id=excluded.plan_revision_id,pending_revision_id=excluded.pending_revision_id,
			 pending_effective_at=excluded.pending_effective_at,status=excluded.status,
			 current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
			 cancel_at_period_end=excluded.cancel_at_period_end,verification_generation=excluded.verification_generation,
			 updated_at=datetime('now')`,
		).bind(
			subscriptionId,
			organizationId,
			currentRevision,
			ACTIVE_STATES.has(state) ? pendingRevision : null,
			ACTIVE_STATES.has(state) ? pendingEffectiveAt : null,
			state,
			start,
			expiry,
			state === "canceled" ? 1 : 0,
			generation,
		),
		env.orderak_db.prepare(
			`INSERT INTO play_purchases(
			 id,organization_id,subscription_id,product_mapping_id,purchase_token_hash,purchase_token_encrypted,
			 linked_token_hash,order_id,state,acknowledgement_state,region_code,start_at,expires_at,raw_etag,
			 last_verified_at,verification_generation)
			 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?)
			 ON CONFLICT(purchase_token_hash) DO UPDATE SET
			 subscription_id=excluded.subscription_id,product_mapping_id=excluded.product_mapping_id,
			 linked_token_hash=excluded.linked_token_hash,order_id=excluded.order_id,state=excluded.state,
			 acknowledgement_state=excluded.acknowledgement_state,region_code=excluded.region_code,
			 start_at=excluded.start_at,expires_at=excluded.expires_at,raw_etag=excluded.raw_etag,
			 last_verified_at=datetime('now'),verification_generation=excluded.verification_generation,
			 updated_at=datetime('now')`,
		).bind(
			purchaseId,
			organizationId,
			subscriptionId,
			mapping.id,
			tokenHash,
			encryptedToken,
			linkedTokenHash,
			orderId,
			state,
			acknowledgementState || null,
			purchase.regionCode ?? null,
			start,
			expiry,
			purchase.etag ?? null,
			generation,
		),
	];
	if (linked?.subscription_id && linked.subscription_id !== subscriptionId) {
		statements.push(
			env.orderak_db.prepare(
				`UPDATE organization_subscriptions SET status='revoked',verification_generation=?,updated_at=datetime('now')
				 WHERE id=? AND organization_id=?`,
			).bind(generation, linked.subscription_id, organizationId),
			env.orderak_db.prepare(
				`UPDATE play_purchases SET state='replaced',replaced_by_token_hash=?,replaced_at=datetime('now'),
				 verification_generation=?,updated_at=datetime('now')
				 WHERE purchase_token_hash=? AND organization_id=?`,
			).bind(tokenHash, generation, linkedTokenHash, organizationId),
		);
	}
	try {
		await env.orderak_db.batch(statements);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("stale_play_verification")) {
			logSignal("play_stale_generation_rejected", { organization_id: organizationId, generation });
			throw new PlayError("verification_superseded");
		}
		throw error;
	}
	return {
		status: state,
		productId: String(item.productId ?? ""),
		needsAcknowledgement: acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING" && ACTIVE_STATES.has(state),
	};
}

async function createVerificationJob(
	env: Env,
	params: {
		organizationId?: string | null;
		sellerId?: string | null;
		purchaseToken: string;
		source: VerificationSource;
		messageId?: string | null;
		eventTime?: string | null;
	},
): Promise<VerificationJob> {
	const id = crypto.randomUUID();
	const tokenHash = await sha256(params.purchaseToken);
	const encrypted = await encryptToken(env, params.purchaseToken);
	await env.orderak_db.prepare(
		`INSERT INTO play_verification_jobs(
		 id,organization_id,seller_id,purchase_token_hash,purchase_token_encrypted,source,message_id,event_time)
		 VALUES(?,?,?,?,?,?,?,?)`,
	).bind(
		id,
		params.organizationId ?? null,
		params.sellerId ?? null,
		tokenHash,
		encrypted,
		params.source,
		params.messageId ?? null,
		params.eventTime ?? null,
	).run();
	const job = await loadJob(env, id);
	if (!job) throw new PlayError("verification_job_create_failed", { retryable: true });
	return job;
}

async function loadJob(env: Env, jobId: string): Promise<VerificationJob | null> {
	return env.orderak_db.prepare(
		`SELECT id,organization_id,seller_id,purchase_token_hash,purchase_token_encrypted,source,message_id,
		 status,attempt_count,verification_generation,purchase_status,error_code,claim_token,claim_started_at,
		 claim_expires_at,lease_reclaim_count,last_lease_reclaimed_at,requeued_from_job_id
		 FROM play_verification_jobs WHERE id=?`,
	).bind(jobId).first<VerificationJob>();
}

export async function claimPlayVerificationJob(env: Env, jobId: string): Promise<VerificationJob | null> {
	const claimToken = crypto.randomUUID();
	const claimed = await env.orderak_db.prepare(
		`UPDATE play_verification_jobs
		 SET status='processing',
		     attempt_count=attempt_count+1,
		     claim_token=?,
		     claim_started_at=datetime('now'),
		     claim_expires_at=datetime('now',?),
		     lease_reclaim_count=lease_reclaim_count+CASE WHEN status='processing' THEN 1 ELSE 0 END,
		     last_lease_reclaimed_at=CASE WHEN status='processing' THEN datetime('now') ELSE last_lease_reclaimed_at END,
		     last_attempt_at=datetime('now'),
		     updated_at=datetime('now')
		 WHERE id=? AND (
		   (status IN ('queued','retrying','applied_ack_pending')
		     AND (next_attempt_at IS NULL OR next_attempt_at<=datetime('now')))
		   OR (status='processing' AND claim_expires_at IS NOT NULL AND claim_expires_at<=datetime('now'))
		 )
		 RETURNING id,organization_id,seller_id,purchase_token_hash,purchase_token_encrypted,source,message_id,
		 status,attempt_count,verification_generation,purchase_status,error_code,claim_token,claim_started_at,
		 claim_expires_at,lease_reclaim_count,last_lease_reclaimed_at,requeued_from_job_id`,
	).bind(claimToken, `+${PLAY_VERIFICATION_LEASE_SECONDS} seconds`, jobId).first<VerificationJob>();
	if (!claimed) return null;
	if (claimed.last_lease_reclaimed_at === claimed.claim_started_at) {
		logSignal("play_lease_expired_reclaimed", {
			job_id: claimed.id,
			lease_reclaim_count: claimed.lease_reclaim_count,
			lease_seconds: PLAY_VERIFICATION_LEASE_SECONDS,
		});
	}
	return claimed;
}

function claimDurationMs(job: VerificationJob): number | null {
	if (!job.claim_started_at) return null;
	const started = Date.parse(`${job.claim_started_at.replace(" ", "T")}Z`);
	return Number.isFinite(started) ? Math.max(0, Date.now() - started) : null;
}

async function runClaimedJobUpdate(
	env: Env,
	job: VerificationJob,
	sql: string,
	bindings: unknown[],
	transition: string,
): Promise<boolean> {
	const result = await env.orderak_db.prepare(`${sql} AND id=? AND claim_token=?`)
		.bind(...bindings, job.id, job.claim_token).run();
	if (Number(result.meta.changes ?? 0) > 0) {
		logSignal("play_claim_duration", {
			job_id: job.id,
			transition,
			duration_ms: claimDurationMs(job),
			lease_seconds: PLAY_VERIFICATION_LEASE_SECONDS,
		});
		return true;
	}
	logSignal("play_stale_claim_write_rejected", { job_id: job.id, transition }, "error");
	return false;
}

async function updateJobFailure(
	env: Env,
	job: VerificationJob,
	error: PlayError,
): Promise<VerificationOutcome> {
	const code = error.message.slice(0, 100);
	if (error.security) {
		logSignal("play_security_conflict", { job_id: job.id, organization_id: job.organization_id, error_code: code }, "error");
		await recordSystemAudit(env, "billing.security_conflict", job.id, { error_code: code, organization_id: job.organization_id });
		await recordBillingAlert(env, "play_billing_security_conflict", job.id, { error_code: code, organization_id: job.organization_id });
	}
	if (code === "verification_superseded") {
		const updated = await runClaimedJobUpdate(env, job,
			"UPDATE play_verification_jobs SET status='superseded',error_code=?,completed_at=datetime('now'),claim_token=NULL,claim_expires_at=NULL,updated_at=datetime('now') WHERE 1=1",
			[code], "superseded");
		if (!updated) return { status: "superseded", errorCode: "stale_claim" };
		logSignal("play_generation_supersession", { job_id: job.id, organization_id: job.organization_id });
		return { status: "superseded", errorCode: code };
	}
	if (error.retryable) {
		const delay = Math.max(error.retryAfterSeconds, retryDelay(job.attempt_count));
		const updated = await runClaimedJobUpdate(env, job,
			`UPDATE play_verification_jobs SET status='retrying',error_code=?,next_attempt_at=datetime('now',?),
			 claim_token=NULL,claim_expires_at=NULL,updated_at=datetime('now') WHERE 1=1`,
			[code, `+${delay} seconds`], "retrying");
		if (!updated) return { status: "superseded", errorCode: "stale_claim" };
		logSignal("play_verification_retry", { job_id: job.id, error_code: code, retry_after_seconds: delay });
		return { status: "retry", errorCode: code, retryAfterSeconds: delay };
	}
	const updated = await runClaimedJobUpdate(env, job,
		`UPDATE play_verification_jobs SET status='terminal_failed',error_code=?,completed_at=datetime('now'),
		 claim_token=NULL,claim_expires_at=NULL,updated_at=datetime('now') WHERE 1=1`,
		[code], "terminal_failed");
	if (!updated) return { status: "superseded", errorCode: "stale_claim" };
	logSignal("play_verification_terminal", { job_id: job.id, error_code: code }, "error");
	return { status: "terminal", errorCode: code };
}

/** One authoritative path used by direct verification, RTDN, reconciliation and admin retry. */
export async function verifyAndApplyPlayPurchase(env: Env, jobId: string): Promise<VerificationOutcome> {
	const existing = await loadJob(env, jobId);
	if (!existing) return { status: "terminal", errorCode: "verification_not_found" };
	if (["succeeded", "terminal_failed", "superseded", "dead_lettered"].includes(existing.status)) {
		return {
			status: existing.status === "succeeded" ? "succeeded" : existing.status === "superseded" ? "superseded" : "terminal",
			purchaseStatus: existing.purchase_status ?? undefined,
			errorCode: existing.error_code ?? undefined,
		};
	}
	const job = await claimPlayVerificationJob(env, jobId);
	if (!job) {
		const current = await loadJob(env, jobId);
		if (current?.status === "processing" && current.claim_expires_at) {
			logSignal("play_active_lease_duplicate", { job_id: jobId, lease_seconds: PLAY_VERIFICATION_LEASE_SECONDS });
			return { status: "active_lease", errorCode: "active_lease_duplicate" };
		}
		if (current && ["succeeded", "terminal_failed", "superseded", "dead_lettered"].includes(current.status)) {
			return { status: current.status === "succeeded" ? "succeeded" : current.status === "superseded" ? "superseded" : "terminal" };
		}
		return { status: "retry", errorCode: "verification_not_due", retryAfterSeconds: 30 };
	}

	try {
		const purchaseToken = await decryptToken(env, job.purchase_token_encrypted);
		const context = await googleContext(env);
		let organizationId = job.organization_id;
		if (!organizationId) {
			const stored = await env.orderak_db.prepare(
				"SELECT organization_id FROM play_purchases WHERE purchase_token_hash=?",
			).bind(job.purchase_token_hash).first<{ organization_id: string }>();
			organizationId = stored?.organization_id ?? null;
		}
		if (!organizationId) {
			// This discovery response never mutates entitlement state. Once it is
			// bound to an organization we start a generation and re-query Google.
			organizationId = await resolveOrganizationFromPurchase(env, await getPlayPurchase(env, context, purchaseToken));
		}
		requireTenantWrite(await resolveTenantContext(env, organizationId));
		const generation = await beginGeneration(env, organizationId);
		if (!await runClaimedJobUpdate(env, job,
			"UPDATE play_verification_jobs SET organization_id=?,verification_generation=?,updated_at=datetime('now') WHERE 1=1",
			[organizationId, generation], "generation_started")) {
			return { status: "superseded", errorCode: "stale_claim" };
		}
		job.organization_id = organizationId;
		job.verification_generation = generation;
		const purchase = await getPlayPurchase(env, context, purchaseToken);
		const applied = await applyVerifiedPurchase(env, organizationId, purchaseToken, purchase, generation);

		if (applied.needsAcknowledgement) {
			try {
				await acknowledge(env, context, applied.productId, purchaseToken);
				await env.orderak_db.prepare(
					`UPDATE play_purchases SET acknowledgement_state='ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
					 updated_at=datetime('now') WHERE purchase_token_hash=?`,
				).bind(job.purchase_token_hash).run();
			} catch (error) {
				const ackError = error instanceof PlayError ? error : new PlayError("google_play_ack_failed", { retryable: true });
				const delay = Math.max(ackError.retryAfterSeconds, retryDelay(job.attempt_count));
				const updated = await runClaimedJobUpdate(env, job,
					`UPDATE play_verification_jobs SET status='applied_ack_pending',purchase_status=?,error_code=?,
					 result_json=?,next_attempt_at=datetime('now',?),claim_token=NULL,claim_expires_at=NULL,updated_at=datetime('now') WHERE 1=1`, [
						applied.status,
						"acknowledgement_pending",
						JSON.stringify({ purchase_status: applied.status, acknowledgement_pending: true }),
						`+${delay} seconds`,
					], "acknowledgement_pending");
				if (!updated) return { status: "superseded", errorCode: "stale_claim", entitlementApplied: true };
				logSignal("play_acknowledgement_pending", { job_id: job.id, organization_id: organizationId }, "error");
				return ackError.retryable
					? { status: "retry", purchaseStatus: applied.status, errorCode: "acknowledgement_pending", retryAfterSeconds: delay, entitlementApplied: true }
					: { status: "succeeded", purchaseStatus: applied.status, entitlementApplied: true };
			}
		}

		const succeeded = await runClaimedJobUpdate(env, job,
			`UPDATE play_verification_jobs SET status='succeeded',purchase_status=?,result_json=?,error_code=NULL,
			 next_attempt_at=NULL,completed_at=datetime('now'),claim_token=NULL,claim_expires_at=NULL,updated_at=datetime('now') WHERE 1=1`,
			[applied.status, JSON.stringify({ purchase_status: applied.status })], "succeeded");
		if (!succeeded) return { status: "superseded", errorCode: "stale_claim", entitlementApplied: true };
		if (job.message_id) await env.orderak_db.prepare(
				"UPDATE play_billing_events SET status='processed',processed_at=datetime('now'),error_code=NULL WHERE message_id=?",
			).bind(job.message_id).run();
		logSignal("play_verification_succeeded", { job_id: job.id, organization_id: organizationId, purchase_status: applied.status });
		return { status: "succeeded", purchaseStatus: applied.status, entitlementApplied: true };
	} catch (error) {
		const playError = error instanceof PlayError
			? error
			: new PlayError("play_verification_internal", { retryable: true });
		const outcome = await updateJobFailure(env, job, playError);
		if (job.message_id && outcome.status === "terminal") {
			await env.orderak_db.prepare(
				"UPDATE play_billing_events SET status='failed',error_code=?,processed_at=datetime('now') WHERE message_id=?",
			).bind(playError.message.slice(0, 100), job.message_id).run();
		}
		return outcome;
	}
}

export async function dispatchPlayVerificationJob(env: Env, jobId: string): Promise<boolean> {
	if (!env.PLAY_BILLING_QUEUE) {
		logSignal("play_outbox_dispatch_unavailable", { job_id: jobId }, "error");
		return false;
	}
	try {
		await env.PLAY_BILLING_QUEUE.send({ version: 1, jobId });
		await env.orderak_db.prepare(
			"UPDATE play_verification_jobs SET dispatched_at=datetime('now'),updated_at=datetime('now') WHERE id=?",
		).bind(jobId).run();
		return true;
	} catch {
		logSignal("play_outbox_dispatch_failed", { job_id: jobId }, "error");
		return false;
	}
}

/** One-minute outbox sweep for jobs whose D1 commit succeeded before Queue send. */
export async function dispatchPendingPlayJobs(env: Env, limit = 100): Promise<number> {
	if (!lifecycleEnabled(env) || !env.PLAY_BILLING_QUEUE) return 0;
	const { results } = await env.orderak_db.prepare(
		`SELECT id FROM play_verification_jobs
		 WHERE (
		   (status IN ('queued','retrying','applied_ack_pending') AND dispatched_at IS NULL
		    AND (next_attempt_at IS NULL OR next_attempt_at<=datetime('now')))
		   OR (status='processing' AND claim_expires_at IS NOT NULL AND claim_expires_at<=datetime('now'))
		 )
		 ORDER BY created_at LIMIT ?`,
	).bind(limit).all<{ id: string }>();
	let dispatched = 0;
	for (const row of results ?? []) if (await dispatchPlayVerificationJob(env, row.id)) dispatched += 1;
	return dispatched;
}

async function recordSystemAudit(env: Env, action: string, entityId: string, details: Json): Promise<void> {
	try {
		await env.orderak_db.prepare(
			`INSERT INTO admin_audit(admin_id,action,entity,entity_id,details_json)
			 VALUES(NULL,?,'play_verification_job',?,?)`,
		).bind(action, entityId, JSON.stringify(details)).run();
	} catch (error) {
		logSignal("billing_audit_write_failed", { action, entity_id: entityId, error: error instanceof Error ? error.message : "unknown" }, "error");
	}
}

async function recordBillingAlert(
	env: Env,
	kind: "play_billing_dlq" | "play_billing_security_conflict",
	jobId: string,
	details: Json,
): Promise<void> {
	const fingerprint = `${kind}:${jobId}`;
	try {
		const existing = await env.orderak_db.prepare(
			"SELECT id FROM security_alerts WHERE fingerprint=? AND status!='resolved' ORDER BY last_seen_at DESC LIMIT 1",
		).bind(fingerprint).first<{ id: string }>();
		if (existing) {
			await env.orderak_db.prepare(
				`UPDATE security_alerts SET occurrence_count=occurrence_count+1,last_seen_at=datetime('now'),
				 details_json=? WHERE id=?`,
			).bind(JSON.stringify(details), existing.id).run();
		} else {
			await env.orderak_db.prepare(
				`INSERT INTO security_alerts(id,severity,kind,fingerprint,title,details_json)
				 VALUES(?,'critical',?,?,?,?)`,
			).bind(
				crypto.randomUUID(),
				kind,
				fingerprint,
				kind === "play_billing_dlq" ? "Google Play verification dead-lettered" : "Google Play security conflict",
				JSON.stringify(details),
			).run();
		}
	} catch (error) {
		logSignal("billing_alert_write_failed", { kind, job_id: jobId, error: error instanceof Error ? error.message : "unknown" }, "error");
	}
}

export async function markPlayVerificationDeadLetter(env: Env, jobId: string): Promise<void> {
	const job = await loadJob(env, jobId);
	if (!job) return;
	const transition = await env.orderak_db.prepare(
		`UPDATE play_verification_jobs SET status='dead_lettered',error_code=COALESCE(error_code,'retry_exhausted'),
		 completed_at=datetime('now'),claim_token=NULL,claim_expires_at=NULL,updated_at=datetime('now')
		 WHERE id=? AND status NOT IN ('succeeded','terminal_failed','superseded','dead_lettered')
		 AND (status!='processing' OR claim_expires_at IS NULL OR claim_expires_at<=datetime('now'))`,
	).bind(jobId).run();
	if (Number(transition.meta.changes ?? 0) === 0) {
		logSignal("play_dlq_transition_deferred", { job_id: jobId, prior_status: job.status });
		return;
	}
	await recordSystemAudit(env, "billing.verification_dead_lettered", jobId, {
		organization_id: job.organization_id,
		attempt_count: job.attempt_count,
		error_code: job.error_code ?? "retry_exhausted",
	});
	await recordBillingAlert(env, "play_billing_dlq", jobId, {
		organization_id: job.organization_id,
		attempt_count: job.attempt_count,
		error_code: job.error_code ?? "retry_exhausted",
	});
	logSignal("play_verification_dlq", { job_id: jobId, organization_id: job.organization_id }, "error");
}

export async function requeuePlayVerificationJob(
	env: Env,
	jobId: string,
	sellerId: string | null = null,
): Promise<string | null> {
	const old = await loadJob(env, jobId);
	if (!old || old.status !== "dead_lettered") return null;
	const existing = await env.orderak_db.prepare(
		"SELECT id FROM play_verification_jobs WHERE requeued_from_job_id=?",
	).bind(jobId).first<{ id: string }>();
	if (existing) return existing.id;
	const newId = crypto.randomUUID();
	try {
		await env.orderak_db.prepare(
			`INSERT INTO play_verification_jobs(
			 id,organization_id,seller_id,purchase_token_hash,purchase_token_encrypted,source,status,requeued_from_job_id)
			 VALUES(?,?,?,?,?,'admin','queued',?)`,
		).bind(newId, old.organization_id, sellerId ?? old.seller_id, old.purchase_token_hash, old.purchase_token_encrypted, jobId).run();
		await dispatchPlayVerificationJob(env, newId);
		return newId;
	} catch (error) {
		const raced = await env.orderak_db.prepare(
			"SELECT id FROM play_verification_jobs WHERE requeued_from_job_id=?",
		).bind(jobId).first<{ id: string }>();
		if (raced) return raced.id;
		throw error;
	}
}

async function verificationResponse(env: Env, job: VerificationJob, sellerId: string): Promise<Response> {
	const pending = ["queued", "processing", "retrying"].includes(job.status);
	if (pending) {
		return jsonResponse({
			ok: false,
			pending: true,
			status: "verification_pending",
			verification_id: job.id,
			retry_after_seconds: retryDelay(job.attempt_count + 1),
		});
	}
	if (job.status === "succeeded" || job.status === "applied_ack_pending") {
		return jsonResponse({
			ok: true,
			status: job.status === "applied_ack_pending" ? "acknowledgement_pending" : "succeeded",
			purchase_status: job.purchase_status,
			entitlements: await resolveEntitlements(env, sellerId),
		});
	}
	return jsonResponse({
		ok: false,
		pending: false,
		status: "verification_failed",
		error: job.error_code ?? (job.status === "superseded" ? "verification_superseded" : "verification_failed"),
	}, 409);
}

async function verifyPubSubOidc(request: Request, env: Env): Promise<boolean> {
	const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
	if (!bearer || !env.GOOGLE_PLAY_PUBSUB_AUDIENCE || !env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL) return false;

	// Local-first: verify with jose JWKS (removes Google network round-trip).
	// Falls back to remote verification on failure — never fails open.
	const localEnabled = (env as unknown as Record<string, unknown>).LOCAL_JWT_VERIFICATION === "true";
	if (localEnabled) {
		const claims = await verifyGoogleIdToken(bearer, env.GOOGLE_PLAY_PUBSUB_AUDIENCE);
		if (claims) {
			const emailVerified = claims.email_verified === true;
			return claims.aud === env.GOOGLE_PLAY_PUBSUB_AUDIENCE
				&& emailVerified
				&& claims.email === env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL;
		}
		// Local verification failed — fall through to remote (safe-fallback).
	}

	// Remote verification (existing path).
	let tokenInfo: Response;
	try {
		tokenInfo = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(bearer)}`, { signal: timeoutSignal() });
	} catch {
		return false;
	}
	if (!tokenInfo.ok) return false;
	const claims = await tokenInfo.json<Json>();
	const emailVerified = claims.email_verified === "true" || claims.email_verified === true;
	return claims.aud === env.GOOGLE_PLAY_PUBSUB_AUDIENCE
		&& emailVerified
		&& claims.email === env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL;
}

async function handleRtdn(request: Request, env: Env): Promise<Response> {
	if (!lifecycleEnabled(env)) return jsonResponse({ error: "billing_lifecycle_disabled" }, 403);
	if (!await verifyPubSubOidc(request, env)) return jsonResponse({ error: "unauthorized" }, 401);
	const envelope = await request.json<Json>().catch(() => ({} as Json));
	const message = envelope.message as Json | undefined;
	const messageId = String(message?.messageId ?? message?.message_id ?? "");
	if (!messageId || !message?.data) return jsonResponse({ error: "invalid_pubsub_message" }, 400);

	const existing = await env.orderak_db.prepare(
		`SELECT j.id,j.dispatched_at,j.status FROM play_verification_jobs j WHERE j.message_id=?`,
	).bind(messageId).first<{ id: string; dispatched_at: string | null; status: string }>();
	if (existing) {
		if (!existing.dispatched_at && ["queued", "retrying", "applied_ack_pending"].includes(existing.status)) {
			await dispatchPlayVerificationJob(env, existing.id);
		}
		return jsonResponse({ ok: true, duplicate: true });
	}

	let data: Json;
	try {
		data = JSON.parse(new TextDecoder().decode(
			Uint8Array.from(atob(String(message.data)), (character) => character.charCodeAt(0)),
		)) as Json;
	} catch {
		await env.orderak_db.prepare(
			"INSERT OR IGNORE INTO play_billing_events(message_id,status,error_code,processed_at) VALUES(?,'failed','malformed_notification',datetime('now'))",
		).bind(messageId).run();
		return jsonResponse({ ok: true, terminal: true });
	}
	const notification = data.subscriptionNotification as Json | undefined;
	const purchaseToken = String(notification?.purchaseToken ?? "");
	if (!purchaseToken) {
		await env.orderak_db.prepare(
			"INSERT OR IGNORE INTO play_billing_events(message_id,status,error_code,processed_at) VALUES(?,'failed','malformed_purchase_token',datetime('now'))",
		).bind(messageId).run();
		return jsonResponse({ ok: true, terminal: true });
	}
	const tokenHash = await sha256(purchaseToken);
	const encrypted = await encryptToken(env, purchaseToken);
	const jobId = crypto.randomUUID();
	const packageName = String(data.packageName ?? "");
	const expectedPackage = env.GOOGLE_PLAY_PACKAGE_NAME || "app.orderak.seller";
	const packageMismatch = Boolean(packageName && packageName !== expectedPackage);
	try {
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				`INSERT INTO play_billing_events(
				 message_id,notification_type,purchase_token_hash,event_time,status,error_code,verification_job_id,processed_at)
				 VALUES(?,?,?,?,?,?,?,?)`,
			).bind(
				messageId,
				notification?.notificationType ?? null,
				tokenHash,
				data.eventTimeMillis ? String(data.eventTimeMillis) : null,
				packageMismatch ? "failed" : "received",
				packageMismatch ? "package_mismatch" : null,
				jobId,
				packageMismatch ? new Date().toISOString() : null,
			),
			env.orderak_db.prepare(
				`INSERT INTO play_verification_jobs(
				 id,purchase_token_hash,purchase_token_encrypted,source,message_id,event_time,status,error_code,completed_at)
				 VALUES(?,?,?,'rtdn',?,?,?,?,?)`,
			).bind(
				jobId,
				tokenHash,
				encrypted,
				messageId,
				data.eventTimeMillis ? String(data.eventTimeMillis) : null,
				packageMismatch ? "terminal_failed" : "queued",
				packageMismatch ? "package_mismatch" : null,
				packageMismatch ? new Date().toISOString() : null,
			),
		]);
	} catch {
		const raced = await env.orderak_db.prepare("SELECT id FROM play_verification_jobs WHERE message_id=?")
			.bind(messageId).first<{ id: string }>();
		if (raced) return jsonResponse({ ok: true, duplicate: true });
		throw new PlayError("rtdn_persistence_failed", { retryable: true });
	}
	if (packageMismatch) {
		logSignal("play_security_conflict", { job_id: jobId, error_code: "package_mismatch" }, "error");
		await recordSystemAudit(env, "billing.security_conflict", jobId, { error_code: "package_mismatch" });
		await recordBillingAlert(env, "play_billing_security_conflict", jobId, { error_code: "package_mismatch" });
		return jsonResponse({ ok: true, terminal: true });
	}
	// Pub/Sub receives success once D1 is durable. The outbox sweep recovers a
	// queue send failure without asking Pub/Sub to redeliver the event.
	await dispatchPlayVerificationJob(env, jobId);
	return jsonResponse({ ok: true });
}

export async function handleGooglePlayRoutes(
	request: Request,
	env: Env,
	url: URL,
	authenticatedSeller?: AuthenticatedSeller | null,
): Promise<Response | null> {
	if (url.pathname === "/api/v1/billing/catalog" && request.method === "GET") {
		const enabled = await acquisitionEnabled(env);
		const { results } = await env.orderak_db.prepare(
			`SELECT sp.plan_key,sp.name,ppm.product_id,ppm.base_plan_id,ppm.price_snapshot_json
			 FROM play_product_mappings ppm JOIN subscription_plans sp ON sp.id=ppm.plan_id
			 WHERE ppm.active=1 ORDER BY sp.sort_order,ppm.base_plan_id`,
		).all<Json>();
		return jsonResponse({
			ok: true,
			billing_enabled: enabled,
			lifecycle_enabled: lifecycleEnabled(env),
			products: enabled ? results ?? [] : [],
		});
	}

	if (url.pathname === "/api/v1/billing/google/verify" && request.method === "POST") {
		if (!lifecycleEnabled(env)) return jsonResponse({ error: "billing_lifecycle_disabled" }, 403);
		const { phone, secret } = readCreds(request, url);
		const seller = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
		if (!seller) return jsonResponse({ error: "auth" }, 401);
		const body = await request.json<Json>().catch(() => ({} as Json));
		const purchaseToken = String(body.purchase_token ?? "");
		if (!purchaseToken || purchaseToken.length > 4096) return jsonResponse({ error: "purchase_token_required" }, 400);
		const organizationId = await ensureOrganizationForStore(env, String(seller.id), String(seller.store_name ?? "Orderak organization"));
		if (!organizationId) return jsonResponse({ error: "entitlements_not_ready" }, 503);
		const job = await createVerificationJob(env, {
			organizationId,
			sellerId: String(seller.id),
			purchaseToken,
			source: "direct",
		});
		const outcome = await verifyAndApplyPlayPurchase(env, job.id);
		if (outcome.status === "succeeded" || outcome.entitlementApplied) {
			if (outcome.status === "retry") await dispatchPlayVerificationJob(env, job.id);
			return jsonResponse({
				ok: true,
				purchase_status: outcome.purchaseStatus,
				entitlements: await resolveEntitlements(env, String(seller.id)),
			});
		}
		if (outcome.status === "retry") {
			await dispatchPlayVerificationJob(env, job.id);
			return jsonResponse({
				ok: false,
				pending: true,
				status: "verification_pending",
				verification_id: job.id,
				retry_after_seconds: Math.max(15, outcome.retryAfterSeconds ?? 15),
			}, 202, { "retry-after": String(Math.max(15, outcome.retryAfterSeconds ?? 15)) });
		}
		return jsonResponse({ error: outcome.errorCode ?? "play_verification_failed" }, 409);
	}

	const verificationMatch = url.pathname.match(/^\/api\/v1\/billing\/verifications\/([0-9a-f-]+)$/i);
	if (verificationMatch && request.method === "GET") {
		if (!lifecycleEnabled(env)) return jsonResponse({ error: "billing_lifecycle_disabled" }, 403);
		const { phone, secret } = readCreds(request, url);
		const seller = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
		if (!seller) return jsonResponse({ error: "auth" }, 401);
		const job = await loadJob(env, verificationMatch[1]);
		if (!job || job.seller_id !== String(seller.id)) return jsonResponse({ error: "verification_not_found" }, 404);
		return verificationResponse(env, job, String(seller.id));
	}

	if (url.pathname === "/api/integrations/v1/google-play/rtdn" && request.method === "POST") {
		return handleRtdn(request, env);
	}
	return null;
}

/** Daily safety net: enqueue least-recently-verified purchases; never writes entitlement state. */
export async function reconcileGooglePlayPurchases(env: Env): Promise<number> {
	if (!lifecycleEnabled(env)) return 0;
	const { results } = await env.orderak_db.prepare(
		`SELECT pp.organization_id,os.store_id AS seller_id,pp.purchase_token_hash,pp.purchase_token_encrypted
		 FROM play_purchases pp
		 LEFT JOIN organization_stores os ON os.organization_id=pp.organization_id AND os.is_primary=1
		 WHERE pp.state IN ('active','grace','canceled','pending','on_hold','paused')
		 AND NOT EXISTS(
		   SELECT 1 FROM play_verification_jobs j WHERE j.purchase_token_hash=pp.purchase_token_hash
		   AND j.status IN ('queued','processing','retrying','applied_ack_pending')
		 )
		 ORDER BY pp.last_verified_at ASC LIMIT 100`,
	).all<{ organization_id: string; seller_id: string | null; purchase_token_hash: string; purchase_token_encrypted: string }>();
	let enqueued = 0;
	for (const row of results ?? []) {
		const jobId = crypto.randomUUID();
		await env.orderak_db.prepare(
			`INSERT INTO play_verification_jobs(
			 id,organization_id,seller_id,purchase_token_hash,purchase_token_encrypted,source)
			 VALUES(?,?,?,?,?,'reconcile')`,
		).bind(jobId, row.organization_id, row.seller_id, row.purchase_token_hash, row.purchase_token_encrypted).run();
		await dispatchPlayVerificationJob(env, jobId);
		enqueued += 1;
	}
	return enqueued;
}

/** Idempotent observed maintenance backfill required before acquisition. */
export async function backfillPlayAccountHashes(env: Env, limit = 100): Promise<number> {
	const { results } = await env.orderak_db.prepare(
		"SELECT id FROM organizations WHERE play_account_hash IS NULL ORDER BY created_at LIMIT ?",
	).bind(limit).all<{ id: string }>();
	let updated = 0;
	for (const organization of results ?? []) {
		const result = await env.orderak_db.prepare(
			"UPDATE organizations SET play_account_hash=?,updated_at=datetime('now') WHERE id=? AND play_account_hash IS NULL",
		).bind(await sha256(organization.id), organization.id).run();
		updated += Number(result.meta.changes ?? 0);
	}
	if (updated > 0) logSignal("play_account_hash_backfill", { updated });
	return updated;
}
