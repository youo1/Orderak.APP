import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage, pickLocale } from "../src/platform/localization/i18n";

describe("locale negotiation", () => {
	it("normalizes regional language tags", () => {
		expect(localeFromAcceptLanguage("ar-EG")).toBe("ar");
		expect(localeFromAcceptLanguage("en-GB")).toBe("en");
	});

	it("honors quality weights and skips unsupported languages", () => {
		expect(localeFromAcceptLanguage("fr;q=1, en;q=0.9, ar;q=0.8")).toBe("en");
		expect(localeFromAcceptLanguage("en;q=0.2, ar;q=0.9")).toBe("ar");
	});

	it("keeps explicit request language ahead of saved and browser preferences", () => {
		const request = new Request("https://orderak.app/?lang=en", {
			headers: { "Accept-Language": "ar-EG" },
		});
		expect(pickLocale(request, new URL(request.url), "ar")).toBe("en");
	});

	it("uses the Arabic platform default when no supported locale is requested", () => {
		const request = new Request("https://orderak.app/", {
			headers: { "Accept-Language": "de-DE, fr;q=0.8" },
		});
		expect(pickLocale(request, new URL(request.url))).toBe("ar");
	});
});
