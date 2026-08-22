import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { createSchema } from "./helpers";
import { runRetentionCleanup } from "../src/domains/identity/retention";

beforeEach(async () => {
	await createSchema();
});

describe("privacy retention cleanup", () => {
	it("removes or de-identifies technical data older than 30 days", async () => {
		await env.orderak_db.prepare("INSERT INTO admin_users(id,email,password_hash) VALUES(1,'retention@test.local','pbkdf2\')").run();
		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO error_logs(context,ip,created_at) VALUES('old','203.0.113.1',datetime('now','-31 days'))"),
			env.orderak_db.prepare("INSERT INTO error_logs(context,ip,created_at) VALUES('new','203.0.113.2',datetime('now','-1 day'))"),
			env.orderak_db.prepare("INSERT INTO admin_audit(action,ip,created_at) VALUES('test','203.0.113.3',datetime('now','-31 days'))"),
			env.orderak_db.prepare("INSERT INTO email_template_history(template_key,lang,changed_ip,changed_at) VALUES('welcome','ar','203.0.113.4',datetime('now','-31 days'))"),
			env.orderak_db.prepare("INSERT INTO admin_sessions(id,admin_id,token_hash,expires_at,created_at) VALUES('expired',1,'hash-expired',datetime('now','-1 day'),datetime('now','-2 days'))"),
			env.orderak_db.prepare("INSERT INTO rate_limits(bucket,count,window_start) VALUES('old-ip',1,unixepoch('now')-2592001)"),
			env.orderak_db.prepare("INSERT INTO webhook_events(event_id,processed_at) VALUES('old-hook',datetime('now','-91 days'))"),
			env.orderak_db.prepare("INSERT INTO webhook_events(event_id,processed_at) VALUES('new-hook',datetime('now','-1 day'))"),
		]);

		await runRetentionCleanup(env);

		const errors = await env.orderak_db.prepare("SELECT context FROM error_logs ORDER BY context").all<{ context: string }>();
		expect(errors.results.map((row) => row.context)).toEqual(["new"]);
		expect((await env.orderak_db.prepare("SELECT ip FROM admin_audit").first<{ ip: string | null }>())?.ip).toBeNull();
		expect((await env.orderak_db.prepare("SELECT changed_ip FROM email_template_history").first<{ changed_ip: string | null }>())?.changed_ip).toBeNull();
		expect(await env.orderak_db.prepare("SELECT id FROM admin_sessions").first()).toBeNull();
		expect(await env.orderak_db.prepare("SELECT bucket FROM rate_limits WHERE bucket='old-ip'").first()).toBeNull();
		const hooks = await env.orderak_db.prepare("SELECT event_id FROM webhook_events ORDER BY event_id").all<{ event_id: string }>();
		expect(hooks.results.map((row) => row.event_id)).toEqual(["new-hook"]);
	});

	// data-map.md and retention-matrix.md §5 both state inbound mail is deleted
	// after two years. Nothing implemented that, so every body, subject and
	// sender address ever received was kept indefinitely.
	it("deletes inbound support mail after two years", async () => {
		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO inbound_emails(to_addr,from_addr,subject,text_body,received_at) VALUES('support@orderak.app','old@example.com','Old','body',datetime('now','-2 years','-1 day'))"),
			env.orderak_db.prepare("INSERT INTO inbound_emails(to_addr,from_addr,subject,text_body,received_at) VALUES('support@orderak.app','recent@example.com','Recent','body',datetime('now','-30 days'))"),
		]);

		await runRetentionCleanup(env);

		const remaining = await env.orderak_db.prepare("SELECT from_addr FROM inbound_emails").all<{ from_addr: string }>();
		expect(remaining.results.map((row) => row.from_addr)).toEqual(["recent@example.com"]);
	});

	// An acceptance recorded before registration completed is claimed by
	// api-store.ts once an account exists. One that is still unclaimed after 90
	// days belongs to a signup that never happened, and was previously kept —
	// with its phone number — forever, because the deletion path only ever
	// matched rows that had a seller_id.
	it("de-identifies consent records that never became an account", async () => {
		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO legal_acceptances(id,seller_id,phone_e164,terms_version,privacy_version,locale,source,accepted_at) VALUES('orphan-old',NULL,'+201000000001',1,1,'ar','android_phone_auth',datetime('now','-91 days'))"),
			env.orderak_db.prepare("INSERT INTO legal_acceptances(id,seller_id,phone_e164,terms_version,privacy_version,locale,source,accepted_at) VALUES('orphan-recent',NULL,'+201000000002',1,1,'ar','android_phone_auth',datetime('now','-10 days'))"),
			env.orderak_db.prepare("INSERT INTO legal_acceptances(id,seller_id,phone_e164,terms_version,privacy_version,locale,source,accepted_at) VALUES('claimed-old','store-1','+201000000003',1,1,'ar','android_phone_auth',datetime('now','-400 days'))"),
		]);

		await runRetentionCleanup(env);

		const rows = await env.orderak_db.prepare("SELECT id,phone_e164 FROM legal_acceptances ORDER BY id").all<{ id: string; phone_e164: string }>();
		expect(rows.results).toEqual([
			// Linked to an account: kept as consent evidence for that account's lifetime.
			{ id: "claimed-old", phone_e164: "+201000000003" },
			{ id: "orphan-old", phone_e164: "expired:orphan-old" },
			{ id: "orphan-recent", phone_e164: "+201000000002" },
		]);

		// Idempotent: a second pass must not re-stamp an already-expired row.
		await runRetentionCleanup(env);
		expect((await env.orderak_db.prepare("SELECT phone_e164 FROM legal_acceptances WHERE id='orphan-old'").first<{ phone_e164: string }>())?.phone_e164)
			.toBe("expired:orphan-old");
	});

	it("expires deletion requests that were never verified", async () => {
		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO deletion_requests(id,phone_e164,email,locale,source,status,deadline_at,requested_at) VALUES('stale','+201000000004','a@example.com','ar','public_web','pending',datetime('now','-90 days'),datetime('now','-181 days'))"),
			env.orderak_db.prepare("INSERT INTO deletion_requests(id,phone_e164,email,locale,source,status,deadline_at,requested_at) VALUES('live','+201000000005','b@example.com','ar','public_web','pending',datetime('now','+60 days'),datetime('now','-30 days'))"),
			env.orderak_db.prepare("INSERT INTO deletion_requests(id,phone_e164,email,locale,source,status,deadline_at,requested_at) VALUES('verified','+201000000006','c@example.com','ar','public_web','verified',datetime('now','-30 days'),datetime('now','-200 days'))"),
		]);

		await runRetentionCleanup(env);

		const rows = await env.orderak_db.prepare("SELECT id,phone_e164,email,status FROM deletion_requests ORDER BY id").all<{ id: string; phone_e164: string; email: string | null; status: string }>();
		expect(rows.results).toEqual([
			{ id: "live", phone_e164: "+201000000005", email: "b@example.com", status: "pending" },
			{ id: "stale", phone_e164: "expired:stale", email: null, status: "rejected" },
			// A verified request is still actionable however old it is, and is
			// de-identified by the deletion job rather than by this one.
			{ id: "verified", phone_e164: "+201000000006", email: "c@example.com", status: "verified" },
		]);
	});
});
