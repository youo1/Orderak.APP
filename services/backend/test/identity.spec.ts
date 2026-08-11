import { describe, it, expect } from "vitest";
import {
	slugify,
	transliterate,
	buildPublicIdentifier,
	newStoreCode,
	newResourceCode,
	normalizeCountryIso,
	countryIsoFromPhone,
	cleanSlug,
} from "../src/domains/identity/identity";

const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;

describe("slugify + transliteration", () => {
	it("slugifies Latin names", () => {
		expect(slugify("Fresh Market")).toBe("fresh-market");
		expect(slugify("  Spaced  Out  ")).toBe("spaced-out");
	});

	it("folds accented Latin (French)", () => {
		expect(slugify("Café Crème")).toBe("cafe-creme");
		expect(transliterate("Éléphant")).toBe("Elephant");
	});

	it("transliterates Arabic instead of dropping it", () => {
		// Arabic script omits short vowels, so the slug is consonant-based but stable.
		expect(slugify("متجر أحمد")).toBe("mtjr-ahmd");
		expect(slugify("محل")).toBe("mhl");
	});

	it("rejects reserved / too-short slugs", () => {
		expect(cleanSlug("api")).toBe("");
		expect(cleanSlug("ab")).toBe("");
		expect(cleanSlug("Fresh Market")).toBe("fresh-market");
	});
});

describe("codes", () => {
	it("mints 8-char store codes from the unambiguous alphabet", () => {
		for (let i = 0; i < 50; i++) {
			const c = newStoreCode();
			expect(c).toHaveLength(8);
			expect(c).toMatch(CODE);
		}
	});

	it("mints prefixed resource codes", () => {
		expect(newResourceCode("c")).toMatch(/^c-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
		expect(newResourceCode("p")).toMatch(/^p-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
	});
});

describe("public identifier + country", () => {
	it("composes <ISO2>-<slug>-<CODE>", () => {
		expect(buildPublicIdentifier("eg", "Fresh Market", "7kx9mp4r")).toBe("EG-fresh-market-7KX9MP4R");
		expect(buildPublicIdentifier("", "", "abc12345")).toBe("XX-store-ABC12345");
	});

	it("normalizes ISO codes", () => {
		expect(normalizeCountryIso("eg")).toBe("EG");
		expect(normalizeCountryIso("Sa")).toBe("SA");
		expect(normalizeCountryIso("egypt")).toBe("XX");
		expect(normalizeCountryIso(null)).toBe("XX");
	});

	it("derives ISO from phone prefix", () => {
		expect(countryIsoFromPhone("+201234567890")).toBe("EG");
		expect(countryIsoFromPhone("+966500000000")).toBe("SA");
		expect(countryIsoFromPhone("+9990000")).toBe("XX");
	});
});
