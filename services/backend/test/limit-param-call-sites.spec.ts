import { describe, expect, it } from "vitest";
import adminSource from "../src/domains/admin/admin.ts?raw";
import operationsSource from "../src/domains/admin/admin-operations.ts?raw";
import controlPlaneSource from "../src/domains/admin/admin-control-plane.ts?raw";
import themeSource from "../src/domains/admin/admin-theme.ts?raw";
import emailAdminSource from "../src/integrations/email/adminRoutes.ts?raw";

// Every `parseLimitParam(<value>, <default>, <max>)` call, as "default/max" pairs.
function helperCalls(source: string): string[] {
	const pairs: string[] = [];
	const pattern = /parseLimitParam\s*\([^;]*?,\s*(\d+)\s*,\s*(\d+)\s*,?\s*\)/g;
	for (const match of source.matchAll(pattern)) pairs.push(`${match[1]}/${match[2]}`);
	return pairs.sort();
}

// Query `limit` reads that are converted by hand rather than through the helper.
function handParsedQueryLimits(source: string): string[] {
	return source.match(/Number\s*\([^;]*searchParams\.get\(\s*["']limit["']\s*\)/g) ?? [];
}

const FILES: Array<{ name: string; source: string; expected: string[] }> = [
	{ name: "admin.ts", source: adminSource, expected: ["100/500", "100/500", "100/500"] },
	{ name: "admin-operations.ts", source: operationsSource, expected: ["100/200", "100/500"] },
	{ name: "admin-control-plane.ts", source: controlPlaneSource, expected: ["20/100", "30/100"] },
	{ name: "admin-theme.ts", source: themeSource, expected: ["20/50"] },
	{ name: "integrations/email/adminRoutes.ts", source: emailAdminSource, expected: ["100/500", "100/500"] },
];

describe("admin limit query parsers use the shared helper", () => {
	for (const file of FILES) {
		it(`${file.name} imports parseLimitParam from platform/http/shared`, () => {
			expect(file.source).toMatch(/import\s*\{[^}]*\bparseLimitParam\b[^}]*\}\s*from\s*["'][./]*[^"']*platform\/http\/shared(\.ts)?["']/);
		});

		it(`${file.name} passes each endpoint's existing default and maximum`, () => {
			expect(helperCalls(file.source)).toEqual([...file.expected].sort());
		});

		it(`${file.name} no longer hand-parses the limit query parameter`, () => {
			expect(handParsedQueryLimits(file.source)).toEqual([]);
			expect(file.source).not.toMatch(/function\s+parseLimit/);
		});
	}

	it("covers exactly eight query parser locations", () => {
		const total = FILES.reduce((sum, file) => sum + helperCalls(file.source).length, 0);
		expect(total).toBe(10);
	});
});
