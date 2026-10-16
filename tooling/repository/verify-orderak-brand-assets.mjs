#!/usr/bin/env node
// ============================================================
// Keep the Orderak brand assets served by every surface identical to the
// approved design exports, on the design-system colour roles, and with every
// local asset reference pointing at a file that exists.
//
// WHY THIS EXISTS
//   Plan item B9 replaces the legacy mark (green bag, teal bubble, orange
//   badge) with direction B, D-14: the same smile-in-a-bag artwork exported
//   once into design/assets/brand and copied to Android, the backend and the
//   admin panel. Nothing else should redraw or recolour it, and a served copy
//   that drifts from its export is a silent regression: the Android launcher,
//   the web manifest and the admin favicon would each show a different mark
//   and no test would notice.
//
//   The guard checks three things:
//     1. Every served copy is byte-identical to its named export.
//     2. Every literal colour in the brand sources, the served SVGs, the
//        Android drawables and launcher background, the admin favicon and the
//        manifest theme/background colours is a colour role declared in
//        design/design-system.default.json. Hex case and shorthand are
//        normalised before comparing.
//     3. Every local asset path referenced by the backend manifest, the
//        backend landing page and the admin index resolves to a real file.
//        External URLs and page routes are ignored.
//
//   Every failure names the offending repository-relative file, so a red CI
//   run points straight at the file to fix.
//
// Usage: node tooling/repository/verify-orderak-brand-assets.mjs
// ============================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const problems = [];

function relative(filePath) {
	return path.relative(repositoryRoot, filePath).replace(/\\/g, "/");
}

function resolve(relativePath) {
	return path.join(repositoryRoot, relativePath);
}

function readText(relativePath) {
	return readFileSync(resolve(relativePath), "utf8");
}

function collectFiles(directory, filter, out = []) {
	if (!existsSync(directory)) return out;
	for (const entry of readdirSync(directory)) {
		if (entry === "node_modules" || entry === "build" || entry === ".gradle" || entry === "dist") continue;
		const full = path.join(directory, entry);
		if (statSync(full).isDirectory()) collectFiles(full, filter, out);
		else if (filter(entry)) out.push(full);
	}
	return out;
}

// ---------------------------------------------------------------------------
// 1. Served copies must be byte-identical to their export.
// ---------------------------------------------------------------------------

const BRAND = "design/assets/brand";
const ANDROID_RES = "apps/seller-android/app/src/main/res";
const BACKEND_STATIC = "services/backend/assets/static";
const ANDROID_MIPMAPS = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];

const SERVED_COPIES = [
	// Android vector drawables.
	{ served: `${ANDROID_RES}/drawable/ic_launcher_foreground.xml`, exported: `${BRAND}/android/ic_launcher_foreground.xml` },
	{ served: `${ANDROID_RES}/drawable/ic_launcher_monochrome.xml`, exported: `${BRAND}/android/ic_launcher_monochrome.xml` },
	{ served: `${ANDROID_RES}/drawable/ic_orderak_logo.xml`, exported: `${BRAND}/android/ic_orderak_logo.xml` },
	// Android legacy launcher PNGs (API 24-25).
	...ANDROID_MIPMAPS.flatMap((density) => [
		{
			served: `${ANDROID_RES}/mipmap-${density}/ic_launcher.png`,
			exported: `${BRAND}/png/android/mipmap-${density}/ic_launcher.png`,
		},
		{
			served: `${ANDROID_RES}/mipmap-${density}/ic_launcher_round.png`,
			exported: `${BRAND}/png/android/mipmap-${density}/ic_launcher_round.png`,
		},
	]),
	// Backend served SVGs and web icons.
	{ served: `${BACKEND_STATIC}/orderak-favicon.svg`, exported: `${BRAND}/svg/orderak-favicon.svg` },
	{ served: `${BACKEND_STATIC}/orderak-logo.svg`, exported: `${BRAND}/svg/orderak-logo.svg` },
	{ served: `${BACKEND_STATIC}/orderak-logo-horizontal.svg`, exported: `${BRAND}/svg/orderak-logo-horizontal.svg` },
	{ served: `${BACKEND_STATIC}/orderak-icon.svg`, exported: `${BRAND}/svg/orderak-mark.svg` },
	{ served: `${BACKEND_STATIC}/orderak-favicon-16.png`, exported: `${BRAND}/png/web/orderak-favicon-16.png` },
	{ served: `${BACKEND_STATIC}/orderak-favicon-32.png`, exported: `${BRAND}/png/web/orderak-favicon-32.png` },
	{ served: `${BACKEND_STATIC}/orderak-favicon-48.png`, exported: `${BRAND}/png/web/orderak-favicon-48.png` },
	{ served: `${BACKEND_STATIC}/orderak-icon-180.png`, exported: `${BRAND}/png/web/orderak-icon-180.png` },
	{ served: `${BACKEND_STATIC}/orderak-icon-192.png`, exported: `${BRAND}/png/web/orderak-icon-192.png` },
	{ served: `${BACKEND_STATIC}/orderak-icon-512.png`, exported: `${BRAND}/png/web/orderak-icon-512.png` },
	{ served: `${BACKEND_STATIC}/orderak-icon-maskable-512.png`, exported: `${BRAND}/png/web/orderak-icon-maskable-512.png` },
	// Both ICO destinations.
	{ served: "services/backend/assets/favicon.ico", exported: `${BRAND}/ico/orderak-favicon.ico` },
	{ served: `${BACKEND_STATIC}/orderak-favicon.ico`, exported: `${BRAND}/ico/orderak-favicon.ico` },
	// Admin favicon.
	{ served: "apps/admin-web/public/favicon.svg", exported: `${BRAND}/svg/orderak-favicon.svg` },
];

