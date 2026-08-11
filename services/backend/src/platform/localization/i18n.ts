// ============================================================
// Tiny dependency-free i18n core for the whole Worker.
//
// - Launch locales: 'ar' (default, RTL) and 'en' (LTR).
// - Add a new language by dropping a dictionary into ./messages
//   and adding its code to LOCALES (+ RTL set if needed).
//
// Usage:
//   const lang = pickLocale(request, url, seller?.lang);
//   t(lang, "errors.auth")                       -> localized string
//   t(lang, "coupons.applied", { amount: "50" }) -> with {vars}
//   pickI18n(row.name_i18n, lang, row.name)      -> localized DB JSON
// ============================================================

import { ar } from "./messages/ar";
import { en } from "./messages/en";

export type Locale = "ar" | "en";

export const LOCALES: Locale[] = ["ar", "en"];
export const DEFAULT_LOCALE: Locale = "ar";
const RTL = new Set<Locale>(["ar"]);

const DICTS: Record<Locale, Record<string, string>> = { ar, en };

/** Is `x` one of our supported locales? */
export function isLocale(x: unknown): x is Locale {
	return typeof x === "string" && (LOCALES as string[]).includes(x);
}

/** Text direction for a locale. */
export function dirFor(lang: Locale): "rtl" | "ltr" {
	return RTL.has(lang) ? "rtl" : "ltr";
}

/**
 * Resolve a standard Accept-Language value without using its raw value as a
 * cache key. Regional variants collapse to the small supported locale set.
 */
export function localeFromAcceptLanguage(value: string | null): Locale | null {
	const ranges = (value ?? "")
		.split(",")
		.map((part, index) => {
			const [range, ...params] = part.trim().split(";");
			const qParam = params.find((p) => p.trim().toLowerCase().startsWith("q="));
			const parsedQ = qParam ? Number(qParam.trim().slice(2)) : 1;
			const q = Number.isFinite(parsedQ) && parsedQ >= 0 && parsedQ <= 1 ? parsedQ : 0;
			return { range: range.toLowerCase(), q, index };
		})
		.filter((item) => item.range && item.range !== "*" && item.q > 0)
		.sort((a, b) => b.q - a.q || a.index - b.index);

	for (const { range } of ranges) {
		const primary = range.split("-")[0];
		if (isLocale(primary)) return primary;
	}
	return null;
}

/**
 * Decide the request locale.
 * Order: explicit ?lang / x-lang  ->  stored user pref  ->  Accept-Language  ->  default.
 */
export function pickLocale(request: Request, url: URL, userPref?: unknown): Locale {
	const q = url.searchParams.get("lang");
	if (isLocale(q)) return q;

	const h = request.headers.get("x-lang");
	if (isLocale(h)) return h;

	if (isLocale(userPref)) return userPref;

	const accepted = localeFromAcceptLanguage(request.headers.get("accept-language"));
	if (accepted) return accepted;
	return DEFAULT_LOCALE;
}

/**
 * Translate a dotted key for a locale, with {var} interpolation.
 * Falls back: requested lang -> English -> the key itself.
 */
export function t(lang: Locale, key: string, vars?: Record<string, string | number>): string {
	const dict = DICTS[lang] ?? DICTS[DEFAULT_LOCALE];
	let s = dict[key] ?? DICTS.en[key] ?? key;
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
		}
	}
	return s;
}

/**
 * Read a localized value from a DB *_i18n JSON column.
 * `raw` is a JSON string like {"ar":"..","en":".."}. Falls back to
 * the requested lang -> English -> `fallback` -> "".
 */
export function pickI18n(raw: unknown, lang: Locale, fallback?: unknown): string {
	if (typeof raw === "string" && raw.trim().startsWith("{")) {
		try {
			const obj = JSON.parse(raw) as Record<string, string>;
			if (obj[lang]) return obj[lang];
			if (obj.en) return obj.en;
			const first = Object.values(obj)[0];
			if (first) return first;
		} catch {
			/* fall through */
		}
	}
	return String(fallback ?? "");
}

/** Build a JSON i18n object from separate fields, dropping blanks. */
export function makeI18n(values: Partial<Record<Locale, string>>): string {
	const obj: Record<string, string> = {};
	for (const l of LOCALES) {
		const v = values[l];
		if (v != null && String(v).trim() !== "") obj[l] = String(v);
	}
	return JSON.stringify(obj);
}
