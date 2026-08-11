import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { createSchema } from "./helpers";
import { classifyAdminQueue } from "../src/entrypoints/admin-worker";
import { classifyPublicQueue } from "../src/entrypoints/public-worker";
import { checkRateLimit, rateLimiterStub } from "../src/platform/http/shared";
import { processQueuedEmail, type QueuedEmailMessage } from "../src/integrations/email/emailQueue";
import { generateExport } from "../src/domains/admin/admin-control-plane";

describe("Cloudflare scalability safeguards", () => {
	beforeEach(async () => {
		await createSchema();
	});

	it("routes production and staging queue names without falling through", () => {
		expect(classifyAdminQueue("orderak-play-billing")).toBe("play");
		expect(classifyAdminQueue("orderak-play-billing-staging")).toBe("play");
		expect(classifyAdminQueue("orderak-play-billing-dlq-staging")).toBe("play_dlq");
		expect(classifyAdminQueue("orderak-admin-exports-staging")).toBe("export");
		expect(classifyAdminQueue("orderak-admin-exports-dlq-staging")).toBe("export_dlq");
		expect(classifyAdminQueue("unexpected")).toBe("unknown");
		expect(classifyPublicQueue("orderak-email-staging")).toBe("email");
		expect(classifyPublicQueue("orderak-email-dlq-staging")).toBe("email_dlq");
	});

	it("increments rate limits atomically under concurrent calls", async () => {
		const results = await Promise.all(Array.from({ length: 20 }, () => checkRateLimit(env, "atomic:test", 5, 60)));
		// Exactly five of twenty concurrent calls may pass. More would mean an
		// increment was lost to a read-modify-write race.
		expect(results.filter(Boolean)).toHaveLength(5);
		// And every one of the twenty must have been counted.
		const namespace = env.RATE_LIMITER;
		const counter = await (await rateLimiterStub(env, "atomic:test"))!.peek();
		expect(counter).toMatchObject({ count: 20 });
	});

	it("rejects oversized JSON before authentication or route parsing", async () => {
		const response = await SELF.fetch("https://api.orderak.app/api/v1/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "x".repeat(300_000) }),
		});
		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({ code: "request_body_too_large" });
	});

	it("processes duplicate email queue deliveries once", async () => {
		const message: QueuedEmailMessage = {
			version: 1,
			jobId: "email-job-1",
			job: {
				templateKey: "test",
				input: { to: "recipient@example.test", subject: "Subject", html: "<p>Hello</p>", text: "Hello" },
			},
		};
		// Deliberately violates the Env shape: the point of the case is the
		// fallback taken when the EMAIL binding is absent at runtime.
		const localEnv = { ...env, EMAIL: undefined } as unknown as TestEnv;
		await processQueuedEmail(localEnv, message);
		await processQueuedEmail(localEnv, message);
		expect(await env.orderak_db.prepare("SELECT status,attempt_count FROM outbound_email_jobs WHERE id=?").bind(message.jobId).first())
			.toMatchObject({ status: "sent", attempt_count: 1 });
		expect(await env.orderak_db.prepare("SELECT COUNT(*) count FROM email_events WHERE template_key='test'").first<{ count: number }>())
			.toMatchObject({ count: 1 });
	});

	it("paginates admin exports and streams the result to R2", async () => {
		const inserts = Array.from({ length: 600 }, (_, index) => env.orderak_db.prepare(
			"INSERT INTO admin_audit(admin_id,action,entity_id,details_json) VALUES(1,'export.test',?,'{}')",
		).bind(String(index)));
		await env.orderak_db.batch(inserts);
		await env.orderak_db.prepare(
			`INSERT INTO admin_exports(id,export_type,classification,filters_json,status,expires_at,requested_by)
			 VALUES('paged-export','audit','internal','{}','queued',datetime('now','+1 day'),1)`,
		).run();
		await generateExport(env, "paged-export", 1);
		const state = await env.orderak_db.prepare(
			"SELECT status,row_count,attempt_count,r2_key FROM admin_exports WHERE id='paged-export'",
		).first<{ status: string; row_count: number; attempt_count: number; r2_key: string }>();
		expect(state).toMatchObject({ status: "completed", row_count: 600, attempt_count: 1 });
		const object = await env.orderak_audit!.get(state!.r2_key);
		const csv = await object!.text();
		expect(csv.split("\r\n").filter(Boolean)).toHaveLength(601);
	});
});
