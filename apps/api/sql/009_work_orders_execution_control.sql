CREATE TABLE IF NOT EXISTS work_orders (
  id BIGSERIAL PRIMARY KEY,
  work_order_code TEXT NOT NULL UNIQUE,
  site_code TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'operations',
  machine_code TEXT,
  fault_code TEXT,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'blocked', 'pending_approval', 'approved', 'closed')),
  assigned_to_name TEXT,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  supervisor_approver UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  estimated_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  actual_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  downtime_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  approval_reason TEXT,
  evidence_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_site_code ON work_orders(site_code);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_due_at ON work_orders(due_at);
CREATE INDEX IF NOT EXISTS idx_work_orders_machine_code ON work_orders(machine_code);
CREATE INDEX IF NOT EXISTS idx_work_orders_department ON work_orders(department);

CREATE TABLE IF NOT EXISTS work_order_events (
  id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_order_events_work_order_id ON work_order_events(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_events_created_at ON work_order_events(created_at);
