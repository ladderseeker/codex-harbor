-- Personal conversations share a directory but retain exact generation ownership.
CREATE TABLE conversation_runtimes (
  session_id uuid PRIMARY KEY REFERENCES sessions(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  generation bigint NOT NULL CHECK (generation > 0),
  state text NOT NULL CHECK (state IN ('starting','active','waiting_approval','waiting_input','idle','protected','retiring','unknown')),
  last_activity_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idle_until timestamptz,
  native_identity jsonb,
  permission_profile text NOT NULL,
  credential_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(session_id,generation)
);
CREATE INDEX conversation_runtimes_workspace ON conversation_runtimes(workspace_id);
ALTER TABLE operations ADD COLUMN queue_reason text CHECK (queue_reason IN ('session_busy','active_capacity','runtime_capacity','protected_capacity','retirement_unknown','workspace_busy','maintenance'));

-- Preserve the managed exclusion contract even if an administrator changes
-- profiles while a personal identity is unresolved. Existing writer fields are
-- never rewritten or silently converted into shared authority.
CREATE FUNCTION harbor_conversation_runtime_exclusion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.writer_owner_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM conversation_runtimes WHERE workspace_id=NEW.id
  ) THEN RAISE EXCEPTION 'workspace has unconfirmed conversation runtimes'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_conversation_runtime_exclusion BEFORE UPDATE ON workspaces
FOR EACH ROW EXECUTE FUNCTION harbor_conversation_runtime_exclusion();
