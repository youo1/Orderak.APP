import { describe, expect, it } from "vitest";
import * as shared from "../src/platform/http/shared";

type ParseLimit = (value: string | null, defaultValue: number, maxValue: number) => number;

function helper(): ParseLimit {
	const fn = (shared as unknown as { parseLimitParam?: ParseLimit }).parseLimitParam;
	expect(typeof fn).toBe("function");
	return fn as ParseLimit;
}

describe("parseLimitParam (acceptance)", () => {
	it("falls back to the default for missing, empty, non-numeric, NaN and infinite values", () => {
		const parse = helper();
		for (const value of [null, "", "abc", "NaN", "Infinity", "-Infinity", "12abc"]) {
			expect(parse(value, 100, 500)).toBe(100);
		}
	});

	it("falls back to the default for fractional, zero and negative values", () => {
		const parse = helper();
		for (const value of ["2.5", "0.5", "499.9", "0", "-0", "-1", "-250"]) {
			expect(parse(value, 30, 100)).toBe(30);
		}
	});

	it("returns a valid positive integer unchanged up to and including the maximum", () => {
		const parse = helper();
		expect(parse("1", 20, 50)).toBe(1);
		expect(parse("42", 100, 500)).toBe(42);
		expect(parse("50", 20, 50)).toBe(50);
		expect(parse("500", 100, 500)).toBe(500);
	});

	it("caps positive integers above the maximum", () => {
		const parse = helper();
		expect(parse("501", 100, 500)).toBe(500);
		expect(parse("201", 100, 200)).toBe(200);
		expect(parse("1000000", 20, 100)).toBe(100);
	});

	it("always returns an integer", () => {
		const parse = helper();
		for (const value of [null, "", "x", "3.7", "-2", "0", "7", "9999"]) {
			expect(Number.isInteger(parse(value, 20, 100))).toBe(true);
		}
	});
});
