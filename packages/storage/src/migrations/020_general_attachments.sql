ALTER TABLE attachments DROP CONSTRAINT attachments_declared_type_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_declared_type_check CHECK(declared_type IN ('image/png','image/jpeg','text/plain','application/octet-stream'));
ALTER TABLE attachments DROP CONSTRAINT attachments_expected_size_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_expected_size_check CHECK(expected_size>0 AND expected_size<=10485760);
ALTER TABLE attachments ADD CONSTRAINT attachments_normalized_size_check CHECK(size IS NULL OR (size>0 AND size<=10485760));
