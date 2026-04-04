CREATE TABLE IF NOT EXISTS ironmind_investigation_cases (
  id BIGSERIAL PRIMARY KEY,
  case_code TEXT NOT NULL UNIQUE,
  machine_code TEXT NOT NULL,
  fault_code TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  status TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  description TEXT,
  owner_name TEXT,
  opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closure_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ironmind_cases_status ON ironmind_investigation_cases(status);
CREATE INDEX IF NOT EXISTS idx_ironmind_cases_machine_fault ON ironmind_investigation_cases(machine_code, fault_code);
CREATE INDEX IF NOT EXISTS idx_ironmind_cases_opened_at ON ironmind_investigation_cases(opened_at DESC);

CREATE TABLE IF NOT EXISTS ironmind_case_actions (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES ironmind_investigation_cases(id) ON DELETE CASCADE,
  action_title TEXT NOT NULL,
  owner_name TEXT,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'todo',
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ironmind_case_actions_case_id ON ironmind_case_actions(case_id);
CREATE INDEX IF NOT EXISTS idx_ironmind_case_actions_status ON ironmind_case_actions(status);
