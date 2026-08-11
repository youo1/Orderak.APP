// ============================================================
// EmailProvider interface — the single swap point.
//
// Business logic never imports a concrete provider. The default is
// CloudflareEmailProvider (Cloudflare Email Sending). To switch to a
// different provider later, implement this interface and change one
// line in emailService.ts.

// ============================================================

export interface SendEmailInput {
	to: string;
	subject: string;
	html: string;
	text: string;
	from?: string;
	replyTo?: string;
	/** Correlates the send with template_key for logging/webhooks. */
	tags?: Record<string, string>;
}

export interface SendEmailResult {
	ok: boolean;
	/** Provider message id (e.g. Cloudflare messageId), when available. */
	id?: string;

	error?: string;
}

export interface EmailProvider {
	readonly name: string;
	send(input: SendEmailInput): Promise<SendEmailResult>;
}
