import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	DEFAULT_DESIGN_SYSTEM_SOURCE,
	LEGACY_DEFAULT_THEME,
	generateDesignSystem,
} from "../src/domains/design/design-system";

const workspace = resolve(process.cwd(), "..", "..");
const fixturePath = resolve(workspace, "design", "design-system.default.json");
const themeDir = resolve(
	workspace,
	"apps",
	"seller-android",
	"app",
	"src",
	"main",
	"java",
	"app",
	"orderak",
	"seller",
	"core",
	"ui",
	"theme",
);
const androidContractPath = resolve(themeDir, "DesignSystemContract.kt");
const androidSchemesPath = resolve(themeDir, "GeneratedDesignSystem.kt");

/**
 * Every Material 3 ColorScheme role, in the order Compose declares them.
 *
 * The generator emits 49 roles; `shadow` is the one MCU produces that Compose's
 * ColorScheme has no slot for, so it is deliberately absent here.
 */
const COMPOSE_COLOR_ROLES = [
	"primary", "onPrimary", "primaryContainer", "onPrimaryContainer", "inversePrimary",
	"secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
	"tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
	"background", "onBackground",
	"surface", "onSurface", "surfaceVariant", "onSurfaceVariant", "surfaceTint",
	"inverseSurface", "inverseOnSurface",
	"error", "onError", "errorContainer", "onErrorContainer",
	"outline", "outlineVariant", "scrim",
	"surfaceBright", "surfaceDim",
	"surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest",
	"surfaceContainerLow", "surfaceContainerLowest",
	"primaryFixed", "primaryFixedDim", "onPrimaryFixed", "onPrimaryFixedVariant",
	"secondaryFixed", "secondaryFixedDim", "onSecondaryFixed", "onSecondaryFixedVariant",
	"tertiaryFixed", "tertiaryFixedDim", "onTertiaryFixed", "onTertiaryFixedVariant",
] as const;

/** OrderakExtendedColors field -> source role. Mirrors the former remoteExtended mapping. */
const EXTENDED_FROM_SEMANTIC: ReadonlyArray<readonly [string, string]> = [
	["warning", "warning"],
	["warningSoft", "warningContainer"],
	["onWarning", "onWarning"],
	["onWarningContainer", "onWarningContainer"],
	["success", "success"],
	["successSoft", "successContainer"],
	["onSuccess", "onSuccess"],
	["onSuccessContainer", "onSuccessContainer"],
	["information", "information"],
	["informationSoft", "informationContainer"],
	["onInformation", "onInformation"],
	["onInformationContainer", "onInformationContainer"],
	["commerce", "commerce"],
	["commerceSoft", "commerceContainer"],
	["onCommerce", "onCommerce"],
	["onCommerceContainer", "onCommerceContainer"],
	["warningContainerOutline", "warningContainerOutline"],
	["successContainerOutline", "successContainerOutline"],
	["informationContainerOutline", "informationContainerOutline"],
	["commerceContainerOutline", "commerceContainerOutline"],
];

const EXTENDED_FROM_SCHEME: ReadonlyArray<readonly [string, string]> = [
	["accent", "secondary"],
	["onAccent", "onSecondary"],
	["primaryTint", "inversePrimary"],
];

const CONTRASTS = ["standard", "medium", "high"] as const;
const MODES = ["light", "dark"] as const;

/** "#0A9A8E" -> "Color(0xFF0A9A8E)". Throws rather than emitting a colour Compose cannot parse. */
function kotlinColor(hex: string): string {
	if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
		throw new Error(`Generated role is not a six-digit hex colour: ${JSON.stringify(hex)}`);
	}
	return `Color(0xFF${hex.slice(1).toUpperCase()})`;
}

function schemeName(contrast: string, mode: string): string {
	return `${mode[0].toUpperCase()}${mode.slice(1)}${contrast[0].toUpperCase()}${contrast.slice(1)}`;
}

function renderColorScheme(
	contrast: string,
	mode: string,
	roles: Record<string, string>,
): string {
	const builder = mode === "dark" ? "darkColorScheme" : "lightColorScheme";
	const body = COMPOSE_COLOR_ROLES.map((role) => {
		const value = roles[role];
		if (!value) throw new Error(`Generated scheme ${contrast}/${mode} is missing role ${role}.`);
		return `    ${role} = ${kotlinColor(value)},`;
	}).join("\n");
	return `private val ${schemeName(contrast, mode)}: ColorScheme = ${builder}(\n${body}\n)`;
}

function renderExtended(
	contrast: string,
	mode: string,
	semantic: Record<string, string>,
	roles: Record<string, string>,
): string {
	const fields = [
		...EXTENDED_FROM_SEMANTIC.map(([field, role]) => {
			const value = semantic[role];
			if (!value) throw new Error(`Generated semantic ${contrast}/${mode} is missing role ${role}.`);
			return `    ${field} = ${kotlinColor(value)},`;
		}),
		...EXTENDED_FROM_SCHEME.map(([field, role]) => {
			const value = roles[role];
			if (!value) throw new Error(`Generated scheme ${contrast}/${mode} is missing role ${role}.`);
			return `    ${field} = ${kotlinColor(value)},`;
		}),
	].join("\n");
	return `private val ${schemeName(contrast, mode)}Extended: OrderakExtendedColors = OrderakExtendedColors(\n${fields}\n)`;
}

function renderSelector(suffix: string, returnType: string): string {
	const branches: string[] = [];
	for (const mode of MODES) {
		for (const contrast of CONTRASTS) {
			branches.push(
				`            "${mode}" to "${contrast}" -> ${schemeName(contrast, mode)}${suffix}`,
			);
		}
	}
	return branches.join("\n");
}

