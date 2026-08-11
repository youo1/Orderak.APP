import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore } from "./helpers";
import { hashSecret } from "../src/platform/http/shared";

beforeEach(createSchema);

describe("seller operations coverage", () => {
	it("scopes support tickets and threaded replies to the authenticated seller", async () => {
		const first = await registerStore({ phone: "+201500001001" });
		const second = await registerStore({ phone: "+201500001002" });
		const created = await SELF.fetch(`${BASE}/api/v1/support/tickets`, {
			method: "POST", headers: authHeaders(first),
			body: JSON.stringify({ subject: "Catalog issue", message: "Please help" }),
		});
		expect(created.status).toBe(201);
		const body = await created.json<{ ticket: { id: number } }>();
		const otherList = await SELF.fetch(`${BASE}/api/v1/support/tickets`, { headers: authHeaders(second) });
		expect((await otherList.json<{ tickets: unknown[] }>()).tickets).toHaveLength(0);
		const otherDetail = await SELF.fetch(`${BASE}/api/v1/support/tickets/${body.ticket.id}`, { headers: authHeaders(second) });
		expect(otherDetail.status).toBe(404);
		const reply = await SELF.fetch(`${BASE}/api/v1/support/tickets/${body.ticket.id}`, {
			method: "POST", headers: authHeaders(first), body: JSON.stringify({ message: "More details" }),
		});
		expect(reply.status).toBe(201);
	});

	it("targets announcements and records read state", async () => {
		const seller = await registerStore({ phone: "+201500001003" });
		await env.orderak_db.prepare("INSERT INTO announcements(title_i18n,body_i18n,target_plan) VALUES(?,?, 'all')")
			.bind('{"en":"Notice","ar":"تنبيه"}', '{"en":"Body","ar":"النص"}').run();
		const first = await SELF.fetch(`${BASE}/api/v1/announcements`, { headers: authHeaders(seller) });
		const item = (await first.json<{ announcements: Array<{ id: number; is_read: boolean }> }>()).announcements[0];
		expect(item.is_read).toBe(false);
		await SELF.fetch(`${BASE}/api/v1/announcements/${item.id}/read`, { method: "POST", headers: authHeaders(seller), body: "{}" });
		const second = await SELF.fetch(`${BASE}/api/v1/announcements`, { headers: authHeaders(seller) });
		expect((await second.json<{ announcements: Array<{ is_read: boolean }> }>()).announcements[0].is_read).toBe(true);
	});

	it("lets a seller author a reviewed translation and keeps another seller out", async () => {
		const seller = await registerStore({ phone: "+201500001004" });
		const other = await registerStore({ phone: "+201500001005" });
		const owner = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(seller.phone).first<{ id: string }>();
		await env.orderak_db.prepare("INSERT INTO products(id,store_id,product_code,app_id,name,description) VALUES('prod-ops',?,'OPS-CODE',1,'Coffee','Fresh')")
			.bind(owner!.id).run();
		const saved = await SELF.fetch(`${BASE}/api/v1/catalog/translations/OPS-CODE/en`, {
			method: "PUT", headers: authHeaders(seller), body: JSON.stringify({ name: "Arabic Coffee", description: "Manual" }),
		});
		expect(saved.status).toBe(200);
		const row = await env.orderak_db.prepare("SELECT translation_status,provider,reviewed_by_type FROM product_translations WHERE product_id='prod-ops' AND lang='en'").first<Record<string, unknown>>();
		expect(row).toMatchObject({ translation_status: "reviewed", provider: "seller", reviewed_by_type: "seller" });
		await env.orderak_db.prepare("UPDATE products SET name='New coffee' WHERE id='prod-ops'").run();
		const staleList = await SELF.fetch(`${BASE}/api/v1/catalog/translations?lang=en`, { headers: authHeaders(seller) });
		expect((await staleList.json<{ translations: Array<{ translation_status: string }> }>()).translations[0].translation_status).toBe("stale");
		const denied = await SELF.fetch(`${BASE}/api/v1/catalog/translations/OPS-CODE/en`, {
			method: "PUT", headers: authHeaders(other), body: JSON.stringify({ name: "Hijacked" }),
		});
		expect(denied.status).toBe(404);
	});

	it("lists and revokes an additional device without exposing the primary secret", async () => {
		const seller = await registerStore({ phone: "+201500001006" });
		const owner = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(seller.phone).first<{ id: string }>();
		await env.orderak_db.prepare("INSERT INTO seller_devices(seller_id,secret_hash,device_id,device_label) VALUES(?,?,?,?)")
			.bind(owner!.id, await hashSecret("additional-secret"), "opaque-device", "Tablet").run();
		const list = await SELF.fetch(`${BASE}/api/v1/devices`, { headers: authHeaders(seller) });
		const devices = (await list.json<{ devices: Array<{ row_id: number; device_label: string }> }>()).devices;
		const tablet = devices.find((device) => device.device_label === "Tablet");
		expect(tablet).toBeTruthy();
		const revoked = await SELF.fetch(`${BASE}/api/v1/devices/${tablet!.row_id}`, { method: "DELETE", headers: authHeaders(seller) });
		expect(revoked.status).toBe(200);
		expect(await env.orderak_db.prepare("SELECT COUNT(*) count FROM seller_devices WHERE seller_id=?").bind(owner!.id).first<{ count: number }>()).toMatchObject({ count: 0 });
		expect(await env.orderak_db.prepare("SELECT action FROM admin_audit WHERE action='device.revoked'").first()).toBeTruthy();
	});

	it("returns a stable restricted-account error while preserving status access", async () => {
		const seller = await registerStore({ phone: "+201500001007" });
		await env.orderak_db.prepare("UPDATE sellers SET status='suspended' WHERE phone=?").bind(seller.phone).run();
		const blocked = await SELF.fetch(`${BASE}/api/v1/store`, { headers: authHeaders(seller) });
		expect(blocked.status).toBe(403);
		expect(await blocked.json()).toMatchObject({ code: "account_restricted", resource_status: "suspended" });
		const status = await SELF.fetch(`${BASE}/api/v1/account/status`, { headers: authHeaders(seller) });
		expect(await status.json()).toMatchObject({ ok: true, status: "suspended" });
	});

	it("serves scheduled first-party ads and deduplicates client retries", async () => {
		const seller = await registerStore({ phone: "+201500001008" });
		await env.orderak_db.prepare("INSERT OR REPLACE INTO plans(id,name,ads_enabled) VALUES('free','Free',1)").run();
		await env.orderak_db.prepare("INSERT INTO ads(title,title_i18n,image_url,click_url,target_plan,starts_at,ends_at) VALUES('Fallback','{\"en\":\"Launch\",\"ar\":\"إطلاق\"}','https://cdn.example/ad.png','https://example.com','all',datetime('now','-1 day'),datetime('now','+1 day'))").run();
		const active = await SELF.fetch(`${BASE}/api/v1/ads/active`, { headers: { ...authHeaders(seller), "accept-language": "en" } });
		expect(active.status).toBe(200);
		const ad = (await active.json<{ ads: Array<{ id: number; title: string }> }>()).ads[0];
		expect(ad.title).toBe("Launch");
		for (let index = 0; index < 2; index++) await SELF.fetch(`${BASE}/api/v1/ads/track`, {
			method: "POST", headers: authHeaders(seller), body: JSON.stringify({ ad_id: ad.id, kind: "impression", event_key: "android:event:dedupe" }),
		});
		expect(await env.orderak_db.prepare("SELECT COUNT(*) count FROM ad_impressions WHERE event_key='android:event:dedupe'").first<{ count: number }>()).toMatchObject({ count: 1 });
		const invalid = await SELF.fetch(`${BASE}/api/v1/ads/track`, {
			method: "POST", headers: authHeaders(seller), body: JSON.stringify({ ad_id: ad.id + 999, kind: "click", event_key: "android:event:invalid" }),
		});
		expect(invalid.status).toBe(404);
		const unauthenticated = await SELF.fetch(`${BASE}/api/v1/ads/active`);
		expect(unauthenticated.status).toBe(401);
	});
});
