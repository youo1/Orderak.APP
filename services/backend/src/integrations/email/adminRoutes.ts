// ============================================================
// Admin API for the "Emails" tab. Mounted from admin.ts under
// /api/admin/v1/email-templates and /api/admin/v1/email-events.
//
// All routes are permission-gated via the `gate()` helper passed in
// (emails:view for reads, emails:manage for writes) and audited.
// ============================================================

import { jsonResponse } from "../../platform/http/shared";
import { Hono } from "hono";
import type { AdminEnv } from "../../domains/admin/admin-context";
import { auditDb } from "../../domains/admin/admin-auth";
import {
	listTemplates,
	getTemplateForEdit,
	saveTranslation,
	setTemplateEnabled,
	getHistory,
	listEvents,
	resolveForSend,
	listInbound,
	getInbound,
	markInboundRead,
	countInboundUnread,
	type Lang,
} from "./repository";

import { renderTemplate } from "./renderer";
import { getEmailService } from "./emailService";
import { SEED_BY_KEY } from "./seeds";


function normLang(v: unknown): Lang {
	return v === "en" ? "en" : "ar";
}

/**
 * Handle /api/admin/v1/email-* routes. Returns a Response, or null if the
 * path isn't an email route (so admin.ts can keep matching).
 */
/**
 * Email admin routes, mounted by admin.ts.
 *
 * Two prefixes deliberately TERMINATE the chain with a 404 rather than falling
 * through - /inbound-emails/* and /email-templates* - which is what the
 * original did via its trailing `return jsonResponse(..., 404)` and its
 * `if (!p.startsWith(".../email-templates")) return null` guard. The scoped
 * catch-alls at the bottom reproduce that; everything else still falls through.
 */
export const emailAdminApp = new Hono<AdminEnv>();
const em = emailAdminApp;
const B = "/api/admin/v1";

// ---- Event log ----
em.get(`${B}/email-events`, async (c) =>
	c.get("gate")("emails:view") ?? jsonResponse({
		ok: true,
		events: await listEvents(c.env, Number(new URL(c.req.url).searchParams.get("limit")) || 100),
	}));

// ---- Inbound mailbox (Cloudflare Email Routing -> Worker) ----
em.get(`${B}/inbound-emails`, async (c) => {
	const denied = c.get("gate")("emails:view");
	if (denied) return denied;
	return jsonResponse({
		ok: true,
		emails: await listInbound(c.env, Number(new URL(c.req.url).searchParams.get("limit")) || 100),
		unread: await countInboundUnread(c.env),
	});
});

/** Shared by both inbound routes: the id must be a positive finite number. */
function inboundId(raw: string): number | Response {
	const id = Number(raw);
	if (!Number.isFinite(id) || id <= 0) return jsonResponse({ error: "bad_id" }, 400);
	return id;
}

em.get(`${B}/inbound-emails/:id`, async (c) => {
	const id = inboundId(c.req.param("id"));
	if (id instanceof Response) return id;
	const denied = c.get("gate")("emails:view");
	if (denied) return denied;
	const email = await getInbound(c.env, id);
	if (!email) return jsonResponse({ error: "not_found" }, 404);
	await markInboundRead(c.env, id);
	return jsonResponse({ ok: true, email });
});

em.post(`${B}/inbound-emails/:id/read`, async (c) => {
	const id = inboundId(c.req.param("id"));
	if (id instanceof Response) return id;
	const denied = c.get("gate")("emails:manage");
	if (denied) return denied;
	await markInboundRead(c.env, id);
	return jsonResponse({ ok: true });
});

// ---- Templates ----
em.get(`${B}/email-templates`, async (c) =>
	c.get("gate")("emails:view") ?? jsonResponse({ ok: true, templates: await listTemplates(c.env) }));

/** Every per-template route rejects an unknown key the same way. */
em.use(`${B}/email-templates/:key/*`, templateKeyGuard);
em.use(`${B}/email-templates/:key`, templateKeyGuard);
async function templateKeyGuard(c: { req: { param: (k: string) => string } }, next: () => Promise<void>) {
	if (!SEED_BY_KEY[decodeURIComponent(c.req.param("key"))]) {
		return jsonResponse({ error: "unknown_template" }, 404);
	}
	await next();
}
const tkey = (c: { req: { param: (k: string) => string } }) => decodeURIComponent(c.req.param("key"));

