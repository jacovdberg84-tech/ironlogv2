CREATE TABLE IF NOT EXISTS automation_job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automation_job_runs_job_name ON automation_job_runs(job_name);
CREATE INDEX IF NOT EXISTS idx_automation_job_runs_started_at ON automation_job_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS fault_events (
  id BIGSERIAL PRIMARY KEY,
  machine_code TEXT NOT NULL,
  fault_code TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  notes TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fault_events_machine_fault_occurred
  ON fault_events(machine_code, fault_code, occurred_at DESC);

CREATE TABLE IF NOT EXISTS fault_notification_rules (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  occurrence_threshold INTEGER NOT NULL DEFAULT 3,
  window_hours INTEGER NOT NULL DEFAULT 24,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fault_notifications (
  id BIGSERIAL PRIMARY KEY,
  rule_id BIGINT REFERENCES fault_notification_rules(id) ON DELETE SET NULL,
  machine_code TEXT NOT NULL,
  fault_code TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fault_notifications_created_at ON fault_notifications(created_at DESC);
