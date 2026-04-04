CREATE TABLE IF NOT EXISTS sites (
  id BIGSERIAL PRIMARY KEY,
  site_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  region TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_site_access (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_user_site_access_user_id ON user_site_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_site_access_site_id ON user_site_access(site_id);

CREATE TABLE IF NOT EXISTS export_artifacts (
  id BIGSERIAL PRIMARY KEY,
  artifact_type TEXT NOT NULL,
  site_code TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_artifacts_site_code ON export_artifacts(site_code);
CREATE INDEX IF NOT EXISTS idx_export_artifacts_created_at ON export_artifacts(created_at DESC);
