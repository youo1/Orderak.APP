// ============================================================
// Cloudflare Email Sending provider — sends via the `send_email`
// Workers binding (Cloudflare Email Service).
//
//   env.EMAIL.send({ to, from, subject, html, text, replyTo })
//     → Promise<{ messageId }>   (throws Error with `.code` on failure)
//
// Docs: https://developers.cloudflare.com/email-service/api/v1/send-emails/workers-api/
//
// Requirements:
//   - Workers *Paid* plan (outbound sending).
//   - The sending domain (orderak.app) must be onboarded under
//     Email Service → Email Sending (adds SPF/DKIM/DMARC + cf-bounce MX).
//   - Before the domain is onboarded you can only send to verified
//     destination addresses; after onboarding you can send to anyone.
//
// Also includes NoopProvider, used for local dev when the binding is
// unavailable: it logs and "succeeds" so flows don't break.
// ============================================================

import type { EmailProvider, SendEmailInput, SendEmailResult } from "./provider";

export class CloudflareEmailProvider implements EmailProvider {
	readonly name = "cloudflare";
	constructor(
		private binding: SendEmail,
		private defaultFrom: string,
	) {}

	async send(input: SendEmailInput): Promise<SendEmailResult> {
		try {
			const res = await this.binding.send({
				to: input.to,
				from: input.from || this.defaultFrom,
				subject: input.subject,
				html: input.html,
				text: input.text,
				replyTo: input.replyTo,
				// Cloudflare has no "tags" field; keep the template key as a
				// custom header so it still shows up in message headers/logs.
				headers: input.tags?.template
					? { "X-Orderak-Template": input.tags.template }
					: undefined,
			});
			return { ok: true, id: res.messageId };
		} catch (e) {
			const err = e as { code?: string | number; message?: string };
			const code = err.code !== undefined ? `${err.code}` : "";
			const msg = err.message ?? String(e);
			return { ok: false, error: `cloudflare email ${code}: ${msg}`.replace(/\s+/g, " ").trim() };
		}
	}
}

/** Fallback for local dev / missing binding: logs, never actually sends. */
export class NoopProvider implements EmailProvider {
	readonly name = "noop";
	async send(input: SendEmailInput): Promise<SendEmailResult> {
		const recipient = input.tags?.recipient_privacy === "private" ? "[private]" : input.to;
		console.log(`[email:noop] to=${recipient} subject=${JSON.stringify(input.subject)}`);
		return { ok: true, id: `noop-${crypto.randomUUID()}` };
	}
}
