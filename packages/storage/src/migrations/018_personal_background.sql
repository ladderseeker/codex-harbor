-- Successful personal development turns retain their owned process group briefly.
-- Only confirmed process retirement clears the reservation and these fields.
ALTER TABLE sessions ADD COLUMN background_until timestamptz;
ALTER TABLE sessions ADD COLUMN background_stop_requested boolean NOT NULL DEFAULT false;
