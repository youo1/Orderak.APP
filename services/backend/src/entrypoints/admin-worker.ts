import { handleAdminRoutes } from "../domains/admin/admin";
import { archiveAuditBatch, generateExport, markExportDeadLetter } from "../domains/admin/admin-control-plane";
import {
	dispatchPendingPlayJobs,
	markPlayVerificationDeadLetter,
	verifyAndApplyPlayPurchase,
} from "../integrations/google-play/google-play";
import { enforceRequestBodyLimit, jsonResponse } from "../platform/http/shared";
import { sweepUndispatchedEmails } from "../integrations/email/emailQueue";
import { withSentry } from "@sentry/cloudflare";
import { Hono } from "hono";

type QueueBody = AdminExportMessage | PlayBillingQueueMessage;
export type AdminQueueKind = "play" | "play_dlq" | "export" | "export_dlq" | "unknown";

export function classifyAdminQueue(queue: string): AdminQueueKind {
	if (/^orderak-play-billing(?:-staging)?$/.test(queue)) return "play";
	if (/^orderak-play-billing-dlq(?:-staging)?$/.test(queue)) return "play_dlq";
	if (/^orderak-admin-exports(?:-staging)?$/.test(queue)) return "export";
	if (/^orderak-admin-exports-dlq(?:-staging)?$/.test(queue)) return "export_dlq";
	return "unknown";
}

function isPlayMessage(body: unknown): body is PlayBillingQueueMessage {
	return body !== null && typeof body === "object" && "version" in body && body.version === 1
		&& "jobId" in body && typeof body.jobId === "string" && body.jobId.length > 0;
}

function isExportMessage(body: unknown): body is AdminExportMessage {
	return body !== null && typeof body === "object" && "exportId" in body
		&& typeof body.exportId === "string" && body.exportId.length > 0
		&& "requestedBy" in body && Number.isInteger(body.requestedBy);
}

