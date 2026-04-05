CREATE TABLE IF NOT EXISTS work_order_checklist_items (
  id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done')),
  assignee_name TEXT,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_order_checklist_items_work_order_id ON work_order_checklist_items(work_order_id);

CREATE TABLE IF NOT EXISTS work_order_comments (
  id BIGSERIAL PRIMARY KEY,
  work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_order_comments_work_order_id ON work_order_comments(work_order_id);

CREATE TABLE IF NOT EXISTS work_order_dependencies (
  work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  depends_on_work_order_id BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (work_order_id, depends_on_work_order_id),
  CHECK (work_order_id <> depends_on_work_order_id)
);

CREATE INDEX IF NOT EXISTS idx_work_order_dependencies_work_order_id ON work_order_dependencies(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_dependencies_depends_on ON work_order_dependencies(depends_on_work_order_id);
