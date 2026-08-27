import type { AdminClaims } from "../identity/auth";
import { auditDb } from "./admin-auth";
import {
	DEFAULT_DESIGN_SYSTEM_SOURCE,
	DESIGN_SYSTEM_GENERATOR_VERSION,
	DESIGN_SYSTEM_SCHEMA_VERSION,
	FIRST_SCHEMA_V2_ANDROID_VERSION_CODE,
	MAX_REQUEST_BYTES,
	designSystemCss,
	generateDesignSystem,
	invalidateDesignSystemCache,
	legacyProjection,
	loadActiveDesignSystem,
	type DesignSystemRevision,
} from "../design/design-system";
import { checkRateLimit, jsonResponse } from "../../platform/http/shared";
import { Hono } from "hono";
import type { AdminEnv } from "./admin-context";


function publicRevision(revision: DesignSystemRevision) {
	return {
		id: revision.id,
		name: revision.name,
		schemaVersion: revision.schemaVersion,
		generatorVersion: revision.generatorVersion,
		source: revision.source,
		overrides: revision.overrides,
		snapshot: revision.snapshot,
		validation: revision.validation,
		contentHash: revision.contentHash,
		publishedAt: revision.publishedAt,
		compatibility: {
			firstSchemaV2AndroidVersionCode: FIRST_SCHEMA_V2_ANDROID_VERSION_CODE,
			legacyProjectionPresent: true,
			sunsetGate: "enforced_minimum_version_and_date",
		},
		createdBy: revision.createdBy,
		rollbackOfRevisionId: revision.rollbackOfRevisionId,
	};
}

/**
 * Length in user-perceived characters.
 *
 * `.length` counts UTF-16 units, so an emoji costs two and an Arabic name with
 * combining marks costs more than it looks. Spreading the string counts code
 * points, which fixes that but still splits a flag or a ZWJ sequence into
 * several. A grapheme segmenter counts what someone typing into the field
 * would count, which is the only measure an 80-character limit can mean.
 */
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function normalizeRevisionName(value: unknown): { name: string; key: string } | Response {
	if (typeof value !== "string") return jsonResponse({ error: "revision_name_required" }, 400);
	const name = value.trim();
	let length = 0;
	for (const _ of graphemes.segment(name)) length += 1;
	if (length < 1 || length > 80) {
		return jsonResponse({ error: "invalid_revision_name", minimumLength: 1, maximumLength: 80 }, 422);
	}
	return { name, key: name.normalize("NFKC").toLocaleLowerCase() };
}

async function readBoundedJson(request: Request): Promise<Record<string, unknown> | Response> {
	const declared = Number(request.headers.get("content-length") ?? 0);
	if (declared > MAX_REQUEST_BYTES) return jsonResponse({ error: "payload_too_large", maximumBytes: MAX_REQUEST_BYTES }, 413);
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) return jsonResponse({ error: "payload_too_large", maximumBytes: MAX_REQUEST_BYTES }, 413);
	try {
		const parsed = JSON.parse(text || "{}");
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return jsonResponse({ error: "invalid_json" }, 400);
	}
}

async function rateLimited(env: AdminWorkerEnv, key: string, limit: number, seconds: number): Promise<Response | null> {
	return await checkRateLimit(env, key, limit, seconds)
		? null
		: jsonResponse({ error: "rate_limited", retryAfterSeconds: seconds }, 429, { "retry-after": String(seconds) });
}

/**
 * Theme routes, mounted by admin.ts.
 *
 * NOTE: this module used to guard on startsWith("/api/admin/v1/theme") and then
 * end with a 404 rather than returning null, so an unmatched /theme* path
 * terminated the chain instead of falling through to the project and email
 * handlers. The catch-alls at the bottom preserve that exactly.
 *
 * Handler bodies are unchanged; each destructures the original locals from the
 * Hono context so the code inside stayed byte-for-byte identical.
 */
export const themeApp = new Hono<AdminEnv>();
const th = themeApp;
const TB = "/api/admin/v1/theme";

