import { describe, expect, it } from "vitest";
import {
	DEFAULT_DESIGN_SYSTEM_SOURCE,
	LEGACY_DEFAULT_THEME,
	generateDesignSystem,
	legacyProjection,
} from "../src/domains/design/design-system";
import { DEFAULT_THEME } from "../src/domains/design/theme";

// Plan item B0 / owner decision D-11: the Dark Teal palette's secondary,
// tertiary and commerce seeds, and the legacy accent derived from them.
describe("Dark Teal palette defaults (B0 / D-11)", () => {
	it("uses the approved seeds and leaves every other source field unchanged", () => {
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
	});

	it("sets the legacy accent to #386664 in both projections, leaving the other legacy tokens alone", () => {
		expect(LEGACY_DEFAULT_THEME.accent).toBe("#386664");
		expect(DEFAULT_THEME.accent).toBe("#386664");
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

	it("generates the expected snapshot: hash prefix, 264 passing contrast pairs, accent = light secondary", async () => {
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		expect(snapshot.contentHash.startsWith("6b95438c3fa8a37a")).toBe(true);
		expect(snapshot.validation.valid).toBe(true);
		expect(snapshot.validation.errors).toEqual([]);
		expect(snapshot.validation.contrast).toHaveLength(264);
		expect(snapshot.validation.contrast.filter((check) => !check.valid)).toEqual([]);
		expect(snapshot.schemes.standard.light.secondary).toBe("#386664");
		expect(legacyProjection(snapshot).accent).toBe(LEGACY_DEFAULT_THEME.accent);
	});
});
