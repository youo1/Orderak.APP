import { describe, expect, it } from "vitest";
import {
	DEFAULT_DESIGN_SYSTEM_SOURCE,
	designSystemCss,
	generateDesignSystem,
} from "../src/domains/design/design-system";

type Snapshot = Awaited<ReturnType<typeof generateDesignSystem>>;
type CssOptions = { fontUrlBase: string };
// The second argument is new in B1; calling through this alias keeps the test
// readable on both sides of the change.
const emit = designSystemCss as unknown as (snapshot: Snapshot, options?: CssOptions) => string;

const CONTRASTS = ["standard", "medium", "high"] as const;
const MODES = ["light", "dark"] as const;
const FONT_FILES = [
	"cairo-arabic-variable.woff2", "cairo-latin-core-variable.woff2", "cairo-latin-variable.woff2",
	"tajawal-arabic-400.woff2", "tajawal-latin-400.woff2", "tajawal-arabic-500.woff2",
	"tajawal-latin-500.woff2", "tajawal-arabic-700.woff2", "tajawal-latin-700.woff2",
	"noto-sans-arabic-variable.woff2", "noto-sans-arabic-latin-core-variable.woff2", "noto-sans-arabic-latin-variable.woff2",
];
const SEMANTIC_ALIASES = [
	"--orderak-canvas", "--orderak-ink", "--orderak-line", "--orderak-muted", "--orderak-primary-tint",
	"--orderak-primary-strong", "--orderak-primary-soft", "--orderak-danger", "--orderak-danger-soft",
	"--orderak-warning-soft", "--orderak-accent", "--orderak-success-soft", "--orderak-information-soft",
	"--orderak-commerce-soft",
];
const LEGACY_ALIASES = [
	"--primary", "--primary-strong", "--primary-soft", "--primary-tint", "--canvas", "--surface", "--ink",
	"--muted", "--line", "--danger", "--danger-soft", "--warning", "--warning-soft", "--accent",
];
/** Alias -> the generated role it must resolve to (kebab-case role name). */
const SEMANTIC_MAP: Array<[string, string]> = [
	["--orderak-canvas", "background"], ["--orderak-ink", "on-surface"], ["--orderak-line", "outline-variant"],
	["--orderak-muted", "on-surface-variant"], ["--orderak-primary-tint", "inverse-primary"],
	["--orderak-primary-strong", "primary-container"], ["--orderak-primary-soft", "surface-container"],
	["--orderak-accent", "secondary"], ["--orderak-danger", "error"], ["--orderak-danger-soft", "error-container"],
	["--orderak-warning-soft", "warning-container"], ["--orderak-success-soft", "success-container"],
	["--orderak-information-soft", "information-container"], ["--orderak-commerce-soft", "commerce-container"],
];
const ON_ACCENT: [string, string] = ["--orderak-on-accent", "on-secondary"];
const LEGACY_MAP: Array<[string, string]> = [
	["--primary", "primary"], ["--primary-strong", "primary-container"], ["--primary-soft", "surface-container"],
	["--primary-tint", "inverse-primary"], ["--canvas", "background"], ["--surface", "surface"], ["--ink", "on-surface"],
	["--muted", "on-surface-variant"], ["--line", "outline-variant"], ["--danger", "error"],
	["--danger-soft", "error-container"], ["--warning", "warning"], ["--warning-soft", "warning-container"],
	["--accent", "secondary"],
];

const kebab = (role: string): string => role.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function depthAt(css: string, index: number): number {
	let depth = 0;
	for (let i = 0; i < index; i++) {
		if (css[i] === "{") depth++;
		else if (css[i] === "}") depth--;
	}
	return depth;
}

/** Bodies of every block whose opener matches; `opener` must be global and end with `\{`. */
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

const declares = (body: string, name: string): boolean =>
	new RegExp(`(?:^|[\\s;{])${escapeRegExp(name)}\\s*:`).test(body);

