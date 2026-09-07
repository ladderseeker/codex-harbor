-- Dedicated process ownership; reservation epoch never aliases native generation.
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_writer_kind_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_writer_kind_check CHECK(writer_kind IN ('conversation','file','terminal','preview','extension'));
CREATE OR REPLACE FUNCTION synchronize_workspace_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.writer_session_id IS NOT NULL THEN
  IF NEW.writer_kind IS NOT NULL AND NEW.writer_kind<>'conversation' THEN RAISE EXCEPTION 'workspace owner conflict'; END IF;
  NEW.writer_kind := 'conversation'; NEW.writer_owner_id := NEW.writer_session_id;
 ELSIF NEW.writer_kind='conversation' THEN
  NEW.writer_kind := NULL; NEW.writer_owner_id := NULL;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.writer_owner_id IS NOT NULL THEN NEW.writer_epoch := nextval('runtime_generation_seq'); END IF;
 ELSIF NEW.writer_owner_id IS NULL THEN NEW.writer_epoch := OLD.writer_epoch;
 ELSIF NEW.writer_owner_id IS DISTINCT FROM OLD.writer_owner_id OR NEW.writer_kind IS DISTINCT FROM OLD.writer_kind THEN
  NEW.writer_epoch := nextval('runtime_generation_seq');
 ELSIF NEW.writer_epoch < OLD.writer_epoch THEN RAISE EXCEPTION 'workspace reservation epoch regression'; END IF;
 IF (NEW.writer_kind IS NULL) <> (NEW.writer_owner_id IS NULL) THEN RAISE EXCEPTION 'workspace owner incomplete'; END IF;
 RETURN NEW;
END $$;

CREATE TABLE previews(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),workspace_id uuid NOT NULL REFERENCES workspaces(id),
 name text NOT NULL CHECK(octet_length(name) BETWEEN 1 AND 160),script text NOT NULL CHECK(script ~ '^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}$'),
 port integer NOT NULL CHECK(port BETWEEN 1024 AND 65535),hostname text NOT NULL UNIQUE,
 permission_profile text NOT NULL CHECK(permission_profile IN ('read-only','workspace-write')),
 actor_hash text NOT NULL,generation bigint NOT NULL DEFAULT 0,revision integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'created' CHECK(state IN ('created','queued','starting','ready','stopping','stopped','exited','failed','uncertain')),
 retired boolean NOT NULL DEFAULT true,lease_epoch bigint,runner_id text,relay_id text,
 failure_code text,exit_code integer,retirement_ack uuid,deadline timestamptz,started_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),command_count integer NOT NULL DEFAULT 0 CHECK(command_count BETWEEN 0 AND 128),
 stop_attempts integer NOT NULL DEFAULT 0 CHECK(stop_attempts BETWEEN 0 AND 3),
 output_sequence bigint NOT NULL DEFAULT 0,output_floor bigint NOT NULL DEFAULT 0,output_lost boolean NOT NULL DEFAULT false,
 restored_from text
);
CREATE UNIQUE INDEX preview_one_workspace_owner ON previews(workspace_id) WHERE NOT retired;
CREATE TABLE preview_readers(
 owner_id uuid PRIMARY KEY REFERENCES previews(id),workspace_id uuid NOT NULL REFERENCES workspaces(id),
 kind text NOT NULL DEFAULT 'preview' CHECK(kind='preview'),epoch bigint NOT NULL,generation bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX preview_readers_workspace ON preview_readers(workspace_id);
CREATE TABLE preview_stops(
 id uuid PRIMARY KEY,preview_id uuid NOT NULL REFERENCES previews(id),generation bigint NOT NULL,attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 3),
 actor_hash text NOT NULL,state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','retiring','completed','failed')),
 acknowledgement uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),failure_code text,
 UNIQUE(preview_id,generation,attempt)
);
CREATE TABLE preview_openings(
 id uuid PRIMARY KEY,preview_id uuid NOT NULL REFERENCES previews(id),generation bigint NOT NULL,actor_hash text NOT NULL,
 ticket_hash text NOT NULL UNIQUE,grant_hash text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,consumed_at timestamptz,revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE preview_grants(
 id uuid PRIMARY KEY REFERENCES preview_openings(id),preview_id uuid NOT NULL REFERENCES previews(id),generation bigint NOT NULL,
 actor_hash text NOT NULL,hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX preview_grant_actor ON preview_grants(actor_hash);
CREATE TABLE preview_logs(
 preview_id uuid NOT NULL REFERENCES previews(id),sequence bigint NOT NULL,generation bigint NOT NULL,
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 16384),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(preview_id,sequence)
);