th.get(TB, async (c) => {
		const request = c.req.raw, env = c.env, gate = c.get("gate");
		const denied = gate("theme:view");
		if (denied) return denied;
		const active = await loadActiveDesignSystem(env, request);
		const currentGenerator = active.generatorVersion === DESIGN_SYSTEM_GENERATOR_VERSION
			? null
			: await generateDesignSystem(active.source);
		return jsonResponse({
			ok: true,
			activeRevisionId: active.id,
			active: publicRevision(active),
			defaults: DEFAULT_DESIGN_SYSTEM_SOURCE,
			approvedFonts: ["cairo", "tajawal", "noto-arabic"],
			capabilities: {
				schemaVersion: DESIGN_SYSTEM_SCHEMA_VERSION,
				generatorVersion: DESIGN_SYSTEM_GENERATOR_VERSION,
				maxBodyBytes: MAX_REQUEST_BYTES,
				contrasts: ["standard", "medium", "high"],
				variants: ["tonal-spot", "vibrant", "expressive", "fidelity", "content", "neutral", "monochrome"],
			},
			generatorUpgradePreview: currentGenerator ? {
				from: active.generatorVersion,
				to: DESIGN_SYSTEM_GENERATOR_VERSION,
				snapshot: currentGenerator,
			} : null,
		}, 200, { "cache-control": "no-store" });
	});

th.post(`${TB}/preview`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const denied = gate("theme:view");
		if (denied) return denied;
		const burstLimited = await rateLimited(env, `theme-preview-burst:${admin.sub}`, 20, 10);
		if (burstLimited) return burstLimited;
		const limited = await rateLimited(env, `theme-preview:${admin.sub}`, 120, 60);
		if (limited) return limited;
		const body = await readBoundedJson(request);
		if (body instanceof Response) return body;
		const started = performance.now();
		const snapshot = await generateDesignSystem(body.source);
		return jsonResponse({
			ok: snapshot.validation.valid,
			snapshot,
			validation: snapshot.validation,
			generationMs: Math.round((performance.now() - started) * 100) / 100,
		}, snapshot.validation.valid ? 200 : 422, { "cache-control": "no-store" });
	});

th.put(TB, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const denied = gate("theme:manage");
		if (denied) return denied;
		const limited = await rateLimited(env, `theme-publish:${admin.sub}`, 20, 3600);
		if (limited) return limited;
		const body = await readBoundedJson(request);
		if (body instanceof Response) return body;
		return publishRevision(request, env, admin, body);
	});

th.get(`${TB}/revisions`, async (c) => {
		const env = c.env, url = new URL(c.req.url), gate = c.get("gate");
		const denied = gate("theme:view");
		if (denied) return denied;
		const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
		const before = Number(url.searchParams.get("beforeRevisionId")) || Number.MAX_SAFE_INTEGER;
		const kind = url.searchParams.get("kind") ?? "all";
		if (!["saved", "checkpoint", "all"].includes(kind)) {
			return jsonResponse({ error: "invalid_revision_kind", allowed: ["saved", "checkpoint", "all"] }, 400);
		}
		const kindFilter = kind === "saved"
			? "AND r.name IS NOT NULL"
			: kind === "checkpoint"
				? "AND r.name IS NULL AND r.id<>s.active_revision_id"
				: "";
		const rows = await env.orderak_db.prepare(
			`SELECT r.id,r.name,r.schema_version,r.generator_version,r.content_hash,r.created_by,
			        r.created_at,r.published_at,r.rollback_of_revision_id,
			        CASE WHEN r.id=s.active_revision_id THEN 1 ELSE 0 END AS is_current
			 FROM design_system_revisions r CROSS JOIN design_system_state s
			 WHERE s.id=1 AND r.status='published' AND r.id<? ${kindFilter}
			 ORDER BY r.id DESC LIMIT ?`,
		).bind(before, limit + 1).all();
		const results = (rows.results ?? []) as Array<Record<string, unknown>>;
		const hasMore = results.length > limit;
		const page = results.slice(0, limit);
		return jsonResponse({
			ok: true,
			revisions: page,
			nextBeforeRevisionId: hasMore ? page.at(-1)?.id : null,
		});
	});

th.patch(`${TB}/revisions/:id{[0-9]+}`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const revisionId = Number(c.req.param("id"));
		const denied = gate("theme:manage");
		if (denied) return denied;
		const limited = await rateLimited(env, `theme-name:${admin.sub}`, 60, 3600);
		if (limited) return limited;
		const body = await readBoundedJson(request);
		if (body instanceof Response) return body;
		return nameRevision(request, env, admin, revisionId, body);
	});

