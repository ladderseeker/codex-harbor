-- File/Git effects reserve workspace ownership independently of conversations.
CREATE TABLE file_operations (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL REFERENCES projects(id), actor_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('save','stage','unstage','commit')),
 state text NOT NULL CHECK(state IN ('queued','dispatching','succeeded','failed','uncertain')),
 epoch bigint, payload jsonb, payload_bytes integer NOT NULL DEFAULT 0 CHECK(payload_bytes BETWEEN 0 AND 2097152),
 request_hash text NOT NULL, result jsonb, failure_code text, acknowledged_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_operation_pending ON file_operations(created_at,id) WHERE state IN ('queued','dispatching');
CREATE INDEX file_operation_workspace ON file_operations(workspace_id,created_at,id);
CREATE TABLE file_inspections (
 id uuid PRIMARY KEY, operation_id uuid NOT NULL UNIQUE REFERENCES file_operations(id),
 actor_hash text NOT NULL, expected_epoch bigint NOT NULL, fence bigint,
 state text NOT NULL CHECK(state IN ('queued','inspecting','ready','failed','consumed')),
 attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 3),
 report jsonb CHECK(octet_length(report::text)<=16384),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE file_operation_audits (
 operation_id uuid NOT NULL REFERENCES file_operations(id), slot integer NOT NULL CHECK(slot BETWEEN 0 AND 3),
 data jsonb NOT NULL CHECK(octet_length(data::text)<=512), PRIMARY KEY(operation_id,slot)
);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS files_revision bigint NOT NULL DEFAULT 0;
CREATE TABLE file_events (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), sequence bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL CHECK(octet_length(data::text)<=2048),
 PRIMARY KEY(workspace_id,sequence)
);

-- Shared reservation identity. Safe for independently delivered later modules.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS writer_kind text CHECK(writer_kind IN ('conversation','file','terminal'));
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS writer_owner_id uuid;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS writer_epoch bigint NOT NULL DEFAULT 0;
UPDATE workspaces SET writer_kind='conversation',writer_owner_id=writer_session_id,writer_epoch=greatest(writer_epoch,coalesce(writer_generation,0)) WHERE writer_session_id IS NOT NULL;
CREATE OR REPLACE FUNCTION synchronize_workspace_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.writer_session_id IS NOT NULL THEN
  IF NEW.writer_kind IN ('file','terminal') THEN RAISE EXCEPTION 'workspace owner conflict'; END IF;
  NEW.writer_kind := 'conversation'; NEW.writer_owner_id := NEW.writer_session_id;
 ELSIF NEW.writer_kind='conversation' THEN
  NEW.writer_kind := NULL; NEW.writer_owner_id := NULL;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.writer_owner_id IS NOT NULL THEN NEW.writer_epoch := nextval('runtime_generation_seq'); END IF;
 ELSIF NEW.writer_owner_id IS NULL THEN
  NEW.writer_epoch := OLD.writer_epoch;
 ELSIF NEW.writer_owner_id IS DISTINCT FROM OLD.writer_owner_id OR NEW.writer_kind IS DISTINCT FROM OLD.writer_kind THEN
  NEW.writer_epoch := nextval('runtime_generation_seq');
 ELSIF NEW.writer_epoch < OLD.writer_epoch THEN
  RAISE EXCEPTION 'workspace reservation epoch regression';
 END IF;
 IF (NEW.writer_kind IS NULL) <> (NEW.writer_owner_id IS NULL) THEN RAISE EXCEPTION 'workspace owner incomplete'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workspace_writer_identity ON workspaces;
CREATE TRIGGER workspace_writer_identity BEFORE INSERT OR UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION synchronize_workspace_writer();