function scopes(css: string): Record<string, string> {
	const plain = stripComments(css);
	return {
		"standard.light": bodies(plain, /:root\s*\{/g, true),
		"standard.dark": bodies(plain, /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g),
		"medium.light": bodies(plain, /:root\[data-orderak-contrast=["']?medium["']?\]\s*\{/g),
		"medium.dark": bodies(plain, /:root\[data-orderak-theme=["']?dark["']?\]\[data-orderak-contrast=["']?medium["']?\]\s*\{/g),
		"high.light": bodies(plain, /:root\[data-orderak-contrast=["']?high["']?\]\s*\{/g),
		"high.dark": bodies(plain, /:root\[data-orderak-theme=["']?dark["']?\]\[data-orderak-contrast=["']?high["']?\]\s*\{/g),
		rail: bodies(plain, /\.orderak-dark\s*\{/g),
	};
}

function declarations(body: string): Map<string, string> {
	const found = new Map<string, string>();
	for (const match of body.matchAll(/(?:^|[\s;{])(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+)/g)) found.set(match[1], match[2].trim());
	return found;
}

type Formats = { hex: string; oklch: string };

/** Follows var() indirections inside one scope; null when `name` reaches the `expected` generated role. */
function resolveFailure(decls: Map<string, string>, roles: Record<string, Formats>, name: string, expected: string): string | null {
	let current = name;
	const seen = new Set<string>();
	for (;;) {
		const value = decls.get(current);
		if (value === undefined) return `${name}: ${current} is not declared in this scope`;
		if (seen.has(current)) return `${name}: circular reference`;
		seen.add(current);
		const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
		if (!ref) {
			const want = roles[expected];
			const literal = value.toLowerCase();
			if (want && (literal === want.hex.toLowerCase() || literal === want.oklch.toLowerCase())) return null;
			return `${name}: resolves to ${value}, not the ${expected} role`;
		}
		const target = ref[1];
		for (const prefix of ["--md-sys-color-", "--orderak-"]) {
			const role = target.slice(prefix.length);
			if (target.startsWith(prefix) && role in roles) {
				if (role !== expected) return `${name}: resolves to ${role}, not ${expected}`;
				return decls.has(target) ? null : `${name}: names ${target}, which this scope does not declare`;
			}
		}
		current = target;
	}
}

function rolesFor(snapshot: Snapshot, contrast: (typeof CONTRASTS)[number], mode: (typeof MODES)[number]): Record<string, Formats> {
	return Object.fromEntries(Object.entries(snapshot.web.colors[contrast][mode]).map(([role, formats]) => [kebab(role), formats]));
}

describe("designSystemCss emits /theme.css and the admin bundle from one function", () => {
	it("defaults to Worker font URLs and differs from the admin bundle only in the font URL base", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const worker = emit(snapshot);
		const explicitWorker = emit(snapshot, { fontUrlBase: "/static/fonts/" });
		const admin = emit(snapshot, { fontUrlBase: "./fonts/" });

		expect(explicitWorker).toBe(worker);
		expect(worker).not.toContain("./fonts/");
		expect(admin).not.toContain("/static/fonts/");
		expect(admin).toContain("./fonts/");
		expect(admin).toBe(worker.split("/static/fonts/").join("./fonts/"));

		for (const [css, base] of [[worker, "/static/fonts/"], [admin, "./fonts/"]] as const) {
			const urls = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((match) => match[1]);
			expect(urls.length).toBeGreaterThanOrEqual(FONT_FILES.length);
			expect(urls.every((url) => url.startsWith(base))).toBe(true);
		}
	});

	it("declares font faces for Cairo, Tajawal and Noto Sans Arabic whatever family is selected", async () => {
		for (const family of ["cairo", "tajawal", "noto-arabic"] as const) {
			const snapshot = await generateDesignSystem({
				...DEFAULT_DESIGN_SYSTEM_SOURCE,
				typography: { ...DEFAULT_DESIGN_SYSTEM_SOURCE.typography, family },
			});
			const css = emit(snapshot, { fontUrlBase: "./fonts/" });
			for (const name of ["Orderak Cairo", "Orderak Tajawal", "Orderak Noto Arabic"]) {
				expect(css).toMatch(new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"${name}"`));
			}
			for (const file of FONT_FILES) expect(css).toContain(`./fonts/${file}`);
			expect((css.match(/@font-face\s*\{/g) ?? []).length).toBe(12);
		}
	});

	it("opens both targets with a generated-file header naming the emitter, version, hash and regeneration command", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		for (const css of [emit(snapshot), emit(snapshot, { fontUrlBase: "./fonts/" })]) {
			const header = /^\s*\/\*[\s\S]*?\*\//.exec(css)?.[0] ?? "";
			expect(header).toContain("designSystemCss");
			expect(header).toContain(snapshot.generatorVersion);
			expect(header).toContain(snapshot.contentHash);
			expect(header).toContain("pnpm run design-system:generate");
			expect(header).toMatch(/by hand/i);
		}
	});

	it("declares every web colour role for all six themes and for the .orderak-dark rail scope", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const found = scopes(emit(snapshot, { fontUrlBase: "./fonts/" }));
		const missing: string[] = [];
		const expectRoles = (scope: string, contrast: (typeof CONTRASTS)[number], mode: (typeof MODES)[number]) => {
			const body = found[scope];
			for (const [role, formats] of Object.entries(snapshot.web.colors[contrast][mode])) {
				const name = kebab(role);
				if (!body.includes(`--md-sys-color-${name}:${formats.hex}`)) missing.push(`${scope} --md-sys-color-${name}`);
				if (!body.includes(`--md-sys-color-${name}-rgb:${formats.rgb}`)) missing.push(`${scope} --md-sys-color-${name}-rgb`);
				if (!body.includes(`--orderak-${name}:${formats.oklch}`)) missing.push(`${scope} --orderak-${name}`);
			}
		};
		for (const contrast of CONTRASTS) for (const mode of MODES) expectRoles(`${contrast}.${mode}`, contrast, mode);
		expectRoles("rail", "standard", "dark");
		expect(missing).toEqual([]);
	});

	it("declares the semantic and legacy colour aliases on :root and again directly in .orderak-dark", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const found = scopes(emit(snapshot));
		const missing: string[] = [];
		for (const alias of [...SEMANTIC_ALIASES, ...LEGACY_ALIASES]) {
			if (!declares(found["standard.light"], alias)) missing.push(`:root ${alias}`);
			if (!declares(found.rail, alias)) missing.push(`.orderak-dark ${alias}`);
		}
		expect(missing).toEqual([]);
		expect(declares(found.rail, "--surface")).toBe(true);
	});

	it("maps every alias to its generated role in all six themes and in .orderak-dark, never to a stale literal", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const found = scopes(emit(snapshot));
		const root = declarations(found["standard.light"]);
		const failures: string[] = [];
		for (const contrast of CONTRASTS) {
			for (const mode of MODES) {
				const scope = `${contrast}.${mode}`;
				// Every :root scheme selector applies to the same element, so later
				// declarations override the light :root ones.
				const merged = new Map([...root, ...declarations(found[scope])]);
				const roles = rolesFor(snapshot, contrast, mode);
				for (const [alias, role] of [...SEMANTIC_MAP, ON_ACCENT, ...LEGACY_MAP]) {
					const failure = resolveFailure(merged, roles, alias, role);
					if (failure) failures.push(`${scope} ${failure}`);
				}
			}
		}
		const rail = declarations(found.rail);
		const railRoles = rolesFor(snapshot, "standard", "dark");
		const railAliases = rail.has(ON_ACCENT[0]) ? [...SEMANTIC_MAP, ON_ACCENT, ...LEGACY_MAP] : [...SEMANTIC_MAP, ...LEGACY_MAP];
		for (const [alias, role] of railAliases) {
			const failure = resolveFailure(rail, railRoles, alias, role);
			if (failure) failures.push(`rail ${failure}`);
		}
		expect(failures).toEqual([]);
	});

	it("keeps every token /theme.css already emitted and owns no hand-kept family", async () => {
		for (const [family, familyName] of [["cairo", "Orderak Cairo"], ["tajawal", "Orderak Tajawal"], ["noto-arabic", "Orderak Noto Arabic"]] as const) {
			const snapshot = await generateDesignSystem({
				...DEFAULT_DESIGN_SYSTEM_SOURCE,
				typography: { ...DEFAULT_DESIGN_SYSTEM_SOURCE.typography, family },
			});
			const css = emit(snapshot);
			const root = scopes(css)["standard.light"];
			expect(root).toContain(`--orderak-font-family:"${familyName}",Cairo,Tajawal,"Noto Sans Arabic",system-ui,sans-serif`);
			for (const [role, token] of Object.entries(snapshot.typography.roles)) {
				const name = kebab(role);
				expect(root).toContain(`--orderak-type-${name}-size:${token.sizeRem}rem`);
				expect(root).toContain(`--orderak-type-${name}-line-height:${token.lineHeight}rem`);
				expect(root).toContain(`--orderak-type-${name}-weight:${token.weight}`);
				expect(root).toContain(`--orderak-type-${name}-tracking:${token.letterSpacingEm}em`);
			}
			for (const [name, value] of Object.entries(snapshot.spacing.tokens)) expect(root).toContain(`--orderak-${name}:${value}px`);
			for (const [name, value] of Object.entries(snapshot.shapes)) expect(root).toContain(`--orderak-shape-${kebab(name)}:${value}px`);
			expect(root).toContain("--orderak-minimum-touch-target:48px");
			const plain = stripComments(css);
			expect(plain).not.toMatch(/@keyframes|\.ork-|:focus-visible|prefers-reduced-motion/);
			expect(plain).not.toMatch(/--orderak-(?:shadow|duration|motion|easing|hover|focus|breakpoint|mark|state|disabled)-[a-z-]+\s*:/);
		}
	});

	it("keeps the generated scrim role opaque", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const scrim = snapshot.web.colors.standard.light.scrim;
		expect(scrim.oklch).not.toContain("/");
		const css = emit(snapshot, { fontUrlBase: "./fonts/" });
		expect(css).toContain(`--orderak-scrim:${scrim.oklch}`);
		expect(css).not.toMatch(/--orderak-scrim\s*:\s*(?:rgba|hsla|color-mix)\(/);
		expect(css).not.toContain("rgba(8,12,30");
	});
});