th.delete(`${TB}/revisions/:id{[0-9]+}`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const revisionId = Number(c.req.param("id"));
		const denied = gate("theme:rollback");
		if (denied) return denied;
		const limited = await rateLimited(env, `theme-delete:${admin.sub}`, 10, 3600);
		if (limited) return limited;
		return deleteRevision(request, env, admin, revisionId);
	});

th.post(`${TB}/revisions/:id{[0-9]+}/:action{activate|rollback}`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const revisionId = Number(c.req.param("id"));
		const compatibilityAlias = c.req.param("action") === "rollback";
		const denied = gate(compatibilityAlias ? "theme:rollback" : "theme:manage");
		if (denied) return denied;
		const limited = await rateLimited(env, `theme-activate:${admin.sub}`, 5, 3600);
		if (limited) return limited;
		const body = await readBoundedJson(request);
		if (body instanceof Response) return body;
		return activateRevision(request, env, admin, revisionId, body, compatibilityAlias);
	});

th.all(TB, () => jsonResponse({ error: "not_found" }, 404));
th.all(`${TB}/*`, () => jsonResponse({ error: "not_found" }, 404));

async function publishRevision(
	request: Request,
	env: AdminWorkerEnv,
	admin: AdminClaims,
	body: Record<string, unknown>,
): Promise<Response> {
	const active = await loadActiveDesignSystem(env, request);
	const baseRevisionId = Number(body.baseRevisionId);
	if (!Number.isInteger(baseRevisionId)) return jsonResponse({ error: "base_revision_required" }, 400);
	const snapshot = await generateDesignSystem(body.source);
	if (!snapshot.validation.valid) return jsonResponse({ error: "validation_failed", validation: snapshot.validation }, 422);
	const projection = legacyProjection(snapshot);
	const inserted = await env.orderak_db.prepare(
		`INSERT INTO design_system_revisions
		 (schema_version,generator_version,source_json,overrides_json,snapshot_json,validation_json,legacy_projection_json,content_hash,status,created_by)
		 VALUES (?,?,?,?,?,?,?,?,'candidate',?) RETURNING id`,
	).bind(
		DESIGN_SYSTEM_SCHEMA_VERSION,
		DESIGN_SYSTEM_GENERATOR_VERSION,
		JSON.stringify(snapshot.source),
		JSON.stringify({}),
		JSON.stringify(snapshot),
		JSON.stringify(snapshot.validation),
		JSON.stringify(projection),
		snapshot.contentHash,
		admin.sub,
	).first<{ id: number }>();
	if (!inserted) return jsonResponse({ error: "revision_insert_failed" }, 500);
	const activated = await env.orderak_db.prepare(
		"UPDATE design_system_state SET active_revision_id=?,updated_at=datetime('now') WHERE id=1 AND active_revision_id=?",
	).bind(inserted.id, baseRevisionId).run();
	if ((activated.meta.changes ?? 0) !== 1) {
		await env.orderak_db.prepare("UPDATE design_system_revisions SET status='abandoned' WHERE id=?").bind(inserted.id).run();
		await auditDb(env, admin, "design_system.publish_conflict", {
			entity: "design_system_revision", entity_id: inserted.id, base_revision_id: baseRevisionId, active_revision_id: active.id,
		}, request);
		invalidateDesignSystemCache();
		return jsonResponse({ error: "revision_conflict", activeRevisionId: (await loadActiveDesignSystem(env, request)).id }, 409);
	}
	await env.orderak_db.prepare(
		"UPDATE design_system_revisions SET status='published',published_at=datetime('now') WHERE id=?",
	).bind(inserted.id).run();
	invalidateDesignSystemCache();
	const revision = await loadActiveDesignSystem(env, request);
	await auditDb(env, admin, "design_system.published", {
		entity: "design_system_revision", entity_id: revision.id, content_hash: revision.contentHash,
	}, request);
	return jsonResponse({ ok: true, activeRevisionId: revision.id, active: publicRevision(revision), cssUrl: `/api/theme/${revision.contentHash}.css` });
}

