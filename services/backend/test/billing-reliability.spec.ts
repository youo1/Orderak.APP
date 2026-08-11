import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createEntitlementSchema, createSchema } from "./helpers";
import {
	claimPlayVerificationJob,
	dispatchPendingPlayJobs,
	dispatchPlayVerificationJob,
	markPlayVerificationDeadLetter,
	requeuePlayVerificationJob,
	verifyAndApplyPlayPurchase,
} from "../src/integrations/google-play/google-play";
import {
	acquireProviderPermit,
	ProviderCircuitOpenError,
	recordProviderFailure,
	recordProviderSuccess,
} from "../src/platform/resilience/provider-circuit";

describe("billing reliability controls", () => {
	beforeEach(async () => {
		await createSchema();
		await createEntitlementSchema();
	});

	it("opens after five retryable failures and allows one half-open recovery probe", async () => {
		for (let index = 0; index < 5; index += 1) {
			const permit = await acquireProviderPermit(env, "google_play");
			await recordProviderFailure(env, permit);
		}
		await expect(acquireProviderPermit(env, "google_play")).rejects.toBeInstanceOf(ProviderCircuitOpenError);

		await env.orderak_db.prepare(
			"UPDATE provider_circuit_state SET state='open',cooldown_until=? WHERE provider='google_play'",
		).bind(Math.floor(Date.now() / 1000) - 1).run();
		const probe = await acquireProviderPermit(env, "google_play");
		expect(probe.probe).toBe(true);
		await recordProviderSuccess(env, probe);
		const row = await env.orderak_db.prepare(
			"SELECT state,failure_count FROM provider_circuit_state WHERE provider='google_play'",
		).first<{ state: string; failure_count: number }>();
		expect(row).toMatchObject({ state: "closed", failure_count: 0 });
	});

	it("rejects a stale generation and rolls back the whole entitlement batch", async () => {
		await env.orderak_db.prepare(
			"INSERT INTO organizations(id,name,owner_store_id) VALUES('org-race','Race shop','store-race')",
		).run();
		await env.orderak_db.prepare(
			"INSERT INTO billing_verification_heads(organization_id,latest_generation) VALUES('org-race',2)",
		).run();
		await env.orderak_db.prepare(
			"INSERT INTO play_product_mappings(id,plan_id,product_id,base_plan_id,package_name,active) VALUES('map-race','p-1','orderak.monthly','monthly','app.orderak.seller',1)",
		).run();

		await expect(env.orderak_db.batch([
			env.orderak_db.prepare(
				`INSERT INTO organization_subscriptions(
				 id,organization_id,plan_revision_id,source,status,verification_generation)
				 VALUES('sub-stale','org-race','r-1','google_play','active',1)`,
			),
			env.orderak_db.prepare(
				`INSERT INTO play_purchases(
				 id,organization_id,subscription_id,product_mapping_id,purchase_token_hash,purchase_token_encrypted,state,verification_generation)
				 VALUES('purchase-stale','org-race','sub-stale','map-race','hash-stale','ciphertext','active',1)`,
			),
		])).rejects.toThrow(/stale_play_verification/);
		const subscriptions = await env.orderak_db.prepare(
			"SELECT COUNT(*) count FROM organization_subscriptions WHERE id='sub-stale'",
		).first<{ count: number }>();
		const purchases = await env.orderak_db.prepare(
			"SELECT COUNT(*) count FROM play_purchases WHERE id='purchase-stale'",
		).first<{ count: number }>();
		expect(Number(subscriptions?.count)).toBe(0);
		expect(Number(purchases?.count)).toBe(0);
	});

	it("deduplicates RTDN message IDs and recovers an undispatched outbox job", async () => {
		await env.orderak_db.prepare(
			`INSERT INTO play_verification_jobs(
			 id,purchase_token_hash,purchase_token_encrypted,source,message_id,status)
			 VALUES('job-rtdn','hash-rtdn','ciphertext','rtdn','message-1','queued')`,
		).run();
		await expect(env.orderak_db.prepare(
			`INSERT INTO play_verification_jobs(
			 id,purchase_token_hash,purchase_token_encrypted,source,message_id,status)
			 VALUES('job-duplicate','hash-rtdn','ciphertext','rtdn','message-1','queued')`,
		).run()).rejects.toThrow();

		// Deliberately violates the Env shape: exercises the path taken when the
		// PLAY_BILLING_QUEUE binding is absent at runtime.
		const withoutQueue = { ...env, PLAY_BILLING_QUEUE: undefined } as unknown as TestEnv;
		expect(await dispatchPlayVerificationJob(withoutQueue, "job-rtdn")).toBe(false);
		expect(await dispatchPendingPlayJobs(env)).toBe(1);
		const job = await env.orderak_db.prepare(
			"SELECT dispatched_at FROM play_verification_jobs WHERE id='job-rtdn'",
		).first<{ dispatched_at: string | null }>();
		expect(job?.dispatched_at).not.toBeNull();
	});

	it("allows one atomic claimant and treats an active lease as unavailable", async () => {
		await env.orderak_db.prepare(
			`INSERT INTO play_verification_jobs(
			 id,purchase_token_hash,purchase_token_encrypted,source,status)
			 VALUES('job-claim','hash-claim','ciphertext','direct','queued')`,
		).run();
		const claims = await Promise.all([
			claimPlayVerificationJob(env, "job-claim"),
			claimPlayVerificationJob(env, "job-claim"),
		]);
		expect(claims.filter(Boolean)).toHaveLength(1);
		const claimed = claims.find(Boolean);
		expect(claimed?.attempt_count).toBe(1);
		expect(claimed?.claim_token).toBeTruthy();
		expect(await claimPlayVerificationJob(env, "job-claim")).toBeNull();
	});

	it("acknowledges an active duplicate before token decryption or a provider call", async () => {
		await env.orderak_db.prepare(
			`INSERT INTO play_verification_jobs(
			 id,purchase_token_hash,purchase_token_encrypted,source,status,claim_token,claim_expires_at)
			 VALUES('job-active','hash-active','intentionally.invalid','direct','processing','owner',datetime('now','+2 minutes'))`,
		).run();
		expect(await verifyAndApplyPlayPurchase(env, "job-active")).toMatchObject({
			status: "active_lease",
			errorCode: "active_lease_duplicate",
		});
	});

	it("reclaims an expired lease and rejects the zombie claim token", async () => {
		await env.orderak_db.prepare(
			`INSERT INTO play_verification_jobs(
			 id,purchase_token_hash,purchase_token_encrypted,source,status,attempt_count,
			 claim_token,claim_started_at,claim_expires_at)
			 VALUES('job-zombie','hash-zombie','ciphertext','direct','processing',1,
			 'old-token',datetime('now','-3 minutes'),datetime('now','-1 minute'))`,
		).run();
		const reclaimed = await claimPlayVerificationJob(env, "job-zombie");
		expect(reclaimed?.claim_token).not.toBe("old-token");
		expect(reclaimed?.attempt_count).toBe(2);
		expect(reclaimed?.lease_reclaim_count).toBe(1);
		expect(reclaimed?.last_lease_reclaimed_at).toBeTruthy();

		const zombieWrite = await env.orderak_db.prepare(
			"UPDATE play_verification_jobs SET status='succeeded' WHERE id='job-zombie' AND claim_token='old-token'",
		).run();
		expect(Number(zombieWrite.meta.changes)).toBe(0);
		const row = await env.orderak_db.prepare(
			"SELECT status FROM play_verification_jobs WHERE id='job-zombie'",
		).first<{ status: string }>();
		expect(row?.status).toBe("processing");
	});

	it("redispatches an expired processing claim for crash-after-claim recovery", async () => {
		await env.orderak_db.prepare(
			`INSERT INTO play_verification_jobs(
			 id,purchase_token_hash,purchase_token_encrypted,source,status,claim_token,claim_expires_at,dispatched_at)
			 VALUES('job-crash','hash-crash','ciphertext','direct','processing','abandoned',datetime('now','-1 minute'),datetime('now','-2 minutes'))`,
		).run();
		expect(await dispatchPendingPlayJobs(env)).toBe(1);
	});

	it("persists DLQ state and requeues without decrypting or returning the token", async () => {
		await env.orderak_db.prepare(
			`INSERT INTO play_verification_jobs(
			 id,purchase_token_hash,purchase_token_encrypted,source,status,attempt_count,error_code)
			 VALUES('job-dead','hash-dead','encrypted.secret','direct','retrying',9,'google_play_verify_503')`,
		).run();
		await markPlayVerificationDeadLetter(env, "job-dead");
		const dead = await env.orderak_db.prepare(
			"SELECT status FROM play_verification_jobs WHERE id='job-dead'",
		).first<{ status: string }>();
		expect(dead?.status).toBe("dead_lettered");
		const newId = await requeuePlayVerificationJob(env, "job-dead");
		expect(newId).toBeTruthy();
		expect(await requeuePlayVerificationJob(env, "job-dead")).toBe(newId);
		const children = await env.orderak_db.prepare(
			"SELECT COUNT(*) count FROM play_verification_jobs WHERE requeued_from_job_id='job-dead'",
		).first<{ count: number }>();
		expect(Number(children?.count)).toBe(1);
		const requeued = await env.orderak_db.prepare(
			"SELECT source,status,purchase_token_encrypted FROM play_verification_jobs WHERE id=?",
		).bind(newId).first<{ source: string; status: string; purchase_token_encrypted: string }>();
		expect(requeued).toMatchObject({ source: "admin", status: "queued", purchase_token_encrypted: "encrypted.secret" });
		const audit = await env.orderak_db.prepare(
			"SELECT action FROM admin_audit WHERE entity_id='job-dead'",
		).first<{ action: string }>();
		expect(audit?.action).toBe("billing.verification_dead_lettered");
		const alert = await env.orderak_db.prepare(
			"SELECT severity,kind FROM security_alerts WHERE fingerprint='play_billing_dlq:job-dead'",
		).first<{ severity: string; kind: string }>();
		expect(alert).toMatchObject({ severity: "critical", kind: "play_billing_dlq" });
	});
});
