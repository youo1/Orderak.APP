import { describe, expect, it } from "vitest";
import {
	DEFAULT_DESIGN_SYSTEM_SOURCE,
	LEGACY_DEFAULT_THEME,
	generateDesignSystem,
	legacyProjection,
} from "../src/domains/design/design-system";
import { DEFAULT_THEME } from "../src/domains/design/theme";
import schemaV2Fixture from "./fixtures/design-system.schema-v2.json";

// Plan item B2 lifts the snapshot to schema 3, so the generated content hash
// moves. Everything plan item B0 / owner decision D-11 approved must not.
const B0_HASH_PREFIX = "6b95438c3fa8a37a";
const v2 = schemaV2Fixture as unknown as { snapshot: { schemaVersion: number; contentHash: string; source: unknown } };

describe("Dark Teal palette defaults survive schema 3 (B0 / D-11, B2)", () => {
	it("keeps the approved seeds and every other source field", () => {
		expect(DEFAULT_DESIGN_SYSTEM_SOURCE).toEqual({
			colors: {
				primary: "#014D4E",
				secondary: "#4B6B69",
				tertiary: "#2F7D6A",
				error: "#BA1A1A",
				warning: "#9A6700",
				success: "#2E7D32",
				information: "#0061A4",
				commerce: "#824894",
				primaryChromaFloor: 28.7,
				primaryLightTones: [29.1, 22, 14],
				surfaceTemperature: "cool",
				variant: "tonal-spot",
				defaultContrast: "standard",
			},
			typography: { family: "cairo", multiplier: 1 },
			spacing: { baseUnit: 4, density: "comfortable" },
			shapes: { preset: "balanced" },
		});
		expect(v2.snapshot.source).toEqual(DEFAULT_DESIGN_SYSTEM_SOURCE);
	});

	it("keeps the legacy accent #386664 and the other legacy tokens", () => {
		expect(LEGACY_DEFAULT_THEME.accent).toBe("#386664");
		expect(DEFAULT_THEME).toEqual(LEGACY_DEFAULT_THEME);
		expect(LEGACY_DEFAULT_THEME).toEqual({
			primary: "#014D4E",
			primary_strong: "#002929",
			primary_soft: "#B0EEEE",
			primary_tint: "#95D1D2",
			canvas: "#F3FBFC",
			surface: "#F3FBFC",
			ink: "#151D1E",
			muted: "#3B494B",
			line: "#BAC9CB",
			danger: "#BA1A1A",
			danger_soft: "#FFDAD5",
			warning: "#755B00",
			warning_soft: "#FFDF91",
			accent: "#386664",
		});
	});

	it("generates a valid schema-3 snapshot with 264 passing contrast pairs and accent = light secondary", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		expect(snapshot.schemaVersion).toBe(3);
		expect(snapshot.validation.valid).toBe(true);
		expect(snapshot.validation.errors).toEqual([]);
		expect(snapshot.validation.contrast).toHaveLength(264);
		expect(snapshot.validation.contrast.filter((check) => !check.valid)).toEqual([]);
		expect(snapshot.schemes.standard.light.secondary).toBe("#386664");
		expect(legacyProjection(snapshot).accent).toBe(LEGACY_DEFAULT_THEME.accent);
	});

	it("moves the generated hash off the B0 schema-2 hash, which the frozen fixture keeps", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		expect(snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
		expect(snapshot.contentHash.startsWith(B0_HASH_PREFIX)).toBe(false);
		expect(v2.snapshot.schemaVersion).toBe(2);
		expect(v2.snapshot.contentHash.startsWith(B0_HASH_PREFIX)).toBe(true);
	});
});
