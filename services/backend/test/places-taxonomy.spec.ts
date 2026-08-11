import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { sha256Hex } from "../src/domains/identity/auth";
import { handleBusinessTaxonomyRoutes } from "../src/domains/catalog/business-taxonomy";
import { handleGeoRoutes } from "../src/domains/catalog/geo";
import { BASE, createSchema } from "./helpers";

const ONBOARDING_TOKEN = "cities-onboarding-token-with-entropy";
let testEnv: TestEnv;

beforeEach(async () => {
	await createSchema();
	testEnv = Object.create(env) as TestEnv;
	testEnv.STATIC_CITY_CATALOG_ENABLED = "true";
	testEnv.BUSINESS_TAXONOMY_ENABLED = "true";
	await env.orderak_db.prepare(
		`INSERT INTO onboarding_sessions(
		   id,token_hash,phone_e164,firebase_uid,device_secret_hash,phone_country_iso,
		   locale,status,expires_at,absolute_expires_at
		 ) VALUES(
		   'onboarding-cities',?,'+201001234567','firebase-cities','secret-hash','EG',
		   'en','account_saved',datetime('now','+30 minutes'),datetime('now','+24 hours')
		 )`,
	).bind(await sha256Hex(ONBOARDING_TOKEN)).run();
});

describe("static city catalogue selection", () => {
	it("opens with popular cities from the verified phone country", async () => {
		const request = new Request(
			`${BASE}/api/v1/geo/cities?country=FR&language=en`,
			{
				headers: {
					authorization: `Bearer ${ONBOARDING_TOKEN}`,
					"cf-connecting-ip": "203.0.113.7",
				},
			},
		);
		const response = await handleGeoRoutes(request, testEnv, new URL(request.url));
		expect(response?.status).toBe(200);
		expect(await response?.json()).toMatchObject({
			ok: true,
			cities: [
				{ city_id: 1, name: "Cairo", country_iso: "EG" },
				{ city_id: 2, name: "Alexandria", country_iso: "EG" },
			],
			attribution: {
				name: "Countries States Cities Database",
				license: "ODbL-1.0",
			},
		});
	});

	it("searches native Arabic names and stores the verified selection", async () => {
		const searchRequest = new Request(
			`${BASE}/api/v1/geo/cities?input=${encodeURIComponent("القاه")}&language=ar`,
			{ headers: { authorization: `Bearer ${ONBOARDING_TOKEN}` } },
		);
		const search = await handleGeoRoutes(searchRequest, testEnv, new URL(searchRequest.url));
		expect(search?.status).toBe(200);
		expect(await search?.json()).toMatchObject({
			ok: true,
			cities: [{ city_id: 1, name: "القاهرة", canonical_name: "Cairo" }],
		});

		const selectRequest = new Request(`${BASE}/api/v1/geo/cities/select`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${ONBOARDING_TOKEN}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ city_id: 1, language: "ar" }),
		});
		const selected = await handleGeoRoutes(selectRequest, testEnv, new URL(selectRequest.url));
		expect(selected?.status).toBe(200);
		expect(await selected?.json()).toMatchObject({
			ok: true,
			city: { city_id: 1, name: "القاهرة", country_iso: "EG" },
		});
		const saved = await env.orderak_db.prepare(
			`SELECT city_catalog_id,city_catalog_version,city_name
			 FROM onboarding_sessions WHERE id='onboarding-cities'`,
		).first<{
			city_catalog_id: number;
			city_catalog_version: string;
			city_name: string;
		}>();
		expect(saved).toEqual({
			city_catalog_id: 1,
			city_catalog_version: "test-v1",
			city_name: "القاهرة",
		});
	});

	it("rejects a city outside the verified phone country", async () => {
		const request = new Request(`${BASE}/api/v1/geo/cities/select`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${ONBOARDING_TOKEN}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ city_id: 3, language: "fr" }),
		});
		const response = await handleGeoRoutes(request, testEnv, new URL(request.url));
		expect(response?.status).toBe(400);
		expect(await response?.json()).toMatchObject({ code: "invalid_city" });
	});

	it("requires a valid onboarding session", async () => {
		const request = new Request(`${BASE}/api/v1/geo/cities?input=Cai&language=en`);
		const response = await handleGeoRoutes(request, testEnv, new URL(request.url));
		expect(response?.status).toBe(401);
		expect(await response?.json()).toMatchObject({ code: "onboarding_auth" });
	});
});

describe("Global business taxonomy", () => {
	it("returns localized categories and subcategories without location inputs", async () => {
		const categoriesRequest = new Request(
			`${BASE}/api/v1/catalog/business-categories?language=ar&country=FR&city=Paris`,
			{ headers: { "cf-connecting-ip": "203.0.113.8" } },
		);
		const categories = await handleBusinessTaxonomyRoutes(
			categoriesRequest,
			testEnv,
			new URL(categoriesRequest.url),
		);
		expect(await categories?.json()).toMatchObject({
			ok: true,
			version: 1,
			categories: [{ id: "fashion" }],
		});

		const subcategoriesRequest = new Request(
			`${BASE}/api/v1/catalog/business-subcategories?category_id=fashion&query=cloth&language=en`,
			{ headers: { "cf-connecting-ip": "203.0.113.8" } },
		);
		const subcategories = await handleBusinessTaxonomyRoutes(
			subcategoriesRequest,
			testEnv,
			new URL(subcategoriesRequest.url),
		);
		expect(await subcategories?.json()).toMatchObject({
			ok: true,
			subcategories: [{
				id: "fashion_clothing",
				category_id: "fashion",
				name: "Clothing Store",
			}],
		});
	});

	it("rejects subcategory query values outside the published contract", async () => {
		const cases = [
			["", "invalid_category"],
			["category_id=INVALID", "invalid_category"],
			["category_id=fashion&language=de", "invalid_language"],
			[`category_id=fashion&query=${"q".repeat(81)}`, "invalid_query"],
			["category_id=fashion&limit=0", "invalid_limit"],
			["category_id=fashion&limit=1.5", "invalid_limit"],
			["category_id=fashion&limit=51", "invalid_limit"],
			["category_id=fashion&x-schemathesis-unknown-property=42", "unexpected_query_parameter"],
		] as const;

		for (const [query, expectedError] of cases) {
			const separator = query ? `?${query}` : "";
			const request = new Request(
				`${BASE}/api/v1/catalog/business-subcategories${separator}`,
				{ headers: { "cf-connecting-ip": "203.0.113.9" } },
			);
			const response = await handleBusinessTaxonomyRoutes(
				request,
				testEnv,
				new URL(request.url),
			);
			expect(response?.status, query).toBe(400);
			expect(await response?.json(), query).toMatchObject({ code: expectedError });
		}
	});
});
