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
	// Consent records that never became an account.
	//
	// legal_acceptances is evidence for an account: retention-matrix.md §2 sets
	// it at "account lifetime + 5 years" and it is de-identified, never deleted,
	// when that account is. A row whose signup was abandoned has no account and
	// therefore no lifetime to measure — so it was measured against nothing and
	// kept its phone number permanently, with no path to remove it. api-store.ts
	// claims these rows (`seller_id IS NULL` -> the new seller) the moment
	// registration completes, so anything still unclaimed after 90 days is a
	// signup that did not happen.
	//
	// De-identified rather than deleted, to stay consistent with how the table
	// is treated everywhere else. The consequence is deliberate: someone who
	// returns after 90 days is asked to accept the current terms again, which is
	// the correct outcome — their recorded acceptance was of a version that may
	// no longer be published.
	{ label: "legal_acceptances:orphan90d", statement: "UPDATE legal_acceptances SET phone_e164='expired:'||id WHERE rowid IN (SELECT rowid FROM legal_acceptances WHERE seller_id IS NULL AND phone_e164 NOT LIKE 'expired:%' AND phone_e164 NOT LIKE 'deleted:%' AND accepted_at < datetime('now','-90 days') LIMIT ?)" },
	// Deletion requests that were never verified.
	//
	// A completed request is de-identified by deletion.ts and kept permanently as
	// compliance evidence (§2). One that was submitted through the public web
	// form and never verified proves nothing, and holds a phone number and an
	// email address while doing so. 180 days is twice the 90-day fulfilment
	// deadline, so nothing still actionable is ever reached.
	//
	// 'rejected' rather than a new 'expired' state: deletion_requests carries
	// CHECK (status IN ('pending','verified','completed','rejected')), and an
	// unverified request that timed out is exactly a request that was not
	// granted. Adding a state would mean a migration and a fifth value for every
	// reader to handle, to say something the existing vocabulary already says.
	{ label: "deletion_requests:unverified180d", statement: "UPDATE deletion_requests SET phone_e164='expired:'||id,email=NULL,status='rejected' WHERE rowid IN (SELECT rowid FROM deletion_requests WHERE status='pending' AND requested_at < datetime('now','-180 days') LIMIT ?)" },
	// Inbound support mail.
	//
	// retention-matrix.md §5 and data-map.md both state "Deleted 2 years after
	// received_at". Nothing implemented that, so every message body, subject and
	// sender address ever received was retained indefinitely — the largest
	// single store of third-party personal data in D1, held against a written
	// commitment that it was not.
	{ label: "inbound_emails:2y", statement: "DELETE FROM inbound_emails WHERE rowid IN (SELECT rowid FROM inbound_emails WHERE received_at < datetime('now','-2 years') LIMIT ?)" },
	{ label: "webhook_events:90d", statement: "DELETE FROM webhook_events WHERE rowid IN (SELECT rowid FROM webhook_events WHERE processed_at < datetime('now','-90 days') LIMIT ?)" },
	{ label: "email_events:90d", statement: "DELETE FROM email_events WHERE rowid IN (SELECT rowid FROM email_events WHERE created_at < datetime('now','-90 days') LIMIT ?)" },
	{ label: "outbound_email_jobs:90d", statement: "DELETE FROM outbound_email_jobs WHERE rowid IN (SELECT rowid FROM outbound_email_jobs WHERE status IN ('sent','failed') AND updated_at < datetime('now','-90 days') LIMIT ?)" },
	{ label: "ad_impressions:90d", statement: "DELETE FROM ad_impressions WHERE rowid IN (SELECT rowid FROM ad_impressions WHERE created_at < datetime('now','-90 days') LIMIT ?)" },
	{ label: "announcements:90d_post_expiry", statement: "DELETE FROM announcements WHERE rowid IN (SELECT rowid FROM announcements WHERE ends_at IS NOT NULL AND ends_at < datetime('now','-90 days') LIMIT ?)" },
	{ label: "admin_audit:2y", statement: "DELETE FROM admin_audit WHERE rowid IN (SELECT rowid FROM admin_audit WHERE created_at < datetime('now','-2 years') LIMIT ?)" },
];

/**
 * Tables this job must never touch, and why.
 *
 * Every rule above is age-based deletion, so a table is safe here only for as
 * long as nobody adds a rule for it. That is exemption by omission, and it is
 * not the same thing as a decision — the next person adding a rule has no way
 * to tell "we chose not to" from "we did not think of it".
 *
 * `stock_movements` is the ledger behind work item 06. It is financial state:
 * the balance it carries is what makes today's `products.stock` explainable,
 * and reconciliation subtracts from an opening balance that only exists as a
 * row in it. Deleting old rows would not trim history, it would make every
 * later balance unverifiable — which is precisely why the ledger was built
 * instead of reusing `admin_audit`, whose own rows this job deletes after two
 * years (see the rule directly above).
 *
 * Named rather than merely absent so the accompanying test can assert it, and
 * so a future rule that reaches this table fails a test instead of a seller.
 */
export const RETENTION_EXEMPT_TABLES = ["stock_movements"] as const;

/** Every table any cleanup rule names. Exported so the exemption is testable. */
export function retentionRuleTables(): string[] {
	const named = new Set<string>();
	for (const rule of CLEANUP_RULES) {
		for (const match of rule.statement.matchAll(/(?:DELETE\s+FROM|UPDATE)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
			named.add(match[1].toLowerCase());
		}
	}
	return [...named].sort();
}

export async function runRetentionCleanup(env: Env): Promise<number> {
	let total = 0;
	const counts: Record<string, number> = {};
	try {
		for (const rule of CLEANUP_RULES) {
			let affectedForRule = 0;
			for (let batch = 0; batch < MAX_BATCHES_PER_RULE; batch++) {
				const result = await env.orderak_db.prepare(rule.statement).bind(RETENTION_BATCH_SIZE).run();
				// `changes` is D1's count of rows affected by the statement, which is
				// what "did this batch fill up?" is asking. `rows_written` is a billing
				// metric that also counts index writes, so a single row touching three
				// indexes reports as more than one row and the loop runs batches that
				// have nothing left to do. Kept as the fallback because it is the field
				// this code has always read and it is never absent.
				const affected = Number(result.meta.changes ?? result.meta.rows_written ?? 0);
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
