// ============================================================
// Admin project-control-center routes (roadmap, tasks, endpoints,
// prompts, design-assets, releases, bugs, docs, settings, terms,
// privacy, plans with limits).
//
// Mounted from admin.ts; all routes are JWT + RBAC gated.
// ============================================================

import { jsonResponse } from "../../platform/http/shared";
import { Hono } from "hono";
import type { AdminEnv } from "./admin-context";
import { auditDb } from "./admin-auth";
import type { AdminClaims } from "../identity/auth";
import { APP_SCREEN_MANIFEST } from "../design/app-screen-manifest";
import { invalidateThemeCache } from "../design/theme";


/** Handle all /api/admin/v1/project-* routes. Returns a Response or null. */
/**
 * Project-workspace routes, mounted by admin.ts.
 *
 * Nine resources share one CRUD shape, so they are generated rather than
 * written out nine times. The numeric-id check stays a 400 id_required inside
 * the handler - constraining the param to [0-9]+ instead would turn that into
 * a 404 and change the response the panel sees.
 *
 * NOTE: the original also matched GET/PUT on /api/admin/v1/theme, but
 * admin-theme runs earlier in the chain and answers both, so those two
 * branches were unreachable. They are not carried over.
 */
export const projectApp = new Hono<AdminEnv>();
const pj = projectApp;
const B = "/api/admin/v1";

pj.get(`${B}/overview`, (c) => c.get("gate")("dashboard:view") ?? overview(c.env));

