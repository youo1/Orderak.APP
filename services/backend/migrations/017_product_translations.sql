-- Cached AI translations for customer-facing product content.
-- The seller-authored products row remains the source of truth. Matching the
-- source fields prevents an old translation being shown after an edit.
CREATE TABLE IF NOT EXISTS product_translations (
  product_id          TEXT NOT NULL,
  lang                TEXT NOT NULL CHECK (lang IN ('ar', 'en')),
  name                TEXT NOT NULL,
  description         TEXT,
  source_name         TEXT NOT NULL,
  source_description  TEXT NOT NULL DEFAULT '',
  detected_language   TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (product_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_product_translations_lang
  ON product_translations(lang, product_id);
