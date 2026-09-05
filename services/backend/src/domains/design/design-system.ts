import {
	Blend,
	Cam16,
	DynamicScheme,
	Hct,
	SchemeContent,
	SchemeExpressive,
	SchemeFidelity,
	SchemeMonochrome,
	SchemeNeutral,
	SchemeTonalSpot,
	SchemeVibrant,
	TonalPalette,
	argbFromHex,
	hexFromArgb,
} from "@material/material-color-utilities";
import { logError } from "../../platform/http/shared";

export const DESIGN_SYSTEM_SCHEMA_VERSION = 2;
export const DESIGN_SYSTEM_GENERATOR_VERSION = "orderak-mcu-0.3.0+3";
export const MAX_PUBLIC_PAYLOAD_BYTES = 128 * 1024;
export const MAX_REQUEST_BYTES = 64 * 1024;
export const FIRST_SCHEMA_V2_ANDROID_VERSION_CODE = 2;

export type SchemeVariant =
	| "tonal-spot" | "vibrant" | "expressive" | "fidelity"
	| "content" | "neutral" | "monochrome";
export type ContrastName = "standard" | "medium" | "high";
export type ThemeMode = "light" | "dark";
export type SurfaceTemperature = "cool" | "neutral" | "warm";
export type FontFamilyId = "cairo" | "tajawal" | "noto-arabic";
export type DensityName = "compact" | "comfortable" | "spacious";
export type ShapePreset = "sharp" | "balanced" | "rounded" | "custom";

export interface DesignSystemSource {
	colors: {
		primary: string;
		secondary: string;
		tertiary: string;
		error: string;
		warning: string;
		success: string;
		information: string;
		/** Monetisation. Its own role so that "locked by plan" can never share a
		    colour with a status. See docs/ux/feature-surface-map.md. */
		commerce: string;
		/**
		 * Chroma floor for the primary palette. The generator otherwise raises a
		 * muted seed to 36, which changes the published brand colour. Set this to
		 * the seed's own chroma to keep the brand exactly as approved.
		 */
		primaryChromaFloor?: number;
		/**
		 * Light-mode tones for `primary`, as [standard, medium, high]. M3 puts the
		 * role at T40; a dark brand seed lives lower than that, and the published
		 * brand colour and the primary action colour must be the same colour.
		 * The ladder must descend so contrast still rises with the contrast level.
		 */
		primaryLightTones?: [number, number, number];
		surfaceTemperature: SurfaceTemperature;
		variant: SchemeVariant;
		defaultContrast: ContrastName;
	};
	typography: {
		family: FontFamilyId;
		multiplier: number;
	};
	spacing: {
		baseUnit: number;
		density: DensityName;
	};
	shapes: {
		preset: ShapePreset;
		baseRadius?: number;
	};
}

export interface ValidationMessage {
	code: string;
	message: string;
	path?: string;
	severity: "error" | "warning";
}

export interface ValidationSummary {
	valid: boolean;
	errors: ValidationMessage[];
	warnings: ValidationMessage[];
	contrast: Array<{ path: string; ratio: number; required: number; valid: boolean }>;
}

export interface GeneratedDesignSystem {
	schemaVersion: 2;
	generatorVersion: string;
	source: DesignSystemSource;
	schemes: Record<ContrastName, Record<ThemeMode, Record<string, string>>>;
	semantic: Record<ContrastName, Record<ThemeMode, Record<string, string>>>;
	typography: {
		family: FontFamilyId;
		multiplier: number;
		roles: Record<string, { sizeRem: number; sizeSp: number; lineHeight: number; weight: number; letterSpacingEm: number }>;
	};
	spacing: { values: number[]; tokens: Record<string, number> };
	shapes: Record<"extraSmall" | "small" | "medium" | "large" | "extraLarge", number>;
	components: { minimumTouchTargetDp: 48 };
	web: {
		colors: Record<ContrastName, Record<ThemeMode, Record<string, { hex: string; rgb: string; oklch: string }>>>;
	};
	validation: ValidationSummary;
	contentHash: string;
}

export interface LegacyTheme {
	primary: string;
	primary_strong: string;
	primary_soft: string;
	primary_tint: string;
	canvas: string;
	surface: string;
	ink: string;
	muted: string;
	line: string;
	danger: string;
	danger_soft: string;
	warning: string;
	warning_soft: string;
	accent: string;
}

export const LEGACY_DEFAULT_THEME: LegacyTheme = {
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
	accent: "#9B4500",
};

export const DEFAULT_DESIGN_SYSTEM_SOURCE: DesignSystemSource = {
	colors: {
		primary: "#014D4E",
		secondary: "#F2751A",
		tertiary: "#3B82F6",
		error: "#BA1A1A",
		warning: "#9A6700",
		success: "#2E7D32",
		information: "#0061A4",
		commerce: "#6D509A",
		primaryChromaFloor: 28.7,
		primaryLightTones: [29.1, 22, 14],
		surfaceTemperature: "cool",
		variant: "tonal-spot",
		defaultContrast: "standard",
	},
	typography: { family: "cairo", multiplier: 1 },
	spacing: { baseUnit: 4, density: "comfortable" },
	shapes: { preset: "balanced" },
};

const HEX = /^#[0-9A-F]{6}$/;
const CONTRAST_LEVEL: Record<ContrastName, number> = { standard: 0, medium: 0.5, high: 1 };
const DENSITY: Record<DensityName, number> = { compact: 0.875, comfortable: 1, spacious: 1.125 };
const SPACING_STEPS = [0, 1, 2, 3, 4, 6, 8, 10, 12, 16] as const;
const COLOR_ROLES = [
	"primary", "onPrimary", "primaryContainer", "onPrimaryContainer", "inversePrimary",
	"secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
	"tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
	"error", "onError", "errorContainer", "onErrorContainer",
	"background", "onBackground", "surface", "surfaceDim", "surfaceBright",
	"surfaceContainerLowest", "surfaceContainerLow", "surfaceContainer",
	"surfaceContainerHigh", "surfaceContainerHighest", "onSurface",
	"surfaceVariant", "onSurfaceVariant", "inverseSurface", "inverseOnSurface",
	"outline", "outlineVariant", "shadow", "scrim", "surfaceTint",
	"primaryFixed", "primaryFixedDim", "onPrimaryFixed", "onPrimaryFixedVariant",
	"secondaryFixed", "secondaryFixedDim", "onSecondaryFixed", "onSecondaryFixedVariant",
	"tertiaryFixed", "tertiaryFixedDim", "onTertiaryFixed", "onTertiaryFixedVariant",
] as const;