pj.get(`${B}/roadmap`, (c) => c.get("gate")("roadmap:view") ?? listRoadmap(c.env));
pj.post(`${B}/roadmap`, (c) => c.get("gate")("roadmap:manage") ?? createRoadmap(c.req.raw, c.env, c.get("admin")));
pj.put(`${B}/roadmap/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("roadmap:manage") ?? updateRoadmap(c.req.raw, c.env, id, c.get("admin"));
});
pj.delete(`${B}/roadmap/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("roadmap:manage") ?? deleteRoadmap(c.env, id, c.get("admin"));
});
pj.get(`${B}/tasks`, (c) => c.get("gate")("tasks:view") ?? listTasks(c.env, new URL(c.req.url)));
pj.post(`${B}/tasks`, (c) => c.get("gate")("tasks:manage") ?? createTask(c.req.raw, c.env, c.get("admin")));
pj.put(`${B}/tasks/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("tasks:manage") ?? updateTask(c.req.raw, c.env, id, c.get("admin"));
});
pj.delete(`${B}/tasks/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("tasks:manage") ?? deleteTask(c.env, id, c.get("admin"));
});
pj.get(`${B}/screens`, (c) => c.get("gate")("screens:view") ?? listScreens(c.env));
pj.post(`${B}/screens`, (c) => c.get("gate")("screens:manage") ?? createScreen(c.req.raw, c.env, c.get("admin")));
pj.put(`${B}/screens/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("screens:manage") ?? updateScreen(c.req.raw, c.env, id, c.get("admin"));
});
pj.delete(`${B}/screens/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("screens:manage") ?? deleteScreen(c.env, id, c.get("admin"));
});
pj.get(`${B}/endpoints`, (c) => c.get("gate")("endpoints:view") ?? listEndpoints(c.env));
pj.post(`${B}/endpoints`, (c) => c.get("gate")("endpoints:manage") ?? createEndpoint(c.req.raw, c.env, c.get("admin")));
pj.put(`${B}/endpoints/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("endpoints:manage") ?? updateEndpoint(c.req.raw, c.env, id, c.get("admin"));
});
pj.delete(`${B}/endpoints/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("endpoints:manage") ?? deleteEndpoint(c.env, id, c.get("admin"));
});
pj.get(`${B}/prompts`, (c) => c.get("gate")("prompts:view") ?? listPrompts(c.env));
pj.post(`${B}/prompts`, (c) => c.get("gate")("prompts:manage") ?? createPrompt(c.req.raw, c.env, c.get("admin")));
pj.put(`${B}/prompts/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("prompts:manage") ?? updatePrompt(c.req.raw, c.env, id, c.get("admin"));
});
pj.delete(`${B}/prompts/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("prompts:manage") ?? deletePrompt(c.env, id, c.get("admin"));
});
pj.get(`${B}/design-assets`, (c) => c.get("gate")("design:view") ?? listDesignAssets(c.env));
pj.post(`${B}/design-assets`, (c) => c.get("gate")("design:manage") ?? createDesignAsset(c.req.raw, c.env, c.get("admin")));
pj.put(`${B}/design-assets/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("design:manage") ?? updateDesignAsset(c.req.raw, c.env, id, c.get("admin"));
});
pj.delete(`${B}/design-assets/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("design:manage") ?? deleteDesignAsset(c.env, id, c.get("admin"));
});
pj.get(`${B}/releases`, (c) => c.get("gate")("releases:view") ?? listReleases(c.env));
pj.post(`${B}/releases`, (c) => c.get("gate")("releases:manage") ?? createRelease(c.req.raw, c.env, c.get("admin")));
pj.put(`${B}/releases/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("releases:manage") ?? updateRelease(c.req.raw, c.env, id, c.get("admin"));
});
pj.delete(`${B}/releases/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("releases:manage") ?? deleteRelease(c.env, id, c.get("admin"));
});
pj.get(`${B}/bugs`, (c) => c.get("gate")("bugs:view") ?? listBugs(c.env, new URL(c.req.url)));
pj.post(`${B}/bugs`, (c) => c.get("gate")("bugs:manage") ?? createBug(c.req.raw, c.env, c.get("admin")));
pj.put(`${B}/bugs/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("bugs:manage") ?? updateBug(c.req.raw, c.env, id, c.get("admin"));
});
pj.delete(`${B}/bugs/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("bugs:manage") ?? deleteBug(c.env, id, c.get("admin"));
});
pj.get(`${B}/project-docs`, (c) => c.get("gate")("docs:view") ?? listProjectDocs(c.env));
pj.post(`${B}/project-docs`, (c) => c.get("gate")("docs:manage") ?? createProjectDoc(c.req.raw, c.env, c.get("admin")));
pj.put(`${B}/project-docs/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("docs:manage") ?? updateProjectDoc(c.req.raw, c.env, id, c.get("admin"));
});
pj.delete(`${B}/project-docs/:id`, (c) => {
	const id = Number(c.req.param("id"));
	if (!id) return jsonResponse({ error: "id_required" }, 400);
	return c.get("gate")("docs:manage") ?? deleteProjectDoc(c.env, id, c.get("admin"));
});

pj.post(`${B}/screens/sync`, (c) => c.get("gate")("screens:manage") ?? syncScreens(c.env, c.get("admin")));

pj.get(`${B}/settings`, (c) => c.get("gate")("settings:view") ?? listSettings(c.env));
pj.put(`${B}/settings/:key`, (c) =>
	c.get("gate")("settings:manage") ?? updateSetting(c.req.raw, c.env, decodeURIComponent(c.req.param("key")), c.get("admin")));

// ---------- Content pages (Terms, Privacy) ----------
pj.get(`${B}/content-pages`, (c) => c.get("gate")("content:view") ?? listContentPages(c.env));
pj.post(`${B}/content-pages`, (c) => c.get("gate")("content:manage") ?? upsertContentPage(c.req.raw, c.env, c.get("admin")));
pj.post(`${B}/content-pages/:slug/:lang/activate`, (c) =>
	c.get("gate")("content:manage") ?? activateContentPage(c.env, c.req.param("slug"), c.req.param("lang"), c.get("admin")));
// Legacy shape: no language segment.
pj.post(`${B}/content-pages/:slug/activate`, (c) =>
	c.get("gate")("content:manage") ?? activateContentPage(c.env, c.req.param("slug"), "", c.get("admin")));
pj.put(`${B}/content-pages/:slug/:lang`, (c) =>
	c.get("gate")("content:manage") ?? upsertContentPage(c.req.raw, c.env, c.get("admin")));

pj.onError((e) => {
	console.error("Admin project error:", e);
	return jsonResponse({ error: "server" }, 500);
});

// ===================== Overview =====================

async function overview(env: AdminWorkerEnv): Promise<Response> {
	const [roadmap, tasks, bugs, releases, recentAudit] = await Promise.all([
		env.orderak_db.prepare("SELECT COUNT(*) AS c FROM roadmap_items WHERE status='in_progress'").first(),
		env.orderak_db.prepare("SELECT COUNT(*) AS c FROM project_tasks WHERE status IN ('todo','in_progress','blocked')").first(),
		env.orderak_db.prepare("SELECT COUNT(*) AS c FROM bugs WHERE status IN ('open','in_progress')").first(),
		env.orderak_db.prepare("SELECT component, version, deployment_status, released_at FROM releases ORDER BY released_at DESC LIMIT 2").all(),
		env.orderak_db.prepare("SELECT action, admin_id, created_at FROM admin_audit ORDER BY id DESC LIMIT 10").all(),
	]);

	return jsonResponse({
		ok: true,
		health: ((tasks as any).c === 0 && (bugs as any).c === 0) ? "ok" : ((bugs as any).c > 3 ? "critical" : "warning"),
		active_milestones: (roadmap as any).c,
		open_tasks: (tasks as any).c,
		open_bugs: (bugs as any).c,
		latest_releases: (releases as any).results ?? [],
		recent_activity: (recentAudit as any).results ?? [],
	});
}

// ===================== Roadmap =====================

async function listRoadmap(env: AdminWorkerEnv): Promise<Response> {
	const { results } = await env.orderak_db.prepare("SELECT * FROM roadmap_items ORDER BY sort_order, id").all();
	return jsonResponse({ ok: true, items: results ?? [] });
}
async function createRoadmap(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const title = String(b.title_i18n ?? "");
	if (!title) return jsonResponse({ error: "title_required" }, 400);
	const row = await env.orderak_db.prepare(
		"INSERT INTO roadmap_items (title_i18n, body_i18n, status, priority, owner, target_date, sort_order) VALUES (?,?,?,?,?,?,?) RETURNING id"
	).bind(title, String(b.body_i18n??""), String(b.status??"planned"), String(b.priority??"medium"), String(b.owner??""), String(b.target_date??null), Math.floor(Number(b.sort_order)||0)).first();
	await auditDb(env, admin, "roadmap.created", { id: (row as any).id });
	return jsonResponse({ ok: true, id: (row as any).id }, 201);
}
async function updateRoadmap(request: Request, env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	await env.orderak_db.prepare(
		"UPDATE roadmap_items SET title_i18n=?, body_i18n=?, status=?, priority=?, owner=?, target_date=?, sort_order=?, updated_at=datetime('now') WHERE id=?"
	).bind(String(b.title_i18n??""), String(b.body_i18n??""), String(b.status??"planned"), String(b.priority??"medium"), String(b.owner??""), String(b.target_date??null), Math.floor(Number(b.sort_order)||0), id).run();
	await auditDb(env, admin, "roadmap.updated", { id });
	return jsonResponse({ ok: true });
}
async function deleteRoadmap(env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("DELETE FROM roadmap_items WHERE id=?").bind(id).run();
	await auditDb(env, admin, "roadmap.deleted", { id });
	return jsonResponse({ ok: true });
}

// ===================== Tasks =====================

async function listTasks(env: AdminWorkerEnv, url: URL): Promise<Response> {
	const status = url.searchParams.get("status") ?? "";
	let stmt = "SELECT * FROM project_tasks";
	const params: any[] = [];
	if (status) { stmt += " WHERE status=?"; params.push(status); }
	stmt += " ORDER BY updated_at DESC LIMIT 200";
	const { results } = await env.orderak_db.prepare(stmt).bind(...params).all();
	return jsonResponse({ ok: true, tasks: results ?? [] });
}
async function createTask(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const title = String(b.title ?? "").trim();
	if (!title) return jsonResponse({ error: "title_required" }, 400);
	const row = await env.orderak_db.prepare(
		"INSERT INTO project_tasks (title, description, status, priority, assigned_to, related_area) VALUES (?,?,?,?,?,?) RETURNING id"
	).bind(title, String(b.description??""), String(b.status??"todo"), String(b.priority??"medium"), String(b.assigned_to??""), String(b.related_area??"")).first();
	await auditDb(env, admin, "task.created", { id: (row as any).id });
	return jsonResponse({ ok: true, id: (row as any).id }, 201);
}
async function updateTask(request: Request, env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	await env.orderak_db.prepare(
		"UPDATE project_tasks SET title=?, description=?, status=?, priority=?, assigned_to=?, related_area=?, updated_at=datetime('now') WHERE id=?"
	).bind(String(b.title??""), String(b.description??""), String(b.status??"todo"), String(b.priority??"medium"), String(b.assigned_to??""), String(b.related_area??""), id).run();
	await auditDb(env, admin, "task.updated", { id });
	return jsonResponse({ ok: true });
}
async function deleteTask(env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("DELETE FROM project_tasks WHERE id=?").bind(id).run();
	await auditDb(env, admin, "task.deleted", { id });
	return jsonResponse({ ok: true });
}

// ===================== App Screens =====================
// Provides CRUD + manifest sync for the App Screens table.
// Each screen has a parent_id that forms a navigation tree:
// Splash → Sign In → Shop Setup → Dashboard → tab/detail screens.
// The admin panel renders this as a collapsible tree view.

async function listScreens(env: AdminWorkerEnv): Promise<Response> {
	const { results } = await env.orderak_db.prepare("SELECT * FROM app_screens ORDER BY sort_order, id").all();
	// Returns flat list including parent_id; the frontend builds the tree client-side.
	return jsonResponse({ ok: true, screens: results ?? [] });
}

/**
 * Sync screens from the Android manifest (APP_SCREEN_MANIFEST).
 * - Resolves parent_route → parent_id by looking up the parent's auto-inserted row.
 * - Creates new rows for screens not yet in the DB.
 * - Updates existing rows to match the manifest (name, description, sort_order, parent_id).
 * This ensures the admin tree stays in sync with the Kotlin navigation graph.
 */
async function syncScreens(env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	let created = 0;
	let updated = 0;
	for (const screen of APP_SCREEN_MANIFEST) {
		// Resolve parent_route to parent_id so the tree links are stored correctly.
		// The parent row must already exist (either created in this sync pass
		// or from a prior sync).
		let parentId: number | null = null;
		if (screen.parent_route) {
			const pr = await env.orderak_db.prepare("SELECT id FROM app_screens WHERE android_route=? ORDER BY id LIMIT 1")
				.bind(screen.parent_route).first<{id:number}>();
			parentId = pr?.id ?? null;
		}

		// Structure comes from the manifest and is overwritten on every sync;
		// design_status, development_status, figma_url and screenshot_url are the
		// admin's own workflow columns and are deliberately left alone.
		const transitions = JSON.stringify(screen.transitions);
		const states = JSON.stringify(screen.states);

		const existing = await env.orderak_db.prepare("SELECT id FROM app_screens WHERE android_route=? ORDER BY id LIMIT 1").bind(screen.android_route).first<{id:number}>();
		if (existing) {
			await env.orderak_db.prepare(`UPDATE app_screens SET
				name=?,description=?,sort_order=?,parent_id=?,
				surface=?,transitions=?,states=?,offline_capable=?,entitlement_key=?,feature_status=?,
				source='android_manifest',last_synced_at=datetime('now'),updated_at=datetime('now')
				WHERE id=?`)
				.bind(screen.name,screen.description,screen.sort_order,parentId,
					screen.surface,transitions,states,screen.offline_capable ? 1 : 0,
					screen.entitlement_key,screen.feature_status,existing.id).run();
			updated++;
		} else {
			await env.orderak_db.prepare(`INSERT INTO app_screens
				(name,description,status,design_status,development_status,android_route,sort_order,parent_id,
				 surface,transitions,states,offline_capable,entitlement_key,feature_status,source,last_synced_at)
				VALUES (?,?,'planned','not_started','not_started',?,?,?,?,?,?,?,?,?,'android_manifest',datetime('now'))`)
				.bind(screen.name,screen.description,screen.android_route,screen.sort_order,parentId,
					screen.surface,transitions,states,screen.offline_capable ? 1 : 0,
					screen.entitlement_key,screen.feature_status).run();
			created++;
		}
	}
	await auditDb(env, admin, "screen.manifest_synced", { created, updated, total: APP_SCREEN_MANIFEST.length });
	return jsonResponse({ ok:true,created,updated,total:APP_SCREEN_MANIFEST.length });
}

async function createScreen(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const name = String(b.name ?? "").trim();
	if (!name) return jsonResponse({ error: "name_required" }, 400);
	// parent_id links this screen into the navigation tree (null = root).
	const parentId = b.parent_id ? Number(b.parent_id) : null;
	const row = await env.orderak_db.prepare(
		"INSERT INTO app_screens (name, description, status, design_status, development_status, figma_url, screenshot_url, android_route, sort_order, parent_id, source) VALUES (?,?,?,?,?,?,?,?,?,?,'manual') RETURNING id"
	).bind(name,String(b.description??""),String(b.status??"planned"),String(b.design_status??"not_started"),String(b.development_status??"not_started"),String(b.figma_url??""),String(b.screenshot_url??""),String(b.android_route??""),Math.floor(Number(b.sort_order)||0),parentId).first();
	await auditDb(env, admin, "screen.created", { id: (row as any).id });
	return jsonResponse({ ok: true, id: (row as any).id }, 201);
}

/**
 * Update an existing screen. parent_id is only written when explicitly
 * provided in the request body (so partial edits don't accidentally
 * clear the tree link). Pass parent_id: null to make a screen a root.
 */
async function updateScreen(request: Request, env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const parentId = b.parent_id !== undefined ? (b.parent_id === null ? null : Number(b.parent_id)) : undefined;
	// Only include parent_id in the update if it was explicitly provided
	if (parentId !== undefined) {
		await env.orderak_db.prepare(
			"UPDATE app_screens SET name=?,description=?,status=?,design_status=?,development_status=?,figma_url=?,screenshot_url=?,android_route=?,sort_order=?,parent_id=?,updated_at=datetime('now') WHERE id=?"
		).bind(String(b.name??""),String(b.description??""),String(b.status??"planned"),String(b.design_status??"not_started"),String(b.development_status??"not_started"),String(b.figma_url??""),String(b.screenshot_url??""),String(b.android_route??""),Math.floor(Number(b.sort_order)||0),parentId,id).run();
	} else {
		await env.orderak_db.prepare(
			"UPDATE app_screens SET name=?,description=?,status=?,design_status=?,development_status=?,figma_url=?,screenshot_url=?,android_route=?,sort_order=?,updated_at=datetime('now') WHERE id=?"
		).bind(String(b.name??""),String(b.description??""),String(b.status??"planned"),String(b.design_status??"not_started"),String(b.development_status??"not_started"),String(b.figma_url??""),String(b.screenshot_url??""),String(b.android_route??""),Math.floor(Number(b.sort_order)||0),id).run();
	}
	await auditDb(env, admin, "screen.updated", { id });
	return jsonResponse({ ok: true });
}
async function deleteScreen(env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("DELETE FROM app_screens WHERE id=?").bind(id).run();
	await auditDb(env, admin, "screen.deleted", { id });
	return jsonResponse({ ok: true });
}

// ===================== API Endpoints =====================

async function listEndpoints(env: AdminWorkerEnv): Promise<Response> {
	const { results } = await env.orderak_db.prepare("SELECT * FROM api_endpoints ORDER BY path, method").all();
	return jsonResponse({ ok: true, endpoints: results ?? [] });
}
async function createEndpoint(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const method = String(b.method??"").toUpperCase();
	const path = String(b.path??"");
	if (!method || !path) return jsonResponse({ error: "method_and_path_required" }, 400);
	const row = await env.orderak_db.prepare(
		"INSERT INTO api_endpoints (method, path, description_i18n, status, docs_url, test_result, android_integration) VALUES (?,?,?,?,?,?,?) RETURNING id"
	).bind(method, path, String(b.description_i18n??""), String(b.status??"implemented"), String(b.docs_url??""), String(b.test_result??"pending"), String(b.android_integration??"none")).first();
	await auditDb(env, admin, "endpoint.created", { id: (row as any).id });
	return jsonResponse({ ok: true, id: (row as any).id }, 201);
}
async function updateEndpoint(request: Request, env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	await env.orderak_db.prepare(
		"UPDATE api_endpoints SET method=?, path=?, description_i18n=?, status=?, docs_url=?, test_result=?, android_integration=?, updated_at=datetime('now') WHERE id=?"
	).bind(String(b.method??""), String(b.path??""), String(b.description_i18n??""), String(b.status??"implemented"), String(b.docs_url??""), String(b.test_result??"pending"), String(b.android_integration??"none"), id).run();
	await auditDb(env, admin, "endpoint.updated", { id });
	return jsonResponse({ ok: true });
}
async function deleteEndpoint(env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("DELETE FROM api_endpoints WHERE id=?").bind(id).run();
	await auditDb(env, admin, "endpoint.deleted", { id });
	return jsonResponse({ ok: true });
}

// ===================== AI Prompts =====================

async function listPrompts(env: AdminWorkerEnv): Promise<Response> {
	const { results } = await env.orderak_db.prepare("SELECT * FROM ai_prompts ORDER BY name").all();
	return jsonResponse({ ok: true, prompts: results ?? [] });
}
async function createPrompt(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const name = String(b.name??"").trim();
	if (!name) return jsonResponse({ error: "name_required" }, 400);
	const row = await env.orderak_db.prepare(
		"INSERT INTO ai_prompts (name, provider, model, version, prompt_text, test_notes, active) VALUES (?,?,?,?,?,?,?) RETURNING id"
	).bind(name, String(b.provider??""), String(b.model??""), String(b.version??""), String(b.prompt_text??""), String(b.test_notes??""), b.active===false?0:1).first();
	await auditDb(env, admin, "prompt.created", { id: (row as any).id });
	return jsonResponse({ ok: true, id: (row as any).id }, 201);
}
async function updatePrompt(request: Request, env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	await env.orderak_db.prepare(
		"UPDATE ai_prompts SET name=?, provider=?, model=?, version=?, prompt_text=?, test_notes=?, active=?, updated_at=datetime('now') WHERE id=?"
	).bind(String(b.name??""), String(b.provider??""), String(b.model??""), String(b.version??""), String(b.prompt_text??""), String(b.test_notes??""), b.active===false?0:1, id).run();
	await auditDb(env, admin, "prompt.updated", { id });
	return jsonResponse({ ok: true });
}
async function deletePrompt(env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("DELETE FROM ai_prompts WHERE id=?").bind(id).run();
	await auditDb(env, admin, "prompt.deleted", { id });
	return jsonResponse({ ok: true });
}

// ===================== Design Assets =====================

async function listDesignAssets(env: AdminWorkerEnv): Promise<Response> {
	const { results } = await env.orderak_db.prepare("SELECT * FROM design_assets ORDER BY id DESC").all();
	return jsonResponse({ ok: true, assets: results ?? [] });
}
async function createDesignAsset(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const name = String(b.name??"").trim();
	const url2 = String(b.url??"").trim();
	if (!name || !url2) return jsonResponse({ error: "name_and_url_required" }, 400);
	const row = await env.orderak_db.prepare(
		"INSERT INTO design_assets (name, type, url, screen_ref) VALUES (?,?,?,?) RETURNING id"
	).bind(name, String(b.type??"figma"), url2, String(b.screen_ref??"")).first();
	await auditDb(env, admin, "design_asset.created", { id: (row as any).id });
	return jsonResponse({ ok: true, id: (row as any).id }, 201);
}
async function updateDesignAsset(request: Request, env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	await env.orderak_db.prepare(
		"UPDATE design_assets SET name=?, type=?, url=?, screen_ref=? WHERE id=?"
	).bind(String(b.name??""), String(b.type??"figma"), String(b.url??""), String(b.screen_ref??""), id).run();
	await auditDb(env, admin, "design_asset.updated", { id });
	return jsonResponse({ ok: true });
}
async function deleteDesignAsset(env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("DELETE FROM design_assets WHERE id=?").bind(id).run();
	await auditDb(env, admin, "design_asset.deleted", { id });
	return jsonResponse({ ok: true });
}

// ===================== Releases =====================

async function listReleases(env: AdminWorkerEnv): Promise<Response> {
	const { results } = await env.orderak_db.prepare("SELECT * FROM releases ORDER BY released_at DESC LIMIT 50").all();
	return jsonResponse({ ok: true, releases: results ?? [] });
}
async function createRelease(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const component = String(b.component??"");
	const version = String(b.version??"");
	if (!component || !version) return jsonResponse({ error: "component_and_version_required" }, 400);
	const row = await env.orderak_db.prepare(
		"INSERT INTO releases (component, version, changelog_i18n, build_file_url, deployment_status, checklist_json, released_at) VALUES (?,?,?,?,?,?,?) RETURNING id"
	).bind(component, version, String(b.changelog_i18n??""), String(b.build_file_url??""), String(b.deployment_status??"pending"), String(b.checklist_json??"[]"), String(b.released_at??null)).first();
	await auditDb(env, admin, "release.created", { id: (row as any).id });
	return jsonResponse({ ok: true, id: (row as any).id }, 201);
}
async function updateRelease(request: Request, env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	await env.orderak_db.prepare(
		"UPDATE releases SET component=?, version=?, changelog_i18n=?, build_file_url=?, deployment_status=?, checklist_json=?, released_at=? WHERE id=?"
	).bind(String(b.component??""), String(b.version??""), String(b.changelog_i18n??""), String(b.build_file_url??""), String(b.deployment_status??"pending"), String(b.checklist_json??"[]"), String(b.released_at??null), id).run();
	await auditDb(env, admin, "release.updated", { id });
	return jsonResponse({ ok: true });
}
async function deleteRelease(env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("DELETE FROM releases WHERE id=?").bind(id).run();
	await auditDb(env, admin, "release.deleted", { id });
	return jsonResponse({ ok: true });
}

// ===================== Bugs =====================

async function listBugs(env: AdminWorkerEnv, url: URL): Promise<Response> {
	const status = url.searchParams.get("status") ?? "";
	let stmt = "SELECT * FROM bugs";
	const params: any[] = [];
	if (status) { stmt += " WHERE status=?"; params.push(status); }
	stmt += " ORDER BY updated_at DESC LIMIT 200";
	const { results } = await env.orderak_db.prepare(stmt).bind(...params).all();
	return jsonResponse({ ok: true, bugs: results ?? [] });
}
async function createBug(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const title = String(b.title??"").trim();
	if (!title) return jsonResponse({ error: "title_required" }, 400);
	const row = await env.orderak_db.prepare(
		"INSERT INTO bugs (title, severity, affected_area, status, owner, fix_notes) VALUES (?,?,?,?,?,?) RETURNING id"
	).bind(title, String(b.severity??"medium"), String(b.affected_area??""), String(b.status??"open"), String(b.owner??""), String(b.fix_notes??"")).first();
	await auditDb(env, admin, "bug.created", { id: (row as any).id });
	return jsonResponse({ ok: true, id: (row as any).id }, 201);
}
async function updateBug(request: Request, env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	await env.orderak_db.prepare(
		"UPDATE bugs SET title=?, severity=?, affected_area=?, status=?, owner=?, fix_notes=?, updated_at=datetime('now') WHERE id=?"
	).bind(String(b.title??""), String(b.severity??"medium"), String(b.affected_area??""), String(b.status??"open"), String(b.owner??""), String(b.fix_notes??""), id).run();
	await auditDb(env, admin, "bug.updated", { id });
	return jsonResponse({ ok: true });
}
async function deleteBug(env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("DELETE FROM bugs WHERE id=?").bind(id).run();
	await auditDb(env, admin, "bug.deleted", { id });
	return jsonResponse({ ok: true });
}

// ===================== Project Docs =====================

async function listProjectDocs(env: AdminWorkerEnv): Promise<Response> {
	const { results } = await env.orderak_db.prepare("SELECT * FROM project_docs ORDER BY category, title").all();
	return jsonResponse({ ok: true, docs: results ?? [] });
}
async function createProjectDoc(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const title = String(b.title??"").trim();
	const url2 = String(b.url_or_path??"").trim();
	if (!title || !url2) return jsonResponse({ error: "title_and_url_required" }, 400);
	const row = await env.orderak_db.prepare(
		"INSERT INTO project_docs (title, category, url_or_path) VALUES (?,?,?) RETURNING id"
	).bind(title, String(b.category??""), url2).first();
	await auditDb(env, admin, "doc.created", { id: (row as any).id });
	return jsonResponse({ ok: true, id: (row as any).id }, 201);
}
async function updateProjectDoc(request: Request, env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	await env.orderak_db.prepare(
		"UPDATE project_docs SET title=?, category=?, url_or_path=? WHERE id=?"
	).bind(String(b.title??""), String(b.category??""), String(b.url_or_path??""), id).run();
	await auditDb(env, admin, "doc.updated", { id });
	return jsonResponse({ ok: true });
}
async function deleteProjectDoc(env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("DELETE FROM project_docs WHERE id=?").bind(id).run();
	await auditDb(env, admin, "doc.deleted", { id });
	return jsonResponse({ ok: true });
}

// ===================== Settings =====================

async function listSettings(env: AdminWorkerEnv): Promise<Response> {
	const { results } = await env.orderak_db.prepare("SELECT * FROM settings ORDER BY key").all();
	return jsonResponse({ ok: true, settings: results ?? [] });
}
async function updateSetting(request: Request, env: AdminWorkerEnv, key: string, admin: AdminClaims): Promise<Response> {
	if (key === "theme_colors") {
		return jsonResponse({ error: "design_system_migrated", path: "/api/admin/v1/theme" }, 409);
	}
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	await env.orderak_db.prepare(
		"INSERT INTO settings (key, value_json, updated_by, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by=excluded.updated_by, updated_at=datetime('now')"
	).bind(key, String(b.value_json??""), admin.sub).run();
	if (key === "theme_colors") invalidateThemeCache();
	await auditDb(env, admin, "setting.updated", { key });
	return jsonResponse({ ok: true });
}


// ===================== Content Pages (Terms, Privacy) =====================

async function listContentPages(env: AdminWorkerEnv): Promise<Response> {
	const { results } = await env.orderak_db.prepare("SELECT * FROM content_page_versions ORDER BY slug, lang, version DESC").all();
	return jsonResponse({ ok: true, pages: results ?? [] });
}
async function upsertContentPage(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const slug = String(b.slug??"").trim();
	const lang2 = String(b.lang??"").trim();
	if (!["terms","privacy"].includes(slug) || !["ar","en"].includes(lang2)) return jsonResponse({ error: "invalid_slug_or_lang" }, 400);
	const latest=await env.orderak_db.prepare("SELECT COALESCE(MAX(version),0) AS version FROM content_page_versions WHERE slug=? AND lang=?").bind(slug,lang2).first<{version:number}>();
	const version=Number(latest?.version??0)+1;
	const row=await env.orderak_db.prepare(`INSERT INTO content_page_versions
		(slug,lang,version,title,body_html,notes,status,created_by) VALUES (?,?,?,?,?,?,'draft',?) RETURNING id`)
		.bind(slug,lang2,version,String(b.title??""),String(b.body_html??""),String(b.notes??""),admin.sub).first<{id:number}>();
	await auditDb(env, admin, "content_page.draft_created", { entity:"content_page", entity_id:row?.id, slug, lang:lang2, version });
	return jsonResponse({ ok:true,id:row?.id,slug,lang:lang2,version,status:"draft" },201);
}
async function activateContentPage(env: AdminWorkerEnv, slug: string, lang2: string, admin: AdminClaims): Promise<Response> {
	if (!["terms","privacy"].includes(slug) || !["ar","en"].includes(lang2)) return jsonResponse({error:"invalid_slug_or_lang"},400);
	const latest=await env.orderak_db.prepare("SELECT id,version FROM content_page_versions WHERE slug=? AND lang=? AND status='draft' ORDER BY version DESC LIMIT 1").bind(slug,lang2).first<{id:number;version:number}>();
	if(!latest)return jsonResponse({error:"draft_not_found"},404);
	await env.orderak_db.batch([
		env.orderak_db.prepare("UPDATE content_page_versions SET status='archived' WHERE slug=? AND lang=? AND status='published'").bind(slug,lang2),
		env.orderak_db.prepare("UPDATE content_page_versions SET status='published',published_at=datetime('now') WHERE id=?").bind(latest.id),
	]);
	await auditDb(env, admin, "content_page.published", { entity:"content_page",entity_id:latest.id,slug,lang:lang2,version:latest.version });
	return jsonResponse({ok:true,slug,lang:lang2,version:latest.version,status:"published"});
}
