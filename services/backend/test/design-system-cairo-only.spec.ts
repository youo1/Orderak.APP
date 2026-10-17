import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { callWorker, createSchema } from "./helpers";
import {
	DEFAULT_DESIGN_SYSTEM_SOURCE,
	type GeneratedDesignSystem,
	designSystemCss,
	designSystemFontPreload,
	generateDesignSystem,
	invalidateDesignSystemCache,
	legacyProjection,
	loadActiveDesignSystem,
} from "../src/domains/design/design-system";
import { signJwt, type AdminRole } from "../src/domains/identity/auth";
import adminWorker from "../src/entrypoints/admin-worker";

/**
 * Owner decision D-07 (plan item B8): Cairo is the only approved web font.
 * These tests lock the generator, the stylesheet/preload emitter and the
 * admin API against that decision, and lock that a revision already stored
 * with a retired family (tajawal / noto-arabic) still loads and renders in
 * Cairo without error and without being rewritten.
 */

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

/**
 * Simulates a GeneratedDesignSystem already stored in D1 before D-07, whose
 * source and snapshot both still name a retired family. Built by cloning a
 * real generated snapshot and overwriting just the family, rather than
 * typing the literal inline, so this file compiles whatever FontFamilyId
 * ends up being after the change (the union may or may not still include
 * the retired values at the type level).
 */
function asRetiredFamily(snapshot: GeneratedDesignSystem, family: "tajawal" | "noto-arabic"): GeneratedDesignSystem {
	const clone = JSON.parse(JSON.stringify(snapshot)) as Record<string, any>;
	clone.source.typography.family = family;
	clone.typography.family = family;
	return clone as GeneratedDesignSystem;
}

describe("D-07: Cairo is the only approved font family", () => {
	it("rejects a new source naming a retired family", async () => {
		for (const family of ["tajawal", "noto-arabic"]) {
			const snapshot = await generateDesignSystem({
				...DEFAULT_DESIGN_SYSTEM_SOURCE,
				typography: { family, multiplier: 1 },
			});
			expect(snapshot.validation.valid).toBe(false);
			expect(
				snapshot.validation.errors.some((e) => e.code === "font_not_approved" && e.path === "typography.family"),
			).toBe(true);
		}
	});

	it("still accepts cairo", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		expect(snapshot.validation.errors.some((e) => e.code === "font_not_approved")).toBe(false);
		expect(snapshot.typography.family).toBe("cairo");
	});

	it("emits only the three Cairo @font-face rules, for a cairo snapshot and for a retired stored family alike", async () => {
		const base = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		for (const css of [designSystemCss(base), designSystemCss(base, { fontUrlBase: "./fonts/" })]) {
			expect((css.match(/@font-face\s*\{/g) ?? []).length).toBe(3);
			expect(css).not.toMatch(/Tajawal|Noto/i);
			expect(css).toContain('--orderak-font-family:"Orderak Cairo"');
		}
		for (const family of ["tajawal", "noto-arabic"] as const) {
			const stored = asRetiredFamily(base, family);
			const css = designSystemCss(stored);
			expect((css.match(/@font-face\s*\{/g) ?? []).length).toBe(3);
			expect(css).not.toMatch(/Tajawal|Noto/i);
			expect(css).toContain('--orderak-font-family:"Orderak Cairo"');
		}
	});

	it("always preloads the Cairo file for the requested script, whatever family the snapshot names", async () => {
		const base = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const expected = {
			arabic: "/static/fonts/cairo-arabic-variable.woff2",
			latin: "/static/fonts/cairo-latin-core-variable.woff2",
		} as const;
		for (const family of ["cairo", "tajawal", "noto-arabic"] as const) {
			const snapshot = family === "cairo" ? base : asRetiredFamily(base, family);
			for (const script of ["arabic", "latin"] as const) {
				expect(designSystemFontPreload(snapshot, script)).toContain(expected[script]);
			}
		}
	});

	describe("a stored revision naming a retired family", () => {
		beforeEach(async () => {
			await createSchema();
			invalidateDesignSystemCache();
			env.LOCAL_ADMIN_ENABLED = "true";
			env.ADMIN_JWT_SECRET = "test-admin-secret";
		});

		it.each(["tajawal", "noto-arabic"] as const)("loads and renders %s in Cairo, unchanged", async (family) => {
			await loadActiveDesignSystem(env);
			const base = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
			const retired = asRetiredFamily(base, family);
			const legacy = legacyProjection(retired);
			const sourceJson = JSON.stringify(retired.source);
			const snapshotJson = JSON.stringify(retired);
			const inserted = await env.orderak_db.prepare(
				`INSERT INTO design_system_revisions
				 (schema_version,generator_version,source_json,overrides_json,snapshot_json,validation_json,legacy_projection_json,content_hash,status,published_at)
				 VALUES (?,?,?,'{}',?,?,?,?,'published',datetime('now')) RETURNING id`,
			).bind(
				retired.schemaVersion,
				retired.generatorVersion,
				sourceJson,
				snapshotJson,
				JSON.stringify(retired.validation),
				JSON.stringify(legacy),
				retired.contentHash,
			).first<{ id: number }>();
			expect(inserted?.id).toBeGreaterThan(0);
			await env.orderak_db.prepare("UPDATE design_system_state SET active_revision_id=? WHERE id=1").bind(inserted!.id).run();
			invalidateDesignSystemCache();

			const revision = await loadActiveDesignSystem(env);
			expect(revision.id).toBe(inserted!.id);
			expect((revision.source as unknown as { typography: { family: string } }).typography.family).toBe(family);

			const css = designSystemCss(revision.snapshot);
			expect((css.match(/@font-face\s*\{/g) ?? []).length).toBe(3);
			expect(css).not.toMatch(/Tajawal|Noto/i);
			expect(designSystemFontPreload(revision.snapshot, "arabic")).toContain("/static/fonts/cairo-arabic-variable.woff2");

			// Unchanged: rendering through designSystemCss/designSystemFontPreload is
			// pure and must never regenerate or rewrite the persisted row.
			const row = await env.orderak_db.prepare(
				"SELECT source_json, snapshot_json, content_hash FROM design_system_revisions WHERE id=?",
			).bind(inserted!.id).first<{ source_json: string; snapshot_json: string; content_hash: string }>();
			expect(row?.source_json).toBe(sourceJson);
			expect(row?.snapshot_json).toBe(snapshotJson);
			expect(row?.content_hash).toBe(retired.contentHash);
		});
	});

	describe("admin theme API", () => {
		beforeEach(async () => {
			await createSchema();
			invalidateDesignSystemCache();
			env.LOCAL_ADMIN_ENABLED = "true";
			env.ADMIN_JWT_SECRET = "test-admin-secret";
		});

		it("reports Cairo as the only approved font", async () => {
			const response = await adminFetch("/api/admin/v1/theme", "owner");
			expect(response.status).toBe(200);
			const body = await response.json<{ approvedFonts: string[] }>();
			expect(body.approvedFonts).toEqual(["cairo"]);
		});
	});
});
