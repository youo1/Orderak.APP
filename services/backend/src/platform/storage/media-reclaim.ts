// ============================================================
// Reclaim media objects that nothing references any more.
//
// The bucket had no delete path except account deletion (deletion.ts), so
// replacing a logo, a cover or a product photo abandoned the previous object
// permanently, and an image uploaded into a form the seller then abandoned was
// never referenced at all. See migration 055 for why this is a table and a
// sweep rather than an R2 lifecycle rule.
//
// THE SAFETY PROPERTY THIS FILE IS BUILT AROUND
//   The failure mode of getting reclamation wrong is deleting a seller's live
//   product photos, which is unrecoverable and visible to their buyers. So every
//   decision here is biased toward missing an orphan rather than removing a
//   reference:
//
//     * an object with no media_objects row is never deleted, only adopted;
//     * an object is only a candidate once it is older than GRACE_DAYS, so
//       nothing in the middle of an upload-then-attach flow is ever eligible;
//     * the reference check asks every column that can name a media URL, and
//       includes `ads` even though ads are admin-authored and cannot currently
//       produce a key under stores/, because the cost of asking is one NOT
//       EXISTS and the cost of being wrong is a deleted image;
//     * deletion is off until MEDIA_RECLAIM_ENABLED is "true". Until then the
//       job reports what it would have removed and removes nothing.
//
//   That last point follows the same pattern as BILLING_ENABLED and
//   ENTITLEMENTS_ENABLED: a subsystem that has never run gets watched on
//   staging before it is allowed to act.
// ============================================================

import { D1_IN_CHUNK } from "../http/shared";

/** How long an object must have existed before it can be considered orphaned. */
const GRACE_DAYS = 30;
/** Rows examined per run. Bounds the D1 read and the total R2 work. */
const SWEEP_LIMIT = 500;
/** Objects adopted from the bucket per run, when backfilling history. */
const ADOPT_LIMIT = 1_000;

/**
 * Adopt objects that exist in the bucket but have no provenance row.
 *
 * Everything uploaded before migration 055 is in this state, and so is anything
 * whose best-effort INSERT in uploadMedia() failed. Without this, the historical
 * leak — which is the larger part of the problem — would never be reclaimable.
 *
 * `created_at` is the object's real R2 upload time, not now(). Using now() would
 * silently restart the grace period for every object in the bucket, so the first
 * sweep after adoption would find nothing and the one after it would find
 * everything thirty days later.
 */
async function adoptUntrackedObjects(env: PublicWorkerEnv): Promise<number> {
	let cursor: string | undefined;
	let adopted = 0;
	let scanned = 0;
	while (scanned < ADOPT_LIMIT) {
		const page = await env.orderak_media.list({ prefix: "stores/", cursor, limit: 200 });
		if (page.objects.length === 0) break;
		scanned += page.objects.length;
		const rows = page.objects
			.map((object) => {
				// stores/{store_id}/{kind}-{uuid}.{ext} — anything else is not ours
				// to adopt, and guessing its store would be worse than skipping it.
				const match = /^stores\/([^/]+)\/(logo|cover|product)-/.exec(object.key);
				return match ? { key: object.key, storeId: match[1], kind: match[2], uploaded: object.uploaded } : null;
			})
			.filter((row): row is { key: string; storeId: string; kind: string; uploaded: Date } => row !== null);
		if (rows.length) {
			await env.orderak_db.batch(rows.map((row) => env.orderak_db.prepare(
				"INSERT OR IGNORE INTO media_objects(key,store_id,kind,created_at) VALUES(?,?,?,?)",
			).bind(row.key, row.storeId, row.kind, row.uploaded.toISOString().replace("T", " ").slice(0, 19))));
			adopted += rows.length;
		}
		if (!page.truncated) break;
		cursor = page.cursor;
	}
	return adopted;
}

/**
 * Keys past the grace period that no column names.
 *
 * One query rather than a per-key lookup: the reference check is the expensive
 * part and running it 500 times would make the sweep the heaviest thing on the
 * nightly cron.
 *
 * Compares the stored URL's path after `/media/` against the key, rather than
 * rebuilding the URL and comparing for equality. The stored value is a full URL
 * built from PUBLIC_SITE_URL at the time it was written, and that origin differs
 * between staging and production and has already changed once — so reconstructing
 * it would treat every row written under the old origin as an orphan and delete a
 * live image. Taking the suffix is origin-independent.
 *
 * Not `LIKE '%' || m.key`, which is the obvious way to write that and does not
 * work: SQLite rejects a LIKE whose pattern is an expression built per row with
 * "LIKE or GLOB pattern too complex". substr/instr is exact anyway — LIKE would
 * also have matched a key that merely ends with another key's name.
 *
 * `instr()` returns 0 when the needle is absent, so the `> 0` guard is what keeps
 * a URL that is not a media URL at all from being compared as though it were.
 */