function renderKotlinSchemes(snapshot: {
	generatorVersion: string;
	contentHash: string;
	schemes: Record<string, Record<string, Record<string, string>>>;
	semantic: Record<string, Record<string, Record<string, string>>>;
	typography: { family: string; roles: Record<string, { sizeSp: number; lineHeight: number; weight: number; letterSpacingEm: number }> };
	spacing: { tokens: Record<string, number> };
	shapes: Record<string, number>;
	components: { minimumTouchTargetDp: number };
	source: { colors: { defaultContrast: string } };
}): string {
	const schemes: string[] = [];
	const extended: string[] = [];
	for (const contrast of CONTRASTS) {
		for (const mode of MODES) {
			schemes.push(renderColorScheme(contrast, mode, snapshot.schemes[contrast][mode]));
			extended.push(renderExtended(contrast, mode, snapshot.semantic[contrast][mode], snapshot.schemes[contrast][mode]));
		}
	}

	const typography = Object.entries(snapshot.typography.roles)
		.map(([role, m]) =>
			`        "${role}" to GeneratedTypeRole(${m.sizeSp}f, ${m.lineHeight}f, ${m.weight}, ${m.letterSpacingEm}f),`)
		.join("\n");
	const spacing = Object.entries(snapshot.spacing.tokens)
		.map(([token, value]) => `        "${token}" to ${value}f,`)
		.join("\n");
	const shapes = Object.entries(snapshot.shapes)
		.map(([name, value]) => `        "${name}" to ${value}f,`)
		.join("\n");

	return `package app.orderak.seller.core.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by services/backend/scripts/generate-design-system-fixture.ts from
 * DEFAULT_DESIGN_SYSTEM_SOURCE. Regenerate with, from services/backend:
 *
 *     pnpm run design-system:generate
 *
 * Every colour below was emitted by generateDesignSystem(), which fails on any
 * role pair below its required WCAG ratio. That build-time gate is the only
 * contrast enforcement in the system: colours reach the app through this file
 * and nowhere else, so hand-editing it removes the guarantee entirely.
 */
internal data class GeneratedTypeRole(
    val sizeSp: Float,
    val lineHeight: Float,
    val weight: Int,
    val letterSpacingEm: Float,
)

internal object GeneratedDesignSystem {
    const val GENERATOR_VERSION = "${snapshot.generatorVersion}"
    const val CONTENT_HASH = "${snapshot.contentHash}"
    const val MINIMUM_TOUCH_TARGET_DP = ${snapshot.components.minimumTouchTargetDp}f
    const val FONT_FAMILY = "${snapshot.typography.family}"
    const val DEFAULT_CONTRAST = "${snapshot.source.colors.defaultContrast}"

    val contrasts: List<String> = listOf(${CONTRASTS.map((c) => `"${c}"`).join(", ")})

    fun colorScheme(contrast: String, dark: Boolean): ColorScheme {
        val mode = if (dark) "dark" else "light"
        return when (mode to normalizeContrast(contrast)) {
${renderSelector("", "ColorScheme")}
            else -> LightStandard
        }
    }

    fun extendedColors(contrast: String, dark: Boolean): OrderakExtendedColors {
        val mode = if (dark) "dark" else "light"
        return when (mode to normalizeContrast(contrast)) {
${renderSelector("Extended", "OrderakExtendedColors")}
            else -> LightStandardExtended
        }
    }

    fun normalizeContrast(contrast: String): String =
        if (contrast in contrasts) contrast else "standard"

    val typography: Map<String, GeneratedTypeRole> = mapOf(
${typography}
    )

    val spacing: Map<String, Float> = mapOf(
${spacing}
    )

    val shapes: Map<String, Float> = mapOf(
${shapes}
    )
}

${schemes.join("\n\n")}

${extended.join("\n\n")}
`;
}

async function main() {
	const snapshot = await generateDesignSystem(DEFAULT_DESIGN_SYSTEM_SOURCE);
	const fixture = `${JSON.stringify({
		$comment: "Canonical compiled fallback. Generated; do not edit by hand.",
		source: DEFAULT_DESIGN_SYSTEM_SOURCE,
		snapshot,
		legacyProjection: LEGACY_DEFAULT_THEME,
	}, null, 2)}\n`;
	const kotlin = `package app.orderak.seller.core.ui.theme

/** Generated fallback identity checked by verifyDesignSystemContract. */
internal object DesignSystemContract {
    const val SCHEMA_VERSION = 2
    const val GENERATOR_VERSION = "${snapshot.generatorVersion}"
    const val DEFAULT_FALLBACK_HASH = "${snapshot.contentHash}"
}
`;
	const schemes = renderKotlinSchemes(snapshot as Parameters<typeof renderKotlinSchemes>[0]);

	if (process.argv.includes("--write")) {
		await writeFile(fixturePath, fixture);
		await writeFile(androidContractPath, kotlin);
		await writeFile(androidSchemesPath, schemes);
		console.log(`Wrote ${fixturePath}`);
		console.log(`Wrote ${androidContractPath}`);
		console.log(`Wrote ${androidSchemesPath}`);
	} else {
		const currentFixture = await readFile(fixturePath, "utf8").catch(() => "");
		const currentKotlin = await readFile(androidContractPath, "utf8").catch(() => "");
		const currentSchemes = await readFile(androidSchemesPath, "utf8").catch(() => "");
		if (currentFixture !== fixture || currentKotlin !== kotlin || currentSchemes !== schemes) {
			console.error("Generated design-system fallback drift detected. Run npm run design-system:generate.");
			process.exitCode = 1;
		} else {
			console.log(`Design-system fixture is current (${snapshot.contentHash}).`);
		}
	}
}

void main();
