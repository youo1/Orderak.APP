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
});
