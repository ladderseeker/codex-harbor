CREATE TABLE schedules (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  title text NOT NULL CHECK(octet_length(title) BETWEEN 1 AND 160),
  config_revision integer NOT NULL DEFAULT 1 CHECK(config_revision>0),
  rule_revision integer NOT NULL DEFAULT 1 CHECK(rule_revision>0),
  grant_epoch integer NOT NULL DEFAULT 0 CHECK(grant_epoch>=0),
  state text NOT NULL DEFAULT 'paused' CHECK(state IN ('enabled','paused','attention','completed')),
  reason text,
  cursor_at timestamptz NOT NULL,
  next_due_at timestamptz,
  last_observed_at timestamptz,
  last_planned_at timestamptz,
  time_fingerprint text NOT NULL,
  catch_up jsonb CHECK(catch_up IS NULL OR octet_length(catch_up::text)<=4096),
  last_pruned jsonb CHECK(last_pruned IS NULL OR octet_length(last_pruned::text)<=4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE schedule_versions (
  schedule_id uuid NOT NULL REFERENCES schedules(id),
  revision integer NOT NULL CHECK(revision>0),
  rule_revision integer NOT NULL CHECK(rule_revision>0),
  config jsonb NOT NULL CHECK(octet_length(config::text)<=4096),
  prompt text NOT NULL CHECK(octet_length(prompt) BETWEEN 1 AND 32768),
  prompt_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(schedule_id,revision)
);
CREATE TABLE schedule_grants (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL,
  config_revision integer NOT NULL,
  epoch integer NOT NULL CHECK(epoch>0),
  identity_pin text NOT NULL,
  instance_id text NOT NULL,
  source_pat_id uuid REFERENCES api_tokens(id),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  one_shot boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(schedule_id,config_revision) REFERENCES schedule_versions(schedule_id,revision),
  UNIQUE(schedule_id,epoch)
);
ALTER TABLE schedules ADD COLUMN active_grant_id uuid REFERENCES schedule_grants(id);
CREATE TABLE schedule_occurrences (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES schedules(id),
  config_revision integer NOT NULL,
  rule_revision integer NOT NULL,
  grant_id uuid REFERENCES schedule_grants(id),
  kind text NOT NULL CHECK(kind IN ('recurring','manual','range')),
  local_minute text,
  intended_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL CHECK(octet_length(snapshot::text)<=4096),
  prompt text CHECK(prompt IS NULL OR octet_length(prompt)<=32768),
  state text NOT NULL CHECK(state IN ('accepted','preparing_workspace','queued_turn','running','attention','succeeded','failed','cancelled','skipped','uncertain')),
  reason text,
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  turn_id uuid NOT NULL UNIQUE,
  storage_operation_id uuid NOT NULL UNIQUE,
  cancel_operation_id uuid NOT NULL UNIQUE,
  acknowledged_at timestamptz,
  acknowledgement_operation_id uuid,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(schedule_id,config_revision) REFERENCES schedule_versions(schedule_id,revision)
);
CREATE UNIQUE INDEX schedule_recurring_identity ON schedule_occurrences(schedule_id,rule_revision,local_minute) WHERE kind='recurring';
CREATE UNIQUE INDEX schedule_one_active ON schedule_occurrences(schedule_id) WHERE state IN ('accepted','preparing_workspace','queued_turn','running','attention') OR (state='uncertain' AND acknowledged_at IS NULL);
CREATE INDEX schedule_occurrence_history ON schedule_occurrences(schedule_id,intended_at DESC,id DESC);
CREATE TABLE schedule_commands (
  schedule_id uuid NOT NULL REFERENCES schedules(id),
  slot text NOT NULL CHECK(octet_length(slot)<=100),
  actor_hash text NOT NULL,
  grant_epoch integer,
  occurrence_id uuid REFERENCES schedule_occurrences(id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL CHECK(octet_length(result::text)<=8192),
  retry_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(schedule_id,grant_epoch) REFERENCES schedule_grants(schedule_id,epoch),
  PRIMARY KEY(schedule_id,slot),
  UNIQUE(actor_hash,idempotency_key)
);
CREATE TABLE schedule_test_clock(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),now_at timestamptz NOT NULL);
