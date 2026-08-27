import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callWorker, createSchema } from "./helpers";
import { MAX_PUBLIC_PAYLOAD_BYTES, invalidateDesignSystemCache, loadActiveDesignSystem } from "../src/domains/design/design-system";
import { signJwt, type AdminRole } from "../src/domains/identity/auth";
import adminWorker from "../src/entrypoints/admin-worker";

async function adminFetch(path: string, role: AdminRole, init: RequestInit = {}): Promise<Response> {
	const token = await signJwt(
		{ sub: 1, email: `${role}@example.test`, role },
		env.ADMIN_JWT_SECRET || "test-admin-secret",
	);
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${token}`);
	headers.set("content-type", "application/json");
	return callWorker(adminWorker, new Request(`https://admin.orderak.app${path}`, { ...init, headers }), env);
}

describe("public design-system contract", () => {
	beforeEach(async () => {
		vi.restoreAllMocks();
		await createSchema();
		env.LOCAL_ADMIN_ENABLED = "true";
		env.ADMIN_JWT_SECRET = "test-admin-secret";
	});

	it("serves schema v2 and the unchanged legacy projection together", async () => {
		const response = await SELF.fetch("https://api.orderak.app/api/v1/theme");
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("public, no-cache");
		expect(response.headers.get("cdn-cache-control")).toContain("max-age=60");
		const text = await response.text();
		expect(new TextEncoder().encode(text).byteLength).toBeLessThan(MAX_PUBLIC_PAYLOAD_BYTES);
		const body = JSON.parse(text);
		expect(body.schemaVersion).toBe(2);
		expect(body.designSystem.schemaVersion).toBe(2);
		expect(body.theme.primary).toBe("#006A62");
		expect(body.theme.accent).toBe("#9B4500");
		expect(body.version).toHaveLength(64);

		const notModified = await SELF.fetch("https://api.orderak.app/api/v1/theme", {
			headers: { "if-none-match": response.headers.get("etag")! },
		});
		expect(notModified.status).toBe(304);
	});

	it("keeps an inaccessible legacy projection for v1 clients without activating an invalid v2 snapshot", async () => {
		const legacy = {
			primary: "#1E3A8A",
			primary_strong: "#14275C",
			primary_soft: "#EDF1FC",
			primary_tint: "#3B5BA9",
			canvas: "#F5F7FC",
			surface: "#FFFFFF",
			ink: "#1C1B1A",
			muted: "#6B7280",
			line: "#E1E5EE",
			danger: "#D0333B",
			danger_soft: "#FBEAE8",
			warning: "#9A6700",
			warning_soft: "#FBF1DE",
			accent: "#ED8936",
		};
		await env.orderak_db.prepare(
			"INSERT OR REPLACE INTO settings(key,value_json) VALUES('theme_colors',?)",
		).bind(JSON.stringify(legacy)).run();
		const response = await SELF.fetch("https://api.orderak.app/api/v1/theme");
		const body = await response.json<Record<string, any>>();
		expect(body.revisionId).toBeGreaterThan(0);
		expect(body.designSystem.validation.valid).toBe(true);
		expect(body.theme).toEqual(legacy);
	});

	it("redirects the stable stylesheet and serves immutable generated CSS", async () => {
		const stable = await SELF.fetch("https://api.orderak.app/api/theme.css", { redirect: "manual" });
		expect(stable.status).toBe(302);
		const location = stable.headers.get("location")!;
		expect(location).toMatch(/\/api\/theme\/[a-f0-9]{64}\.css$/);
		const immutable = await SELF.fetch(location);
		expect(immutable.status).toBe(200);
		expect(immutable.headers.get("cache-control")).toContain("immutable");
		const css = await immutable.text();
		expect(css).toContain("--md-sys-color-primary:");
		expect(css).toContain("--md-sys-color-primary-rgb:");
		expect(css).toContain("oklch(");
		expect(css).toContain("font-display:swap");
	});

	it("allows exactly one active-pointer winner for concurrent bases", async () => {
		await SELF.fetch("https://api.orderak.app/api/v1/theme");
		const state = await env.orderak_db.prepare(
			"SELECT active_revision_id id FROM design_system_state WHERE id=1",
		).first<{ id: number }>();
		const candidates = await Promise.all([1, 2].map(async () => {
			const row = await env.orderak_db.prepare(
				`INSERT INTO design_system_revisions
				 (schema_version,generator_version,source_json,overrides_json,snapshot_json,validation_json,legacy_projection_json,content_hash,status)
				 SELECT schema_version,generator_version,source_json,overrides_json,snapshot_json,validation_json,legacy_projection_json,content_hash,'candidate'
				 FROM design_system_revisions WHERE id=? RETURNING id`,
			).bind(state!.id).first<{ id: number }>();
			return row!.id;
		}));
		const attempts = await Promise.all(candidates.map((candidate) =>
			env.orderak_db.prepare(
				"UPDATE design_system_state SET active_revision_id=? WHERE id=1 AND active_revision_id=?",
			).bind(candidate, state!.id).run()
		));
		expect(attempts.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0)).toBe(1);
	});

	it("keeps compiled last-known-good behavior and logs corrupt active data", async () => {
		await SELF.fetch("https://api.orderak.app/api/v1/theme");
		const state = await env.orderak_db.prepare(
			"SELECT active_revision_id id FROM design_system_state WHERE id=1",
		).first<{ id: number }>();
		await env.orderak_db.prepare(
			"UPDATE design_system_revisions SET snapshot_json='not-json' WHERE id=?",
		).bind(state!.id).run();
		invalidateDesignSystemCache();
		const fallback = await loadActiveDesignSystem(env);
		expect(fallback.id).toBe(0);
		expect(fallback.legacyTheme.primary).toBe("#006A62");
		const error = await env.orderak_db.prepare(
			"SELECT context FROM error_logs WHERE context='design_system_fallback' ORDER BY id DESC LIMIT 1",
		).first<{ context: string }>();
		expect(error?.context).toBe("design_system_fallback");
		const audit = await env.orderak_db.prepare(
			"SELECT action FROM admin_audit WHERE action='design_system.fallback_activated' ORDER BY id DESC LIMIT 1",
		).first<{ action: string }>();
		expect(audit?.action).toBe("design_system.fallback_activated");
	});

	it("preserves an expired in-memory last-known-good revision when D1 becomes corrupt", async () => {
		const now = Date.now();
		vi.spyOn(Date, "now").mockReturnValue(now);
		const active = await loadActiveDesignSystem(env);
		await env.orderak_db.prepare(
			"UPDATE design_system_revisions SET snapshot_json='not-json' WHERE id=?",
		).bind(active.id).run();
		vi.mocked(Date.now).mockReturnValue(now + 61_000);
		const fallback = await loadActiveDesignSystem(env);
		expect(fallback.id).toBe(active.id);
		expect(fallback.contentHash).toBe(active.contentHash);
	});

	it("names, lists, activates, and permanently deletes immutable checkpoints", async () => {
		const initialResponse = await adminFetch("/api/admin/v1/theme", "owner");
		expect(initialResponse.status).toBe(200);
		const initial = await initialResponse.json<Record<string, any>>();
		const firstId = initial.activeRevisionId as number;

		const changedSource = structuredClone(initial.active.source);
		changedSource.colors.primary = "#6750A4";
		const appliedResponse = await adminFetch("/api/admin/v1/theme", "owner", {
			method: "PUT",
			body: JSON.stringify({
				baseRevisionId: firstId,
				source: changedSource,
				overrides: {},
			}),
		});
		expect(appliedResponse.status).toBe(200);
		const applied = await appliedResponse.json<Record<string, any>>();
		const secondId = applied.activeRevisionId as number;
		expect(secondId).toBeGreaterThan(firstId);
		const secondHash = applied.active.contentHash as string;

		const namedResponse = await adminFetch(`/api/admin/v1/theme/revisions/${firstId}`, "owner", {
			method: "PATCH",
			body: JSON.stringify({ name: "  Été Palette  " }),
		});
		expect(namedResponse.status).toBe(200);
		expect(await namedResponse.json()).toMatchObject({ revision: { id: firstId, name: "Été Palette" } });

		const duplicate = await adminFetch(`/api/admin/v1/theme/revisions/${secondId}`, "owner", {
			method: "PATCH",
			body: JSON.stringify({ name: "e\u0301TE\u0301 PALETTE" }),
		});
		expect(duplicate.status).toBe(409);
		expect(await duplicate.json()).toMatchObject({ code: "revision_name_exists" });

		const saved = await adminFetch("/api/admin/v1/theme/revisions?kind=saved&limit=10", "owner");
		expect(saved.status).toBe(200);
		expect(await saved.json()).toMatchObject({
			revisions: [{ id: firstId, name: "Été Palette", is_current: 0 }],
		});

		const activatedResponse = await adminFetch(`/api/admin/v1/theme/revisions/${firstId}/activate`, "owner", {
			method: "POST",
			body: JSON.stringify({ baseRevisionId: secondId }),
		});
		expect(activatedResponse.status).toBe(200);
		const activated = await activatedResponse.json<Record<string, any>>();
		const thirdId = activated.activeRevisionId as number;
		expect(thirdId).toBeGreaterThan(secondId);
		expect(activated.active.name).toBeNull();

		const activeDelete = await adminFetch(`/api/admin/v1/theme/revisions/${thirdId}`, "owner", { method: "DELETE" });
		expect(activeDelete.status).toBe(409);
		expect(await activeDelete.json()).toMatchObject({ code: "active_revision_cannot_be_deleted" });

		const deleted = await adminFetch(`/api/admin/v1/theme/revisions/${secondId}`, "owner", { method: "DELETE" });
		expect(deleted.status).toBe(200);
		expect(await deleted.json()).toMatchObject({ deletedRevisionId: secondId });

		const removedCss = await SELF.fetch(`https://api.orderak.app/api/theme/${secondHash}.css`);
		expect(removedCss.status).toBe(404);
		const audit = await env.orderak_db.prepare(
			"SELECT action,details_json FROM admin_audit WHERE action='design_system.revision_deleted' ORDER BY id DESC LIMIT 1",
		).first<{ action: string; details_json: string }>();
		expect(audit?.action).toBe("design_system.revision_deleted");
		expect(audit?.details_json).not.toContain("snapshot_json");
	});

	it("enforces revision metadata validation and owner-only deletion", async () => {
		const current = await adminFetch("/api/admin/v1/theme", "owner").then((response) => response.json<Record<string, any>>());
		const id = current.activeRevisionId as number;
		const tooLong = await adminFetch(`/api/admin/v1/theme/revisions/${id}`, "owner", {
			method: "PATCH",
			body: JSON.stringify({ name: "x".repeat(81) }),
		});
		expect(tooLong.status).toBe(422);
		const readonlyName = await adminFetch(`/api/admin/v1/theme/revisions/${id}`, "readonly", {
			method: "PATCH",
			body: JSON.stringify({ name: "Not allowed" }),
		});
		expect(readonlyName.status).toBe(403);
		const readonlyDelete = await adminFetch(`/api/admin/v1/theme/revisions/${id}`, "readonly", { method: "DELETE" });
		expect(readonlyDelete.status).toBe(403);
	});
});
