import { describe, expect, it } from "vitest";
import { parseLimitParam } from "../src/platform/http/shared";

describe("parseLimitParam", () => {
	it("falls back to the default for a missing value", () => {
		expect(parseLimitParam(null, 100, 500)).toBe(100);
	});

	it("falls back to the default for an empty value", () => {
		expect(parseLimitParam("", 20, 50)).toBe(20);
	});

	it("falls back to the default for non-numeric and NaN inputs", () => {
		expect(Number.isNaN(Number("NaN"))).toBe(true);
		for (const value of ["abc", "NaN", "12abc", "  "]) {
			expect(parseLimitParam(value, 30, 100)).toBe(30);
		}
	});

	it("falls back to the default for infinite inputs", () => {
		expect(parseLimitParam("Infinity", 100, 500)).toBe(100);
		expect(parseLimitParam("-Infinity", 100, 500)).toBe(100);
	});

	it("falls back to the default for fractional values instead of rounding", () => {
		expect(parseLimitParam("2.5", 20, 50)).toBe(20);
		expect(parseLimitParam("499.9", 100, 500)).toBe(100);
	});

	it("falls back to the default for zero and negative values", () => {
		expect(parseLimitParam("0", 30, 100)).toBe(30);
		expect(parseLimitParam("-0", 30, 100)).toBe(30);
		expect(parseLimitParam("-1", 30, 100)).toBe(30);
		expect(parseLimitParam("-250", 30, 100)).toBe(30);
	});

	it("returns a valid positive integer unchanged up to the maximum", () => {
		expect(parseLimitParam("1", 20, 50)).toBe(1);
		expect(parseLimitParam("42", 100, 500)).toBe(42);
		expect(parseLimitParam("500", 100, 500)).toBe(500);
	});

	it("caps a positive integer above the maximum", () => {
		expect(parseLimitParam("501", 100, 500)).toBe(500);
		expect(parseLimitParam("1000000", 20, 100)).toBe(100);
	});

	it("always returns an integer", () => {
		for (const value of [null, "", "x", "3.7", "-2", "0", "7", "9999"]) {
			expect(Number.isInteger(parseLimitParam(value, 20, 100))).toBe(true);
		}
	});
});
