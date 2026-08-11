/** Daily privacy-retention cleanup. D1 is authoritative for these records. */

const RETENTION_BATCH_SIZE = 1_000;
const MAX_BATCHES_PER_RULE = 10;

type CleanupRule = { label: string; statement: string };

const CLEANUP_RULES: CleanupRule[] = [
	{ label: "error_logs:30d", statement: "DELETE FROM error_logs WHERE rowid IN (SELECT rowid FROM error_logs WHERE created_at < datetime('now','-30 days') LIMIT ?)" },
	{ label: "admin_audit:ip30d", statement: "UPDATE admin_audit SET ip=NULL WHERE rowid IN (SELECT rowid FROM admin_audit WHERE ip IS NOT NULL AND created_at < datetime('now','-30 days') LIMIT ?)" },
	{ label: "email_template_history:ip30d", statement: "UPDATE email_template_history SET changed_ip=NULL WHERE rowid IN (SELECT rowid FROM email_template_history WHERE changed_ip IS NOT NULL AND changed_at < datetime('now','-30 days') LIMIT ?)" },
	{ label: "admin_sessions:30d", statement: "DELETE FROM admin_sessions WHERE rowid IN (SELECT rowid FROM admin_sessions WHERE expires_at < datetime('now') OR created_at < datetime('now','-30 days') LIMIT ?)" },
	{ label: "rate_limits:30d", statement: "DELETE FROM rate_limits WHERE rowid IN (SELECT rowid FROM rate_limits WHERE window_start < unixepoch('now') - 2592000 LIMIT ?)" },
	{ label: "onboarding_sessions:expired30d", statement: "DELETE FROM onboarding_sessions WHERE rowid IN (SELECT rowid FROM onboarding_sessions WHERE absolute_expires_at < datetime('now','-30 days') LIMIT ?)" },
	{ label: "webauthn_challenges:expired1d", statement: "DELETE FROM webauthn_challenges WHERE rowid IN (SELECT rowid FROM webauthn_challenges WHERE expires_at < datetime('now','-1 day') LIMIT ?)" },
	{ label: "recent_auth_proofs:expired1d", statement: "DELETE FROM recent_auth_proofs WHERE rowid IN (SELECT rowid FROM recent_auth_proofs WHERE expires_at < datetime('now','-1 day') LIMIT ?)" },
	{ label: "admin_auth_challenges:expired1d", statement: "DELETE FROM admin_auth_challenges WHERE rowid IN (SELECT rowid FROM admin_auth_challenges WHERE expires_at < datetime('now','-1 day') OR consumed_at < datetime('now','-1 day') LIMIT ?)" },
	{ label: "email_verification_tokens:expired30d", statement: "DELETE FROM email_verification_tokens WHERE rowid IN (SELECT rowid FROM email_verification_tokens WHERE expires_at < datetime('now','-30 days') OR used_at < datetime('now','-30 days') LIMIT ?)" },
	{ label: "webhook_events:90d", statement: "DELETE FROM webhook_events WHERE rowid IN (SELECT rowid FROM webhook_events WHERE processed_at < datetime('now','-90 days') LIMIT ?)" },
	{ label: "email_events:90d", statement: "DELETE FROM email_events WHERE rowid IN (SELECT rowid FROM email_events WHERE created_at < datetime('now','-90 days') LIMIT ?)" },
	{ label: "outbound_email_jobs:90d", statement: "DELETE FROM outbound_email_jobs WHERE rowid IN (SELECT rowid FROM outbound_email_jobs WHERE status IN ('sent','failed') AND updated_at < datetime('now','-90 days') LIMIT ?)" },
	{ label: "ad_impressions:90d", statement: "DELETE FROM ad_impressions WHERE rowid IN (SELECT rowid FROM ad_impressions WHERE created_at < datetime('now','-90 days') LIMIT ?)" },
	{ label: "announcements:90d_post_expiry", statement: "DELETE FROM announcements WHERE rowid IN (SELECT rowid FROM announcements WHERE ends_at IS NOT NULL AND ends_at < datetime('now','-90 days') LIMIT ?)" },
	{ label: "admin_audit:2y", statement: "DELETE FROM admin_audit WHERE rowid IN (SELECT rowid FROM admin_audit WHERE created_at < datetime('now','-2 years') LIMIT ?)" },
];

export async function runRetentionCleanup(env: Env): Promise<number> {
	let total = 0;
	const counts: Record<string, number> = {};
	try {
		for (const rule of CLEANUP_RULES) {
			let affectedForRule = 0;
			for (let batch = 0; batch < MAX_BATCHES_PER_RULE; batch++) {
				const result = await env.orderak_db.prepare(rule.statement).bind(RETENTION_BATCH_SIZE).run();
				const affected = Number(result.meta.rows_written ?? 0);
				affectedForRule += affected;
				if (affected < RETENTION_BATCH_SIZE) break;
			}
			counts[rule.label] = affectedForRule;
			total += affectedForRule;
		}
		console.log(JSON.stringify({ signal: "retention_cleanup_completed", affected_total: total, counts }));
		return total;
	} catch (error) {
		console.error(JSON.stringify({ signal: "retention_cleanup_failed", message: error instanceof Error ? error.message : "unknown" }));
		throw error;
	}
}
