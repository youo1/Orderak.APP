CREATE TABLE IF NOT EXISTS content_page_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, lang TEXT NOT NULL,
  version INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL DEFAULT '',
  notes TEXT, status TEXT NOT NULL DEFAULT 'draft', created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), published_at TEXT,
  UNIQUE(slug,lang,version)
);
CREATE INDEX IF NOT EXISTS idx_content_versions_lookup ON content_page_versions(slug,lang,status,version DESC);
INSERT OR IGNORE INTO content_page_versions (slug,lang,version,title,body_html,notes,status,created_by,created_at,published_at)
SELECT slug,lang,1,COALESCE(title,''),COALESCE(body_html,''),notes,
  CASE WHEN active=1 THEN 'published' ELSE 'draft' END,updated_by,
  COALESCE(updated_at,datetime('now')),
  CASE WHEN active=1 THEN COALESCE(updated_at,datetime('now')) ELSE NULL END
FROM content_pages;
