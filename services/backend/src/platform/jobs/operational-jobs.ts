export async function runObservedJob(env: Env, jobKey: string, work: () => Promise<number | void>): Promise<void> {
	const id = crypto.randomUUID();
	try {
		await env.orderak_db.prepare(
			"INSERT INTO operational_job_runs(id,job_key,trigger_kind,status) VALUES(?,?,'scheduled','running')",
		).bind(id, jobKey).run();
	} catch {
		// Rolling deployments may execute before the additive migration lands.
	}
	try {
		const affectedCount = (await work()) ?? 0;
		try {
			await env.orderak_db.prepare(
				"UPDATE operational_job_runs SET status='succeeded',completed_at=datetime('now'),affected_count=? WHERE id=?",
			).bind(affectedCount, id).run();
		} catch { /* migration not available yet */ }
	} catch (error) {
		const message = error instanceof Error ? error.message.slice(0, 500) : "unknown";
		try {
			await env.orderak_db.prepare(
				"UPDATE operational_job_runs SET status='failed',completed_at=datetime('now'),error_message=? WHERE id=?",
			).bind(message, id).run();
		} catch { /* migration not available yet */ }
		throw error;
	}
}
