import { describe, expect, it } from "vitest";
import {
	DEFAULT_DESIGN_SYSTEM_SOURCE,
	DESIGN_SYSTEM_GENERATOR_VERSION,
	DESIGN_SYSTEM_SCHEMA_VERSION,
	designSystemCss,
	generateDesignSystem,
} from "../src/domains/design/design-system";

type Snapshot = Awaited<ReturnType<typeof generateDesignSystem>>;
type Formats = { hex: string; rgb: string; oklch: string };
type CssOptions = { fontUrlBase: string };
interface Scope { decls: Map<string, string>; parent?: Scope }

const emit = designSystemCss as unknown as (snapshot: Snapshot, options?: CssOptions) => string;

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function declarations(body: string): Map<string, string> {
	const found = new Map<string, string>();
	for (const match of body.matchAll(/(?:^|[\s;{])(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+)/g)) found.set(match[1], match[2].trim());
	return found;
}

const merge = (...maps: Array<Map<string, string>>): Map<string, string> => new Map(maps.flatMap((map) => [...map]));

/** A custom property's var() references resolve on the element that declares it; undeclared names inherit from the parent. */
function resolve(scope: Scope, name: string, depth = 0): string | undefined {
	if (depth > 40) return undefined;
	for (let current: Scope | undefined = scope; current; current = current.parent) {
		const value = current.decls.get(name);
		if (value !== undefined) return substitute(current, value, depth + 1);
	}
	return undefined;
}

function substitute(scope: Scope, value: string, depth = 0): string {
	let out = value;
	for (let i = 0; i < 40 && out.includes("var("); i++) {
		const next = out.replace(/var\(\s*(--[A-Za-z0-9-]+)\s*(?:,([^()]*))?\)/g, (_match, ref: string, fallback?: string) =>
			resolve(scope, ref, depth) ?? fallback?.trim() ?? `<undefined ${ref}>`);
		if (next === out) break;
		out = next;
	}
	return out;
}

/** Formatting-insensitive form of a non-colour value: whitespace, leading zeros, trailing zeros and s/ms are normalised. */
const canon = (value: string): string => value.replace(/!important/gi, "").trim()
	.replace(/\s+/g, " ")
	.replace(/\s*([,()/])\s*/g, "$1")
	.replace(/(-?\d*\.?\d+)(ms|s)\b/g, (_match, n: string, unit: string) =>
		`${unit === "s" ? Math.round(parseFloat(n) * 1e6) / 1e3 : parseFloat(n)}ms`)
	.replace(/-?\d*\.?\d+/g, (n) => String(parseFloat(n)));

function mentions(value: string, formats: Formats): boolean {
	const v = value.toLowerCase().replace(/\s+/g, " ");
	return v.includes(formats.hex.toLowerCase()) || v.includes(formats.rgb) || v.includes(formats.oklch.toLowerCase());
}

function hasAlpha(value: string, alpha: number): boolean {
	const fraction = String(alpha).replace(/^0/, "");
	const percent = `${Math.round(alpha * 1000) / 10}%`;
	return new RegExp(`(?<![\\d.])(?:0?${escapeRegExp(fraction)}0*(?![\\d%])|${escapeRegExp(percent)})`).test(value);
}

async function emitted() {
	const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
	const css = emit(snapshot);
	const plain = stripComments(css);
	const root = declarations(bodies(plain, /:root\s*\{/g, true));
	const darkMedia = declarations(bodies(plain, /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g));
	const highLight = declarations(bodies(plain, /:root\[data-orderak-contrast=["']?high["']?\]\s*\{/g));
	const highDark = declarations(bodies(plain, /:root\[data-orderak-theme=["']?dark["']?\]\[data-orderak-contrast=["']?high["']?\]\s*\{/g));
	const reducedMotion = declarations(bodies(plain, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g));
	const rail = declarations(bodies(plain, /\.orderak-dark\s*\{/g));
	const light: Scope = { decls: root };
	const dark: Scope = { decls: merge(root, darkMedia) };
	return {
		snapshot,
		css,
		plain,
		maps: { root, darkMedia, highLight, highDark, reducedMotion, rail },
		light,
		dark,
		high: { decls: merge(root, highLight) } as Scope,
		reduced: { decls: merge(root, reducedMotion) } as Scope,
		railOnLight: { decls: rail, parent: light } as Scope,
		railOnDark: { decls: rail, parent: dark } as Scope,
		role: (contrast: "standard" | "medium" | "high", mode: "light" | "dark", role: string): Formats =>
			snapshot.web.colors[contrast][mode][role] as Formats,
	};
}

function checkColour(
	failures: string[],
	label: string,
	scope: Scope,
	name: string,
	expected: Formats,
	options: { alpha?: number; prefix?: string; not?: Formats } = {},
): void {
	const value = resolve(scope, name);
	if (value === undefined) {
		failures.push(`${label} ${name} is undefined`);
		return;
	}
	if (!mentions(value, expected)) failures.push(`${label} ${name} = ${value} does not resolve through the expected generated role`);
	if (options.alpha !== undefined && !hasAlpha(value, options.alpha)) failures.push(`${label} ${name} = ${value} lost alpha ${options.alpha}`);
	if (options.prefix && !canon(value).startsWith(`${canon(options.prefix)} `)) failures.push(`${label} ${name} = ${value} lost its structure (${options.prefix} ...)`);
	if (options.not && mentions(value, options.not)) failures.push(`${label} ${name} = ${value} still resolves to the other mode's colour`);
}

const NON_COLOUR: Array<[string, string]> = [
	["--orderak-duration-instant", "0ms"],
	["--orderak-duration-short", "150ms"],
	["--orderak-duration-medium", "180ms"],
	["--orderak-duration-long", "200ms"],
	["--orderak-duration-extra-long", "300ms"],
	["--orderak-easing-standard", "cubic-bezier(.2,0,0,1)"],
	["--orderak-easing-decelerate", "cubic-bezier(0,0,0,1)"],
	["--orderak-easing-accelerate", "cubic-bezier(.3,0,1,1)"],
	["--orderak-easing-linear", "linear"],
	["--orderak-motion-fast", "150ms ease"],
	["--orderak-motion-nav", "180ms ease"],
	["--orderak-motion-drawer", "200ms ease"],
	["--orderak-motion-state", "opacity 150ms cubic-bezier(.2,0,0,1)"],
	["--orderak-state-hover", "0.08"],
	["--orderak-state-focus", "0.10"],
	["--orderak-state-pressed", "0.10"],
	["--orderak-state-dragged", "0.16"],
	["--orderak-state-selected", "0.12"],
	["--orderak-disabled-content-opacity", "0.38"],
	["--orderak-disabled-container-opacity", "0.12"],
	["--orderak-disabled-opacity-web", "0.5"],
	["--orderak-focus-ring-width", "3px"],
	["--orderak-focus-ring-offset", "2px"],
	["--orderak-hover-lift", "translateY(-1px)"],
	["--orderak-pressed-lift", "none"],
	["--orderak-shape-full", "999px"],
	["--orderak-numeric-tabular", "tabular-nums lining-nums"],
	["--orderak-sidebar-width", "268px"],
	["--orderak-topbar-height", "64px"],
];

const SHADOWS: Array<[string, string, number]> = [
	["--orderak-shadow-card", "0 5px 18px", 0.04],
	["--orderak-shadow-raised", "0 5px 14px", 0.08],
	["--orderak-shadow-storefront", "0 1px 4px", 0.067],
	["--orderak-shadow-modal", "0 16px 40px", 0.08],
	["--orderak-shadow-overlay", "0 30px 80px", 0.14],
];

describe("B2: the generator owns every remaining token family (schema 3)", () => {
	it("raises the schema to 3 and bumps the generator version", async () => {
		expect(DESIGN_SYSTEM_SCHEMA_VERSION).toBe(3);
		expect(DESIGN_SYSTEM_GENERATOR_VERSION).toBe("orderak-mcu-0.3.0+4");
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		expect(snapshot.schemaVersion).toBe(3);
		expect(snapshot.generatorVersion).toBe("orderak-mcu-0.3.0+4");
		expect(snapshot.validation.valid).toBe(true);
	});

	it("emits every non-colour token on :root with exactly its current value", async () => {
		const { light } = await emitted();
		const failures: string[] = [];
		for (const [name, expected] of NON_COLOUR) {
			const value = resolve(light, name);
			if (value === undefined) failures.push(`${name} is undefined`);
			else if (canon(value) !== canon(expected)) failures.push(`${name} = ${value}, expected ${expected}`);
		}
		expect(failures).toEqual([]);
	});

	it("zeroes motion under prefers-reduced-motion and keeps the transition structures", async () => {
		const { reduced, plain } = await emitted();
		expect(plain).toMatch(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
		const expected: Array<[string, string]> = [
			["--orderak-duration-instant", "0ms"],
			["--orderak-duration-short", "0ms"],
			["--orderak-duration-medium", "0ms"],
			["--orderak-duration-long", "0ms"],
			["--orderak-duration-extra-long", "0ms"],
			["--orderak-motion-fast", "0ms linear"],
			["--orderak-motion-nav", "0ms linear"],
			["--orderak-motion-drawer", "0ms linear"],
			["--orderak-motion-state", "opacity 0ms cubic-bezier(.2,0,0,1)"],
		];
		const failures: string[] = [];
		for (const [name, want] of expected) {
			const value = resolve(reduced, name);
			if (value === undefined || canon(value) !== canon(want)) failures.push(`${name} = ${value}, expected ${want}`);
		}
		expect(failures).toEqual([]);
	});

	it("derives light colour-bearing tokens from the named roles, keeping alpha and structure", async () => {
		const { light, role } = await emitted();
		const failures: string[] = [];
		const primary = role("standard", "light", "primary");
		checkColour(failures, ":root", light, "--orderak-focus-ring-color", primary, { alpha: 0.22 });
		checkColour(failures, ":root", light, "--orderak-focus-ring", primary, { alpha: 0.22, prefix: "3px solid" });
		checkColour(failures, ":root", light, "--orderak-focus-field-ring", primary, { alpha: 0.12, prefix: "0 0 0 3px" });
		checkColour(failures, ":root", light, "--orderak-hover-surface", role("standard", "light", "surfaceContainerLow"));
		checkColour(failures, ":root", light, "--orderak-hover-border", role("standard", "light", "outlineVariant"));
		checkColour(failures, ":root", light, "--orderak-hover-tint", role("standard", "light", "primaryContainer"));
		for (const [name, geometry, alpha] of SHADOWS) {
			checkColour(failures, ":root", light, name, role("standard", "light", "shadow"), { alpha, prefix: geometry });
		}
		expect(failures).toEqual([]);
		expect(canon(light.decls.get("--orderak-hover-tint") ?? "")).toBe("var(--orderak-primary-soft)");
	});

	it("follows the dark and high-contrast palettes on :root", async () => {
		const { dark, high, role } = await emitted();
		const failures: string[] = [];
		const lightPrimary = role("standard", "light", "primary");
		const darkPrimary = role("standard", "dark", "primary");
		checkColour(failures, "dark", dark, "--orderak-focus-ring-color", darkPrimary, { not: lightPrimary });
		checkColour(failures, "dark", dark, "--orderak-focus-ring", darkPrimary, { prefix: "3px solid", not: lightPrimary });
		checkColour(failures, "dark", dark, "--orderak-focus-field-ring", darkPrimary, { prefix: "0 0 0 3px", not: lightPrimary });
		checkColour(failures, "dark", dark, "--orderak-hover-surface", role("standard", "dark", "surfaceContainerHigh"), { not: role("standard", "light", "surfaceContainerLow") });
		checkColour(failures, "dark", dark, "--orderak-hover-border", role("standard", "dark", "outline"), { not: role("standard", "light", "outlineVariant") });
		for (const [name, geometry, alpha] of SHADOWS) {
			checkColour(failures, "dark", dark, name, role("standard", "dark", "shadow"), { alpha, prefix: geometry });
		}
		checkColour(failures, "high", high, "--orderak-focus-ring-color", role("high", "light", "primary"), { alpha: 0.22, not: lightPrimary });
		checkColour(failures, "high", high, "--orderak-hover-surface", role("high", "light", "surfaceContainerLow"));
		checkColour(failures, "high", high, "--orderak-hover-border", role("high", "light", "outlineVariant"));
		expect(failures).toEqual([]);
	});

	it("redeclares the rail values in .orderak-dark, including the composite focus ring", async () => {
		const { railOnLight, railOnDark, role } = await emitted();
		const failures: string[] = [];
		const lightPrimary = role("standard", "light", "primary");
		const darkPrimary = role("standard", "dark", "primary");
		for (const [label, scope] of [["rail/light page", railOnLight], ["rail/dark page", railOnDark]] as const) {
			checkColour(failures, label, scope, "--orderak-focus-ring-color", darkPrimary, { alpha: 0.34, not: lightPrimary });
			checkColour(failures, label, scope, "--orderak-focus-ring", darkPrimary, { alpha: 0.34, prefix: "3px solid", not: lightPrimary });
			checkColour(failures, label, scope, "--orderak-focus-field-ring", darkPrimary, { alpha: 0.18, prefix: "0 0 0 3px", not: lightPrimary });
			checkColour(failures, label, scope, "--orderak-hover-surface", role("standard", "dark", "surfaceContainerHigh"), { not: role("standard", "light", "surfaceContainerLow") });
			checkColour(failures, label, scope, "--orderak-hover-border", role("standard", "dark", "outline"), { not: role("standard", "light", "outlineVariant") });
		}
		expect(failures).toEqual([]);
	});

	it("writes no colour literal outside the generated role properties and no retired palette value", async () => {
		const { snapshot, css, maps } = await emitted();
		const roleProperties = new Set<string>();
		for (const role of Object.keys(snapshot.web.colors.standard.light)) {
			const name = kebab(role);
			roleProperties.add(`--md-sys-color-${name}`);
			roleProperties.add(`--md-sys-color-${name}-rgb`);
			roleProperties.add(`--orderak-${name}`);
		}
		const literal = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[\d.]/i;
		const offenders: string[] = [];
		for (const [scope, decls] of Object.entries(maps)) {
			for (const [name, value] of decls) {
				if (roleProperties.has(name)) continue;
				if (literal.test(value)) offenders.push(`${scope} ${name}: ${value}`);
			}
		}
		expect(offenders).toEqual([]);
		const squashed = css.replace(/\s+/g, "");
		for (const retired of ["30,58,138", "149,209,210", "20,20,31", "13,21,20", "0,0,0,.067"]) {
			expect(squashed, retired).not.toContain(retired);
		}
	});

	it("emits the new families identically for /theme.css and the bundle, differing only by font URL base", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const worker = emit(snapshot);
		const admin = emit(snapshot, { fontUrlBase: "./fonts/" });
		expect(admin).toBe(worker.split("/static/fonts/").join("./fonts/"));
		for (const css of [worker, admin]) {
			expect(css).toMatch(/--orderak-motion-drawer\s*:/);
			expect(css).toMatch(/--orderak-focus-ring\s*:/);
			expect(css).toMatch(/prefers-reduced-motion/);
			const plain = stripComments(css);
			expect(plain).not.toMatch(/\.ork-|@keyframes|:focus-visible/);
		}
	});

	it("emits only the three Cairo faces for Cairo and for a stored retired-family snapshot", async () => {
		for (const family of ["cairo", "tajawal", "noto-arabic"] as const) {
			const base = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
			const snapshot = family === "cairo"
				? base
				: (JSON.parse(JSON.stringify({ ...base, source: { ...base.source, typography: { ...base.source.typography, family } }, typography: { ...base.typography, family } })) as Snapshot);
			const css = emit(snapshot, { fontUrlBase: "./fonts/" });
			expect((css.match(/@font-face\s*\{/g) ?? []).length).toBe(3);
			expect(css).not.toMatch(/Tajawal|Noto/i);
			expect(css).toContain('--orderak-font-family:"Orderak Cairo",Cairo,system-ui,sans-serif');
		}
	});
});