const REQUIRED_PAIRS: Array<[string, string, number]> = [
	["onPrimary", "primary", 4.5],
	["onPrimaryContainer", "primaryContainer", 4.5],
	["onSecondary", "secondary", 4.5],
	["onSecondaryContainer", "secondaryContainer", 4.5],
	["onTertiary", "tertiary", 4.5],
	["onTertiaryContainer", "tertiaryContainer", 4.5],
	["onError", "error", 4.5],
	["onErrorContainer", "errorContainer", 4.5],
	["onBackground", "background", 4.5],
	["onSurface", "surface", 4.5],
	["onSurfaceVariant", "surfaceVariant", 4.5],
	["inverseOnSurface", "inverseSurface", 4.5],
	["inversePrimary", "inverseSurface", 4.5],
	["onSurface", "surfaceDim", 4.5],
	["onSurface", "surfaceBright", 4.5],
	["onSurface", "surfaceContainerLowest", 4.5],
	["onSurface", "surfaceContainerLow", 4.5],
	["onSurface", "surfaceContainer", 4.5],
	["onSurface", "surfaceContainerHigh", 4.5],
	["onSurface", "surfaceContainerHighest", 4.5],
	["onPrimaryFixed", "primaryFixed", 4.5],
	["onPrimaryFixed", "primaryFixedDim", 4.5],
	["onPrimaryFixedVariant", "primaryFixed", 4.5],
	["onPrimaryFixedVariant", "primaryFixedDim", 4.5],
	["onSecondaryFixed", "secondaryFixed", 4.5],
	["onSecondaryFixed", "secondaryFixedDim", 4.5],
	["onSecondaryFixedVariant", "secondaryFixed", 4.5],
	["onSecondaryFixedVariant", "secondaryFixedDim", 4.5],
	["onTertiaryFixed", "tertiaryFixed", 4.5],
	["onTertiaryFixed", "tertiaryFixedDim", 4.5],
	["onTertiaryFixedVariant", "tertiaryFixed", 4.5],
	["onTertiaryFixedVariant", "tertiaryFixedDim", 4.5],
];

const SEMANTIC_REQUIRED_PAIRS: Array<[string, string, number]> = [
	["onWarning", "warning", 4.5],
	["onWarningContainer", "warningContainer", 4.5],
	["onSuccess", "success", 4.5],
	["onSuccessContainer", "successContainer", 4.5],
	["onInformation", "information", 4.5],
	["onInformationContainer", "informationContainer", 4.5],
	["onCommerce", "commerce", 4.5],
	["onCommerceContainer", "commerceContainer", 4.5],
	// The outline must be visible over its own container, or it is decoration.
	["warningContainerOutline", "warningContainer", 1.3],
	["successContainerOutline", "successContainer", 1.3],
	["informationContainerOutline", "informationContainer", 1.3],
	["commerceContainerOutline", "commerceContainer", 1.3],
];

function validateAllContrast(
	schemes: GeneratedDesignSystem["schemes"],
	semantic: GeneratedDesignSystem["semantic"],
): ValidationSummary["contrast"] {
	const checks: ValidationSummary["contrast"] = [];
	for (const contrast of ["standard", "medium", "high"] as ContrastName[]) {
		for (const mode of ["light", "dark"] as ThemeMode[]) {
			const roles = schemes[contrast][mode];
			for (const [foreground, background, required] of REQUIRED_PAIRS) {
				const ratio = contrastRatio(roles[foreground], roles[background]);
				checks.push({
					path: `${contrast}.${mode}.${foreground}/${background}`,
					ratio,
					required,
					valid: ratio >= required,
				});
			}
			const semanticRoles = semantic[contrast][mode];
			for (const [foreground, background, required] of SEMANTIC_REQUIRED_PAIRS) {
				const ratio = contrastRatio(semanticRoles[foreground], semanticRoles[background]);
				checks.push({
					path: `${contrast}.${mode}.${foreground}/${background}`,
					ratio,
					required,
					valid: ratio >= required,
				});
			}
		}
	}
	return checks;
}

const TYPE_BASE: Record<string, [number, number, number, number]> = {
	displayLarge: [3.5625, 4, 400, -0.0044],
	displayMedium: [2.8125, 3.25, 400, 0],
	displaySmall: [2.25, 2.75, 400, 0],
	headlineLarge: [2, 2.5, 400, 0],
	headlineMedium: [1.75, 2.25, 400, 0],
	headlineSmall: [1.5, 2, 400, 0],
	titleLarge: [1.375, 1.75, 400, 0],
	titleMedium: [1, 1.5, 500, 0.0094],
	titleSmall: [0.875, 1.25, 500, 0.0071],
	bodyLarge: [1, 1.5, 400, 0.0313],
	bodyMedium: [0.875, 1.25, 400, 0.0179],
	bodySmall: [0.75, 1, 400, 0.0333],
	labelLarge: [0.875, 1.25, 500, 0.0071],
	labelMedium: [0.75, 1, 500, 0.0417],
	labelSmall: [0.6875, 1, 500, 0.0455],
};

function normalizeHex(value: unknown): string {
	const upper = String(value ?? "").trim().toUpperCase();
	return HEX.test(upper) ? upper : "";
}

