import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callWorker, createSchema } from "./helpers";
import {
	FIRST_SCHEMA_V2_ANDROID_VERSION_CODE,
	designSystemCss,
	invalidateDesignSystemCache,
	loadActiveDesignSystem,
} from "../src/domains/design/design-system";
import { publicDesignSystemCss, publicDesignSystemResponse } from "../src/domains/admin/admin-theme";
import { signJwt, type AdminRole } from "../src/domains/identity/auth";
import adminWorker from "../src/entrypoints/admin-worker";
import schemaV2Fixture from "./fixtures/design-system.schema-v2.json";

type Formats = { hex: string; rgb: string; oklch: string };
type V2Snapshot = {
	schemaVersion: number;
	generatorVersion: string;
	contentHash: string;
	source: unknown;
	validation: { valid: boolean };
	typography: { roles: Record<string, { sizeRem: number; lineHeight: number; weight: number; letterSpacingEm: number }> };
	spacing: { tokens: Record<string, number> };
	shapes: Record<string, number>;
	web: { colors: Record<string, Record<string, Record<string, Formats>>> };
};
type V2Fixture = { source: unknown; snapshot: V2Snapshot; legacyProjection: unknown };

const v2 = schemaV2Fixture as unknown as V2Fixture;
const V2_HASH = "6b95438c3fa8a37a8a7614882da4e0d44d2054ca7dd4317036c3040a62a6e0eb";
const emit = designSystemCss as unknown as (snapshot: unknown, options?: { fontUrlBase: string }) => string;

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const kebab = (role: string): string => role.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

function depthAt(css: string, index: number): number {
	let depth = 0;
	for (let i = 0; i < index; i++) {
		if (css[i] === "{") depth++;
		else if (css[i] === "}") depth--;
	}
	return depth;
}

function bodies(css: string, opener: RegExp, topLevelOnly = false): string {
	const found: string[] = [];
	for (const match of css.matchAll(opener)) {
		const index = match.index ?? 0;
		if (topLevelOnly && depthAt(css, index) !== 0) continue;
		const open = index + match[0].length - 1;
		let depth = 0;
		for (let i = open; i < css.length; i++) {
			if (css[i] === "{") depth++;
			else if (css[i] === "}") {
				depth--;
				if (depth === 0) {
					found.push(css.slice(open + 1, i));
					break;
				}
			}
		}
	}
	return found.join("\n");
}

/** Declarations that only a schema-3 snapshot carries; a schema-2 render must omit every one. */
const SCHEMA_3_ONLY = [
	/--orderak-(?:duration|easing|motion|state|disabled|focus|hover|pressed|icon)-[a-z-]+\s*:/,
	/--orderak-shadow-(?:card|raised|storefront|modal|overlay)\s*:/,
	/--orderak-(?:shape-full|sidebar-width|topbar-height|numeric-tabular)\s*:/,
	/prefers-reduced-motion/,
];

function schema3Leaks(css: string): string[] {
	const plain = stripComments(css);
	return SCHEMA_3_ONLY.filter((pattern) => pattern.test(plain)).map(String);
}

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

