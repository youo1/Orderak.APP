// ============================================================
// Email persistence layer (all D1 access lives here).
//
// Template resolution rule:
//   DB override (email_template_translations) wins; otherwise the
//   code seed (seeds.ts) is used. This means the app works before
//   any admin edits, and edits never require a redeploy.
// ============================================================

import { SEED_TEMPLATES, SEED_BY_KEY, type TemplateCategory } from "./seeds";

export type Lang = "ar" | "en" | "fr";

export interface ResolvedTemplate {
	subject: string;
	html: string;
	text: string;
	/** "db" if this came from an admin override, "seed" if from code. */
	source: "db" | "seed";
	version: number;
}

export interface TemplateSummary {
	key: string;
	category: TemplateCategory;
	enabled: boolean;
	langs: Lang[]; // languages that have a DB override
}

interface TranslationRow {
	template_key: string;
	lang: string;
	subject: string;
	html: string;
	text: string;
	version: number;
	updated_at?: string;
}

const LANGS: Lang[] = ["ar", "en", "fr"];

function normLang(lang: string): Lang {
	return lang === "ar" || lang === "fr" ? lang : "en";
}

// ---------------------------------------------------------------------------
// Resolution for sending
// ---------------------------------------------------------------------------

/** Resolve the template to actually send: DB override → seed fallback. */
export async function resolveForSend(
	env: Env,
	key: string,
	lang: string,
): Promise<ResolvedTemplate | null> {
	const l = normLang(lang);

	const row = (await env.orderak_db
		.prepare(
			"SELECT subject, html, text, version FROM email_template_translations WHERE template_key = ? AND lang = ?",
		)
		.bind(key, l)
		.first()) as TranslationRow | null;

	if (row && (row.subject || row.html || row.text)) {
		return {
			subject: row.subject,
			html: row.html,
			text: row.text,
			source: "db",
			version: row.version,
		};
	}

	// Fall back to the code seed (try requested lang, then the other).
	const seed = SEED_BY_KEY[key];
	if (!seed) return null;
	const tr = seed.translations[l] ?? seed.translations.en ?? seed.translations.ar;
	return { subject: tr.subject, html: tr.html, text: tr.text, source: "seed", version: 0 };
}

// ---------------------------------------------------------------------------
// Admin listing / editing
// ---------------------------------------------------------------------------

/** List every known template (seed keys), noting which langs are overridden. */
export async function listTemplates(env: Env): Promise<TemplateSummary[]> {
	const { results } = await env.orderak_db
		.prepare("SELECT key, category, enabled FROM email_templates")
		.all();
	const dbMeta = new Map<string, { category: string; enabled: number }>();
	for (const r of (results ?? []) as Record<string, unknown>[]) {
		dbMeta.set(String(r.key), { category: String(r.category), enabled: Number(r.enabled) });
	}

	const { results: trs } = await env.orderak_db
		.prepare("SELECT template_key, lang FROM email_template_translations")
		.all();
	const overrides = new Map<string, Set<Lang>>();
	for (const r of (trs ?? []) as Record<string, unknown>[]) {
		const k = String(r.template_key);
		if (!overrides.has(k)) overrides.set(k, new Set());
		overrides.get(k)!.add(normLang(String(r.lang)));
	}

	return SEED_TEMPLATES.map((seed) => {
		const meta = dbMeta.get(seed.key);
		return {
			key: seed.key,
			category: (meta?.category as TemplateCategory) ?? seed.category,
			enabled: meta ? meta.enabled === 1 : true,
			langs: [...(overrides.get(seed.key) ?? new Set<Lang>())],
		};
	});
}

/** Get one template's content per language for the editor (override or seed). */
export async function getTemplateForEdit(
	env: Env,
	key: string,
): Promise<{
	key: string;
	category: TemplateCategory;
	enabled: boolean;
	translations: Record<Lang, ResolvedTemplate>;
} | null> {
	const seed = SEED_BY_KEY[key];
	if (!seed) return null;

	const meta = (await env.orderak_db
		.prepare("SELECT category, enabled FROM email_templates WHERE key = ?")
		.bind(key)
		.first()) as { category: string; enabled: number } | null;

	const translations = {} as Record<Lang, ResolvedTemplate>;
	for (const l of LANGS) {
		translations[l] = (await resolveForSend(env, key, l))!;
	}

	return {
		key,
		category: (meta?.category as TemplateCategory) ?? seed.category,
		enabled: meta ? meta.enabled === 1 : true,
		translations,
	};
}

