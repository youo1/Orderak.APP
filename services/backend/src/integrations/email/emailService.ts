// ============================================================
// EmailService — the ONLY email entry point for business logic.
//
//   import { getEmailService } from "./email/emailService";
//   const email = getEmailService(env, ctx);
//   await email.send("admin_password_reset", to, { code, reset_url }, "ar");
//
// Business code never touches the email provider, D1, or rendering
// directly. Provider + transport are chosen here, so swapping the
// provider or adding a real Queue later is a one-file change.
// ============================================================

import type { EmailProvider } from "./providers/provider";
import { CloudflareEmailProvider, NoopProvider } from "./providers/cloudflare";

import { DirectTransport, QueueTransport, type Transport } from "./emailQueue";
import { renderTemplate, type TemplateData } from "./renderer";
import { resolveForSend, isEnabled, recordEvent } from "./repository";

/** Default From — override per-message if needed. */
const DEFAULT_FROM = "Orderak <no-reply@orderak.app>";
/** Where human replies should land (Cloudflare Email Routing → inbox). */
const DEFAULT_REPLY_TO = "support@orderak.app";

export interface SendResult {
	ok: boolean;
	id?: string;
	error?: string;
	/** True when queued/backgrounded (no synchronous provider result). */
	queued?: boolean;
	skipped?: "disabled" | "unknown_template";
}

export class EmailService {
	constructor(
		private env: Env,
		private provider: EmailProvider,
		private transport: Transport,
	) {}

	/**
	 * Render a template (DB override → seed) and dispatch it.
	 * Missing template / disabled template is a no-op (logged), never throws.
	 */
	async send(
		key: string,
		to: string,
		data: TemplateData = {},
		lang = "ar",
		opts: { from?: string; replyTo?: string; privateRecipient?: boolean } = {},
	): Promise<SendResult> {
		if (!(await isEnabled(this.env, key))) {
			await recordEvent(this.env, { to, templateKey: key, event: "skipped_disabled" });
			return { ok: false, skipped: "disabled" };
		}

		const tpl = await resolveForSend(this.env, key, lang);
		if (!tpl) {
			console.error(`[email] unknown template: ${key}`);
			return { ok: false, skipped: "unknown_template" };
		}

		const { subject, html, text, missing } = renderTemplate(tpl, data);
		if (missing.length) {
			// Not fatal — defaults may cover it — but worth surfacing.
			console.warn(`[email] template ${key} missing vars: ${missing.join(", ")}`);
		}

		const result = await this.transport.dispatch(this.env, {
			templateKey: key,
			eventRecipient: opts.privateRecipient ? "[private-account-email]" : undefined,
			input: {
				to,
				subject,
				html,
				text,
				from: opts.from ?? DEFAULT_FROM,
				replyTo: opts.replyTo ?? DEFAULT_REPLY_TO,
				tags: {
					template: key,
					...(opts.privateRecipient ? { recipient_privacy: "private" } : {}),
				},
			},
		});

		if (result === null) return { ok: true, queued: true };
		return { ok: result.ok, id: result.id, error: result.error };
	}

	/**
	 * Send pre-rendered content directly (used by the admin "test send",
	 * which renders with admin-supplied sample variables). Awaits the result.
	 */
	async sendRendered(
		to: string,
		content: { subject: string; html: string; text: string },
		templateKey?: string,
	): Promise<SendResult> {
		const result = await this.transport.dispatch(this.env, {
			templateKey,
			input: {
				to,
				subject: content.subject,
				html: content.html,
				text: content.text,
				from: DEFAULT_FROM,
				replyTo: DEFAULT_REPLY_TO,
				tags: templateKey ? { template: templateKey, kind: "test" } : { kind: "test" },
			},
		});
		if (result === null) return { ok: true, queued: true };
		return { ok: result.ok, id: result.id, error: result.error };
	}
}

/**
 * Build an EmailService for this request.
 * - With the Cloudflare `send_email` binding (EMAIL) present → CloudflareEmailProvider;
 *   otherwise NoopProvider (dev-safe: logs instead of sending).
 * - Normal request flows use the durable Queue binding when available.
 * - Calls without an ExecutionContext (for example admin test-send) remain
 *   synchronous so the caller receives the provider result immediately.
 */
export function getEmailService(env: Env, ctx?: ExecutionContext): EmailService {
	const from = env.EMAIL_FROM || DEFAULT_FROM;
	const provider: EmailProvider = env.EMAIL
		? new CloudflareEmailProvider(env.EMAIL, from)
		: new NoopProvider();
	const transport = ctx && env.EMAIL_QUEUE
		? new QueueTransport(env.EMAIL_QUEUE)
		: new DirectTransport(provider);
	return new EmailService(env, provider, transport);
}