function harden(response: Response): Response {
	const headers = new Headers(response.headers);
	// Request correlation, for the same reason the public Worker stamps it in
	// middleware: the admin contract declares X-Request-ID on every response, and
	// only jsonResponse() was setting one. harden() already runs on every response
	// including 404s and 500s, so it is the one place that cannot be bypassed.
	// Generated, never echoed from the request — an inbound id is caller-controlled
	// and this value reaches the audit trail.
	if (!headers.has("x-request-id")) headers.set("x-request-id", crypto.randomUUID());
	headers.set("cache-control", "no-store");
	headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
	headers.set("cross-origin-resource-policy", "same-origin");
	headers.set("referrer-policy", "no-referrer");
	headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
	headers.set("x-content-type-options", "nosniff");
	headers.set("x-frame-options", "DENY");
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ---- HTTP routing (Hono) ---------------------------------------------------
//
// Hono owns routing only. Two things stay deliberately outside it:
//   * enforceRequestBodyLimit consumes the body stream and returns a *new*
//     Request; swapping the request underneath Hono breaks its body caching.
//   * harden() must apply to every response, including 404s and 500s.
// Both therefore wrap app.fetch() in the exported handler below.

const app = new Hono<{ Bindings: AdminWorkerEnv }>();

const healthBody = { ok: true, service: "orderak-admin-worker", public: false };
app.get("/health", () => jsonResponse(healthBody));
app.get("/api/admin/v1/health", () => jsonResponse(healthBody));

app.all("/api/admin/v1/*", async (c) => {
	const handled = await handleAdminRoutes(c.req.raw, c.env, new URL(c.req.url));
	return handled ?? jsonResponse({ error: "not_found" }, 404);
});

// Anything outside /api/admin/v1/ is not this worker's concern.
app.all("*", () => jsonResponse({ error: "not_found" }, 404));

app.onError((error) => {
	console.error(JSON.stringify({ kind: "admin_worker_error", message: error instanceof Error ? error.message : "unknown" }));
	return jsonResponse({ error: "server" }, 500);
});

export default withSentry<AdminWorkerEnv, QueueBody>(
	// SENTRY_DSN is a Wrangler secret — set via `npx wrangler secret put SENTRY_DSN`.
	// When missing, Sentry is a no-op.
	(env) => {
		const dsn = (env as unknown as Record<string, unknown>).SENTRY_DSN as string | undefined;
		return dsn ? { dsn, tracesSampleRate: 0.1 } : {};
	},
	{
	async fetch(request: Request, env: AdminWorkerEnv, ctx: ExecutionContext): Promise<Response> {
		const bounded = await enforceRequestBodyLimit(request, {
			jsonBytes: 256 * 1024,
			formBytes: 6 * 1024 * 1024,
			otherBytes: 512 * 1024,
		});
		if (bounded instanceof Response) return harden(bounded);
		return harden(await app.fetch(bounded, env, ctx));
	},
	// Awaited rather than handed to ctx.waitUntil(): a cron invocation must
	// fail when its job fails, otherwise the run is reported as successful
	// and a broken job stays invisible.
	async scheduled(controller: ScheduledController, env: AdminWorkerEnv): Promise<void> {
		if (controller.cron === "*/15 * * * *") await archiveAuditBatch(env);
		if (controller.cron === "* * * * *") {
			// Both recover the same failure: a row committed to D1 whose Queue send
			// did not land. Neither is reachable any other way.
			await dispatchPendingPlayJobs(env);
			await sweepUndispatchedEmails(env);
		}
	},
	async queue(batch: MessageBatch<QueueBody>, env: AdminWorkerEnv): Promise<void> {
		const kind = classifyAdminQueue(batch.queue);
		if (kind === "unknown") {
			console.error(JSON.stringify({ signal: "unknown_admin_queue", queue: batch.queue }));
			batch.ackAll();
			return;
		}
		if (kind === "play_dlq") {
			for (const message of batch.messages) {
				const body = message.body as PlayBillingQueueMessage;
				if (isPlayMessage(body)) await markPlayVerificationDeadLetter(env, body.jobId);
				message.ack();
			}
			return;
		}
		if (kind === "play") {
			for (const message of batch.messages) {
				const body = message.body as PlayBillingQueueMessage;
				if (!isPlayMessage(body)) {
					console.error(JSON.stringify({ signal: "play_queue_message_malformed" }));
					message.ack();
					continue;
				}
				try {
					const outcome = await verifyAndApplyPlayPurchase(env, body.jobId);
					if (outcome.status === "retry") {
						message.retry({ delaySeconds: Math.min(21_600, Math.max(30, outcome.retryAfterSeconds ?? 30)) });
					} else {
						message.ack();
					}
				} catch (error) {
					console.error(JSON.stringify({
						signal: "play_queue_consumer_error",
						job_id: body.jobId,
						message: error instanceof Error ? error.message : "unknown",
					}));
					message.retry({ delaySeconds: 30 });
				}
			}
			return;
		}
		if (kind === "export_dlq") {
			for (const message of batch.messages) {
				const body = message.body as AdminExportMessage;
				if (isExportMessage(body)) await markExportDeadLetter(env, body.exportId, body.requestedBy);
				message.ack();
			}
			return;
		}
		for (const message of batch.messages) {
			const body = message.body as AdminExportMessage;
			if (!isExportMessage(body)) {
				console.error(JSON.stringify({ signal: "admin_export_message_malformed" }));
				message.ack();
				continue;
			}
			try {
				await generateExport(env, body.exportId, body.requestedBy);
				message.ack();
			} catch (error) {
				console.error(JSON.stringify({
					signal: "admin_export_consumer_error",
					export_id: body.exportId,
					message: error instanceof Error ? error.message : "unknown",
				}));
				message.retry({ delaySeconds: Math.min(3_600, 30 * (2 ** Math.max(0, message.attempts - 1))) });
			}
		}
	},
} satisfies ExportedHandler<AdminWorkerEnv, QueueBody>);
