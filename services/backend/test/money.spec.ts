import { describe, expect, it } from "vitest";
import {
	MoneySchema,
	addMoney,
	exponentOf,
	formatMoney,
	money,
	parseMoney,
	percentOf,
} from "../src/platform/money/money";

describe("exponentOf", () => {
	it("reads 2 for the currencies whose minor unit is a hundredth", () => {
		expect(exponentOf("EGP")).toBe(2);
		expect(exponentOf("SAR")).toBe(2);
		expect(exponentOf("AED")).toBe(2);
		expect(exponentOf("QAR")).toBe(2);
	});

	// The reason ADR-009 exists. A hardcoded /100 is not off by a rounding
	// error in these three markets, it is off by a factor of ten.
	it("reads 3 for the Gulf currencies whose minor unit is a thousandth", () => {
		expect(exponentOf("KWD")).toBe(3);
		expect(exponentOf("BHD")).toBe(3);
		expect(exponentOf("OMR")).toBe(3);
	});
});

describe("formatMoney", () => {
	it("reads the same minor amount as a different major amount per currency", () => {
		expect(formatMoney(money(15000, "EGP"), "en-US")).toContain("150.00");
		expect(formatMoney(money(15000, "KWD"), "en-US")).toContain("15.000");
	});

	it("follows the locale for digits and the currency for decimals", () => {
		const arabic = formatMoney(money(15000, "EGP"), "ar-EG");
		expect(arabic).toMatch(/[٠-٩]/);
	});
});

describe("parseMoney", () => {
	it("scales by the currency's own exponent", () => {
		expect(parseMoney("150", "EGP")).toEqual({ amount_minor: 15000, currency: "EGP" });
		expect(parseMoney("150", "KWD")).toEqual({ amount_minor: 150000, currency: "KWD" });
	});

	// Money.kt carries this same fix. Re-introducing truncation on the server
	// would be a regression against a defect the Android side already found.
	it("rounds rather than truncates", () => {
		expect(parseMoney("4.35", "EGP")?.amount_minor).toBe(435);
		expect(parseMoney("4.3555", "KWD")?.amount_minor).toBe(4356);
	});

	it("accepts Arabic decimal separators and thousands grouping", () => {
		expect(parseMoney("1,500.50", "EGP")?.amount_minor).toBe(150050);
		expect(parseMoney("150٫5", "EGP")?.amount_minor).toBe(15050);
	});

	it("returns null rather than zero for unparseable input", () => {
		expect(parseMoney("", "EGP")).toBeNull();
		expect(parseMoney("abc", "EGP")).toBeNull();
		expect(parseMoney("1.2.3", "EGP")).toBeNull();
	});
});

describe("money", () => {
	it("refuses a fractional minor amount instead of truncating it", () => {
		expect(() => money(10.5, "EGP")).toThrow(/integer/);
	});
});

describe("addMoney", () => {
	it("adds within a currency", () => {
		expect(addMoney(money(100, "EGP"), money(250, "EGP")).amount_minor).toBe(350);
	});

	it("refuses to mix currencies rather than returning a wrong total", () => {
		expect(() => addMoney(money(100, "EGP"), money(100, "KWD"))).toThrow(/Cannot add/);
	});
});

describe("percentOf", () => {
	it("rounds half away from zero in both directions", () => {
		expect(percentOf(money(101, "EGP"), 50).amount_minor).toBe(51);
		expect(percentOf(money(-101, "EGP"), 50).amount_minor).toBe(-51);
	});

	it("keeps the currency", () => {
		expect(percentOf(money(1000, "KWD"), 10).currency).toBe("KWD");
	});
});

describe("MoneySchema", () => {
	it("accepts a well-formed pair", () => {
		expect(MoneySchema.parse({ amount_minor: 15000, currency: "EGP" }))
			.toEqual({ amount_minor: 15000, currency: "EGP" });
	});

	it("rejects a bare number, which is the shape ADR-009 removes", () => {
		expect(MoneySchema.safeParse(15000).success).toBe(false);
	});

	it("rejects an amount that is not an integer count of minor units", () => {
		expect(MoneySchema.safeParse({ amount_minor: 150.5, currency: "EGP" }).success).toBe(false);
	});

	it("rejects a currency outside ISO 4217 support", () => {
		expect(MoneySchema.safeParse({ amount_minor: 1, currency: "XYZ" }).success).toBe(false);
	});
});
