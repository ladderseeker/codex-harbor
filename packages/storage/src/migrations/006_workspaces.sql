ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_project_id_key;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Local';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'local' CHECK(kind IN ('local','worktree','copy'));
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'ready' CHECK(state IN ('creating','removing','ready','unavailable','failed','archived','removed'));
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS relative_path text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS canonical_path text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS device text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS inode text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS common_path text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS common_device text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS common_inode text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS base_revision text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS source_dirty boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS source_workspace_id uuid REFERENCES workspaces(id);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS writer_session_id uuid REFERENCES sessions(id);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS failure_code text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS archived_at timestamptz;
UPDATE workspaces w SET relative_path=p.relative_path,canonical_path=p.canonical_path,device=p.device,inode=p.inode FROM projects p WHERE p.id=w.project_id AND w.canonical_path IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_local_unique ON workspaces(project_id) WHERE kind='local';
CREATE UNIQUE INDEX IF NOT EXISTS workspace_project_identity ON workspaces(project_id,id);
ALTER TABLE sessions ADD CONSTRAINT session_workspace_project FOREIGN KEY(project_id,workspace_id) REFERENCES workspaces(project_id,id);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS snapshot_hash text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE workspaces ADD COLUMN writer_generation bigint;
CREATE TABLE workspace_releases (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 session_id uuid NOT NULL REFERENCES sessions(id), expected_generation bigint NOT NULL,
 actor_hash text NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','dispatching','completed','failed')),
 failure_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workspace_release_pending ON workspace_releases(workspace_id) WHERE state IN ('queued','dispatching');

CREATE TABLE workspace_storage_operations (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), project_id uuid NOT NULL REFERENCES projects(id),
 action text NOT NULL CHECK(action IN ('create','remove')), command jsonb NOT NULL, actor_hash text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','dispatching','completed','failed')),
 result jsonb, failure_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workspace_storage_pending ON workspace_storage_operations(project_id) WHERE state IN ('queued','dispatching');
