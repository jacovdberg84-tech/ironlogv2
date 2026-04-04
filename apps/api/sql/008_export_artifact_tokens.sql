CREATE TABLE IF NOT EXISTS export_artifact_tokens (
  id BIGSERIAL PRIMARY KEY,
  artifact_id BIGINT NOT NULL REFERENCES export_artifacts(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_export_artifact_tokens_artifact_id ON export_artifact_tokens(artifact_id);
CREATE INDEX IF NOT EXISTS idx_export_artifact_tokens_expires_at ON export_artifact_tokens(expires_at);
