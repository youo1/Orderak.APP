import type { EmailProvider, SendEmailInput, SendEmailResult } from "./providers/provider";
import { CloudflareEmailProvider, NoopProvider } from "./providers/cloudflare";
import { recordEvent } from "./repository";

const DEFAULT_FROM = "Orderak <no-reply@orderak.app>";
const EMAIL_LEASE_SECONDS = 120;

export interface EmailJob {
	input: SendEmailInput;
	templateKey?: string;
	/** Alternate value for event logs when the real recipient is private. */
	eventRecipient?: string;
}

export interface QueuedEmailMessage {
	version: 1;
	jobId: string;
	/**
	 * Only present on messages queued before the outbox existed. The job now
	 * lives in outbound_email_jobs.payload; the message is a wake-up carrying an
	 * id. Kept optional so messages already in flight during the rollout still
	 * deliver.
	 */
	job?: EmailJob;
}

export interface Transport {
	readonly name: string;
	dispatch(env: Env, job: EmailJob): Promise<SendEmailResult | null>;
}

async function deliver(provider: EmailProvider, env: Env, job: EmailJob): Promise<SendEmailResult> {
	const result = await provider.send(job.input);
	await recordEvent(env, {
		to: job.eventRecipient ?? job.input.to,
		templateKey: job.templateKey,
		providerId: result.id,
		event: result.ok ? "sent" : "failed",
		error: result.error,
		meta: { provider: provider.name },
	});
	return result;
}

/** Synchronous transport retained for admin test-send and local development. */
export class DirectTransport implements Transport {
	readonly name = "direct";
	constructor(private provider: EmailProvider) {}

	dispatch(env: Env, job: EmailJob): Promise<SendEmailResult> {
		return deliver(this.provider, env, job);
	}
}

/**
 * Durable transport used by normal request flows.
 *
 * Transactional outbox: the job is committed to D1 before anything is queued,
 * and only its id travels on the Queue. Previously the whole job went onto the
 * Queue and the row was created by the consumer, so a failed send or a lost
 * message left no trace that an email had ever been requested.
 *
 * A Queue send that throws is deliberately swallowed. The row is already
 * durable with dispatched_at NULL, which is exactly what sweepUndispatchedEmails
 * looks for, so the mail is recovered a minute later rather than failing the
 * request that asked for it — a seller should not lose a registration because
 * the mail Queue hiccuped.
 */
export class QueueTransport implements Transport {
	readonly name = "queue";
	constructor(private queue: Queue) {}

	async dispatch(env: Env, job: EmailJob): Promise<null> {
		const jobId = crypto.randomUUID();

		await env.orderak_db.prepare(
			`INSERT INTO outbound_email_jobs(id,status,attempt_count,payload)
			 VALUES(?,'queued',0,?)`,
		).bind(jobId, JSON.stringify(job)).run();

		try {
			await this.queue.send({ version: 1, jobId }, { contentType: "json" });
			await env.orderak_db.prepare(
				"UPDATE outbound_email_jobs SET dispatched_at=datetime('now'),updated_at=datetime('now') WHERE id=?",
			).bind(jobId).run();
		} catch {
			console.error(JSON.stringify({ signal: "email_outbox_dispatch_failed", job_id: jobId }));
		}
		return null;
	}
}

/**
 * Re-queue jobs whose D1 commit succeeded but whose Queue send did not.
 *
 * Runs on the admin Worker's one-minute cron beside dispatchPendingPlayJobs,
 * which recovers the same failure for Play verification. Without it a row with
 * dispatched_at NULL would sit queued forever, since nothing else ever looks
 * at it.
 *
 * The age floor avoids racing a dispatch still in flight in another isolate.
 */
export async function sweepUndispatchedEmails(env: Env, limit = 50): Promise<number> {
	const queue = (env as { EMAIL_QUEUE?: Queue }).EMAIL_QUEUE;
	if (!queue) return 0;

	const { results } = await env.orderak_db.prepare(
		`SELECT id FROM outbound_email_jobs
		 WHERE status='queued' AND dispatched_at IS NULL
		   AND created_at <= datetime('now','-60 seconds')
		 ORDER BY created_at LIMIT ?`,
	).bind(limit).all<{ id: string }>();

	let dispatched = 0;
	for (const { id } of results ?? []) {
		try {
			await queue.send({ version: 1, jobId: id }, { contentType: "json" });
			await env.orderak_db.prepare(
				"UPDATE outbound_email_jobs SET dispatched_at=datetime('now'),updated_at=datetime('now') WHERE id=?",
			).bind(id).run();
			dispatched += 1;
		} catch {
			// Leave it queued; the next sweep tries again.
			console.error(JSON.stringify({ signal: "email_outbox_sweep_failed", job_id: id }));
		}
	}
	if (dispatched > 0) {
		console.log(JSON.stringify({ signal: "email_outbox_swept", count: dispatched }));
	}
	return dispatched;
}

