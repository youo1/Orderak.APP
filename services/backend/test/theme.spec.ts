import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, mergeTheme } from "../src/domains/design/theme";

describe("theme override accessibility", () => {
	it("rejects unreadable primary — white text on white fails", () => {
		const theme = mergeTheme({ primary: "#FFFFFF" });
		expect(theme.primary).toBe(DEFAULT_THEME.primary);
	});

	it("rejects unreadable danger — white text on white fails", () => {
		const theme = mergeTheme({ danger: "#FFFFFF" });
		expect(theme.danger).toBe(DEFAULT_THEME.danger);
	});

	it("rejects unreadable ink/canvas/surface — white ink on white canvas fails", () => {
		const theme = mergeTheme({
			ink: "#FFFFFF",
			canvas: "#FFFFFF",
			surface: "#FFFFFF",
		});
		expect(theme.ink).toBe(DEFAULT_THEME.ink);
		expect(theme.canvas).toBe(DEFAULT_THEME.canvas);
		expect(theme.surface).toBe(DEFAULT_THEME.surface);
	});

	it("rejects unreadable muted — white muted on white canvas fails", () => {
		const theme = mergeTheme({ muted: "#FFFFFF" });
		expect(theme.muted).toBe(DEFAULT_THEME.muted);
	});

	it("rejects unreadable warning — white warning on white fails", () => {
		const theme = mergeTheme({ warning: "#FFFFFF" });
		expect(theme.warning).toBe(DEFAULT_THEME.warning);
	});

	it("keeps valid overrides for interaction colors", () => {
		expect(mergeTheme({ primary: "#005A30" }).primary).toBe("#005A30");
		expect(mergeTheme({ danger: "#B03028" }).danger).toBe("#B03028");
	});

	it("keeps valid ink on valid canvas", () => {
		const theme = mergeTheme({ ink: "#1A1A1A", canvas: "#F0F0F0" });
		expect(theme.ink).toBe("#1A1A1A");
		expect(theme.canvas).toBe("#F0F0F0");
	});
});