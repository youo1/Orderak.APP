import { describe, expect, it } from "vitest";
import {
	DEFAULT_DESIGN_SYSTEM_SOURCE,
	DESIGN_SYSTEM_GENERATOR_VERSION,
	contrastRatio,
	generateDesignSystem,
} from "../src/domains/design/design-system";

describe("generated design system", () => {
	it("is deterministic, complete, and accessible for every mode and contrast", async () => {
		const first = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const second = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);

		expect(first.contentHash).toBe(second.contentHash);
		expect(first.generatorVersion).toBe(DESIGN_SYSTEM_GENERATOR_VERSION);
		expect(first.validation.valid).toBe(true);
		expect(Object.keys(first.typography.roles)).toHaveLength(15);
		expect(first.spacing.values).toEqual([0, 4, 8, 12, 16, 24, 32, 40, 48, 64]);
		expect(first.components.minimumTouchTargetDp).toBe(48);
		for (const contrast of ["standard", "medium", "high"] as const) {
			for (const mode of ["light", "dark"] as const) {
				expect(Object.keys(first.schemes[contrast][mode]).length).toBeGreaterThanOrEqual(49);
			}
		}
		expect(first.validation.contrast.every((check) => check.valid)).toBe(true);
	});

	it("uses one typography multiplier and does not compound presets", async () => {
		const large = await generateDesignSystem({
			...DEFAULT_DESIGN_SYSTEM_SOURCE,
			typography: { family: "cairo", multiplier: 1.08 },
		});
		expect(large.typography.roles.bodyLarge.sizeRem).toBe(1.08);
	});

	it("harmonizes semantic colors and exposes web color representations", async () => {
		const result = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const warning = result.web.colors.standard.light.warning;
		expect(warning.hex).toMatch(/^#[0-9A-F]{6}$/);
		expect(warning.rgb).toMatch(/^\d+ \d+ \d+$/);
		expect(warning.oklch).toMatch(/^oklch\(/);
		expect(contrastRatio(result.semantic.standard.light.onWarning, result.semantic.standard.light.warning)).toBeGreaterThanOrEqual(4.5);
		expect(result.semantic.medium.light.warning).not.toBe(result.semantic.standard.light.warning);
		expect(result.semantic.high.dark.warningContainer).not.toBe(result.semantic.standard.dark.warningContainer);
		expect(result.validation.contrast.filter((check) => check.path.includes("Warning")).every((check) => check.valid)).toBe(true);
	});

	it("warns about similar brand seeds without blocking publication", async () => {
		const result = await generateDesignSystem({
			...DEFAULT_DESIGN_SYSTEM_SOURCE,
			colors: {
				...DEFAULT_DESIGN_SYSTEM_SOURCE.colors,
				// Near-neighbour of the teal primary in CAM16-UCS. The literal value
				// matters only in that it must be *similar* to the brand primary; when
				// the brand was navy this was #1E3A8A for the same reason.
				secondary: "#0F766E",
			},
		});
		expect(result.validation.warnings.some((warning) => warning.code === "seed_similarity")).toBe(true);
		expect(result.validation.valid).toBe(true);
	});

	it("validates every generated contrast pair against its required ratio", async () => {
		// Per-role overrides were removed, so a failing pair can no longer be
		// injected by an operator. What this gate now protects against is a
		// regression in the generator itself: if MCU tone mapping or the seeds
		// ever stopped producing accessible pairs, the build must fail rather
		// than ship an unreadable theme.
		const result = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		expect(result.validation.valid).toBe(true);
		expect(result.validation.errors).toEqual([]);

		const checks = result.validation.contrast;
		expect(checks.length).toBeGreaterThan(0);
		expect(checks.every((check) => check.valid)).toBe(true);
		expect(checks.every((check) => check.ratio >= check.required)).toBe(true);

		for (const contrast of ["standard", "medium", "high"]) {
			for (const mode of ["light", "dark"]) {
				expect(checks.some((check) => check.path.startsWith(`${contrast}.${mode}.`))).toBe(true);
			}
		}
	});

});
