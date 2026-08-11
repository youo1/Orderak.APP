/** Admin controls may only narrow deployment configuration, never enable it. */
export async function runtimeControlEnabled(env: Env, key: string, fallback = false): Promise<boolean> {
	try {
		const row = await env.orderak_db.prepare("SELECT value_json FROM settings WHERE key=?").bind(key).first<{ value_json: string }>();
		if (!row) return fallback;
		return JSON.parse(row.value_json) === true;
	} catch {
		return fallback;
	}
}

