import { describe, expect, it } from "vitest";
import {
	DEFAULT_DESIGN_SYSTEM_SOURCE,
	contrastRatio,
	designSystemCss,
	generateDesignSystem,
	legacyProjection,
} from "../src/domains/design/design-system";

type Snapshot = Awaited<ReturnType<typeof generateDesignSystem>>;
type CssOptions = { fontUrlBase: string };
const emit = designSystemCss as unknown as (snapshot: Snapshot, options?: CssOptions) => string;

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

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

function resolve(decls: Map<string, string>, name: string, depth = 0): string | undefined {
	if (depth > 40) return undefined;
	const value = decls.get(name);
	if (value === undefined) return undefined;
	const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
	if (!ref) return value;
	return resolve(decls, ref[1], depth + 1);
}

describe("B1 follow-up: restores --primary-soft, --primary-strong and --surface to the approved roles", () => {
	it("pins the computed hex for the three restored aliases in light :root and .orderak-dark", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const css = emit(snapshot);
		const plain = stripComments(css);
		const root = declarations(bodies(plain, /:root\s*\{/g, true));
		const rail = declarations(bodies(plain, /\.orderak-dark\s*\{/g));

		expect(resolve(root, "--primary-strong")).toBe("#054F50");
		expect(resolve(root, "--primary-soft")).toBe("#B0EEEE");
		expect(resolve(root, "--surface")).toBe("#FFFFFF");
		expect(resolve(root, "--orderak-primary-strong")).toBe("#054F50");
		expect(resolve(root, "--orderak-primary-soft")).toBe("#B0EEEE");

		expect(resolve(rail, "--primary-strong")).toBe("#B0EEEE");
		expect(resolve(rail, "--primary-soft")).toBe("#054F50");
		expect(resolve(rail, "--surface")).toBe("#080F10");
		expect(resolve(rail, "--orderak-primary-strong")).toBe("#B0EEEE");
		expect(resolve(rail, "--orderak-primary-soft")).toBe("#054F50");
	});

	it("requires white text on light --primary-strong to reach WCAG AA contrast (>= 4.5:1)", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const css = emit(snapshot);
		const root = declarations(bodies(stripComments(css), /:root\s*\{/g, true));
		const strong = resolve(root, "--primary-strong");
		expect(strong).toBeDefined();
		expect(contrastRatio("#FFFFFF", strong as string)).toBeGreaterThanOrEqual(4.5);
	});

	it("leaves legacyProjection's primary_strong/primary_soft mapped to primaryContainer/surfaceContainer, unchanged", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const legacy = legacyProjection(snapshot);
		expect(legacy.primary_strong).toBe(snapshot.schemes.standard.light.primaryContainer);
		expect(legacy.primary_soft).toBe(snapshot.schemes.standard.light.surfaceContainer);
	});
});
