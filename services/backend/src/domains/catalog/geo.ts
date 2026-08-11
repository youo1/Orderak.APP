import { requireOnboardingGeoContext } from "../identity/auth-v2";
import { checkRateLimit, jsonResponse } from "../../platform/http/shared";
import { measured } from "../../platform/observability/measurement";

interface CityRow {
	source_city_id: number;
	version: string;
	name: string;
	native_name: string | null;
	state_name: string | null;
	country_iso: string;
	population: number;
}

const SUPPORTED_LANGS = new Set(["ar", "en", "fr"]);
const ARABIC_TEXT = /[\u0600-\u06ff]/;

export async function handleGeoRoutes(
	request: Request,
	env: PublicWorkerEnv,
	url: URL,
): Promise<Response | null> {
	if (url.pathname === "/api/v1/geo/cities" && request.method === "GET") {
		return searchCities(request, env, url);
	}
	if (url.pathname === "/api/v1/geo/cities/select" && request.method === "POST") {
		return selectCity(request, env);
	}
	return null;
}

async function searchCities(request: Request, env: PublicWorkerEnv, url: URL): Promise<Response> {
	if (env.STATIC_CITY_CATALOG_ENABLED !== "true") {
		return jsonResponse({ error: "feature_disabled", feature: "static_city_catalog" }, 503);
	}
	const context = await requireOnboardingGeoContext(request, env);
	if (context instanceof Response) return context;
	if (context.status === "completed") return jsonResponse({ error: "onboarding_complete" }, 409);

	const requestedLanguage = (
		url.searchParams.get("language") ?? url.searchParams.get("lang") ?? "en"
	).toLowerCase();
	const language = SUPPORTED_LANGS.has(requestedLanguage) ? requestedLanguage : "en";
	const query = (
		url.searchParams.get("input") ?? url.searchParams.get("q") ?? ""
	).trim().replace(/\s+/g, " ").slice(0, 80);
	const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
	const [sessionAllowed, ipAllowed] = await Promise.all([
		checkRateLimit(env, `city-catalog:onboarding:${context.id}`, 60, 60),
		checkRateLimit(env, `city-catalog:ip:${ip}`, 180, 60),
	]);
	if (!sessionAllowed || !ipAllowed) return jsonResponse({ error: "rate_limited" }, 429);

	try {
		const geo = env.orderak_geo.withSession("first-unconstrained");
		// Measured because this is the read the replication decision is about:
		// city lookup is the highest-volume D1 read on the public surface, and
		// measurement.ts existed to inform that call while nothing recorded a
		// single database timing.
		const { result: rows } = await measured("db", query ? "geo_search" : "geo_popular", () =>
			query
				? searchByText(geo as unknown as D1Database, context.countryIso, query)
				: popularCities(geo as unknown as D1Database, context.countryIso));
		return jsonResponse({
			ok: true,
			cities: rows.map((row) => cityResponse(row, language)),
			attribution: cityAttribution(),
		});
	} catch (error) {
		console.error(JSON.stringify({
			signal: "static_city_catalog_search_failed",
			reason: safeError(error),
		}));
		return jsonResponse(
			{ error: "city_catalog_unavailable", manual_entry_allowed: true },
			503,
			{ "retry-after": "30" },
		);
	}
}

