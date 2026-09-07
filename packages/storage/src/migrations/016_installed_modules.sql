-- Restored module rows remain history, never execution or old control authority.
ALTER TABLE file_operations ADD COLUMN restored_from text;
ALTER TABLE terminals ADD COLUMN restored_from text;