for (const { served, exported } of SERVED_COPIES) {
	const servedPath = resolve(served);
	const exportedPath = resolve(exported);
	if (!existsSync(servedPath)) {
		problems.push(`${served}: served copy is missing (expected a byte-for-byte copy of ${exported}).`);
		continue;
	}
	if (!existsSync(exportedPath)) {
		problems.push(`${served}: export ${exported} is missing.`);
		continue;
	}
	if (!readFileSync(servedPath).equals(readFileSync(exportedPath))) {
		problems.push(`${served}: is not byte-identical to its export ${exported}.`);
	}
}

// ---------------------------------------------------------------------------
// 2. Colours must be design-system role values.
// ---------------------------------------------------------------------------

/** Normalise a hex colour to uppercase, expanding 3-digit shorthand. */
function normaliseHex(value) {
	const hex = value.replace(/^#/, "").toUpperCase();
	if (hex.length === 3) return `#${hex.split("").map((char) => char + char).join("")}`;
	return `#${hex}`;
}

const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/g;

/**
 * The role values: every colour the generated schemes and semantic roles assign, in every contrast and mode. Only
 * these count. Seed colours, source overrides and validation records elsewhere in the file are not roles.
 */
function collectRoleHexes() {
	const roles = new Set();
	const snapshot = JSON.parse(readText("design/design-system.default.json")).snapshot ?? {};
	for (const family of [snapshot.schemes, snapshot.semantic]) {
		for (const modes of Object.values(family ?? {})) {
			for (const roleValues of Object.values(modes ?? {})) {
				for (const value of Object.values(roleValues ?? {})) {
					if (typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value)) roles.add(normaliseHex(value));
				}
			}
		}
	}
	if (roles.size === 0) problems.push("design/design-system.default.json: no scheme or semantic role colours found.");
	return roles;
}

// Colour-bearing attributes and style properties in SVG and Android vector XML. A value there must be a role hex
// (checked above) or one of these keywords; a named colour (`red`) or a functional notation (`rgb(…)`, `hsl(…)`)
// would otherwise slip past a check that only reads hex literals.
const COLOUR_PROPERTY = /(?:^|[\s"'{;])(fill|stroke|stop-color|flood-color|lighting-color|color|android:fillColor|android:strokeColor)\s*[=:]\s*["']?([^"';>}\s]+)/g;
const COLOUR_KEYWORDS = new Set(["none", "transparent", "currentcolor", "inherit"]);