async function selectCity(request: Request, env: PublicWorkerEnv): Promise<Response> {
	if (env.STATIC_CITY_CATALOG_ENABLED !== "true") {
		return jsonResponse({ error: "feature_disabled", feature: "static_city_catalog" }, 503);
	}
	const context = await requireOnboardingGeoContext(request, env);
	if (context instanceof Response) return context;
	if (context.status === "completed") return jsonResponse({ error: "onboarding_complete" }, 409);
	if (!(await checkRateLimit(env, `city-catalog:select:${context.id}`, 20, 60))) {
		return jsonResponse({ error: "rate_limited" }, 429);
	}

	const body = await readObject(request);
	const cityId = positiveInteger(body.city_id);
	const requestedLanguage = text(body.language, 5).toLowerCase();
	const language = SUPPORTED_LANGS.has(requestedLanguage) ? requestedLanguage : "en";
	if (cityId == null) return jsonResponse({ error: "invalid_city" }, 400);

	try {
		const city = await env.orderak_geo.withSession("first-unconstrained").prepare(
			`SELECT c.source_city_id,c.version,c.name,c.native_name,c.state_name,
			        c.country_iso,c.population
			 FROM city_catalog c
			 JOIN city_catalog_versions v ON v.version=c.version AND v.active=1
			 WHERE c.source_city_id=? AND c.country_iso=?
			 LIMIT 1`,
		).bind(cityId, context.countryIso).first<CityRow>();
		if (!city) return jsonResponse({ error: "invalid_city" }, 400);
		const selected = cityResponse(city, language);
		await env.orderak_db.prepare(
			`UPDATE onboarding_sessions
			 SET city_catalog_id=?,city_catalog_version=?,city_name=?,updated_at=datetime('now')
			 WHERE id=? AND status IN ('phone_verified','account_saved')`,
		).bind(city.source_city_id, city.version, selected.name, context.id).run();
		return jsonResponse({ ok: true, city: selected, attribution: cityAttribution() });
	} catch (error) {
		console.error(JSON.stringify({
			signal: "static_city_catalog_select_failed",
			reason: safeError(error),
		}));
		return jsonResponse(
			{ error: "city_catalog_unavailable", manual_entry_allowed: true },
			503,
			{ "retry-after": "30" },
		);
	}
}

async function popularCities(database: D1Database, countryIso: string): Promise<CityRow[]> {
	const rows = await database.prepare(
		`SELECT c.source_city_id,c.version,c.name,c.native_name,c.state_name,
		        c.country_iso,c.population
		 FROM city_catalog c
		 JOIN city_catalog_versions v ON v.version=c.version AND v.active=1
		 WHERE c.country_iso=?
		 ORDER BY c.population DESC,c.name
		 LIMIT 10`,
	).bind(countryIso).all<CityRow>();
	return rows.results ?? [];
}

async function searchByText(
	database: D1Database,
	countryIso: string,
	query: string,
): Promise<CityRow[]> {
	const match = query
		.split(/\s+/)
		.map((token) => token.replace(/[^\p{L}\p{N}-]/gu, ""))
		.filter(Boolean)
		.map((token) => `"${token.replaceAll('"', '""')}"*`)
		.join(" ");
	if (!match) return [];
	const rows = await database.prepare(
		`SELECT c.source_city_id,c.version,c.name,c.native_name,c.state_name,
		        c.country_iso,c.population
		 FROM city_catalog_search s
		 JOIN city_catalog_versions v ON v.version=s.version AND v.active=1
		 JOIN city_catalog c
		   ON c.version=s.version AND c.source_city_id=CAST(s.source_city_id AS INTEGER)
		 WHERE city_catalog_search MATCH ? AND s.country_iso=?
		 ORDER BY bm25(city_catalog_search),c.population DESC,c.name
		 LIMIT 10`,
	).bind(match, countryIso).all<CityRow>();
	return rows.results ?? [];
}

function cityResponse(row: CityRow, language: string) {
	const nativeName = row.native_name?.trim() || null;
	const localizedName =
		language === "ar" && nativeName && ARABIC_TEXT.test(nativeName)
			? nativeName
			: row.name;
	return {
		city_id: row.source_city_id,
		name: localizedName,
		canonical_name: row.name,
		native_name: nativeName,
		state_name: row.state_name,
		country_iso: row.country_iso,
	};
}

function cityAttribution() {
	return {
		name: "Countries States Cities Database",
		url: "https://github.com/dr5hn/countries-states-cities-database",
		license: "ODbL-1.0",
		license_url: "https://opendatacommons.org/licenses/odbl/1-0/",
	};
}

function positiveInteger(value: unknown): number | null {
	const parsed = typeof value === "number"
		? value
		: typeof value === "string" && /^\d+$/.test(value)
			? Number(value)
			: Number.NaN;
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function text(value: unknown, max: number): string {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
	try {
		const value: unknown = await request.json();
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? value as Record<string, unknown>
			: {};
	} catch {
		return {};
	}
}

function safeError(error: unknown): string {
	return error instanceof Error ? error.name : "unknown";
}