// GET /:key  -> content per language for the editor
em.get(`${B}/email-templates/:key`, async (c) =>
	c.get("gate")("emails:view") ?? jsonResponse({ ok: true, template: await getTemplateForEdit(c.env, tkey(c)) }));

// POST /:key  -> save a translation (subject/html/text) for one language
em.post(`${B}/email-templates/:key`, async (c) => {
	const denied = c.get("gate")("emails:manage");
	if (denied) return denied;
	const key = tkey(c), admin = c.get("admin"), request = c.req.raw;
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const lang = normLang(b.lang);
	const content = {
		subject: String(b.subject ?? ""),
		html: String(b.html ?? ""),
		text: String(b.text ?? ""),
	};
	const { version } = await saveTranslation(
		c.env, key, lang, content, admin.sub || null, request.headers.get("cf-connecting-ip"));
	await auditDb(c.env, admin, "admin.email_template_saved", { entity: "email_template", entity_id: `${key}:${lang}`, version }, request);
	return jsonResponse({ ok: true, version });
});

// POST /:key/enabled  -> enable/disable a template
em.post(`${B}/email-templates/:key/enabled`, async (c) => {
	const denied = c.get("gate")("emails:manage");
	if (denied) return denied;
	const key = tkey(c), admin = c.get("admin"), request = c.req.raw;
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const enabled = !(b.enabled === false || b.enabled === 0);
	await setTemplateEnabled(c.env, key, enabled);
	await auditDb(c.env, admin, "admin.email_template_enabled", { entity: "email_template", entity_id: key, enabled }, request);
	return jsonResponse({ ok: true, enabled });
});

// GET /:key/history?lang=ar  -> version history
em.get(`${B}/email-templates/:key/history`, async (c) =>
	c.get("gate")("emails:view") ?? jsonResponse({
		ok: true,
		history: await getHistory(c.env, tkey(c), new URL(c.req.url).searchParams.get("lang") ?? "ar"),
	}));

// POST /:key/preview  -> render with sample vars (no send). For live preview.
em.post(`${B}/email-templates/:key/preview`, async (c) => {
	const denied = c.get("gate")("emails:view");
	if (denied) return denied;
	const b = (await c.req.raw.json().catch(() => ({}))) as Record<string, unknown>;
	const lang = normLang(b.lang);
	const data = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
	// Prefer unsaved editor content if provided; else the stored/seed one.
	const base =
		b.subject !== undefined || b.html !== undefined || b.text !== undefined
			? { subject: String(b.subject ?? ""), html: String(b.html ?? ""), text: String(b.text ?? "") }
			: (await resolveForSend(c.env, tkey(c), lang))!;
	return jsonResponse({ ok: true, rendered: renderTemplate(base, data) });
});

// POST /:key/test  -> render with sample vars and actually send.
em.post(`${B}/email-templates/:key/test`, async (c) => {
	const denied = c.get("gate")("emails:manage");
	if (denied) return denied;
	const key = tkey(c), admin = c.get("admin"), request = c.req.raw;
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const to = String(b.to ?? "").trim();
	if (!to || !to.includes("@")) return jsonResponse({ error: "recipient_required" }, 400);
	const lang = normLang(b.lang);
	const data = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;
	const rendered = renderTemplate((await resolveForSend(c.env, key, lang))!, data);
	// No ctx -> awaits provider so we can report the real result.
	const res = await getEmailService(c.env).sendRendered(to, rendered, key);
	await auditDb(c.env, admin, "admin.email_test_sent", { entity: "email_template", entity_id: `${key}:${lang}`, to }, request);
	return jsonResponse({ ok: res.ok, id: res.id, error: res.error, missing: rendered.missing });
});

// Terminating 404s, scoped to the two prefixes that owned them.
em.all(`${B}/inbound-emails/*`, () => jsonResponse({ error: "not_found" }, 404));
em.all(`${B}/email-templates`, () => jsonResponse({ error: "not_found" }, 404));
em.all(`${B}/email-templates/*`, () => jsonResponse({ error: "not_found" }, 404));
