CREATE TABLE runtime_credentials(id boolean PRIMARY KEY DEFAULT true CHECK(id), ciphertext text NOT NULL, iv text NOT NULL, tag text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE runtime_bootstrap(id boolean PRIMARY KEY DEFAULT true CHECK(id), runtime_id uuid NOT NULL);
