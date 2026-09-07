ALTER TABLE browser_sessions ADD COLUMN identity_pin text NOT NULL DEFAULT '';
UPDATE browser_sessions SET revoked=true WHERE identity_pin='';
ALTER TABLE harbor_meta ADD COLUMN identity_pin text NOT NULL DEFAULT '';
