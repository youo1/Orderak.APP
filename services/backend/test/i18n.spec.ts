import { describe, expect, it } from "vitest";
import { LOCALES, localeFromAcceptLanguage, pickLocale, t } from "../src/platform/localization/i18n";

describe("locale negotiation", () => {
	it("normalizes regional language tags", () => {
		expect(localeFromAcceptLanguage("ar-EG")).toBe("ar");
		expect(localeFromAcceptLanguage("en-GB")).toBe("en");
	});

	it("honors quality weights and skips unsupported languages", () => {
		// French is supported as of 2026-09-12, so it wins its own weight rather
		// than being skipped. The app has shipped it as a selectable UI language
		// throughout; this module was the one place that had never heard of it,
		// which is why a French seller was answered in Arabic.
		expect(localeFromAcceptLanguage("fr;q=1, en;q=0.9, ar;q=0.8")).toBe("fr");
		expect(localeFromAcceptLanguage("en;q=0.2, ar;q=0.9")).toBe("ar");
		// Still skipped: a language with no dictionary.
		expect(localeFromAcceptLanguage("de;q=1, en;q=0.9")).toBe("en");
		expect(localeFromAcceptLanguage("de-DE, es;q=0.8")).toBeNull();
	});

	it("negotiates French from the tag the Android app actually sends", () => {
		// AppLocales.currentTag() emits a bare "fr"; the picker also offers
		// regional variants through the system locale list.
		expect(localeFromAcceptLanguage("fr")).toBe("fr");
		expect(localeFromAcceptLanguage("fr-MA")).toBe("fr");
		const request = new Request("https://orderak.app/", { headers: { "Accept-Language": "fr" } });
		expect(pickLocale(request, new URL(request.url))).toBe("fr");
	});

	it("keeps explicit request language ahead of saved and browser preferences", () => {
		const request = new Request("https://orderak.app/?lang=en", {
			headers: { "Accept-Language": "ar-EG" },
		});
		expect(pickLocale(request, new URL(request.url), "ar")).toBe("en");
	});

	it("uses the Arabic platform default when no supported locale is requested", () => {
		const request = new Request("https://orderak.app/", {
			headers: { "Accept-Language": "de-DE, es;q=0.8" },
		});
		expect(pickLocale(request, new URL(request.url))).toBe("ar");
	});

	it("answers every supported locale from its own dictionary", () => {
		// The set the app offers and the set this module can answer in have to be
		// the same set. They were not: AppLocales.supported listed three and
		// LOCALES held two, so one whole language silently resolved to another.
		for (const locale of LOCALES) {
			expect(t(locale, "errors.not_found")).not.toBe("errors.not_found");
		}
		expect(LOCALES).toEqual(["ar", "en", "fr"]);
	});
});
