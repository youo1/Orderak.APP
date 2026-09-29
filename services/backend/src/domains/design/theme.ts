// ============================================================
// Project design tokens — the single source of truth for colors
// across every server-rendered surface (landing, catalog, legal
// pages, admin panel) and the public /api/v1/theme endpoint that the
// storefront reads.
//
// Overrides live in the `settings` table under the `theme_colors`
// key (JSON object of token -> hex). Anything not overridden falls
// back to DEFAULT_THEME, so a partial override is always safe.
//
// Dark Teal palette. These values are the standard/light roles emitted by
// generateDesignSystem() from the brand seed #014D4E (HCT hue 198.1, chroma
// 28.7) with secondary #4B6B69 and tertiary #2F7D6A. `primary` is pinned to the
// tone the seed occupies, so the published brand colour and the primary action
// colour are the same colour. Every pair was contrast-validated at generation.
// Keep them in step with design/tokens.json and LEGACY_DEFAULT_THEME; they are
// the same projection rendered for different consumers.
// ============================================================

import { invalidateDesignSystemCache, loadActiveDesignSystem } from "./design-system";

export interface Theme {
	primary: string;        // buttons, links, focus states — #014D4E, 9.7:1 on canvas
	primary_strong: string; // hover/pressed — #002929
	primary_soft: string;   // container/badge fills — #B0EEEE, pair with --ink
	primary_tint: string;   // icons/decorative accents — #95D1D2
	canvas: string;         // page background — #F3FBFC
	surface: string;        // cards, inputs — #F3FBFC
	ink: string;            // primary text — #151D1E
	muted: string;          // secondary text — #3B494B
	line: string;           // borders — #BAC9CB
	danger: string;         // error text/icons/borders — #BA1A1A
	danger_soft: string;    // error container fill — #FFDAD5
	warning: string;        // warning text/icons — #755B00
	warning_soft: string;   // warning container fill — #FFDF91
	accent: string;         // decorative fill — #386664 (fill-only)
}

export const DEFAULT_THEME: Theme = {
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
};

export const THEME_KEYS = Object.keys(DEFAULT_THEME) as (keyof Theme)[];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** True when the value is a plain 6-digit hex color like #1DAB61. */
export function isHexColor(v: unknown): v is string {
	return typeof v === "string" && HEX_RE.test(v);
}

function luminance(hex: string): number {
	const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
		.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (light + 0.05) / (dark + 0.05);
}

/** Merge a raw (possibly partial / invalid) override onto the defaults. */
export function mergeTheme(raw: unknown): Theme {
	const t: Theme = { ...DEFAULT_THEME };
	if (raw && typeof raw === "object") {
		for (const k of THEME_KEYS) {
			const v = (raw as Record<string, unknown>)[k];
			if (isHexColor(v)) t[k] = v.toUpperCase();
		}
	}
	// Admin overrides must not be able to create unreadable buttons or body
	// text. Invalid pairs fall back by role to the compiled accessible defaults.

	// Primary must contrast against surface (#FFFFFF) ≥4.5:1 for button text.
	if (contrast(t.primary, "#FFFFFF") < 4.5) t.primary = DEFAULT_THEME.primary;
	// Danger must contrast against surface (#FFFFFF) ≥4.5:1 for error text/icons.
	if (contrast(t.danger, "#FFFFFF") < 4.5) t.danger = DEFAULT_THEME.danger;
	// Ink must contrast against canvas and surface ≥4.5:1 for body text.
	if (contrast(t.ink, t.canvas) < 4.5 || contrast(t.ink, t.surface) < 4.5) {
		t.ink = DEFAULT_THEME.ink;
		t.canvas = DEFAULT_THEME.canvas;
		t.surface = DEFAULT_THEME.surface;
	}
	// Muted must contrast against canvas and surface ≥4.5:1 for secondary text.
	if (contrast(t.muted, t.canvas) < 4.5 || contrast(t.muted, t.surface) < 4.5) t.muted = DEFAULT_THEME.muted;
	// Warning must contrast against surface ≥4.5:1 for warning text/icons.
	if (contrast(t.warning, "#FFFFFF") < 4.5) t.warning = DEFAULT_THEME.warning;
	return t;
}

/**
 * Drop the cached design system so the next render picks up a published revision.
 *
 * This used to clear a second, unrelated module-level cache: a branding payload
 * that nothing ever requested. `loadBrandingConfig` and the `loadTheme` wrapper it
 * called were declared and never referenced from anywhere in this repository, so
 * the whole chain went with them — the interface, the asset map, the SHA-256
 * shortener and the TTL. `/api/v1/theme` is what clients actually read, and it
 * caches inside the design-system loader.
 */
export function invalidateThemeCache(): void {
	invalidateDesignSystemCache();
}
