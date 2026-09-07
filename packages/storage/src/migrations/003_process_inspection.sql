ALTER TABLE sessions ADD COLUMN process_inspection jsonb NOT NULL DEFAULT '{"status":"unavailable","generation":0,"processes":[]}';
