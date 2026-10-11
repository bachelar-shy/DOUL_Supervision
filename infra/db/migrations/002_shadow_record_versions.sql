-- DOUL relational-store migration candidate (NOT enabled by current API).
-- Run only after explicit migration rehearsal, audited backup and change approval.
-- This is a shadow, append-only record history; production still reads v1 snapshot.
BEGIN;

CREATE TABLE IF NOT EXISTS doul_shadow_domain_record_versions (
  project_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  subtype TEXT,
  status TEXT,
  record_json JSONB NOT NULL,
  payload_sha256 CHAR(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  backfilled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, object_type, object_id, version),
  CHECK (record_json->>'id' = object_id),
  CHECK ((record_json->>'projectId' = project_id) OR
         (object_type = 'Project' AND record_json->>'id' = project_id))
);
CREATE INDEX IF NOT EXISTS doul_shadow_record_latest_lookup
  ON doul_shadow_domain_record_versions(project_id, object_type, object_id, version DESC);

CREATE OR REPLACE FUNCTION doul_shadow_record_versions_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Immutable record history: updates and physical deletes are prohibited';
END; $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'doul_shadow_record_no_mutation'
      AND tgrelid = 'doul_shadow_domain_record_versions'::regclass
  ) THEN
    CREATE TRIGGER doul_shadow_record_no_mutation
      BEFORE UPDATE OR DELETE ON doul_shadow_domain_record_versions
      FOR EACH ROW EXECUTE FUNCTION doul_shadow_record_versions_immutable();
  END IF;
END; $$;

COMMENT ON TABLE doul_shadow_domain_record_versions IS
  'Read-only shadow export of immutable v1 history; not operational source of truth until independent cutover approval.';
COMMIT;
