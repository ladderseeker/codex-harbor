ALTER TABLE sessions ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE sessions ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN metadata_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN replay_floor bigint NOT NULL DEFAULT 0;
ALTER TABLE operations ADD COLUMN native_turn_id text;
ALTER TABLE operations ADD COLUMN uncertainty_acknowledged_at timestamptz;
ALTER TABLE operations ADD COLUMN control_attempts integer NOT NULL DEFAULT 1;
CREATE TABLE session_recoveries(id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES sessions(id),actor_hash text NOT NULL,expected_generation bigint NOT NULL,fence_generation bigint,state text NOT NULL CHECK(state IN ('queued','fencing','ready','failed','consumed')),uncertain_operation_ids uuid[] NOT NULL,snapshot_cursor bigint NOT NULL,attempts integer NOT NULL DEFAULT 1,report jsonb NOT NULL DEFAULT '{"status":"unavailable"}',continued_operation_id uuid REFERENCES operations(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX session_recovery_active ON session_recoveries(session_id) WHERE state IN ('queued','fencing','ready');
ALTER TABLE operations ADD COLUMN recovery_id uuid REFERENCES session_recoveries(id);
CREATE INDEX sessions_history_order ON sessions(archived,created_at DESC,id DESC);
ALTER TABLE intents ADD COLUMN control_target text;
CREATE INDEX intents_control_target ON intents(actor,control_target) WHERE control_target IS NOT NULL;
CREATE TABLE recovery_audits(recovery_id uuid NOT NULL REFERENCES session_recoveries(id),slot integer NOT NULL CHECK(slot BETWEEN 1 AND 4),data jsonb NOT NULL CHECK(octet_length(data::text)<=512),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(recovery_id,slot));
UPDATE sessions SET archived=true WHERE archived_at IS NOT NULL;
ALTER TABLE sessions ADD COLUMN history_ceiling bigint NOT NULL DEFAULT 500;
-- Preserve pre-P007 data without pretending it had unallocated control slots.
-- This one-time ceiling never grows through the application API.
UPDATE sessions s SET history_ceiling=greatest(500,
 (SELECT count(*) FROM operations o WHERE o.session_id=s.id)+
 (SELECT count(*) FROM operations t WHERE t.session_id=s.id AND t.kind='turn' AND t.state IN ('queued','dispatching','running','waiting_approval','waiting_input') AND NOT EXISTS(SELECT 1 FROM operations c WHERE c.session_id=s.id AND c.kind='cancel' AND c.payload->>'operationId'=t.id::text))+1);
