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
				secondary: "#1E3A8A",
			},
		});
		expect(result.validation.warnings.some((warning) => warning.code === "seed_similarity")).toBe(true);
		expect(result.validation.valid).toBe(true);
	});

	it("requires justified overrides and blocks failed contrast pairs", async () => {
		const result = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE, {
			"standard.light.primary": { value: "#FFFFFF", reason: "Approved temporary campaign exception" },
		});
		expect(result.validation.valid).toBe(false);
		expect(result.validation.errors.some((error) => error.code === "contrast_failed")).toBe(true);

		const missingReason = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE, {
			"standard.light.primary": { value: "#005A30", reason: "short" },
		});
		expect(missingReason.validation.errors.some((error) => error.code === "invalid_override_reason")).toBe(true);

		const fixedPairBase = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		const fixedPair = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE, {
			"standard.light.primaryFixed": {
				value: fixedPairBase.schemes.standard.light.onPrimaryFixed,
				reason: "Approved fixed role verification",
			},
		});
		expect(fixedPair.validation.errors.some((error) => error.path?.includes("onPrimaryFixed/primaryFixed"))).toBe(true);
	});

});
