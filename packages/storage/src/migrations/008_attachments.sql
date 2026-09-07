CREATE TABLE attachments (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions(id), project_id uuid NOT NULL REFERENCES projects(id),
 name text NOT NULL CHECK(octet_length(name)<=240), declared_type text NOT NULL CHECK(declared_type IN ('image/png','text/plain')),
 expected_size integer NOT NULL CHECK(expected_size>0 AND expected_size<=262144), expected_hash text NOT NULL CHECK(expected_hash ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','staged','attached','deleted','expired')),
 media_type text, size integer, digest text, content bytea, operation_id uuid REFERENCES operations(id),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 CHECK((state IN ('staged','attached'))=(content IS NOT NULL)), CHECK((state='attached')=(operation_id IS NOT NULL)),
 UNIQUE(session_id,id)
);
CREATE INDEX attachment_expiry ON attachments(expires_at) WHERE state IN ('uploading','staged');
CREATE TABLE conversation_drafts (
 session_id uuid PRIMARY KEY REFERENCES sessions(id), text text NOT NULL DEFAULT '' CHECK(octet_length(text)<=32768),
 attachment_ids uuid[] NOT NULL DEFAULT '{}', revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(cardinality(attachment_ids)<=4)
);
ALTER TABLE attachments ADD COLUMN device text, ADD COLUMN inode text;
CREATE TABLE session_attachment_storage(session_id uuid PRIMARY KEY REFERENCES sessions(id),canonical text NOT NULL,device text NOT NULL,inode text NOT NULL);
