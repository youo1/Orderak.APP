// ============================================================
// Project design tokens — the single source of truth for colors
// across every server-rendered surface (landing, catalog, legal
// pages, admin panel) and the public /api/v1/theme endpoint that the
// Android app can read.
//
// Overrides live in the `settings` table under the `theme_colors`
// key (JSON object of token -> hex). Anything not overridden falls
// back to DEFAULT_THEME, so a partial override is always safe.
// Edited from the admin panel's Theme tab in one click.
//
// Navy + gold palette. Deep navy (#1E3A8A) passes WCAG AA both
// directions at ~10.4:1. Gold (#D4A017) is reserved for decorative
// fills only (badges, highlights) — never use it as text or icon color.
// ============================================================

import { invalidateDesignSystemCache, loadActiveDesignSystem } from "./design-system";

export interface Theme {
	primary: string;        // buttons, links, focus states — #1E3A8A, 10.4:1 on white
	primary_strong: string; // hover/pressed — #14275C
	primary_soft: string;   // container/badge fills — #EDF1FC, pair with --ink
	primary_tint: string;   // icons/decorative accents — #3B5BA9, 5.8:1
	canvas: string;         // page background — #F5F7FC
	surface: string;        // cards, inputs — #FFFFFF
	ink: string;            // primary text — #14141F
	muted: string;          // secondary text — #5C6470, 6.0:1
	line: string;           // borders — #E1E5EE
	danger: string;         // error text/icons/borders — #C1362B, 5.5:1
	danger_soft: string;    // error container fill — #FBEAE8
	warning: string;        // warning text/icons — #9A6700, 4.9:1
	warning_soft: string;   // warning container fill — #FBF1DE
	accent: string;         // GOLD decorative fill — #D4A017, 2.4:1 on white (fill-only)
}

export const DEFAULT_THEME: Theme = {
	primary: "#1E3A8A",
	primary_strong: "#14275C",
	primary_soft: "#EDF1FC",
	primary_tint: "#3B5BA9",
	canvas: "#F5F7FC",
	surface: "#FFFFFF",
	ink: "#14141F",
	muted: "#5C6470",
	line: "#E1E5EE",
	danger: "#C1362B",
	danger_soft: "#FBEAE8",
	warning: "#9A6700",
	warning_soft: "#FBF1DE",
	accent: "#D4A017",
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

// Module-level cache: Workers isolates keep this between requests, so
// hot paths (landing, catalog) don't pay a D1 read per page view.
const CACHE_TTL_MS = 60_000;

/** Load the effective theme (defaults + saved overrides), cached ~60s. */
export async function loadTheme(env: Env): Promise<Theme> {
	return (await loadActiveDesignSystem(env)).legacyTheme;
}

/** Drop the cache after a save so the next render picks up new colors. */
export function invalidateThemeCache(): void {
	invalidateDesignSystemCache();
	brandingCache = null;
}

// ---------------- Branding config (mobile remote-config) ----------------
// A tiny, versioned payload the Android app polls: theme tokens + brand
// asset URLs. `version` is a content hash, also served as the ETag, so
// clients that send If-None-Match get a bodyless 304 when nothing changed
// and only ever re-download assets whose URLs/content actually changed
// (the static assets themselves are served with their own ETags).

export interface BrandingConfig {
	version: string;
	theme: Theme;
	assets: Record<string, string>;
}

const BRAND_ASSETS = (site: string): Record<string, string> => ({
	logo: `${site}/static/orderak-logo.svg`,
	logo_horizontal: `${site}/static/orderak-logo-horizontal.svg`,
	icon: `${site}/static/orderak-icon.svg`,
	icon_512: `${site}/static/orderak-icon-512.png`,
	favicon: `${site}/static/orderak-favicon.svg`,
});

let brandingCache: { config: BrandingConfig; expires: number } | null = null;

async function sha256Short(s: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

/** Assemble the versioned branding config (cached alongside the theme). */
export async function loadBrandingConfig(env: Env, siteUrl: string): Promise<BrandingConfig> {
	if (brandingCache && brandingCache.expires > Date.now()) return brandingCache.config;
	const theme = await loadTheme(env);
	const assets = BRAND_ASSETS(siteUrl);
	const version = await sha256Short(JSON.stringify({ theme, assets }));
	const config: BrandingConfig = { version, theme, assets };
	brandingCache = { config, expires: Date.now() + CACHE_TTL_MS };
	return config;
}