async function nameRevision(
	request: Request,
	env: AdminWorkerEnv,
	admin: AdminClaims,
	targetId: number,
	body: Record<string, unknown>,
): Promise<Response> {
	const normalized = normalizeRevisionName(body.name);
	if (normalized instanceof Response) return normalized;
	const existing = await env.orderak_db.prepare(
		"SELECT id FROM design_system_revisions WHERE name_key=? AND id<>? LIMIT 1",
	).bind(normalized.key, targetId).first<{ id: number }>();
	if (existing) return jsonResponse({ error: "revision_name_exists", conflictingRevisionId: existing.id }, 409);
	try {
		const changed = await env.orderak_db.prepare(
			`UPDATE design_system_revisions SET name=?,name_key=?
			 WHERE id=? AND status='published' RETURNING id,name,content_hash,published_at`,
		).bind(normalized.name, normalized.key, targetId).first<Record<string, unknown>>();
		if (!changed) return jsonResponse({ error: "revision_not_found" }, 404);
		await auditDb(env, admin, "design_system.revision_named", {
			entity: "design_system_revision",
			entity_id: targetId,
			name: normalized.name,
		}, request);
		return jsonResponse({ ok: true, revision: changed });
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		if (/unique|constraint/i.test(message)) return jsonResponse({ error: "revision_name_exists" }, 409);
		throw error;
	}
}

async function deleteRevision(
	request: Request,
	env: AdminWorkerEnv,
	admin: AdminClaims,
	targetId: number,
): Promise<Response> {
	const current = await env.orderak_db.prepare(
		"SELECT active_revision_id FROM design_system_state WHERE id=1",
	).first<{ active_revision_id: number | null }>();
	if (current?.active_revision_id === targetId) {
		return jsonResponse({ error: "active_revision_cannot_be_deleted" }, 409);
	}
	const deleted = await env.orderak_db.prepare(
		`DELETE FROM design_system_revisions
		 WHERE id=? AND status='published'
		   AND id<>(SELECT active_revision_id FROM design_system_state WHERE id=1)
		 RETURNING id,name,content_hash,generator_version,created_by,created_at,published_at,rollback_of_revision_id`,
	).bind(targetId).first<Record<string, unknown>>();
	if (!deleted) {
		const activeAfterRace = await env.orderak_db.prepare(
			"SELECT active_revision_id FROM design_system_state WHERE id=1",
		).first<{ active_revision_id: number | null }>();
		if (activeAfterRace?.active_revision_id === targetId) {
			return jsonResponse({ error: "active_revision_cannot_be_deleted" }, 409);
		}
		return jsonResponse({ error: "revision_not_found" }, 404);
	}
	invalidateDesignSystemCache();
	await auditDb(env, admin, "design_system.revision_deleted", {
		entity: "design_system_revision",
		entity_id: targetId,
		name: deleted.name,
		content_hash: deleted.content_hash,
		generator_version: deleted.generator_version,
		created_by: deleted.created_by,
		created_at: deleted.created_at,
		published_at: deleted.published_at,
		rollback_of_revision_id: deleted.rollback_of_revision_id,
	}, request);
	return jsonResponse({ ok: true, deletedRevisionId: targetId });
}