function rounded(value: number, precision = 4): number {
	const factor = 10 ** precision;
	return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function variantScheme(source: Hct, variant: SchemeVariant, dark: boolean, contrast: number): DynamicScheme {
	switch (variant) {
		case "vibrant": return new SchemeVibrant(source, dark, contrast);
		case "expressive": return new SchemeExpressive(source, dark, contrast);
		case "fidelity": return new SchemeFidelity(source, dark, contrast);
		case "content": return new SchemeContent(source, dark, contrast);
		case "neutral": return new SchemeNeutral(source, dark, contrast);
		case "monochrome": return new SchemeMonochrome(source, dark, contrast);
		default: return new SchemeTonalSpot(source, dark, contrast);
	}
}

function customizedScheme(source: DesignSystemSource, dark: boolean, contrast: number): DynamicScheme {
	const primaryHct = Hct.fromInt(argbFromHex(source.colors.primary));
	const base = variantScheme(primaryHct, source.colors.variant, dark, contrast);
	const secondary = Hct.fromInt(argbFromHex(source.colors.secondary));
	const tertiary = Hct.fromInt(argbFromHex(source.colors.tertiary));
	const temperatureHue = source.colors.surfaceTemperature === "cool" ? primaryHct.hue + 8
		: source.colors.surfaceTemperature === "warm" ? primaryHct.hue - 12 : primaryHct.hue;
	const neutralChroma = source.colors.surfaceTemperature === "neutral" ? 4 : 7;
	const result = new DynamicScheme({
		sourceColorArgb: argbFromHex(source.colors.primary),
		variant: base.variant,
		contrastLevel: contrast,
		isDark: dark,
		primaryPalette: TonalPalette.fromHueAndChroma(primaryHct.hue, Math.max(primaryHct.chroma, source.colors.primaryChromaFloor ?? 36)),
		secondaryPalette: TonalPalette.fromHueAndChroma(secondary.hue, Math.max(secondary.chroma, 24)),
		tertiaryPalette: TonalPalette.fromHueAndChroma(tertiary.hue, Math.max(tertiary.chroma, 28)),
		neutralPalette: TonalPalette.fromHueAndChroma((temperatureHue + 360) % 360, neutralChroma),
		neutralVariantPalette: TonalPalette.fromHueAndChroma((temperatureHue + 360) % 360, neutralChroma + 4),
	});
	const error = Hct.fromInt(argbFromHex(source.colors.error));
	result.errorPalette = TonalPalette.fromHueAndChroma(error.hue, Math.max(error.chroma, 48));
	return result;
}

/**
 * Pins light-mode `primary` to the tone the brand seed actually occupies.
 *
 * M3 places the role at T40. A dark brand seed sits lower, so without this the
 * published brand colour and the primary action colour are two different
 * colours. The ladder descends with the contrast level, so contrast still rises.
 * Every pair this touches is re-checked by validateAllContrast afterwards.
 */
function anchorBrandTone(
	roles: Record<string, string>,
	source: DesignSystemSource,
	dark: boolean,
	contrast: ContrastName,
): Record<string, string> {
	if (dark || !source.colors.primaryLightTones) return roles;
	const seed = Hct.fromInt(argbFromHex(source.colors.primary));
	const palette = TonalPalette.fromHueAndChroma(seed.hue, Math.max(seed.chroma, source.colors.primaryChromaFloor ?? 36));
	const index = contrast === "high" ? 2 : contrast === "medium" ? 1 : 0;
	return { ...roles, primary: hex(palette.tone(source.colors.primaryLightTones[index])) };
}

function schemeRoles(scheme: DynamicScheme): Record<string, string> {
	const result: Record<string, string> = {};
	for (const role of COLOR_ROLES) {
		const value = (scheme as unknown as Record<string, number>)[role];
		result[role] = hexFromArgb(value).toUpperCase();
	}
	return result;
}

function semanticRoles(source: DesignSystemSource, dark: boolean, contrast: ContrastName): Record<string, string> {
	const primary = argbFromHex(source.colors.primary);
	const create = (seed: string, harmonize: boolean) => {
		const argb = harmonize ? Blend.harmonize(argbFromHex(seed), primary) : argbFromHex(seed);
		const hct = Hct.fromInt(argb);
		const palette = TonalPalette.fromHueAndChroma(hct.hue, Math.max(hct.chroma, 36));
		const tones = dark
			? contrast === "high" ? [95, 0, 20, 100, 60]
				: contrast === "medium" ? [90, 10, 25, 95, 65]
					: [80, 20, 30, 90, 70]
			: contrast === "high" ? [20, 100, 70, 0, 35]
				: contrast === "medium" ? [30, 100, 80, 10, 45]
					: [40, 100, 90, 10, 50];
		return {
			color: hex(palette.tone(tones[0])),
			onColor: hex(palette.tone(tones[1])),
			container: hex(palette.tone(tones[2])),
			onContainer: hex(palette.tone(tones[3])),
			// A container at T90 on a T98 surface separates by hue alone, which fails
			// a colour-blind reader. The outline gives it an edge that survives
			// greyscale, and is contrast-checked against the surface like any other pair.
			containerOutline: hex(palette.tone(tones[4])),
		};
	};
	// Harmonisation rotates a hue toward the brand, which reads as one family but
	// costs separation. With the brand at 198.1 degrees only the warm role can
	// afford it: harmonising success collapses brand<->success to 27 degrees, and
	// harmonising information and commerce pulls them onto each other and onto the
	// brand. Measured, not assumed - see docs/ux/feature-surface-map.md.
	const warning = create(source.colors.warning, true);
	const success = create(source.colors.success, false);
	const information = create(source.colors.information, false);
	const commerce = create(source.colors.commerce, false);
	return {
		warning: warning.color, onWarning: warning.onColor, warningContainer: warning.container, onWarningContainer: warning.onContainer, warningContainerOutline: warning.containerOutline,
		success: success.color, onSuccess: success.onColor, successContainer: success.container, onSuccessContainer: success.onContainer, successContainerOutline: success.containerOutline,
		information: information.color, onInformation: information.onColor, informationContainer: information.container, onInformationContainer: information.onContainer, informationContainerOutline: information.containerOutline,
		commerce: commerce.color, onCommerce: commerce.onColor, commerceContainer: commerce.container, onCommerceContainer: commerce.onContainer, commerceContainerOutline: commerce.containerOutline,
	};
}

function hex(argb: number): string {
	return hexFromArgb(argb).toUpperCase();
}

function relativeLuminance(value: string): number {
	const channels = [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16) / 255)
		.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
	const values = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return rounded((values[0] + 0.05) / (values[1] + 0.05), 2);
}

