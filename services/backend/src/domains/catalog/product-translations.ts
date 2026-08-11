type ProductSource = { id: string; name: string; description: string };
type Translation = { id: string; detected_language?: string; ar: { name: string; description?: string }; en: { name: string; description?: string } };

import { callDeepSeek, deepSeekEnabled } from "../../integrations/ai/deepseek";

const MODEL = "deepseek-chat";

/**
 * Refresh Arabic and English cached translations after product sync.
 * If AI is unavailable, public pages safely keep showing seller-authored text.
 */
export async function refreshProductTranslations(env: Env, storeId: string): Promise<void> {
	if (!await deepSeekEnabled(env)) return;
	const organizationId = (await env.orderak_db.prepare(
		"SELECT organization_id FROM organization_stores WHERE store_id=?",
	).bind(storeId).first<{ organization_id: string }>())?.organization_id ?? null;
	const { results } = await env.orderak_db.prepare(
		`SELECT p.id, p.name, COALESCE(p.description, '') AS description
		 FROM products p
		 WHERE p.store_id = ? AND (NOT EXISTS (
		   SELECT 1 FROM product_translations pt
		   WHERE pt.product_id = p.id AND pt.lang = 'en'
		     AND pt.source_name = p.name
		     AND pt.source_description = COALESCE(p.description, '')
		 ) OR NOT EXISTS (
		   SELECT 1 FROM product_translations pt
		   WHERE pt.product_id = p.id AND pt.lang = 'ar'
		     AND pt.source_name = p.name
		     AND pt.source_description = COALESCE(p.description, '')
		 ))`,
	).bind(storeId).all<ProductSource>();

	const products = results ?? [];
	for (let i = 0; i < products.length; i += 4) {
		const batch = products.slice(i, i + 4);
		try {
			const versionParts = await Promise.all(batch.map(sourceVersion));
			const translated = await translateBatch(env, organizationId, `translation:${versionParts.join(":")}`, batch);
			const byId = new Map(batch.map((p) => [p.id, p]));
			const sourceVersions = new Map(
				await Promise.all(batch.map(async (p) => [p.id, await sourceVersion(p)] as const)),
			);
			const statements: D1PreparedStatement[] = [];
			for (const item of translated) {
				const source = byId.get(item.id);
				if (!source) continue;
				for (const lang of ["ar", "en"] as const) {
					const value = item[lang];
					if (!value?.name?.trim()) continue;
					statements.push(env.orderak_db.prepare(
						`INSERT INTO product_translations
						 (product_id, lang, name, description, source_name, source_description,
						  detected_language, source_locale, source_version, translation_status,
						  provider, model, reviewed_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'machine', 'deepseek', ?, NULL, datetime('now'))
						 ON CONFLICT(product_id, lang) DO UPDATE SET
						 name=excluded.name, description=excluded.description,
						 source_name=excluded.source_name, source_description=excluded.source_description,
						 detected_language=excluded.detected_language, source_locale=excluded.source_locale,
						 source_version=excluded.source_version, translation_status='machine',
						 provider=excluded.provider, model=excluded.model, reviewed_at=NULL,
						 updated_at=datetime('now')`,
					).bind(source.id, lang, value.name.trim().slice(0, 120), (value.description ?? "").trim().slice(0, 700) || null,
						source.name, source.description, item.detected_language ?? null,
						item.detected_language ?? "und", sourceVersions.get(source.id) ?? "", MODEL));
				}
			}
			if (statements.length) await env.orderak_db.batch(statements);
		} catch {
			console.error(JSON.stringify({ signal: "translation_provider_failure", provider: "deepseek", fallback: "seller_authored" }));
		}
	}
}

async function sourceVersion(source: ProductSource): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify([source.name, source.description]));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function translateBatch(
	env: Env,
	organizationId: string | null,
	idempotencyKey: string,
	products: ProductSource[],
): Promise<Translation[]> {
	const result = await callDeepSeek(env, {
		organizationId,
		idempotencyKey,
		model: MODEL,
		responseFormat: { type: "json_object" },
		messages: [
			{ role: "system", content: "Translate ecommerce product content into Arabic and English. Detect the source language. Preserve brand names, model numbers, sizes, measurements, prices and emoji exactly. Return valid JSON only as {\"products\":[{\"id\":\"...\",\"detected_language\":\"...\",\"ar\":{\"name\":\"...\",\"description\":\"...\"},\"en\":{\"name\":\"...\",\"description\":\"...\"}}]}. Never add facts." },
			{ role: "user", content: JSON.stringify({ products }) },
		],
	});
	const parsed = JSON.parse(result.content) as { products?: Translation[] };
	return Array.isArray(parsed.products) ? parsed.products : [];
}