async function activateRevision(
	request: Request,
	env: AdminWorkerEnv,
	admin: AdminClaims,
	targetId: number,
	body: Record<string, unknown>,
	compatibilityAlias: boolean,
): Promise<Response> {
	const active = await loadActiveDesignSystem(env, request);
	const baseRevisionId = Number(body.baseRevisionId);
	if (baseRevisionId !== active.id) return jsonResponse({ error: "revision_conflict", activeRevisionId: active.id }, 409);
	const target = await env.orderak_db.prepare(
		"SELECT * FROM design_system_revisions WHERE id=? AND status='published'",
	).bind(targetId).first<Record<string, unknown>>();
	if (!target) return jsonResponse({ error: "revision_not_found" }, 404);
	const inserted = await env.orderak_db.prepare(
		`INSERT INTO design_system_revisions
		 (schema_version,generator_version,source_json,overrides_json,snapshot_json,validation_json,legacy_projection_json,content_hash,status,created_by,rollback_of_revision_id)
		 VALUES (?,?,?,?,?,?,?,?,'candidate',?,?) RETURNING id`,
	).bind(
		target.schema_version, target.generator_version, target.source_json, target.overrides_json,
		target.snapshot_json, target.validation_json, target.legacy_projection_json, target.content_hash, admin.sub, targetId,
	).first<{ id: number }>();
	if (!inserted) return jsonResponse({ error: "revision_insert_failed" }, 500);
	const activated = await env.orderak_db.prepare(
		"UPDATE design_system_state SET active_revision_id=?,updated_at=datetime('now') WHERE id=1 AND active_revision_id=?",
	).bind(inserted.id, baseRevisionId).run();
	if ((activated.meta.changes ?? 0) !== 1) {
		await env.orderak_db.prepare("UPDATE design_system_revisions SET status='abandoned' WHERE id=?").bind(inserted.id).run();
		await auditDb(env, admin, "design_system.publish_conflict", {
			entity: "design_system_revision",
			entity_id: inserted.id,
			base_revision_id: baseRevisionId,
			source_revision_id: targetId,
		}, request);
		return jsonResponse({ error: "revision_conflict", activeRevisionId: (await loadActiveDesignSystem(env, request)).id }, 409);
	}
	await env.orderak_db.prepare("UPDATE design_system_revisions SET status='published',published_at=datetime('now') WHERE id=?").bind(inserted.id).run();
	invalidateDesignSystemCache();
	const revision = await loadActiveDesignSystem(env, request);
	await auditDb(env, admin, "design_system.revision_activated", {
		entity: "design_system_revision",
		entity_id: revision.id,
		source_revision_id: targetId,
		compatibility_alias: compatibilityAlias,
	}, request);
	return jsonResponse({ ok: true, activeRevisionId: revision.id, active: publicRevision(revision) });
}

// The two public* exports below serve /api/v1/theme and /api/theme.css from the
// PUBLIC Worker, so they take the shared Env even though they live beside the
// admin theme routes. They read orderak_db only.
export async function publicDesignSystemResponse(request: Request, env: Env, siteUrl: string): Promise<Response> {
	const revision = await loadActiveDesignSystem(env, request);
	const assets = {
		logo: `${siteUrl}/static/orderak-logo.svg`,
		logo_horizontal: `${siteUrl}/static/orderak-logo-horizontal.svg`,
		icon: `${siteUrl}/static/orderak-icon.svg`,
		icon_512: `${siteUrl}/static/orderak-icon-512.png`,
		favicon: `${siteUrl}/static/orderak-favicon.svg`,
	};
	const body = {
		ok: true,
		schemaVersion: DESIGN_SYSTEM_SCHEMA_VERSION,
		version: revision.contentHash,
		revisionId: revision.id,
		generatorVersion: revision.generatorVersion,
		publishedAt: revision.publishedAt,
		compatibility: {
			firstSchemaV2AndroidVersionCode: FIRST_SCHEMA_V2_ANDROID_VERSION_CODE,
			legacyProjectionPresent: true,
			sunsetGate: "enforced_minimum_version_and_date",
		},
		source: revision.source,
		designSystem: revision.snapshot,
		theme: revision.legacyTheme,
		assets,
	};
	const etag = `"${revision.contentHash}"`;
	const headers = {
		etag,
		"cache-control": "public, no-cache",
		"cdn-cache-control": "public, max-age=60, stale-while-revalidate=60",
		"content-type": "application/json; charset=utf-8",
		"access-control-allow-origin": "*",
	};
	if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
	return new Response(JSON.stringify(body), { headers });
}

export async function publicDesignSystemCss(request: Request, env: Env, hash?: string): Promise<Response> {
	const revision = await loadActiveDesignSystem(env, request);
	if (hash && hash !== revision.contentHash) {
		const row = await env.orderak_db.prepare(
			"SELECT snapshot_json,content_hash FROM design_system_revisions WHERE content_hash=? AND status='published' ORDER BY id DESC LIMIT 1",
		).bind(hash).first<{ snapshot_json: string; content_hash: string }>();
		if (!row) return jsonResponse({ error: "theme_not_found" }, 404);
		return new Response(designSystemCss(JSON.parse(row.snapshot_json)), {
			headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=31536000, immutable", etag: `"${row.content_hash}"` },
		});
	}
	if (!hash) {
		return new Response(null, {
			status: 302,
			headers: {
				location: new URL(`/api/theme/${revision.contentHash}.css`, request.url).toString(),
				"cache-control": "public, max-age=60",
			},
		});
	}
	return new Response(designSystemCss(revision.snapshot), {
		headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=31536000, immutable", etag: `"${revision.contentHash}"` },
	});
}
