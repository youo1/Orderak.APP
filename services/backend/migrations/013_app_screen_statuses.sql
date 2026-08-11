ALTER TABLE app_screens ADD COLUMN design_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE app_screens ADD COLUMN development_status TEXT NOT NULL DEFAULT 'not_started';
UPDATE app_screens SET
 design_status=CASE status WHEN 'design' THEN 'in_progress' WHEN 'in_progress' THEN 'done' WHEN 'done' THEN 'done' ELSE 'not_started' END,
 development_status=CASE status WHEN 'in_progress' THEN 'in_progress' WHEN 'done' THEN 'done' ELSE 'not_started' END;
CREATE INDEX IF NOT EXISTS idx_screens_design_status ON app_screens(design_status);
CREATE INDEX IF NOT EXISTS idx_screens_development_status ON app_screens(development_status);
