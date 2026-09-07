CREATE TABLE deployment_state (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 maintenance boolean NOT NULL DEFAULT false,
 activation_required boolean NOT NULL DEFAULT false,
 restored_from text,
 epoch bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO deployment_state(id) VALUES(true);
CREATE TABLE deployment_restored_operations (
 kind text NOT NULL,
 id uuid NOT NULL,
 source_instance text NOT NULL,
 historical jsonb NOT NULL,
 restored_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(kind,id)
);

ALTER TABLE workspace_storage_operations ADD COLUMN retry_authority boolean NOT NULL DEFAULT true;
