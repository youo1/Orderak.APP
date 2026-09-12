// Media objects are reclaimable once nothing references them.
//
// The bucket previously had no delete path except account deletion, so every
// replaced logo, cover and product photo stayed in R2 forever and stayed
// fetchable at its /media/ URL. These tests cover the sweep that fixes that,
// and most of them exist to pin the half that must NOT happen: a live image
// must never be deleted, whichever column happens to reference it.
import { beforeEach, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { createSchema, registerStore, authHeaders, type Registered } from "./helpers";
import { reclaimOrphanedMedia } from "../src/platform/storage/media-reclaim";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function testEnv(overrides: Record<string, unknown> = {}) {
	return { ...(env as unknown as Record<string, unknown>), ...overrides } as never;
}

async function upload(r: Registered, kind = "product"): Promise<string> {
	const form = new FormData();
	form.append("file", new File([PNG], "p.png", { type: "image/png" }), "p.png");
	form.append("kind", kind);
	// authHeaders() sets a JSON content-type, which would clobber the multipart
	// boundary; credentials only.
	const { "content-type": _ignored, ...credentials } = authHeaders(r);
	const res = await SELF.fetch("https://api.orderak.app/api/v1/media/upload", {
		method: "POST", headers: credentials, body: form,
	});
	expect(res.status).toBe(200);
	return (await res.json<{ key: string }>()).key;
}

/** Move a provenance row outside the grace window so the sweep can see it. */
async function age(key: string, days = 40): Promise<void> {
	await env.orderak_db.prepare(
		"UPDATE media_objects SET created_at=datetime('now',?) WHERE key=?",
	).bind(`-${days} days`, key).run();
}

async function trackedKeys(): Promise<string[]> {
	const { results } = await env.orderak_db.prepare("SELECT key FROM media_objects ORDER BY key").all<{ key: string }>();
	return (results ?? []).map((row) => row.key);
}

beforeEach(async () => {
	await createSchema();
});

describe("media provenance", () => {
	it("records an uploaded object so it can be found later", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		const key = await upload(r, "logo");

		const row = await env.orderak_db.prepare("SELECT store_id,kind FROM media_objects WHERE key=?")
			.bind(key).first<{ store_id: string; kind: string }>();
		expect(row).toBeTruthy();
		expect(row!.kind).toBe("logo");
		expect(key.startsWith(`stores/${row!.store_id}/logo-`)).toBe(true);
	});
});

describe("media reclamation", () => {
	it("reports orphans without deleting while the flag is off", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		const key = await upload(r);
		await age(key);

		// Default posture: MEDIA_RECLAIM_ENABLED is "false" in both environments
		// until a dry run has been read, so the sweep must act on nothing.
		const deleted = await reclaimOrphanedMedia(testEnv());
		expect(deleted).toBe(0);
		expect(await env.orderak_media.get(key)).not.toBeNull();
		expect(await trackedKeys()).toContain(key);
	});

	it("deletes an unreferenced object once enabled", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		const key = await upload(r);
		await age(key);

		const deleted = await reclaimOrphanedMedia(testEnv({ MEDIA_RECLAIM_ENABLED: "true" }));
		expect(deleted).toBe(1);
		expect(await env.orderak_media.get(key)).toBeNull();
		expect(await trackedKeys()).not.toContain(key);
	});

	it("never deletes an object inside the grace window", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		const key = await upload(r);
		// Not aged: an upload whose store update or product sync has not arrived
		// yet looks exactly like an orphan, and is the most common state of all.

		expect(await reclaimOrphanedMedia(testEnv({ MEDIA_RECLAIM_ENABLED: "true" }))).toBe(0);
		expect(await env.orderak_media.get(key)).not.toBeNull();
	});

	it("never deletes an object a store still uses as its logo or cover", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		const logo = await upload(r, "logo");
		const cover = await upload(r, "cover");
		await age(logo);
		await age(cover);
		await env.orderak_db.prepare(
			"UPDATE sellers SET logo_url=?, cover_url=? WHERE public_identifier=?",
		).bind(
			`https://orderak.app/media/${logo}`,
			`https://orderak.app/media/${cover}`,
			r.public_identifier,
		).run();

		expect(await reclaimOrphanedMedia(testEnv({ MEDIA_RECLAIM_ENABLED: "true" }))).toBe(0);
		expect(await env.orderak_media.get(logo)).not.toBeNull();
		expect(await env.orderak_media.get(cover)).not.toBeNull();
	});

	it("never deletes an object a product still uses", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		const key = await upload(r);
		await age(key);
		await SELF.fetch("https://api.orderak.app/api/v1/products/sync", {
			method: "POST",
			headers: authHeaders(r),
			body: JSON.stringify({
				products: [{
					app_id: 1, name: "Cola", price: { amount_minor: 1500, currency: "EGP" },
					stock: 10, available: true, image_url: `https://orderak.app/media/${key}`,
				}],
			}),
		});

		expect(await reclaimOrphanedMedia(testEnv({ MEDIA_RECLAIM_ENABLED: "true" }))).toBe(0);
		expect(await env.orderak_media.get(key)).not.toBeNull();
	});

	it("matches a reference written under a different origin", async () => {
		// PUBLIC_SITE_URL differs between staging and production and has already
		// changed once, so a reference check that rebuilt the URL would treat
		// every row written under the old origin as an orphan and delete it.
		const r = await registerStore({ store_name: "Fresh Market" });
		const key = await upload(r, "logo");
		await age(key);
		await env.orderak_db.prepare("UPDATE sellers SET logo_url=? WHERE public_identifier=?")
			.bind(`https://staging.orderak.app/media/${key}`, r.public_identifier).run();

		expect(await reclaimOrphanedMedia(testEnv({ MEDIA_RECLAIM_ENABLED: "true" }))).toBe(0);
		expect(await env.orderak_media.get(key)).not.toBeNull();
	});

	it("adopts an object that predates provenance tracking, then reclaims it", async () => {
		// Everything uploaded before migration 055 has no row. Without adoption
		// the historical leak — the larger part of the problem — stays unreachable.
		const r = await registerStore({ store_name: "Fresh Market" });
		const storeId = (await env.orderak_db.prepare("SELECT id FROM sellers WHERE public_identifier=?")
			.bind(r.public_identifier).first<{ id: string }>())!.id;
		const key = `stores/${storeId}/product-legacy0001.png`;
		await env.orderak_media.put(key, PNG, { httpMetadata: { contentType: "image/png" } });
		expect(await trackedKeys()).not.toContain(key);

		// First pass adopts it. Its created_at is the object's real upload time,
		// which in this test is now — so the grace window still protects it.
		expect(await reclaimOrphanedMedia(testEnv({ MEDIA_RECLAIM_ENABLED: "true" }))).toBe(0);
		expect(await trackedKeys()).toContain(key);
		expect(await env.orderak_media.get(key)).not.toBeNull();

		// Once it is genuinely old, the same sweep removes it.
		await age(key);
		expect(await reclaimOrphanedMedia(testEnv({ MEDIA_RECLAIM_ENABLED: "true" }))).toBe(1);
		expect(await env.orderak_media.get(key)).toBeNull();
	});

	it("ignores bucket objects that are not store media", async () => {
		await env.orderak_media.put("exports/not-store-media.csv", "a,b\n");
		await reclaimOrphanedMedia(testEnv({ MEDIA_RECLAIM_ENABLED: "true" }));
		expect(await trackedKeys()).not.toContain("exports/not-store-media.csv");
		expect(await env.orderak_media.get("exports/not-store-media.csv")).not.toBeNull();
	});
});
