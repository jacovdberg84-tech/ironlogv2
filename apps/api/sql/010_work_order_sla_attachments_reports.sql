CREATE TABLE IF NOT EXISTS work_order_sla_rules (
  id BIGSERIAL PRIMARY KEY,
  site_code TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  applies_priority TEXT CHECK (applies_priority IN ('low', 'medium', 'high', 'critical')),
  applies_department TEXT,
  breach_after_hours NUMERIC(10, 2) NOT NULL,
  escalation_channel TEXT NOT NULL DEFAULT 'email' CHECK (escalation_channel IN ('email', 'teams_webhook', 'whatsapp_webhook')),
  escalation_recipient TEXT NOT NULL,
  auto_request_approval BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_code, name)
);

CREATE INDEX IF NOT EXISTS idx_work_order_sla_rules_site_code ON work_order_sla_rules(site_code);
CREATE INDEX IF NOT EXISTS idx_work_order_sla_rules_enabled ON work_order_sla_rules(enabled);

CREATE TABLE IF NOT EXISTS work_order_escalations (
  id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  rule_id BIGINT REFERENCES work_order_sla_rules(id) ON DELETE SET NULL,
  escalation_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'triggered' CHECK (status IN ('triggered', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_order_escalations_work_order_id ON work_order_escalations(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_escalations_created_at ON work_order_escalations(created_at);

CREATE TABLE IF NOT EXISTS work_order_attachments (
  id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_order_attachments_work_order_id ON work_order_attachments(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_attachments_created_at ON work_order_attachments(created_at);
