import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { createSchema } from "./helpers";
import {
	QueueTransport,
	processQueuedEmail,
	sweepUndispatchedEmails,
	type EmailJob,
	type QueuedEmailMessage,
} from "../src/integrations/email/emailQueue";

/**
 * Email used to be queued with no durable record: the whole job went onto the
 * Queue and the row was created by the consumer. A send that failed, or a
 * message that was lost, left nothing behind — no row, no retry, no evidence
 * the mail had been requested.
 *
 * These assert the properties that make it an outbox rather than the shape of
 * the code: the record exists before the Queue does, the consumer reads what to
 * send from that record, an undispatched job is recovered, and content does not
 * outlive delivery.
 */

const job = (to = "seller@example.com"): EmailJob => ({
	input: { to, subject: "Verify", html: "<p>hi</p>", text: "hi" },
	templateKey: "verify",
});

/** Queue double that records sends and can be told to fail. */
function fakeQueue(failing = false) {
	const sent: Array<{ version: number; jobId: string; job?: EmailJob }> = [];
	return {
		sent,
		queue: {
			async send(body: { version: number; jobId: string; job?: EmailJob }) {
				if (failing) throw new Error("queue_unavailable");
				sent.push(body);
			},
		} as unknown as Queue,
	};
}

const rowFor = (id: string) =>
	env.orderak_db
		.prepare("SELECT status, payload, dispatched_at, attempt_count FROM outbound_email_jobs WHERE id=?")
		.bind(id)
		.first<{ status: string; payload: string | null; dispatched_at: string | null; attempt_count: number }>();

describe("email outbox", () => {
	beforeEach(async () => {
		await createSchema();
	});

	it("commits the job before queueing, and sends only an id", async () => {
		const { sent, queue } = fakeQueue();
		await new QueueTransport(queue).dispatch(env, job());

		expect(sent).toHaveLength(1);
		// The message is a wake-up, not the payload — no recipient travels on it.
		expect(sent[0].job).toBeUndefined();
		expect(JSON.stringify(sent[0])).not.toContain("seller@example.com");

		const row = await rowFor(sent[0].jobId);
		expect(row).toMatchObject({ status: "queued" });
		expect(row?.dispatched_at).not.toBeNull();
		expect(JSON.parse(row!.payload!)).toMatchObject({ input: { to: "seller@example.com" } });
	});

	it("keeps the job when the Queue send fails, instead of losing it", async () => {
		const { queue } = fakeQueue(true);
		await new QueueTransport(queue).dispatch(env, job("dropped@example.com"));

		const { results } = await env.orderak_db
			.prepare("SELECT id, status, dispatched_at FROM outbound_email_jobs")
			.all<{ id: string; status: string; dispatched_at: string | null }>();

		// The request that asked for the mail must not fail, and the mail must not
		// vanish: the row survives, undispatched, for the sweep to find.
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ status: "queued", dispatched_at: null });
	});

	it("the sweep re-queues an undispatched job and marks it dispatched", async () => {
		const id = crypto.randomUUID();
		await env.orderak_db.prepare(
			`INSERT INTO outbound_email_jobs(id,status,attempt_count,payload,created_at)
			 VALUES(?,'queued',0,?,datetime('now','-5 minutes'))`,
		).bind(id, JSON.stringify(job())).run();

		const { sent, queue } = fakeQueue();
		const swept = await sweepUndispatchedEmails({ ...env, EMAIL_QUEUE: queue } as unknown as Env);

		expect(swept).toBe(1);
		expect(sent[0].jobId).toBe(id);
		expect((await rowFor(id))?.dispatched_at).not.toBeNull();
	});

	it("the sweep leaves a job that was dispatched, and one too recent to judge", async () => {
		const dispatched = crypto.randomUUID();
		const fresh = crypto.randomUUID();
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				`INSERT INTO outbound_email_jobs(id,status,attempt_count,payload,dispatched_at,created_at)
				 VALUES(?,'queued',0,?,datetime('now'),datetime('now','-5 minutes'))`,
			).bind(dispatched, JSON.stringify(job())),
			// Created just now: a dispatch may still be in flight elsewhere.
			env.orderak_db.prepare(
				`INSERT INTO outbound_email_jobs(id,status,attempt_count,payload)
				 VALUES(?,'queued',0,?)`,
			).bind(fresh, JSON.stringify(job())),
		]);

		const { sent, queue } = fakeQueue();
		const swept = await sweepUndispatchedEmails({ ...env, EMAIL_QUEUE: queue } as unknown as Env);

		expect(swept).toBe(0);
		expect(sent).toHaveLength(0);
	});

	it("the consumer sends what the record says, not what the message says", async () => {
		const { sent, queue } = fakeQueue();
		await new QueueTransport(queue).dispatch(env, job("record@example.com"));
		const { jobId } = sent[0];

		// A message claiming a different recipient must not change what is sent.
		await processQueuedEmail(env, {
			version: 1,
			jobId,
			job: job("attacker@example.com"),
		} as QueuedEmailMessage);

		const event = await env.orderak_db
			.prepare("SELECT to_addr FROM email_events ORDER BY id DESC LIMIT 1")
			.first<{ to_addr: string }>();
		expect(event?.to_addr).toBe("record@example.com");
	});

	it("clears the payload once sent, keeping the delivery record", async () => {
		const { sent, queue } = fakeQueue();
		await new QueueTransport(queue).dispatch(env, job());

		await processQueuedEmail(env, { version: 1, jobId: sent[0].jobId } as QueuedEmailMessage);

		const row = await rowFor(sent[0].jobId);
		expect(row?.status).toBe("sent");
		expect(row?.payload).toBeNull();
	});

	it("still delivers a message queued before the outbox existed", async () => {
		// Old shape: the whole job on the message, no row anywhere.
		const jobId = crypto.randomUUID();
		await processQueuedEmail(env, { version: 1, jobId, job: job("inflight@example.com") });

		expect((await rowFor(jobId))?.status).toBe("sent");
	});

	it("fails a job whose content cannot be reconstructed rather than retrying forever", async () => {
		const jobId = crypto.randomUUID();
		await env.orderak_db.prepare(
			"INSERT INTO outbound_email_jobs(id,status,attempt_count,payload) VALUES(?,'queued',0,NULL)",
		).bind(jobId).run();

		await expect(processQueuedEmail(env, { version: 1, jobId } as QueuedEmailMessage))
			.rejects.toThrow("email_job_payload_missing");
		expect((await rowFor(jobId))?.status).toBe("failed");
	});
});
