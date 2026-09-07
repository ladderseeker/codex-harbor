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

CREATE TABLE terminals(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),workspace_id uuid NOT NULL REFERENCES workspaces(id),
 actor_hash text NOT NULL,permission_profile text NOT NULL CHECK(permission_profile IN ('read-only','workspace-write')),
 generation bigint NOT NULL DEFAULT 1,state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','dispatching','running','shell_exited','retiring','terminated','interrupted','failed','uncertain')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),deadline timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 retired boolean NOT NULL DEFAULT false,writer_epoch bigint,failure_code text,exit_code integer,
 controller_actor text,controller_id uuid,controller_epoch bigint NOT NULL DEFAULT 0,controller_until timestamptz,
 input_sequence bigint NOT NULL DEFAULT 0,input_uncertain boolean NOT NULL DEFAULT false,
 input_window timestamptz,input_bytes integer NOT NULL DEFAULT 0,input_frame_window timestamptz,input_frames integer NOT NULL DEFAULT 0,
 resize_sequence bigint NOT NULL DEFAULT 0,resize_cols integer NOT NULL DEFAULT 80,resize_rows integer NOT NULL DEFAULT 24,resize_pending boolean NOT NULL DEFAULT false,
 resize_window timestamptz,resize_count integer NOT NULL DEFAULT 0,heartbeat_at timestamptz,
 output_sequence bigint NOT NULL DEFAULT 0,output_floor bigint NOT NULL DEFAULT 0,output_lost boolean NOT NULL DEFAULT false,
 control_window timestamptz,control_count integer NOT NULL DEFAULT 0,
 termination_attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX terminal_workspace ON terminals(workspace_id,created_at);
CREATE TABLE terminal_input(
 terminal_id uuid NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,epoch bigint NOT NULL,sequence bigint NOT NULL,
 actor_hash text NOT NULL,controller_id uuid NOT NULL,hash text NOT NULL,bytes bytea,
 state text NOT NULL CHECK(state IN ('accepted','dispatching','delivered','denied','uncertain')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),settled_at timestamptz,failure_code text,
 PRIMARY KEY(terminal_id,epoch,sequence)
);
CREATE TABLE terminal_output(
 terminal_id uuid NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,sequence bigint NOT NULL,bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 16384),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(terminal_id,sequence)
);
