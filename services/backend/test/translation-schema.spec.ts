import { beforeEach, describe, expect, it } from "vitest";
import { createSchema, env } from "./helpers";

beforeEach(async () => {
	await createSchema();
});

describe("product translation lifecycle schema", () => {
	it("stores source provenance, lifecycle, and review metadata", async () => {
		const { results } = await env.orderak_db
			.prepare("PRAGMA table_info(product_translations)")
			.all<{ name: string }>();
		const columns = new Set((results ?? []).map((column) => column.name));

		for (const expected of [
			"source_locale",
			"source_version",
			"translation_status",
			"provider",
			"model",
			"reviewed_at",
		]) {
			expect(columns.has(expected), `missing ${expected}`).toBe(true);
		}
	});
});