function isAllowedColourValue(value) {
	const lower = value.toLowerCase();
	return (
		/^#[0-9a-f]{3,8}$/i.test(value) || // a hex literal: the role check above decides it
		COLOUR_KEYWORDS.has(lower) ||
		/^url\(#[^)]+\)$/i.test(value) || // a gradient or pattern; its stops are checked as stop-color
		value.startsWith("@") // an Android resource reference, resolved and checked where it is defined
	);
}

const roleHexes = collectRoleHexes();

const DRAWABLE_FILES = [
	`${ANDROID_RES}/drawable/ic_launcher_foreground.xml`,
	`${ANDROID_RES}/drawable/ic_launcher_monochrome.xml`,
	`${ANDROID_RES}/drawable/ic_orderak_logo.xml`,
	`${ANDROID_RES}/values/ic_launcher_background.xml`,
];

const COLOUR_FILES = [
	...collectFiles(resolve(`${BRAND}/svg`), (name) => name.endsWith(".svg")),
	...collectFiles(resolve(`${BRAND}/android`), (name) => name.endsWith(".xml")),
	...collectFiles(resolve(BACKEND_STATIC), (name) => name.endsWith(".svg")),
	resolve("apps/admin-web/public/favicon.svg"),
	...DRAWABLE_FILES.map(resolve),
];

for (const file of COLOUR_FILES) {
	const relativeFile = relative(file);
	if (!existsSync(file)) {
		problems.push(`${relativeFile}: expected file is missing.`);
		continue;
	}
	const text = readFileSync(file, "utf8");
	for (const match of text.matchAll(HEX_PATTERN)) {
		const colour = normaliseHex(match[0]);
		if (!roleHexes.has(colour)) {
			problems.push(
				`${relativeFile}: colour ${match[0]} is not a colour role in design/design-system.default.json.`,
			);
		}
	}
	for (const match of text.matchAll(COLOUR_PROPERTY)) {
		const [, property, value] = match;
		if (!isAllowedColourValue(value)) {
			problems.push(
				`${relativeFile}: ${property} ${value} is not a hex colour role; named and functional colours are not allowed.`,
			);
		}
	}
}

const manifestRelative = "services/backend/assets/manifest.json";
const manifest = existsSync(resolve(manifestRelative))
	? JSON.parse(readText(manifestRelative))
	: null;
if (manifest) {
	for (const key of ["theme_color", "background_color"]) {
		const value = manifest[key];
		if (typeof value !== "string") {
			problems.push(`${manifestRelative}: ${key} is not a colour string.`);
			continue;
		}
		if (!roleHexes.has(normaliseHex(value))) {
			problems.push(
				`${manifestRelative}: ${key} value ${value} is not a colour role in design/design-system.default.json.`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// 3. Local asset references must resolve to a real file.
// ---------------------------------------------------------------------------

// Only paths that name a static asset are checked. Stylesheet and script
// references are application entry points — `/theme.css` is generated by the
// admin edge worker and `/src/app/main.tsx` is a Vite module — not files in the
// served asset trees, so they are ignored as page routes.
const STATIC_ASSET_EXTENSIONS = new Set([
	".svg",
	".png",
	".ico",
	".jpg",
	".jpeg",
	".webp",
	".gif",
	".avif",
	".json",
	".webmanifest",
]);

function isExternalReference(value) {
	return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

function extractAttributeReferences(text) {
	const references = [];
	for (const match of text.matchAll(/\b(?:href|src|content)\s*=\s*(["'])([^"']+)\1/g)) {
		references.push(match[2]);
	}
	return references;
}

function extractManifestReferences(document) {
	const references = [];
	if (Array.isArray(document.icons)) {
		for (const icon of document.icons) {
			if (icon && typeof icon.src === "string") references.push(icon.src);
		}
	}
	return references;
}

function resolveReference(relativeDocument, base, reference) {
	if (isExternalReference(reference)) return null;
	let withoutFragment = reference.split("#")[0].split("?")[0];
	if (withoutFragment === "" || withoutFragment === "/") return null;
	const extension = path.posix.extname(withoutFragment).toLowerCase();
	if (!STATIC_ASSET_EXTENSIONS.has(extension)) return null;
	// The manifest (/manifest.json), the landing page (/) and the admin index
	// (/) are all served from the site root, so a document-relative reference
	// such as `missing-relative.png` resolves exactly like the equivalent
	// root-relative `/missing-relative.png`. A local asset reference is never
	// skipped; only external URLs, fragments and extensionless page routes are.
	if (!withoutFragment.startsWith("/")) withoutFragment = `/${withoutFragment}`;
	if (base === "backend" && withoutFragment.startsWith("/static/")) {
		return { file: resolve(`${BACKEND_STATIC}/${withoutFragment.slice("/static/".length)}`), path: withoutFragment };
	}
	if (base === "backend") {
		return { file: resolve(`services/backend/assets/${withoutFragment.slice(1)}`), path: withoutFragment };
	}
	return { file: resolve(`apps/admin-web/public/${withoutFragment.slice(1)}`), path: withoutFragment };
}

const REFERENCE_DOCUMENTS = [
	{ document: "services/backend/assets/manifest.json", base: "backend", kind: "manifest" },
	{ document: "services/backend/src/landing.ts", base: "backend", kind: "attributes" },
	{ document: "apps/admin-web/index.html", base: "admin", kind: "attributes" },
];

for (const { document, base, kind } of REFERENCE_DOCUMENTS) {
	const file = resolve(document);
	if (!existsSync(file)) {
		problems.push(`${document}: expected document is missing.`);
		continue;
	}
	const references =
		kind === "manifest"
			? extractManifestReferences(JSON.parse(readFileSync(file, "utf8")))
			: extractAttributeReferences(readFileSync(file, "utf8"));
	for (const reference of references) {
		const resolved = resolveReference(document, base, reference);
		if (resolved === null) continue;
		if (!existsSync(resolved.file)) {
			problems.push(
				`${document}: referenced asset ${resolved.path} does not resolve to an existing file ` +
					`(${relative(resolved.file)}).`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

if (problems.length > 0) {
	console.error(`\n${problems.length} Orderak brand-asset problem(s):`);
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}

console.log(
	`Orderak brand assets verified: ${SERVED_COPIES.length} served cop${SERVED_COPIES.length === 1 ? "y" : "ies"} ` +
		`byte-identical, ${COLOUR_FILES.length} colour source(s) on design-system roles, ` +
		`${REFERENCE_DOCUMENTS.length} document(s) with resolvable asset references.`,
);