async function findOrphanedKeys(env: PublicWorkerEnv): Promise<{ key: string; store_id: string }[]> {
	const { results } = await env.orderak_db.prepare(
		`SELECT m.key, m.store_id FROM media_objects m
		 WHERE m.created_at < datetime('now', ?)
		   AND NOT EXISTS (
		     SELECT 1 FROM sellers s WHERE s.id = m.store_id AND (
		       (instr(s.logo_url,'/media/')  > 0 AND substr(s.logo_url,  instr(s.logo_url,'/media/')  + 7) = m.key)
		       OR (instr(s.cover_url,'/media/') > 0 AND substr(s.cover_url, instr(s.cover_url,'/media/') + 7) = m.key)
		     )
		   )
		   AND NOT EXISTS (
		     SELECT 1 FROM products p WHERE p.store_id = m.store_id
		       AND instr(p.image_url,'/media/') > 0
		       AND substr(p.image_url, instr(p.image_url,'/media/') + 7) = m.key
		   )
		   AND NOT EXISTS (
		     SELECT 1 FROM ads a WHERE
		       (instr(a.image_url,'/media/') > 0 AND substr(a.image_url, instr(a.image_url,'/media/') + 7) = m.key)
		       OR (instr(COALESCE(a.image_url_i18n,''),'/media/') > 0
		           AND instr(COALESCE(a.image_url_i18n,''), m.key) > 0)
		   )
		 ORDER BY m.created_at
		 LIMIT ?`,
	).bind(`-${GRACE_DAYS} days`, SWEEP_LIMIT).all<{ key: string; store_id: string }>();
	return results ?? [];
}

/**
 * Delete unreferenced media, or report what would be deleted.
 *
 * Returns the number of objects removed — zero while the flag is off, which is
 * what operational_job_runs.affected_count will show for a dry run.
 */
export async function reclaimOrphanedMedia(env: PublicWorkerEnv): Promise<number> {
	const adopted = await adoptUntrackedObjects(env);
	const orphans = await findOrphanedKeys(env);

	if (env.MEDIA_RECLAIM_ENABLED !== "true") {
		// Deliberately console.log, not console.error: a dry run is the expected
		// steady state until the flag is flipped, and routing it to the error
		// stream would train everyone to ignore it.
		console.log(JSON.stringify({
			signal: "media_reclaim_dry_run",
			adopted,
			would_delete: orphans.length,
			// A sample, not the list: at SWEEP_LIMIT this would otherwise emit 500
			// keys into every nightly log line.
			sample: orphans.slice(0, 5).map((row) => row.key),
		}));
		return 0;
	}

	if (orphans.length === 0) {
		console.log(JSON.stringify({ signal: "media_reclaim_completed", adopted, deleted: 0 }));
		return 0;
	}

	const keys = orphans.map((row) => row.key);
	// Chunked, because D1 caps a statement at 100 bound parameters.
	//
	// This bound one `key IN (...)` per sweep, so the first batch that actually
	// reached SWEEP_LIMIT threw `too many SQL variables` — after the R2 delete
	// below had already destroyed the objects. The rows survived, stayed past the
	// grace window, and the same batch was re-selected every night: the R2 delete
	// became a no-op and D1 threw again, permanently. api-store.ts:1314 chunks
	// the identical pattern at 90; this is the same number for the same reason.
	//
	// Deleting per chunk rather than all of R2 up front also bounds what a
	// mid-sweep failure can strand: at most one chunk's objects are gone with
	// their rows still present, and those rows simply re-select next run and find
	// nothing to delete. R2 stays first within a chunk — the other order drops
	// the record of an object still in the bucket, which is how an orphan becomes
	// permanently unreachable.
	for (let offset = 0; offset < keys.length; offset += D1_IN_CHUNK) {
		const chunk = keys.slice(offset, offset + D1_IN_CHUNK);
		await env.orderak_media.delete(chunk);
		await env.orderak_db.prepare(
			`DELETE FROM media_objects WHERE key IN (${chunk.map(() => "?").join(",")})`,
		).bind(...chunk).run();
	}

	console.log(JSON.stringify({ signal: "media_reclaim_completed", adopted, deleted: keys.length }));
	return keys.length;
}
