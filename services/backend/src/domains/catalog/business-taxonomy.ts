import { checkRateLimit, jsonResponse } from "../../platform/http/shared";

interface CategoryRow {
	id: string;
	key: string;
	name_en: string;
	name_ar: string;
	name_fr: string;
	sort_order: number;
	version_id: number;
}

interface SubcategoryRow extends CategoryRow {
	category_id: string;
}

const SUPPORTED_LANGS = new Set(["ar", "en", "fr"]);
const SUBCATEGORY_QUERY_PARAMS = new Set(["category_id", "query", "language", "limit"]);

export async function handleBusinessTaxonomyRoutes(
	request: Request,
	env: PublicWorkerEnv,
	url: URL,
): Promise<Response | null> {
	if (request.method !== "GET") return null;
	if (
		url.pathname !== "/api/v1/catalog/business-categories"
		&& url.pathname !== "/api/v1/catalog/business-subcategories"
	) {
		return null;
	}
	if (env.BUSINESS_TAXONOMY_ENABLED !== "true") {
		return jsonResponse({ error: "feature_disabled", feature: "business_taxonomy_v2" }, 503);
	}
	const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
	if (!(await checkRateLimit(env, `business-taxonomy:ip:${ip}`, 180, 60))) {
		return jsonResponse({ error: "rate_limited" }, 429);
	}
	const requestedLanguage = (url.searchParams.get("language") ?? "en").toLowerCase();
	if (!SUPPORTED_LANGS.has(requestedLanguage)) {
		return jsonResponse({ error: "invalid_language" }, 400);
	}
	const language = requestedLanguage;

	try {
		if (url.pathname === "/api/v1/catalog/business-categories") {
			return listCategories(env, language);
		}
		return listSubcategories(env, url, language);
	} catch (error) {
		console.error(JSON.stringify({
			signal: "business_taxonomy_query_failed",
			reason: error instanceof Error ? error.name : "unknown",
		}));
		return jsonResponse({ error: "taxonomy_unavailable" }, 503);
	}
}

async function listCategories(env: PublicWorkerEnv, language: string): Promise<Response> {
	const rows = await env.orderak_db.prepare(
		`SELECT c.id,c.key,c.name_en,c.name_ar,c.name_fr,c.sort_order,c.version_id
		 FROM business_categories c
		 JOIN business_taxonomy_versions v ON v.id=c.version_id AND v.status='active'
		 WHERE c.active=1 ORDER BY c.sort_order,c.id`,
	).all<CategoryRow>();
	const categories = (rows.results ?? []).map((row) => ({
		id: row.id,
		key: row.key,
		name: localizedName(row, language),
		version: row.version_id,
	}));
	return jsonResponse({
		ok: true,
		version: categories[0]?.version ?? null,
		categories,
	});
}

async function listSubcategories(env: PublicWorkerEnv, url: URL, language: string): Promise<Response> {
	for (const key of url.searchParams.keys()) {
		if (!SUBCATEGORY_QUERY_PARAMS.has(key)) {
			return jsonResponse({ error: "unexpected_query_parameter", parameter: key }, 400);
		}
	}
	const categoryId = (url.searchParams.get("category_id") ?? "").trim();
	const query = (url.searchParams.get("query") ?? "").trim();
	const rawLimit = url.searchParams.get("limit");
	if (!/^[a-z0-9_]{2,80}$/.test(categoryId)) {
		return jsonResponse({ error: "invalid_category" }, 400);
	}
	if (query.length > 80) return jsonResponse({ error: "invalid_query" }, 400);
	const limit = rawLimit === null ? 30 : Number(rawLimit);
	if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
		return jsonResponse({ error: "invalid_limit" }, 400);
	}

	let rows: SubcategoryRow[];
	if (!query) {
		const result = await env.orderak_db.prepare(
			`SELECT s.id,s.category_id,s.key,s.name_en,s.name_ar,s.name_fr,s.sort_order,s.version_id
			 FROM business_subcategories s
			 JOIN business_taxonomy_versions v ON v.id=s.version_id AND v.status='active'
			 WHERE s.category_id=? AND s.active=1
			 ORDER BY s.sort_order,s.id LIMIT ?`,
		).bind(categoryId, limit).all<SubcategoryRow>();
		rows = result.results ?? [];
	} else {
		const match = ftsPrefix(query);
		if (!match) return jsonResponse({ ok: true, version: 1, subcategories: [] });
		const result = await env.orderak_db.prepare(
			`SELECT s.id,s.category_id,s.key,s.name_en,s.name_ar,s.name_fr,s.sort_order,s.version_id
			 FROM business_taxonomy_search f
			 JOIN business_subcategories s ON s.id=f.subcategory_id
			 JOIN business_taxonomy_versions v ON v.id=s.version_id AND v.status='active'
			 WHERE business_taxonomy_search MATCH ? AND f.category_id=? AND s.active=1
			 ORDER BY bm25(business_taxonomy_search),s.sort_order LIMIT ?`,
		).bind(match, categoryId, limit).all<SubcategoryRow>();
		rows = result.results ?? [];
	}
	const subcategories = rows.map((row) => ({
		id: row.id,
		category_id: row.category_id,
		key: row.key,
		name: localizedName(row, language),
		version: row.version_id,
	}));
	return jsonResponse({
		ok: true,
		version: subcategories[0]?.version ?? 1,
		subcategories,
	});
}

function localizedName(row: CategoryRow, language: string): string {
	if (language === "ar") return row.name_ar;
	if (language === "fr") return row.name_fr;
	return row.name_en;
}

function ftsPrefix(query: string): string {
	return query
		.split(/\s+/)
		.map((token) => token.replace(/[^\p{L}\p{N}-]/gu, ""))
		.filter(Boolean)
		.map((token) => `"${token.replaceAll('"', '""')}"*`)
		.join(" ");
}
