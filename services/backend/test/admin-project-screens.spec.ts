import { beforeEach, describe, expect, it } from "vitest";
import type { D1Migration } from "cloudflare:test";
import { signJwt, type AdminRole } from "../src/domains/identity/auth";
import adminWorker from "../src/entrypoints/admin-worker";
import { callWorker, createSchema, env } from "./helpers";

async function adminFetch(path: string, role: AdminRole, init: RequestInit = {}): Promise<Response> {
	const token = await signJwt({ sub: 1, email: `${role}@example.test`, role }, env.ADMIN_JWT_SECRET || "test-admin-secret");
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${token}`);
	headers.set("content-type", "application/json");
	return callWorker(adminWorker, new Request(`https://admin.orderak.app${path}`, { ...init, headers }), env);
}

describe("migration 061: app_screens.figma_url renamed to design_url", () => {
	it("renames the column and preserves an existing value, executed from the real migration file", async () => {
		const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS;
		const migration061 = migrations.find((m) => m.name.startsWith("061_app_screens_design_url"));
		if (!migration061) throw new Error("migration 061_app_screens_design_url.sql was not found in TEST_MIGRATIONS");

		// Run 061's own statements against an isolated fixture table, not the
		// suite's shared app_screens: by the time any other test in this file has
		// called createSchema(), the shared table is already past 061 and
		// figma_url no longer exists there, so re-running the rename on it would
		// fail on a column that is already gone. Only the table identifier is
		// substituted below; the statement text is the migration file's own.
		const FIXTURE = "app_screens_061_fixture";
		await env.orderak_db.prepare(`DROP TABLE IF EXISTS ${FIXTURE}`).run();
		await env.orderak_db.prepare(
			`CREATE TABLE ${FIXTURE} (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				description TEXT,
				status TEXT DEFAULT 'planned',
				figma_url TEXT,
				screenshot_url TEXT,
				android_route TEXT,
				sort_order INTEGER DEFAULT 0,
				created_at TEXT DEFAULT (datetime('now')),
				updated_at TEXT DEFAULT (datetime('now'))
			)`,
		).run();
		const seeded = await env.orderak_db.prepare(
			`INSERT INTO ${FIXTURE} (name, figma_url) VALUES ('Splash', 'https://claude.ai/artifact/seed-link') RETURNING id`,
		).first<{ id: number }>();

		for (const rawQuery of migration061.queries) {
			const query = rawQuery.replace(/\bapp_screens\b/g, FIXTURE);
			const hasStatement = query.split("\n").some((line) => !/^\s*--/.test(line) && line.trim().length > 0);
			if (!hasStatement) continue;
			await env.orderak_db.prepare(query).run();
		}

		const row = await env.orderak_db.prepare(`SELECT design_url FROM ${FIXTURE} WHERE id=?`).bind(seeded?.id).first<{ design_url: string }>();
		expect(row?.design_url).toBe("https://claude.ai/artifact/seed-link");
		await expect(
			env.orderak_db.prepare(`SELECT figma_url FROM ${FIXTURE} WHERE id=?`).bind(seeded?.id).first(),
		).rejects.toThrow();

		await env.orderak_db.prepare(`DROP TABLE ${FIXTURE}`).run();
	});
});

describe("admin screens: design_url create and update", () => {
	beforeEach(async () => {
		await createSchema();
	});

	it("stores and returns design_url through create and update", async () => {
		const created = await adminFetch("/api/admin/v1/screens", "owner", {
			method: "POST",
			body: JSON.stringify({ name: "Dashboard", design_url: "https://claude.ai/artifact/dashboard" }),
		});
		expect(created.status).toBe(201);
		const { id } = await created.json<{ id: number }>();

		const afterCreate = await (await adminFetch("/api/admin/v1/screens", "owner")).json<{ screens: Record<string, unknown>[] }>();
		const createdScreen = afterCreate.screens.find((s) => s.id === id);
		expect(createdScreen).toMatchObject({ design_url: "https://claude.ai/artifact/dashboard" });
		expect(createdScreen).not.toHaveProperty("figma_url");

		const updated = await adminFetch(`/api/admin/v1/screens/${id}`, "owner", {
			method: "PUT",
			body: JSON.stringify({ name: "Dashboard", design_url: "https://claude.ai/artifact/dashboard-v2" }),
		});
		expect(updated.status).toBe(200);

		const afterUpdate = await (await adminFetch("/api/admin/v1/screens", "owner")).json<{ screens: Record<string, unknown>[] }>();
		expect(afterUpdate.screens.find((s) => s.id === id)).toMatchObject({ design_url: "https://claude.ai/artifact/dashboard-v2" });
	});
});
