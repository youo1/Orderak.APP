import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createEntitlementSchema, createSchema } from "./helpers";
import { handleGooglePlayRoutes } from "../src/integrations/google-play/google-play";

/**
 * Which product mappings an environment can see.
 *
 * Staging has its own Play Console entry: the staging Android flavour applies
 * `applicationIdSuffix = ".staging"`, so a staging build is a different app to
 * Google and carries its own products. Product ids are scoped per app, so both
 * packages have an `orderak_paid1` and they are not the same product.
 *
 * `mappingForItem` binds `GOOGLE_PLAY_PACKAGE_NAME` into the lookup, so that
 * variable is the whole of the selection. The failure this guards against is
 * quiet in a specific way: a mapping set that does not match the variable is
 * invisible to the query, every purchase fails with `play_product_not_enabled`,
 * and the mappings look completely correct in a table.
 */

const PRODUCTION = "app.orderak.seller";
const STAGING = "app.orderak.seller.staging";

/** `p-1` is the paid1 plan createEntitlementSchema already seeds. */
const PLAN_ID = "p-1";

async function seedBothPackages(): Promise<void> {
	await env.orderak_db.prepare(
		`INSERT INTO play_product_mappings(id,plan_id,product_id,base_plan_id,package_name,active) VALUES
		 ('m-prod',?,'orderak_paid1','monthly',?,1),
		 ('m-stag',?,'orderak_paid1','monthly',?,1)`,
	).bind(PLAN_ID, PRODUCTION, PLAN_ID, STAGING).run();
}

/** The lookup `mappingForItem` performs, with the package it would bind. */
async function resolve(packageName: string): Promise<string | null> {
	const row = await env.orderak_db.prepare(
		`SELECT ppm.id FROM play_product_mappings ppm
		 JOIN subscription_plans sp ON sp.id = ppm.plan_id
		 WHERE ppm.product_id=? AND ppm.base_plan_id=? AND ppm.package_name=? AND ppm.active=1`,
	).bind("orderak_paid1", "monthly", packageName).first<{ id: string }>();
	return row?.id ?? null;
}

describe("play product mappings, per package", () => {
	beforeEach(async () => {
		await createSchema();
		await createEntitlementSchema();
	});

	it("lets one product id exist under both packages", async () => {
		// The old constraint was UNIQUE(product_id, base_plan_id), which permitted
		// exactly one row per product across all packages — so the staging rows
		// could not be inserted at all. Migration 054 widened it to include the
		// package, which is what the lookup had always assumed.
		await expect(seedBothPackages()).resolves.not.toThrow();

		const { results } = await env.orderak_db
			.prepare("SELECT package_name FROM play_product_mappings ORDER BY package_name")
			.all<{ package_name: string }>();
		expect((results ?? []).map((r) => r.package_name)).toEqual([PRODUCTION, STAGING]);
	});

	it("resolves each package to its own mapping", async () => {
		await seedBothPackages();
		expect(await resolve(PRODUCTION)).toBe("m-prod");
		expect(await resolve(STAGING)).toBe("m-stag");
	});

	it("resolves nothing for a package with no mappings", async () => {
		await seedBothPackages();
		// What a mismatched GOOGLE_PLAY_PACKAGE_NAME produces: no row, so
		// mappingForItem throws play_product_not_enabled and every purchase in
		// that environment fails while the table looks correct.
		expect(await resolve("app.orderak.seller.typo")).toBeNull();
	});

	it("still refuses a duplicate within one package", async () => {
		// Widening the constraint must not have removed it. Two rows for the same
		// product and base plan in one package would make the lookup's answer
		// depend on row order.
		await seedBothPackages();
		await expect(
			env.orderak_db.prepare(
				"INSERT INTO play_product_mappings(id,plan_id,product_id,base_plan_id,package_name,active) VALUES('m-dup',?,'orderak_paid1','monthly',?,1)",
			).bind(PLAN_ID, STAGING).run(),
		).rejects.toThrow();
	});

	it("offers only this environment's products in the billing catalogue", async () => {
		// /api/v1/billing/catalog selected every active mapping and did not filter
		// by package. With one package that was harmless; with two it means a
		// staging build is offered production's product ids, and Play refuses a
		// purchase for a product that does not exist in the app asking for it.
		await seedBothPackages();
		const request = new Request("https://example.com/api/v1/billing/catalog");
		const stagingEnv = {
			...(env as Record<string, unknown>),
			GOOGLE_PLAY_PACKAGE_NAME: STAGING,
			BILLING_ENABLED: "true",
		} as never;

		const response = await handleGooglePlayRoutes(request, stagingEnv, new URL(request.url));
		expect(response).not.toBeNull();
		const body = (await response!.json()) as { products: { product_id: string }[] };

		// One row, not two: the production mapping for the same product id is
		// active and must not appear.
		expect(body.products).toHaveLength(1);
	});

	it("ignores an inactive mapping even when the package matches", async () => {
		await seedBothPackages();
		await env.orderak_db.prepare("UPDATE play_product_mappings SET active=0 WHERE id='m-stag'").run();
		// Inactive is how a mapping waits for its Play Console product to be
		// confirmed to exist. It must not resolve in the meantime.
		expect(await resolve(STAGING)).toBeNull();
		expect(await resolve(PRODUCTION)).toBe("m-prod");
	});
});