/** Save an admin override for (key, lang): bumps version + writes history. */
export async function saveTranslation(
	env: Env,
	key: string,
	lang: string,
	content: { subject: string; html: string; text: string },
	adminId: number | null,
	ip: string | null,
): Promise<{ version: number }> {
	const seed = SEED_BY_KEY[key];
	if (!seed) throw new Error("unknown_template");
	const l = normLang(lang);

	// Ensure the header row exists.
	await env.orderak_db
		.prepare(
			"INSERT INTO email_templates (key, category) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
		)
		.bind(key, seed.category)
		.run();

	// Next version = current + 1.
	const prev = (await env.orderak_db
		.prepare("SELECT version FROM email_template_translations WHERE template_key = ? AND lang = ?")
		.bind(key, l)
		.first()) as { version: number } | null;
	const version = (prev?.version ?? 0) + 1;

	await env.orderak_db
		.prepare(
			`INSERT INTO email_template_translations (template_key, lang, subject, html, text, version, updated_by, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(template_key, lang) DO UPDATE SET
			   subject = excluded.subject,
			   html = excluded.html,
			   text = excluded.text,
			   version = excluded.version,
			   updated_by = excluded.updated_by,
			   updated_at = datetime('now')`,
		)
		.bind(key, l, content.subject, content.html, content.text, version, adminId)
		.run();

	// Append to history (for audit + restore).
	await env.orderak_db
		.prepare(
			`INSERT INTO email_template_history (template_key, lang, subject, html, text, version, changed_by, changed_ip)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(key, l, content.subject, content.html, content.text, version, adminId, ip)
		.run();

	await env.orderak_db
		.prepare("UPDATE email_templates SET current_version = ?, updated_at = datetime('now') WHERE key = ?")
		.bind(version, key)
		.run();

	return { version };
}

/** Enable/disable a template (disabled templates are skipped on send). */
export async function setTemplateEnabled(env: Env, key: string, enabled: boolean): Promise<void> {
	const seed = SEED_BY_KEY[key];
	if (!seed) throw new Error("unknown_template");
	await env.orderak_db
		.prepare(
			`INSERT INTO email_templates (key, category, enabled) VALUES (?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`,
		)
		.bind(key, seed.category, enabled ? 1 : 0)
		.run();
}

/** Is a template enabled? (missing header row = enabled by default) */
export async function isEnabled(env: Env, key: string): Promise<boolean> {
	const row = (await env.orderak_db
		.prepare("SELECT enabled FROM email_templates WHERE key = ?")
		.bind(key)
		.first()) as { enabled: number } | null;
	return row ? row.enabled === 1 : true;
}

/** Version history for (key, lang), newest first. */
export async function getHistory(env: Env, key: string, lang: string): Promise<Record<string, unknown>[]> {
	const { results } = await env.orderak_db
		.prepare(
			`SELECT id, version, subject, changed_by, changed_ip, changed_at
			 FROM email_template_history
			 WHERE template_key = ? AND lang = ?
			 ORDER BY id DESC LIMIT 50`,
		)
		.bind(key, normLang(lang))
		.all();
	return (results ?? []) as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Events (send log + webhook)
// ---------------------------------------------------------------------------

export async function recordEvent(
	env: Env,
	e: {
		to?: string | null;
		templateKey?: string | null;
		providerId?: string | null;
		event: string;
		error?: string | null;
		meta?: unknown;
	},
): Promise<void> {
	try {
		await env.orderak_db
			.prepare(
				`INSERT INTO email_events (to_addr, template_key, provider_id, event, error, meta_json)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				e.to ?? null,
				e.templateKey ?? null,
				e.providerId ?? null,
				e.event,
				e.error ?? null,
				e.meta !== undefined ? JSON.stringify(e.meta) : null,
			)
			.run();
	} catch (err) {
		console.error("recordEvent failed:", err);
	}
}

export async function listEvents(env: Env, limit = 100): Promise<Record<string, unknown>[]> {
	const lim = Math.min(500, Math.max(1, limit));
	const { results } = await env.orderak_db
		.prepare(
			`SELECT id, to_addr, template_key, provider_id, event, error, created_at
			 FROM email_events ORDER BY id DESC LIMIT ?`,
		)
		.bind(lim)
		.all();
	return (results ?? []) as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Inbound email (Cloudflare Email Routing → Worker `email()` handler)
// ---------------------------------------------------------------------------

export interface InboundEmailInput {
	to: string;
	from: string;
	subject: string;
	text: string;
	html: string;
	messageId?: string | null;
	size?: number;
	forwarded?: boolean;
}

/** Store one received message. Returns the new row id. */
export async function recordInbound(env: Env, e: InboundEmailInput): Promise<number> {
	const row = (await env.orderak_db
		.prepare(
			`INSERT INTO inbound_emails (to_addr, from_addr, subject, text_body, html_body, message_id, size, forwarded)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
		)
		.bind(
			e.to.slice(0, 320),
			e.from.slice(0, 320),
			(e.subject ?? "").slice(0, 500),
			e.text ?? "",
			e.html ?? "",
			e.messageId ?? null,
			Math.max(0, Math.floor(e.size ?? 0)),
			e.forwarded ? 1 : 0,
		)
		.first()) as { id: number } | null;
	return row?.id ?? 0;
}

/** List received messages (newest first). Body columns omitted for the list view. */
export async function listInbound(env: Env, limit = 100): Promise<Record<string, unknown>[]> {
	const lim = Math.min(500, Math.max(1, limit));
	const { results } = await env.orderak_db
		.prepare(
			`SELECT id, to_addr, from_addr, subject, size, forwarded, read_at, received_at
			 FROM inbound_emails ORDER BY id DESC LIMIT ?`,
		)
		.bind(lim)
		.all();
	return (results ?? []) as Record<string, unknown>[];
}

/** Full single message (includes bodies). Marks it read as a side effect. */
export async function getInbound(env: Env, id: number): Promise<Record<string, unknown> | null> {
	const row = (await env.orderak_db
		.prepare(
			`SELECT id, to_addr, from_addr, subject, text_body, html_body, message_id, size, forwarded, read_at, received_at
			 FROM inbound_emails WHERE id = ?`,
		)
		.bind(id)
		.first()) as Record<string, unknown> | null;
	return row;
}

/** Mark a message read (idempotent). */
export async function markInboundRead(env: Env, id: number): Promise<void> {
	await env.orderak_db
		.prepare("UPDATE inbound_emails SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL")
		.bind(id)
		.run();
}

/** Count of unread messages (for the nav badge). */
export async function countInboundUnread(env: Env): Promise<number> {
	const row = (await env.orderak_db
		.prepare("SELECT COUNT(*) AS c FROM inbound_emails WHERE read_at IS NULL")
		.first()) as { c: number } | null;
	return row?.c ?? 0;
}


