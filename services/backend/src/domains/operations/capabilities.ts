/** Runtime store capability lookup. Latest unexpired active override wins. */
export async function storeCapabilityEnabled(env: Env, storeId: string, capabilityKey: string, fallback = true): Promise<boolean> {
	const row = await env.orderak_db.prepare(
		`SELECT enabled FROM store_capability_overrides WHERE store_id=? AND capability_key=? AND revoked_at IS NULL
		 AND (expires_at IS NULL OR expires_at>datetime('now')) ORDER BY created_at DESC LIMIT 1`,
	).bind(storeId, capabilityKey).first<{ enabled: number }>();
	return row ? row.enabled === 1 : fallback;
}
