-- A record of what is in the media bucket, so abandoned objects can be found.
--
-- WHAT EXISTED BEFORE
--   Nothing. uploadMedia() wrote an object to R2 under
--   `stores/{store_id}/{kind}-{uuid}.{ext}` and returned its URL, and that was
--   the last the system knew about it. The only orderak_media.delete() in the
--   tree is in deletion.ts, which clears a whole store prefix when an account is
--   erased. So replacing a logo, a cover or a product photo wrote a new object
--   and abandoned the old one permanently, and an image uploaded into a form the
--   seller then abandoned was never referenced by anything at all.
--
--   Two consequences, one of them not about cost. The bucket grows
--   monotonically with ordinary use — a seller iterating on product photos is
--   the expected behaviour, not the abusive one — and nothing reports its size,
--   so the first signal is a bill. And an image a seller removed from their
--   catalogue stays fetchable at its /media/{key} URL forever, which is a
--   weaker privacy position than the retention matrix takes everywhere else.
--
-- WHY A TABLE AND NOT AN R2 LIFECYCLE RULE
--   A lifecycle rule deletes by age. It cannot tell a live product photo from a
--   superseded one, so any rule short enough to reclaim orphans would also
--   delete the logo of a store that has not changed its logo in a while.
--   Reclamation needs to know what is still referenced, and that lives in D1.
--
-- WHY THIS TABLE DOES NOT RECORD WHAT REFERENCES THE OBJECT
--   The obvious shape is a foreign key back to the row using the image, marked
--   orphaned at the moment of replacement. That shape misses the larger half of
--   the problem: an upload is a separate request from the store update or
--   product sync that later names its URL, so an object that is never attached
--   to anything has no replacement event to hook. It would also require every
--   present and future write path that touches logo_url, cover_url or image_url
--   to remember to mark the old key — exactly the kind of obligation that is
--   satisfied on the day it is written and quietly missed by the next feature.
--
--   So this table records only provenance: which store uploaded what, and when.
--   Whether an object is still referenced is answered at sweep time by asking
--   the columns that would reference it. That question has one correct answer
--   at any moment and cannot drift.
--
-- ROLLOUT SAFETY
--   Additive: one CREATE TABLE and two CREATE INDEX. The running Worker does not
--   know this table exists and is unaffected between migration and deploy.
--
--   Rows are only created from this migration forward, so objects uploaded
--   before it are invisible to the sweep until the backfill in
--   reclaimOrphanedMedia() adopts them from an R2 listing. That is deliberate:
--   an object with no row is never deleted, so the failure mode of an incomplete
--   record is a missed reclamation, never a deleted photo.

CREATE TABLE IF NOT EXISTS media_objects (
  -- The R2 object key, e.g. stores/{store_id}/product-{uuid}.jpg. Primary key
  -- because the key is the identity: R2 has exactly one object per key.
  key         TEXT PRIMARY KEY,
  -- Denormalised from the key rather than joined out of it, so the sweep's
  -- reference checks can be indexed. No foreign key to sellers: an object may
  -- outlive its store row during account deletion, and a cascade here would
  -- delete the record of objects that still need removing from the bucket.
  store_id    TEXT NOT NULL,
  -- 'logo' | 'cover' | 'product', matching ALLOWED_KINDS in media.ts. Stored so
  -- a sweep can be scoped to one kind without parsing keys.
  kind        TEXT NOT NULL,
  -- Upload time. The grace period is measured from here, so a backfilled row
  -- must carry the object's real R2 upload timestamp and not the backfill date,
  -- or adopting history would reset every orphan's clock by 30 days.
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The sweep reads oldest-first within the grace window.
CREATE INDEX IF NOT EXISTS idx_media_objects_created ON media_objects(created_at);
-- The reference checks are all scoped to one store.
CREATE INDEX IF NOT EXISTS idx_media_objects_store ON media_objects(store_id);