describe("the frozen schema-2 fixture", () => {
	it("is the develop-era canonical fixture, unchanged", async () => {
		expect(v2.snapshot.schemaVersion).toBe(2);
		expect(v2.snapshot.generatorVersion).toBe("orderak-mcu-0.3.0+3");
		expect(v2.snapshot.contentHash).toBe(V2_HASH);
		const { contentHash: _hash, ...rest } = v2.snapshot;
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(rest)));
		const recomputed = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
		expect(recomputed).toBe(V2_HASH);
	});

	it("still renders every schema-2 family through designSystemCss and omits the schema-3 families", () => {
		const worker = emit(v2.snapshot);
		const admin = emit(v2.snapshot, { fontUrlBase: "./fonts/" });
		expect(admin).toBe(worker.split("/static/fonts/").join("./fonts/"));
		const header = /^\s*\/\*[\s\S]*?\*\//.exec(worker)?.[0] ?? "";
		expect(header).toContain(V2_HASH);
		expect(header).toContain("orderak-mcu-0.3.0+3");
		expect((worker.match(/@font-face\s*\{/g) ?? []).length).toBe(12);

		const plain = stripComments(worker);
		const root = bodies(plain, /:root\s*\{/g, true);
		const scopes: Record<string, [string, string, string]> = {
			"standard.light": [root, "standard", "light"],
			"standard.dark": [bodies(plain, /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g), "standard", "dark"],
			"high.light": [bodies(plain, /:root\[data-orderak-contrast=["']?high["']?\]\s*\{/g), "high", "light"],
			rail: [bodies(plain, /\.orderak-dark\s*\{/g), "standard", "dark"],
		};
		const missing: string[] = [];
		for (const [scope, [body, contrast, mode]] of Object.entries(scopes)) {
			for (const [role, formats] of Object.entries(v2.snapshot.web.colors[contrast][mode])) {
				const name = kebab(role);
				if (!body.includes(`--md-sys-color-${name}:${formats.hex}`)) missing.push(`${scope} --md-sys-color-${name}`);
				if (!body.includes(`--orderak-${name}:${formats.oklch}`)) missing.push(`${scope} --orderak-${name}`);
			}
		}
		for (const alias of ["--orderak-canvas", "--orderak-ink", "--orderak-line", "--orderak-primary-soft", "--primary", "--surface"]) {
			if (!new RegExp(`(?:^|[\\s;{])${alias}\\s*:`).test(root)) missing.push(`:root ${alias}`);
			if (!new RegExp(`(?:^|[\\s;{])${alias}\\s*:`).test(scopes.rail[0])) missing.push(`.orderak-dark ${alias}`);
		}
		for (const [role, token] of Object.entries(v2.snapshot.typography.roles)) {
			if (!root.includes(`--orderak-type-${kebab(role)}-size:${token.sizeRem}rem`)) missing.push(`type ${role}`);
		}
		for (const [name, value] of Object.entries(v2.snapshot.spacing.tokens)) {
			if (!root.includes(`--orderak-${name}:${value}px`)) missing.push(`spacing ${name}`);
		}
		for (const [name, value] of Object.entries(v2.snapshot.shapes)) {
			if (!root.includes(`--orderak-shape-${kebab(name)}:${value}px`)) missing.push(`shape ${name}`);
		}
		if (!root.includes("--orderak-minimum-touch-target:48px")) missing.push("touch target");
		expect(missing).toEqual([]);
		expect(schema3Leaks(worker)).toEqual([]);
	});
});

describe("an active schema-2 revision in D1", () => {
	beforeEach(async () => {
		vi.restoreAllMocks();
		await createSchema();
		invalidateDesignSystemCache();
		env.LOCAL_ADMIN_ENABLED = "true";
		env.ADMIN_JWT_SECRET = "test-admin-secret";
	});
	afterEach(() => invalidateDesignSystemCache());

	it("loads, reports schema 2 publicly and serves /theme.css without schema-3 families", async () => {
		await loadActiveDesignSystem(env);
		const inserted = await env.orderak_db.prepare(
			`INSERT INTO design_system_revisions
			 (schema_version,generator_version,source_json,overrides_json,snapshot_json,validation_json,legacy_projection_json,content_hash,status,published_at)
			 VALUES (2,?,?,'{}',?,?,?,?,'published',datetime('now')) RETURNING id`,
		).bind(
			v2.snapshot.generatorVersion,
			JSON.stringify(v2.snapshot.source),
			JSON.stringify(v2.snapshot),
			JSON.stringify(v2.snapshot.validation),
			JSON.stringify(v2.legacyProjection),
			v2.snapshot.contentHash,
		).first<{ id: number }>();
		expect(inserted?.id).toBeGreaterThan(0);
		await env.orderak_db.prepare("UPDATE design_system_state SET active_revision_id=? WHERE id=1").bind(inserted!.id).run();
		invalidateDesignSystemCache();

		const revision = await loadActiveDesignSystem(env);
		expect(revision.id).toBe(inserted!.id);
		expect(revision.schemaVersion).toBe(2);
		expect(revision.contentHash).toBe(V2_HASH);

		const response = await publicDesignSystemResponse(new Request("https://api.orderak.app/api/v1/theme"), env, "https://orderak.app");
		expect(response.status).toBe(200);
		const body = await response.json<Record<string, any>>();
		expect(body.schemaVersion).toBe(2);
		expect(body.designSystem.schemaVersion).toBe(2);
		expect(body.version).toBe(V2_HASH);
		expect(body.compatibility.firstSchemaV2AndroidVersionCode).toBe(2);
		expect(FIRST_SCHEMA_V2_ANDROID_VERSION_CODE).toBe(2);

		const cssResponse = await publicDesignSystemCss(new Request(`https://api.orderak.app/api/theme/${V2_HASH}.css`), env, V2_HASH);
		expect(cssResponse.status).toBe(200);
		const css = await cssResponse.text();
		expect(css).toBe(emit(v2.snapshot));
		expect(css).toContain(`--md-sys-color-primary:${v2.snapshot.web.colors.standard.light.primary.hex}`);
		expect(schema3Leaks(css)).toEqual([]);

		const admin = await adminFetch("/api/admin/v1/theme", "owner");
		expect(admin.status).toBe(200);
		const adminBody = await admin.json<Record<string, any>>();
		expect(adminBody.active.schemaVersion).toBe(2);
		expect(adminBody.capabilities.schemaVersion).toBe(3);
	});

	it("seeds and reports schema 3 for a fresh installation", async () => {
		const response = await publicDesignSystemResponse(new Request("https://api.orderak.app/api/v1/theme"), env, "https://orderak.app");
		const body = await response.json<Record<string, any>>();
		expect(body.schemaVersion).toBe(3);
		expect(body.designSystem.schemaVersion).toBe(3);
		expect(body.compatibility.firstSchemaV2AndroidVersionCode).toBe(2);
		const admin = await adminFetch("/api/admin/v1/theme", "owner").then((r) => r.json<Record<string, any>>());
		expect(admin.capabilities.schemaVersion).toBe(3);
		expect(admin.active.schemaVersion).toBe(3);
	});
});