function webColor(value: string): { hex: string; rgb: string; oklch: string } {
	const r8 = parseInt(value.slice(1, 3), 16);
	const g8 = parseInt(value.slice(3, 5), 16);
	const b8 = parseInt(value.slice(5, 7), 16);
	const linear = [r8, g8, b8].map((v) => {
		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	const l = 0.4122214708 * linear[0] + 0.5363325363 * linear[1] + 0.0514459929 * linear[2];
	const m = 0.2119034982 * linear[0] + 0.6806995451 * linear[1] + 0.1073969566 * linear[2];
	const s = 0.0883024619 * linear[0] + 0.2817188376 * linear[1] + 0.6299787005 * linear[2];
	const l3 = Math.cbrt(l);
	const m3 = Math.cbrt(m);
	const s3 = Math.cbrt(s);
	const L = 0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3;
	const A = 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3;
	const B = 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3;
	const chroma = Math.sqrt(A * A + B * B);
	const hue = (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
	return {
		hex: value,
		rgb: `${r8} ${g8} ${b8}`,
		oklch: `oklch(${rounded(L * 100, 3)}% ${rounded(chroma, 4)} ${rounded(hue, 2)})`,
	};
}

function validateSource(raw: unknown): { source: DesignSystemSource; errors: ValidationMessage[] } {
	const input = (raw && typeof raw === "object" ? raw : {}) as Partial<DesignSystemSource>;
	const colors = (input.colors ?? {}) as Partial<DesignSystemSource["colors"]>;
	const typography = (input.typography ?? {}) as Partial<DesignSystemSource["typography"]>;
	const spacing = (input.spacing ?? {}) as Partial<DesignSystemSource["spacing"]>;
	const shapes = (input.shapes ?? {}) as Partial<DesignSystemSource["shapes"]>;
	const errors: ValidationMessage[] = [];
	const color = (key: keyof Omit<DesignSystemSource["colors"], "surfaceTemperature" | "variant" | "defaultContrast" | "primaryChromaFloor" | "primaryLightTones">) => {
		const normalized = normalizeHex(colors[key] ?? DEFAULT_DESIGN_SYSTEM_SOURCE.colors[key]);
		if (!normalized) errors.push({ code: "invalid_hex", path: `colors.${key}`, message: "Use a six-digit hex color.", severity: "error" });
		return normalized || DEFAULT_DESIGN_SYSTEM_SOURCE.colors[key];
	};
	const variant = String(colors.variant ?? DEFAULT_DESIGN_SYSTEM_SOURCE.colors.variant) as SchemeVariant;
	const surfaceTemperature = String(colors.surfaceTemperature ?? DEFAULT_DESIGN_SYSTEM_SOURCE.colors.surfaceTemperature) as SurfaceTemperature;
	const defaultContrast = String(colors.defaultContrast ?? DEFAULT_DESIGN_SYSTEM_SOURCE.colors.defaultContrast) as ContrastName;
	const family = String(typography.family ?? DEFAULT_DESIGN_SYSTEM_SOURCE.typography.family) as FontFamilyId;
	const density = String(spacing.density ?? DEFAULT_DESIGN_SYSTEM_SOURCE.spacing.density) as DensityName;
	const shapePreset = String(shapes.preset ?? DEFAULT_DESIGN_SYSTEM_SOURCE.shapes.preset) as ShapePreset;
	if (!["tonal-spot", "vibrant", "expressive", "fidelity", "content", "neutral", "monochrome"].includes(variant)) errors.push({ code: "invalid_variant", path: "colors.variant", message: "Unsupported scheme variant.", severity: "error" });
	if (!["cool", "neutral", "warm"].includes(surfaceTemperature)) errors.push({ code: "invalid_surface_temperature", path: "colors.surfaceTemperature", message: "Unsupported surface temperature.", severity: "error" });
	if (!["standard", "medium", "high"].includes(defaultContrast)) errors.push({ code: "invalid_contrast", path: "colors.defaultContrast", message: "Unsupported default contrast.", severity: "error" });
	if (!["cairo", "tajawal", "noto-arabic"].includes(family)) errors.push({ code: "font_not_approved", path: "typography.family", message: "Select an approved font family.", severity: "error" });
	if (!["compact", "comfortable", "spacious"].includes(density)) errors.push({ code: "invalid_density", path: "spacing.density", message: "Unsupported density.", severity: "error" });
	if (!["sharp", "balanced", "rounded", "custom"].includes(shapePreset)) errors.push({ code: "invalid_shape_preset", path: "shapes.preset", message: "Unsupported shape preset.", severity: "error" });
	const multiplier = Number(typography.multiplier ?? 1);
	const baseUnit = Number(spacing.baseUnit ?? 4);
	const baseRadius = Number(shapes.baseRadius ?? 12);
	if (!Number.isFinite(multiplier) || multiplier < 0.9 || multiplier > 1.15) errors.push({ code: "invalid_type_multiplier", path: "typography.multiplier", message: "Typography multiplier must be 0.90–1.15.", severity: "error" });
	if (!Number.isFinite(baseUnit) || baseUnit < 2 || baseUnit > 8) errors.push({ code: "invalid_spacing_base", path: "spacing.baseUnit", message: "Spacing base must be 2–8.", severity: "error" });
	if (!Number.isFinite(baseRadius) || baseRadius < 0 || baseRadius > 24) errors.push({ code: "invalid_radius", path: "shapes.baseRadius", message: "Custom radius must be 0–24.", severity: "error" });
	return {
		source: {
			colors: {
				primary: color("primary"), secondary: color("secondary"), tertiary: color("tertiary"),
				error: color("error"), warning: color("warning"), success: color("success"), information: color("information"),
				commerce: color("commerce"),
				// Structural, not seller-editable: these fall back to the defaults so a
				// published revision that predates them cannot silently unpin the brand.
				primaryChromaFloor: Number(colors.primaryChromaFloor ?? DEFAULT_DESIGN_SYSTEM_SOURCE.colors.primaryChromaFloor),
				primaryLightTones: (colors.primaryLightTones ?? DEFAULT_DESIGN_SYSTEM_SOURCE.colors.primaryLightTones) as [number, number, number],
				surfaceTemperature, variant, defaultContrast,
			},
			typography: { family, multiplier: clamp(multiplier || 1, 0.9, 1.15) },
			spacing: { baseUnit: clamp(baseUnit || 4, 2, 8), density },
			shapes: { preset: shapePreset, ...(shapePreset === "custom" ? { baseRadius: clamp(baseRadius || 0, 0, 24) } : {}) },
		},
		errors,
	};
}

async function contentHash(value: unknown): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function generateDesignSystem(rawSource: unknown): Promise<GeneratedDesignSystem> {
	const normalized = validateSource(rawSource);
	const source = normalized.source;
	const warnings: ValidationMessage[] = [];
	const schemes = {} as GeneratedDesignSystem["schemes"];
	const semantic = {} as GeneratedDesignSystem["semantic"];
	for (const contrast of ["standard", "medium", "high"] as ContrastName[]) {
		schemes[contrast] = {} as Record<ThemeMode, Record<string, string>>;
		semantic[contrast] = {} as Record<ThemeMode, Record<string, string>>;
		for (const mode of ["light", "dark"] as ThemeMode[]) {
			schemes[contrast][mode] = anchorBrandTone(
				schemeRoles(customizedScheme(source, mode === "dark", CONTRAST_LEVEL[contrast])),
				source, mode === "dark", contrast,
			);
			semantic[contrast][mode] = semanticRoles(source, mode === "dark", contrast);
		}
	}
	if (!["neutral", "monochrome"].includes(source.colors.variant)) {
		const seeds = [
			["primary", source.colors.primary],
			["secondary", source.colors.secondary],
			["tertiary", source.colors.tertiary],
		] as const;
		for (let i = 0; i < seeds.length; i++) {
			for (let j = i + 1; j < seeds.length; j++) {
				const distance = Cam16.fromInt(argbFromHex(seeds[i][1])).distance(Cam16.fromInt(argbFromHex(seeds[j][1])));
				if (distance < 10) warnings.push({
					code: "seed_similarity",
					path: `colors.${seeds[j][0]}`,
					message: `${seeds[i][0]} and ${seeds[j][0]} are visually similar (CAM16-UCS ${rounded(distance, 1)}).`,
					severity: "warning",
				});
			}
		}
	}
	const contrastChecks = validateAllContrast(schemes, semantic);
	const contrastErrors = contrastChecks.filter((item) => !item.valid).map<ValidationMessage>((item) => ({
		code: "contrast_failed", path: item.path, message: `Contrast ${item.ratio}:1 is below ${item.required}:1.`, severity: "error",
	}));
	const spacingValues = SPACING_STEPS.map((step) => Math.round(step * source.spacing.baseUnit * DENSITY[source.spacing.density] * 2) / 2);
	for (let i = 2; i < spacingValues.length; i++) {
		if (spacingValues[i] <= spacingValues[i - 1]) normalized.errors.push({ code: "spacing_not_increasing", path: "spacing", message: "Positive spacing values must be strictly increasing.", severity: "error" });
	}
	if (spacingValues.at(-1)! > 144) normalized.errors.push({ code: "spacing_too_large", path: "spacing", message: "Generated spacing cannot exceed 144dp/px.", severity: "error" });
	const shapePresets: Record<Exclude<ShapePreset, "custom">, number[]> = {
		sharp: [0, 4, 8, 12, 16],
		balanced: [4, 8, 12, 16, 24],
		rounded: [8, 12, 16, 24, 32],
	};
	const baseRadius = source.shapes.baseRadius ?? 12;
	const shapeValues = source.shapes.preset === "custom"
		? [baseRadius * 0.333, baseRadius * 0.667, baseRadius, Math.min(32, baseRadius * 1.333), Math.min(40, baseRadius * 2)].map((v) => Math.round(v * 2) / 2)
		: shapePresets[source.shapes.preset];
	const typographyRoles: GeneratedDesignSystem["typography"]["roles"] = {};
	for (const [role, [sizeRem, lineHeight, weight, letterSpacingEm]] of Object.entries(TYPE_BASE)) {
		typographyRoles[role] = {
			sizeRem: rounded(sizeRem * source.typography.multiplier),
			sizeSp: rounded(sizeRem * 16 * source.typography.multiplier, 2),
			lineHeight: rounded(lineHeight * source.typography.multiplier),
			weight,
			letterSpacingEm,
		};
	}
	const web = {} as GeneratedDesignSystem["web"]["colors"];
	for (const contrast of ["standard", "medium", "high"] as ContrastName[]) {
		web[contrast] = {} as Record<ThemeMode, Record<string, ReturnType<typeof webColor>>>;
		for (const mode of ["light", "dark"] as ThemeMode[]) {
			web[contrast][mode] = Object.fromEntries(Object.entries({ ...schemes[contrast][mode], ...semantic[contrast][mode] }).map(([key, value]) => [key, webColor(value)]));
		}
	}
	const errors = [...normalized.errors, ...contrastErrors];
	const base = {
		schemaVersion: DESIGN_SYSTEM_SCHEMA_VERSION as 2,
		generatorVersion: DESIGN_SYSTEM_GENERATOR_VERSION,
		source,
		schemes,
		semantic,
		typography: { family: source.typography.family, multiplier: source.typography.multiplier, roles: typographyRoles },
		spacing: { values: spacingValues, tokens: Object.fromEntries(SPACING_STEPS.map((step, index) => [`space${step}`, spacingValues[index]])) },
		shapes: { extraSmall: shapeValues[0], small: shapeValues[1], medium: shapeValues[2], large: shapeValues[3], extraLarge: shapeValues[4] },
		components: { minimumTouchTargetDp: 48 as const },
		web: { colors: web },
		validation: { valid: errors.length === 0, errors, warnings, contrast: contrastChecks },
	};
	return { ...base, contentHash: await contentHash(base) };
}

export function legacyProjection(snapshot: GeneratedDesignSystem): LegacyTheme {
	const light = snapshot.schemes.standard.light;
	const semantic = snapshot.semantic.standard.light;
	return {
		primary: light.primary,
		primary_strong: light.primaryContainer,
		primary_soft: light.surfaceContainer,
		primary_tint: light.inversePrimary,
		canvas: light.background,
		surface: light.surface,
		ink: light.onSurface,
		muted: light.onSurfaceVariant,
		line: light.outlineVariant,
		danger: light.error,
		danger_soft: light.errorContainer,
		warning: semantic.warning,
		warning_soft: semantic.warningContainer,
		accent: light.secondary,
	};
}

export interface DesignSystemRevision {
	id: number;
	name: string | null;
	source: DesignSystemSource;
	/**
	 * Retained for the design_system_revisions.overrides_json column, which is
	 * kept rather than dropped (a destructive migration with no upside). Per-role
	 * overrides were removed: colour now comes only from the seeds, so that every
	 * emitted value has passed contrast validation.
	 */
	overrides: Record<string, never>;
	snapshot: GeneratedDesignSystem;
	validation: ValidationSummary;
	legacyTheme: LegacyTheme;
	contentHash: string;
	generatorVersion: string;
	schemaVersion: number;
	publishedAt: string | null;
	createdBy: number | null;
	rollbackOfRevisionId: number | null;
}

interface RevisionRow {
	id: number;
	name: string | null;
	schema_version: number;
	generator_version: string;
	source_json: string;
	overrides_json: string;
	snapshot_json: string;
	validation_json: string;
	legacy_projection_json: string;
	content_hash: string;
	published_at: string | null;
	created_by: number | null;
	rollback_of_revision_id: number | null;
}

function parseRevision(row: RevisionRow): DesignSystemRevision {
	return {
		id: row.id,
		name: row.name ?? null,
		source: JSON.parse(row.source_json),
		overrides: JSON.parse(row.overrides_json),
		snapshot: JSON.parse(row.snapshot_json),
		validation: JSON.parse(row.validation_json),
		legacyTheme: JSON.parse(row.legacy_projection_json),
		contentHash: row.content_hash,
		generatorVersion: row.generator_version,
		schemaVersion: row.schema_version,
		publishedAt: row.published_at,
		createdBy: row.created_by,
		rollbackOfRevisionId: row.rollback_of_revision_id,
	};
}

let activeCache: { revision: DesignSystemRevision; expires: number } | null = null;

export function invalidateDesignSystemCache(): void {
	activeCache = null;
}

async function seedInitialRevision(env: Env): Promise<DesignSystemRevision> {
	const existing = await env.orderak_db.prepare(
		"SELECT r.* FROM design_system_state s JOIN design_system_revisions r ON r.id=s.active_revision_id WHERE s.id=1",
	).first<RevisionRow>();
	if (existing) return parseRevision(existing);
	let legacyTheme = { ...LEGACY_DEFAULT_THEME };
	try {
		const row = await env.orderak_db.prepare(
			"SELECT value_json FROM settings WHERE key='theme_colors'",
		).first<{ value_json: string }>();
		const saved = row?.value_json ? JSON.parse(row.value_json) as Record<string, unknown> : {};
		for (const key of Object.keys(legacyTheme) as Array<keyof LegacyTheme>) {
			const value = normalizeHex(saved[key]);
			if (value) legacyTheme[key] = value;
		}
	} catch {
		// Migration compatibility falls back to the compiled legacy projection.
	}
	if (contrastRatio(legacyTheme.primary, "#FFFFFF") < 4.5) legacyTheme.primary = LEGACY_DEFAULT_THEME.primary;
	if (contrastRatio(legacyTheme.danger, "#FFFFFF") < 4.5) legacyTheme.danger = LEGACY_DEFAULT_THEME.danger;
	if (contrastRatio(legacyTheme.warning, "#FFFFFF") < 4.5) legacyTheme.warning = LEGACY_DEFAULT_THEME.warning;
	if (contrastRatio(legacyTheme.ink, legacyTheme.canvas) < 4.5 || contrastRatio(legacyTheme.ink, legacyTheme.surface) < 4.5) {
		legacyTheme.ink = LEGACY_DEFAULT_THEME.ink;
		legacyTheme.canvas = LEGACY_DEFAULT_THEME.canvas;
		legacyTheme.surface = LEGACY_DEFAULT_THEME.surface;
	}
	if (contrastRatio(legacyTheme.muted, legacyTheme.canvas) < 4.5 || contrastRatio(legacyTheme.muted, legacyTheme.surface) < 4.5) {
		legacyTheme.muted = LEGACY_DEFAULT_THEME.muted;
	}
	const source: DesignSystemSource = {
		...DEFAULT_DESIGN_SYSTEM_SOURCE,
		colors: {
			...DEFAULT_DESIGN_SYSTEM_SOURCE.colors,
			primary: legacyTheme.primary,
			secondary: legacyTheme.accent,
			error: legacyTheme.danger,
			warning: legacyTheme.warning,
		},
	};
	const generatedSnapshot = await generateDesignSystem(source);
	let snapshot = structuredClone(generatedSnapshot);
	// Revision 1 preserves the effective pre-migration Android/light web
	// projection. Future revisions are fully generator-owned.
	Object.assign(snapshot.schemes.standard.light, {
		primary: legacyTheme.primary,
		onPrimary: "#FFFFFF",
		primaryContainer: legacyTheme.primary_soft,
		onPrimaryContainer: legacyTheme.ink,
		secondary: legacyTheme.accent,
		onSecondary: legacyTheme.ink,
		secondaryContainer: legacyTheme.warning_soft,
		onSecondaryContainer: legacyTheme.ink,
		background: legacyTheme.canvas,
		onBackground: legacyTheme.ink,
		surface: legacyTheme.surface,
		onSurface: legacyTheme.ink,
		surfaceVariant: legacyTheme.primary_soft,
		onSurfaceVariant: legacyTheme.muted,
		outline: legacyTheme.line,
		outlineVariant: legacyTheme.line,
		error: legacyTheme.danger,
		onError: "#FFFFFF",
		errorContainer: legacyTheme.danger_soft,
		onErrorContainer: legacyTheme.ink,
	});
	snapshot.web.colors.standard.light = Object.fromEntries(
		Object.entries({
			...snapshot.schemes.standard.light,
			...snapshot.semantic.standard.light,
		}).map(([key, value]) => [key, webColor(value)]),
	);
	const actualContrast = validateAllContrast(snapshot.schemes, snapshot.semantic);
	const nonContrastErrors = snapshot.validation.errors.filter((error) => error.code !== "contrast_failed");
	const actualContrastErrors = actualContrast.filter((item) => !item.valid).map<ValidationMessage>((item) => ({
		code: "contrast_failed",
		path: item.path,
		message: `Contrast ${item.ratio}:1 is below ${item.required}:1.`,
		severity: "error",
	}));
	snapshot.validation = {
		...snapshot.validation,
		contrast: actualContrast,
		errors: [...nonContrastErrors, ...actualContrastErrors],
		valid: nonContrastErrors.length === 0 && actualContrastErrors.length === 0,
	};
	if (!snapshot.validation.valid) {
		// The legacy projection remains exact for schema-v1 clients, but an
		// inaccessible historical palette must never become the schema-v2
		// active snapshot. Keep the generated accessible snapshot instead.
		snapshot = generatedSnapshot;
	} else {
		snapshot.contentHash = await contentHash({ ...snapshot, contentHash: undefined });
	}
	const inserted = await env.orderak_db.prepare(
		`INSERT INTO design_system_revisions
		 (schema_version,generator_version,source_json,overrides_json,snapshot_json,validation_json,legacy_projection_json,content_hash,status,published_at)
		 VALUES (?,?,?,?,?,?,?,?,'published',datetime('now')) RETURNING *`,
	).bind(
		DESIGN_SYSTEM_SCHEMA_VERSION,
		DESIGN_SYSTEM_GENERATOR_VERSION,
		JSON.stringify(source),
		"{}",
		JSON.stringify(snapshot),
		JSON.stringify(snapshot.validation),
		JSON.stringify(legacyTheme),
		snapshot.contentHash,
	).first<RevisionRow>();
	if (!inserted) throw new Error("design_system_seed_failed");
	const changed = await env.orderak_db.prepare(
		"UPDATE design_system_state SET active_revision_id=?,updated_at=datetime('now') WHERE id=1 AND active_revision_id IS NULL",
	).bind(inserted.id).run();
	if ((changed.meta.changes ?? 0) === 0) {
		const winner = await env.orderak_db.prepare(
			"SELECT r.* FROM design_system_state s JOIN design_system_revisions r ON r.id=s.active_revision_id WHERE s.id=1",
		).first<RevisionRow>();
		if (winner) return parseRevision(winner);
	}
	return parseRevision(inserted);
}

export async function loadActiveDesignSystem(env: Env, request?: Request): Promise<DesignSystemRevision> {
	if (activeCache && activeCache.expires > Date.now()) return activeCache.revision;
	const lastKnownGood = activeCache?.revision;
	try {
		const row = await env.orderak_db.prepare(
			"SELECT r.* FROM design_system_state s JOIN design_system_revisions r ON r.id=s.active_revision_id WHERE s.id=1",
		).first<RevisionRow>();
		const revision = row ? parseRevision(row) : await seedInitialRevision(env);
		if (!revision.snapshot.validation.valid) throw new Error("active design-system snapshot is invalid");
		activeCache = { revision, expires: Date.now() + 60_000 };
		return revision;
	} catch (error) {
		const fallback = lastKnownGood ? "last_known_good" : "compiled_defaults";
		await logError(env, "design_system_fallback", error, request);
		console.error(JSON.stringify({ severity: "high", signal: "design_system_fallback", fallback }));
		try {
			await env.orderak_db.prepare(
				`INSERT INTO admin_audit(action,entity,entity_id,details_json)
				 VALUES ('design_system.fallback_activated','design_system_state','1',?)`,
			).bind(JSON.stringify({ fallback, severity: "high" })).run();
		} catch {
			// Error logging above is the primary incident evidence.
		}
		if (lastKnownGood) return lastKnownGood;
		const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
		return {
			id: 0,
			name: null,
			source: snapshot.source,
			overrides: {},
			snapshot,
			validation: snapshot.validation,
			legacyTheme: LEGACY_DEFAULT_THEME,
			contentHash: snapshot.contentHash,
			generatorVersion: snapshot.generatorVersion,
			schemaVersion: snapshot.schemaVersion,
			publishedAt: null,
			createdBy: null,
			rollbackOfRevisionId: null,
		};
	}
}

export function designSystemCss(snapshot: GeneratedDesignSystem): string {
	const lines: string[] = [
		`/* Orderak design system ${snapshot.contentHash}; generator ${snapshot.generatorVersion} */`,
		fontFaceCss(snapshot.typography.family),
		":root{",
	];
	const appendColors = (contrast: ContrastName, mode: ThemeMode) => {
		const colors = snapshot.web.colors[contrast][mode];
		for (const [role, formats] of Object.entries(colors)) {
			const cssRole = role.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
			lines.push(`--md-sys-color-${cssRole}:${formats.hex};--md-sys-color-${cssRole}-rgb:${formats.rgb};--orderak-${cssRole}:${formats.oklch};`);
		}
	};
	appendColors("standard", "light");
	const familyName = snapshot.typography.family === "cairo" ? "Orderak Cairo"
		: snapshot.typography.family === "tajawal" ? "Orderak Tajawal" : "Orderak Noto Arabic";
	lines.push(`--orderak-font-family:"${familyName}",Cairo,Tajawal,"Noto Sans Arabic",system-ui,sans-serif;`);
	for (const [role, token] of Object.entries(snapshot.typography.roles)) {
		const name = role.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
		lines.push(`--orderak-type-${name}-size:${token.sizeRem}rem;--orderak-type-${name}-line-height:${token.lineHeight}rem;--orderak-type-${name}-weight:${token.weight};--orderak-type-${name}-tracking:${token.letterSpacingEm}em;`);
	}
	for (const [name, value] of Object.entries(snapshot.spacing.tokens)) lines.push(`--orderak-${name}:${value}px;`);
	for (const [name, value] of Object.entries(snapshot.shapes)) lines.push(`--orderak-shape-${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}:${value}px;`);
	lines.push("--orderak-minimum-touch-target:48px;}");
	lines.push('@media(prefers-color-scheme:dark){:root{');
	appendColors("standard", "dark");
	lines.push("}}");
	for (const contrast of ["medium", "high"] as ContrastName[]) {
		lines.push(`:root[data-orderak-contrast="${contrast}"]{`);
		appendColors(contrast, "light");
		lines.push("}");
		lines.push(`:root[data-orderak-theme="dark"][data-orderak-contrast="${contrast}"]{`);
		appendColors(contrast, "dark");
		lines.push("}");
	}
	lines.push(':root{--primary:var(--md-sys-color-primary);--primary-strong:var(--md-sys-color-primary-container);--primary-soft:var(--md-sys-color-surface-container);--primary-tint:var(--md-sys-color-inverse-primary);--canvas:var(--md-sys-color-background);--surface:var(--md-sys-color-surface);--ink:var(--md-sys-color-on-surface);--muted:var(--md-sys-color-on-surface-variant);--line:var(--md-sys-color-outline-variant);--danger:var(--md-sys-color-error);--danger-soft:var(--md-sys-color-error-container);--warning:var(--md-sys-color-warning);--warning-soft:var(--md-sys-color-warning-container);--accent:var(--md-sys-color-secondary);}');
	return lines.join("");
}

export function designSystemFontPreload(
	snapshot: GeneratedDesignSystem,
	script: "arabic" | "latin" = "arabic",
): string {
	const source = snapshot.typography.family === "tajawal"
		? `/static/fonts/tajawal-${script}-400.woff2`
		: snapshot.typography.family === "noto-arabic"
			? `/static/fonts/noto-sans-arabic-${script === "arabic" ? "variable" : "latin-core-variable"}.woff2`
			: `/static/fonts/cairo-${script === "arabic" ? "arabic-variable" : "latin-core-variable"}.woff2`;
	return `<link rel="preload" href="${source}" as="font" type="font/woff2" crossorigin>`;
}

const ARABIC_RANGE = "U+0600-06FF,U+0750-077F,U+0870-089F,U+08A0-08FF,U+200C-200E,U+FB50-FDFF,U+FE70-FEFC";
const LATIN_RANGE = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+2000-206F,U+20AC,U+2122,U+FEFF,U+FFFD";
const LATIN_EXT_RANGE = "U+0100-02FF,U+1E00-1EFF,U+20A0-20CF";

function face(
	family: string,
	source: string,
	weight: string,
	range: string,
	metrics: { size: number; ascent: number; descent: number; gap: number },
): string {
	return `@font-face{font-family:"${family}";src:url("${source}") format("woff2");font-weight:${weight};font-style:normal;font-display:swap;unicode-range:${range};size-adjust:${metrics.size}%;ascent-override:${metrics.ascent}%;descent-override:${metrics.descent}%;line-gap-override:${metrics.gap}%;}`;
}

function fontFaceCss(family: FontFamilyId): string {
	if (family === "tajawal") {
		const metrics = { size: 114.54, ascent: 64.3, descent: 35.7, gap: 20 };
		return [400, 500, 700].flatMap((weight) => [
			face("Orderak Tajawal", `/static/fonts/tajawal-arabic-${weight}.woff2`, String(weight), ARABIC_RANGE, metrics),
			face("Orderak Tajawal", `/static/fonts/tajawal-latin-${weight}.woff2`, String(weight), LATIN_RANGE, metrics),
		]).join("");
	}
	if (family === "noto-arabic") {
		const metrics = { size: 97.01, ascent: 137.4, descent: 73.8, gap: 0 };
		return [
			face("Orderak Noto Arabic", "/static/fonts/noto-sans-arabic-variable.woff2", "100 900", ARABIC_RANGE, metrics),
			face("Orderak Noto Arabic", "/static/fonts/noto-sans-arabic-latin-core-variable.woff2", "100 900", LATIN_RANGE, metrics),
			face("Orderak Noto Arabic", "/static/fonts/noto-sans-arabic-latin-variable.woff2", "100 900", LATIN_EXT_RANGE, metrics),
		].join("");
	}
	const metrics = { size: 104, ascent: 130.3, descent: 57.1, gap: 0 };
	return [
		face("Orderak Cairo", "/static/fonts/cairo-arabic-variable.woff2", "200 1000", ARABIC_RANGE, metrics),
		face("Orderak Cairo", "/static/fonts/cairo-latin-core-variable.woff2", "200 1000", LATIN_RANGE, metrics),
		face("Orderak Cairo", "/static/fonts/cairo-latin-variable.woff2", "200 1000", LATIN_EXT_RANGE, metrics),
	].join("");
}
