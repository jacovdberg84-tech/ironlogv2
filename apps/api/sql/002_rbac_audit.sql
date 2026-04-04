CREATE TABLE IF NOT EXISTS rbac_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_created_at ON rbac_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rbac_audit_logs_actor_user_id ON rbac_audit_logs(actor_user_id);
