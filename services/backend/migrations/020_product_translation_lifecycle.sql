-- Add provenance and review lifecycle metadata without rewriting the original
-- migration, which may already be applied in production.
ALTER TABLE product_translations ADD COLUMN source_locale TEXT NOT NULL DEFAULT 'und';
ALTER TABLE product_translations ADD COLUMN source_version TEXT NOT NULL DEFAULT '';
ALTER TABLE product_translations ADD COLUMN translation_status TEXT NOT NULL DEFAULT 'machine'
  CHECK (translation_status IN ('pending', 'machine', 'reviewed', 'rejected'));
ALTER TABLE product_translations ADD COLUMN provider TEXT;
ALTER TABLE product_translations ADD COLUMN model TEXT;
ALTER TABLE product_translations ADD COLUMN reviewed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_product_translations_status
  ON product_translations(translation_status, lang);