function emailProvider(env: Env): EmailProvider {
	const from = env.EMAIL_FROM || DEFAULT_FROM;
	return env.EMAIL ? new CloudflareEmailProvider(env.EMAIL, from) : new NoopProvider();
}

/**
 * Claims and sends one at-least-once Queue message. A completed job is a no-op,
 * while an expired processing lease can be reclaimed after an isolate failure.
 */
export async function processQueuedEmail(env: Env, message: QueuedEmailMessage): Promise<void> {
	if (message.version !== 1 || !message.jobId) {
		throw new Error("email_queue_message_malformed");
	}

	// Messages queued before the outbox carried the whole job and had no row.
	// Insert one for them so a message already in flight during the rollout is
	// still delivered; for anything queued since, the row already exists and
	// OR IGNORE leaves its payload alone.
	await env.orderak_db.prepare(
		`INSERT OR IGNORE INTO outbound_email_jobs(id,status,attempt_count,payload)
		 VALUES(?,'queued',0,?)`,
	).bind(message.jobId, message.job ? JSON.stringify(message.job) : null).run();

	const claimed = await env.orderak_db.prepare(
		`UPDATE outbound_email_jobs
		 SET status='processing',attempt_count=attempt_count+1,
		     lease_expires_at=datetime('now', ?),updated_at=datetime('now')
		 WHERE id=? AND (
		   status IN ('queued','retrying') OR
		   (status='processing' AND lease_expires_at<=datetime('now'))
		 )
		 RETURNING id`,
	).bind(`+${EMAIL_LEASE_SECONDS} seconds`, message.jobId).first<{ id: string }>();

	if (!claimed) {
		const existing = await env.orderak_db.prepare(
			"SELECT status FROM outbound_email_jobs WHERE id=?",
		).bind(message.jobId).first<{ status: string }>();
		if (existing?.status === "sent") return;
		throw new Error("email_job_lease_unavailable");
	}

	// What to send comes from the durable record, not the message. The message
	// is only a wake-up carrying an id; treating it as the source of truth is
	// what made a lost message an unrecoverable one.
	const stored = await env.orderak_db.prepare(
		"SELECT payload FROM outbound_email_jobs WHERE id=?",
	).bind(message.jobId).first<{ payload: string | null }>();

	let job: EmailJob | undefined;
	if (stored?.payload) {
		try {
			job = JSON.parse(stored.payload) as EmailJob;
		} catch {
			job = undefined;
		}
	}
	job ??= message.job;

	if (!job?.input?.to) {
		// Nothing recoverable: fail the row rather than retry a job whose content
		// cannot be reconstructed, which would burn every attempt to no purpose.
		await env.orderak_db.prepare(
			`UPDATE outbound_email_jobs SET status='failed',last_error='email_job_payload_missing',
			 lease_expires_at=NULL,updated_at=datetime('now') WHERE id=?`,
		).bind(message.jobId).run();
		throw new Error("email_job_payload_missing");
	}

	const result = await deliver(emailProvider(env), env, job);
	if (!result.ok) {
		await env.orderak_db.prepare(
			`UPDATE outbound_email_jobs SET status='retrying',last_error=?,lease_expires_at=NULL,
			 updated_at=datetime('now') WHERE id=?`,
		).bind(result.error ?? "email_provider_failed", message.jobId).run();
		throw new Error(result.error ?? "email_provider_failed");
	}

	// payload=NULL on success: the delivery record is worth retaining for 90 days
	// (see the retention job), the recipient address and rendered body are not.
	await env.orderak_db.prepare(
		`UPDATE outbound_email_jobs SET status='sent',provider_id=?,last_error=NULL,
		 lease_expires_at=NULL,payload=NULL,sent_at=datetime('now'),updated_at=datetime('now') WHERE id=?`,
	).bind(result.id ?? null, message.jobId).run();
}

export async function markQueuedEmailDeadLetter(env: Env, message: QueuedEmailMessage): Promise<void> {
	if (!message?.jobId) return;
	await env.orderak_db.prepare(
		`INSERT INTO outbound_email_jobs(id,status,attempt_count,last_error,updated_at)
		 VALUES(?,'failed',1,'dead_lettered',datetime('now'))
		 ON CONFLICT(id) DO UPDATE SET status='failed',last_error='dead_lettered',
		 lease_expires_at=NULL,updated_at=datetime('now')`,
	).bind(message.jobId).run();
}
