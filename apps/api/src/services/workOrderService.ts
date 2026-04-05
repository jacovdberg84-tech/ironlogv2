import { randomInt } from "crypto";
import { pool } from "../db/pool.js";

export type WorkOrderPriority = "low" | "medium" | "high" | "critical";
export type WorkOrderStatus = "open" | "assigned" | "in_progress" | "blocked" | "pending_approval" | "approved" | "closed";

export type CreateWorkOrderInput = {
  siteCode: string;
  department: string;
  machineCode?: string;
  faultCode?: string;
  title: string;
  description?: string;
  priority: WorkOrderPriority;
  assignedToName?: string;
  dueAt?: string;
  estimatedCost: number;
  downtimeHours: number;
};

export type UpdateWorkOrderInput = Partial<{
  title: string;
  description: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  assignedToName: string;
  dueAt: string | null;
  actualCost: number;
  downtimeHours: number;
  evidenceNotes: string;
}>;

function toSiteCode(siteCode?: string | null) {
  const normalized = (siteCode ?? "SITE-A").trim().toUpperCase();
  return normalized.length > 0 ? normalized : "SITE-A";
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function toWorkOrderCode(siteCode: string) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  const suffix = randomInt(100, 999);
  return `WO-${siteCode}-${stamp}-${suffix}`;
}

async function addWorkOrderEvent(
  workOrderId: number,
  eventType: string,
  message: string,
  actorUserId: string | null,
  metadata: Record<string, unknown> = {}
) {
  await pool.query(
    `
      INSERT INTO work_order_events(work_order_id, event_type, message, actor_user_id, metadata)
      VALUES($1, $2, $3, $4, $5::jsonb)
    `,
    [workOrderId, eventType, message, actorUserId, JSON.stringify(metadata)]
  );
}

function requiresApproval(priority: WorkOrderPriority, estimatedCost: number) {
  return priority === "critical" || estimatedCost >= 25000;
}

export async function createWorkOrder(input: CreateWorkOrderInput, actorUserId: string) {
  const siteCode = toSiteCode(input.siteCode);
  const estimatedCost = Math.max(0, round(input.estimatedCost || 0));
  const downtimeHours = Math.max(0, round(input.downtimeHours || 0));
  const approvalRequired = requiresApproval(input.priority, estimatedCost);
  const workOrderCode = toWorkOrderCode(siteCode);

  const created = await pool.query(
    `
      INSERT INTO work_orders(
        work_order_code,
        site_code,
        department,
        machine_code,
        fault_code,
        title,
        description,
        priority,
        status,
        assigned_to_name,
        requested_by,
        due_at,
        estimated_cost,
        actual_cost,
        downtime_hours,
        approval_required,
        approval_reason,
        updated_at
      )
      VALUES(
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        CASE WHEN $14 THEN 'pending_approval' ELSE 'open' END,
        $9,
        $10,
        $11::timestamptz,
        $12,
        0,
        $13,
        $14,
        CASE WHEN $14 THEN 'High-risk work order requires supervisor approval before closure' ELSE NULL END,
        NOW()
      )
      RETURNING
        id,
        work_order_code AS "workOrderCode",
        site_code AS "siteCode",
        department,
        machine_code AS "machineCode",
        fault_code AS "faultCode",
        title,
        description,
        priority,
        status,
        assigned_to_name AS "assignedToName",
        requested_by AS "requestedBy",
        due_at AS "dueAt",
        started_at AS "startedAt",
        closed_at AS "closedAt",
        estimated_cost AS "estimatedCost",
        actual_cost AS "actualCost",
        downtime_hours AS "downtimeHours",
        approval_required AS "approvalRequired",
        approval_reason AS "approvalReason",
        evidence_notes AS "evidenceNotes",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      workOrderCode,
      siteCode,
      input.department,
      input.machineCode ?? null,
      input.faultCode ?? null,
      input.title,
      input.description ?? null,
      input.priority,
      input.assignedToName ?? null,
      actorUserId,
      input.dueAt ?? null,
      estimatedCost,
      downtimeHours,
      approvalRequired
    ]
  );

  const row = created.rows[0];
  await addWorkOrderEvent(
    Number(row.id),
    "created",
    `Work order ${row.workOrderCode} opened with priority ${row.priority}`,
    actorUserId,
    {
      siteCode,
      department: input.department,
      estimatedCost,
      approvalRequired
    }
  );

  return row;
}

export async function getWorkOrderById(workOrderId: number) {
  const result = await pool.query(
    `
      SELECT
        id,
        work_order_code AS "workOrderCode",
        site_code AS "siteCode",
        department,
        machine_code AS "machineCode",
        fault_code AS "faultCode",
        title,
        description,
        priority,
        status,
        assigned_to_name AS "assignedToName",
        requested_by AS "requestedBy",
        supervisor_approver AS "supervisorApprover",
        due_at AS "dueAt",
        started_at AS "startedAt",
        closed_at AS "closedAt",
        estimated_cost AS "estimatedCost",
        actual_cost AS "actualCost",
        downtime_hours AS "downtimeHours",
        approval_required AS "approvalRequired",
        approval_reason AS "approvalReason",
        evidence_notes AS "evidenceNotes",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM work_orders
      WHERE id = $1
      LIMIT 1
    `,
    [workOrderId]
  );

  return result.rows[0] ?? null;
}

export async function listWorkOrders(input: {
  siteCode: string;
  status?: WorkOrderStatus;
  limit: number;
}) {
  const siteCode = toSiteCode(input.siteCode);
  const limit = Math.max(10, Math.min(input.limit, 200));

  const result = await pool.query(
    `
      SELECT
        id,
        work_order_code AS "workOrderCode",
        site_code AS "siteCode",
        department,
        machine_code AS "machineCode",
        fault_code AS "faultCode",
        title,
        description,
        priority,
        status,
        assigned_to_name AS "assignedToName",
        requested_by AS "requestedBy",
        supervisor_approver AS "supervisorApprover",
        due_at AS "dueAt",
        started_at AS "startedAt",
        closed_at AS "closedAt",
        estimated_cost AS "estimatedCost",
        actual_cost AS "actualCost",
        downtime_hours AS "downtimeHours",
        approval_required AS "approvalRequired",
        approval_reason AS "approvalReason",
        evidence_notes AS "evidenceNotes",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        (CASE WHEN due_at IS NOT NULL AND due_at < NOW() AND status <> 'closed' THEN TRUE ELSE FALSE END) AS "isOverdue"
      FROM work_orders
      WHERE site_code = $1
        AND ($2::text IS NULL OR status = $2)
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        COALESCE(due_at, NOW() + INTERVAL '365 days'),
        created_at DESC
      LIMIT $3
    `,
    [siteCode, input.status ?? null, limit]
  );

  return { items: result.rows };
}

export async function updateWorkOrder(workOrderId: number, input: UpdateWorkOrderInput, actorUserId: string) {
  const current = await getWorkOrderById(workOrderId);
  if (!current) {
    return null;
  }

  const nextStatus = input.status ?? current.status;
  const nextPriority = input.priority ?? current.priority;
  const nextActualCost = input.actualCost ?? Number(current.actualCost ?? 0);
  const nextEstimatedCost = Number(current.estimatedCost ?? 0);
  const nextApprovalRequired = requiresApproval(nextPriority, nextEstimatedCost) || Boolean(current.approvalRequired);

  const updated = await pool.query(
    `
      UPDATE work_orders
      SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        priority = COALESCE($4, priority),
        status = COALESCE($5, status),
        assigned_to_name = COALESCE($6, assigned_to_name),
        due_at = COALESCE($7::timestamptz, due_at),
        actual_cost = COALESCE($8, actual_cost),
        downtime_hours = COALESCE($9, downtime_hours),
        evidence_notes = COALESCE($10, evidence_notes),
        started_at = CASE
          WHEN COALESCE($5, status) IN ('assigned', 'in_progress') AND started_at IS NULL THEN NOW()
          ELSE started_at
        END,
        closed_at = CASE
          WHEN COALESCE($5, status) = 'closed' THEN NOW()
          ELSE closed_at
        END,
        approval_required = $11,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        work_order_code AS "workOrderCode",
        site_code AS "siteCode",
        department,
        machine_code AS "machineCode",
        fault_code AS "faultCode",
        title,
        description,
        priority,
        status,
        assigned_to_name AS "assignedToName",
        requested_by AS "requestedBy",
        supervisor_approver AS "supervisorApprover",
        due_at AS "dueAt",
        started_at AS "startedAt",
        closed_at AS "closedAt",
        estimated_cost AS "estimatedCost",
        actual_cost AS "actualCost",
        downtime_hours AS "downtimeHours",
        approval_required AS "approvalRequired",
        approval_reason AS "approvalReason",
        evidence_notes AS "evidenceNotes",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      workOrderId,
      input.title ?? null,
      input.description ?? null,
      nextPriority,
      nextStatus,
      input.assignedToName ?? null,
      input.dueAt ?? null,
      nextActualCost,
      input.downtimeHours ?? null,
      input.evidenceNotes ?? null,
      nextApprovalRequired
    ]
  );

  await addWorkOrderEvent(workOrderId, "updated", `Work order updated (status: ${nextStatus})`, actorUserId, {
    changes: input
  });

  return updated.rows[0] ?? null;
}

export async function requestWorkOrderApproval(workOrderId: number, actorUserId: string, reason?: string) {
  const updated = await pool.query(
    `
      UPDATE work_orders
      SET
        status = 'pending_approval',
        approval_required = TRUE,
        approval_reason = COALESCE($3, approval_reason, 'Supervisor review requested'),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, work_order_code AS "workOrderCode", status, approval_reason AS "approvalReason"
    `,
    [workOrderId, actorUserId, reason ?? null]
  );

  const row = updated.rows[0] ?? null;
  if (!row) {
    return null;
  }

  await addWorkOrderEvent(workOrderId, "approval_requested", "Supervisor approval requested", actorUserId, {
    reason: row.approvalReason ?? reason ?? null
  });

  return row;
}

export async function approveWorkOrder(workOrderId: number, actorUserId: string, notes?: string) {
  const updated = await pool.query(
    `
      UPDATE work_orders
      SET
        status = 'approved',
        supervisor_approver = $2,
        approval_required = TRUE,
        approval_reason = COALESCE($3, approval_reason),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, work_order_code AS "workOrderCode", status, approval_reason AS "approvalReason"
    `,
    [workOrderId, actorUserId, notes ?? null]
  );

  const row = updated.rows[0] ?? null;
  if (!row) {
    return null;
  }

  await addWorkOrderEvent(workOrderId, "approved", "Supervisor approved work order", actorUserId, {
    notes: notes ?? null
  });

  return row;
}

export async function closeWorkOrder(workOrderId: number, actorUserId: string, payload: { actualCost?: number; downtimeHours?: number; evidenceNotes?: string }) {
  const current = await getWorkOrderById(workOrderId);
  if (!current) {
    return { error: "not_found" as const };
  }

  if (current.approvalRequired && !["approved", "closed"].includes(String(current.status))) {
    return { error: "approval_required" as const };
  }

  const actualCost = Math.max(0, round(payload.actualCost ?? Number(current.actualCost ?? 0)));
  const downtimeHours = Math.max(0, round(payload.downtimeHours ?? Number(current.downtimeHours ?? 0)));

  const updated = await pool.query(
    `
      UPDATE work_orders
      SET
        status = 'closed',
        actual_cost = $2,
        downtime_hours = $3,
        evidence_notes = COALESCE($4, evidence_notes),
        closed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        work_order_code AS "workOrderCode",
        site_code AS "siteCode",
        department,
        machine_code AS "machineCode",
        fault_code AS "faultCode",
        title,
        description,
        priority,
        status,
        assigned_to_name AS "assignedToName",
        requested_by AS "requestedBy",
        supervisor_approver AS "supervisorApprover",
        due_at AS "dueAt",
        started_at AS "startedAt",
        closed_at AS "closedAt",
        estimated_cost AS "estimatedCost",
        actual_cost AS "actualCost",
        downtime_hours AS "downtimeHours",
        approval_required AS "approvalRequired",
        approval_reason AS "approvalReason",
        evidence_notes AS "evidenceNotes",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [workOrderId, actualCost, downtimeHours, payload.evidenceNotes ?? null]
  );

  const row = updated.rows[0] ?? null;
  if (!row) {
    return { error: "not_found" as const };
  }

  await addWorkOrderEvent(workOrderId, "closed", "Work order closed with evidence and attribution", actorUserId, {
    actualCost,
    downtimeHours,
    evidenceNotes: payload.evidenceNotes ?? null
  });

  return { item: row };
}

export async function getShiftCommandBoard(siteCode: string) {
  const safeSiteCode = toSiteCode(siteCode);

  const [counts, overdue, blocked, pendingApprovals, byAssignee] = await Promise.all([
    pool.query<{ status: string; count: number }>(
      `
        SELECT status, COUNT(*)::int AS count
        FROM work_orders
        WHERE site_code = $1
        GROUP BY status
      `,
      [safeSiteCode]
    ),
    pool.query(
      `
        SELECT
          id,
          work_order_code AS "workOrderCode",
          title,
          priority,
          status,
          assigned_to_name AS "assignedToName",
          due_at AS "dueAt"
        FROM work_orders
        WHERE site_code = $1
          AND status <> 'closed'
          AND due_at IS NOT NULL
          AND due_at < NOW()
        ORDER BY due_at ASC
        LIMIT 25
      `,
      [safeSiteCode]
    ),
    pool.query(
      `
        SELECT
          id,
          work_order_code AS "workOrderCode",
          title,
          priority,
          assigned_to_name AS "assignedToName",
          approval_reason AS "approvalReason",
          updated_at AS "updatedAt"
        FROM work_orders
        WHERE site_code = $1
          AND status = 'blocked'
        ORDER BY updated_at DESC
        LIMIT 25
      `,
      [safeSiteCode]
    ),
    pool.query(
      `
        SELECT
          id,
          work_order_code AS "workOrderCode",
          title,
          priority,
          assigned_to_name AS "assignedToName",
          estimated_cost AS "estimatedCost",
          approval_reason AS "approvalReason",
          updated_at AS "updatedAt"
        FROM work_orders
        WHERE site_code = $1
          AND status = 'pending_approval'
        ORDER BY estimated_cost DESC, updated_at DESC
        LIMIT 25
      `,
      [safeSiteCode]
    ),
    pool.query(
      `
        SELECT
          COALESCE(assigned_to_name, 'Unassigned') AS "assignee",
          COUNT(*)::int AS "activeCount",
          SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END)::int AS "blockedCount",
          SUM(CASE WHEN due_at IS NOT NULL AND due_at < NOW() AND status <> 'closed' THEN 1 ELSE 0 END)::int AS "overdueCount"
        FROM work_orders
        WHERE site_code = $1
          AND status <> 'closed'
        GROUP BY COALESCE(assigned_to_name, 'Unassigned')
        ORDER BY "activeCount" DESC
        LIMIT 20
      `,
      [safeSiteCode]
    )
  ]);

  const statusMap = counts.rows.reduce<Record<string, number>>((acc, row) => {
    acc[String(row.status)] = Number(row.count);
    return acc;
  }, {});

  return {
    siteCode: safeSiteCode,
    generatedAt: new Date().toISOString(),
    backlog: {
      open: statusMap.open ?? 0,
      assigned: statusMap.assigned ?? 0,
      inProgress: statusMap.in_progress ?? 0,
      blocked: statusMap.blocked ?? 0,
      pendingApproval: statusMap.pending_approval ?? 0,
      approved: statusMap.approved ?? 0,
      closed: statusMap.closed ?? 0
    },
    overdue: overdue.rows,
    blocked: blocked.rows,
    pendingApprovals: pendingApprovals.rows,
    assigneeLoad: byAssignee.rows
  };
}

export async function getWorkOrderAttribution(siteCode: string, hours: number) {
  const safeSiteCode = toSiteCode(siteCode);
  const safeHours = Math.max(24, Math.min(hours, 24 * 30));

  const [byMachine, byDepartment] = await Promise.all([
    pool.query(
      `
        SELECT
          COALESCE(machine_code, 'UNKNOWN') AS "machineCode",
          COUNT(*)::int AS "workOrders",
          SUM(actual_cost)::float AS "actualCost",
          SUM(downtime_hours)::float AS "downtimeHours"
        FROM work_orders
        WHERE site_code = $1
          AND created_at >= NOW() - ($2::int * INTERVAL '1 hour')
        GROUP BY COALESCE(machine_code, 'UNKNOWN')
        ORDER BY "actualCost" DESC, "downtimeHours" DESC
        LIMIT 50
      `,
      [safeSiteCode, safeHours]
    ),
    pool.query(
      `
        SELECT
          department,
          COUNT(*)::int AS "workOrders",
          SUM(actual_cost)::float AS "actualCost",
          SUM(downtime_hours)::float AS "downtimeHours"
        FROM work_orders
        WHERE site_code = $1
          AND created_at >= NOW() - ($2::int * INTERVAL '1 hour')
        GROUP BY department
        ORDER BY "actualCost" DESC, "downtimeHours" DESC
      `,
      [safeSiteCode, safeHours]
    )
  ]);

  return {
    siteCode: safeSiteCode,
    windowHours: safeHours,
    byMachine: byMachine.rows,
    byDepartment: byDepartment.rows
  };
}

export async function getRoleScorecard(siteCode: string, user: { id: string; roles: string[]; permissions: string[] }, days: number) {
  const safeSiteCode = toSiteCode(siteCode);
  const safeDays = Math.max(1, Math.min(days, 90));

  const isExecutive = user.permissions.includes("system.admin") || user.roles.includes("admin");
  const isSupervisor = user.roles.includes("manager") || isExecutive;

  const [siteTotals, myTotals] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS "totalWorkOrders",
          SUM(CASE WHEN status <> 'closed' THEN 1 ELSE 0 END)::int AS "activeWorkOrders",
          SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END)::int AS "pendingApprovals",
          SUM(CASE WHEN status <> 'closed' AND due_at IS NOT NULL AND due_at < NOW() THEN 1 ELSE 0 END)::int AS "overdueWorkOrders",
          SUM(actual_cost)::float AS "actualCost",
          SUM(downtime_hours)::float AS "downtimeHours"
        FROM work_orders
        WHERE site_code = $1
          AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
      `,
      [safeSiteCode, safeDays]
    ),
    pool.query(
      `
        SELECT
          COUNT(*)::int AS "myRaised",
          SUM(CASE WHEN status <> 'closed' THEN 1 ELSE 0 END)::int AS "myOpen",
          SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END)::int AS "myClosed"
        FROM work_orders
        WHERE site_code = $1
          AND requested_by = $2
          AND created_at >= NOW() - ($3::int * INTERVAL '1 day')
      `,
      [safeSiteCode, user.id, safeDays]
    )
  ]);

  const site = siteTotals.rows[0] ?? {};
  const my = myTotals.rows[0] ?? {};

  const roleView = isExecutive ? "executive" : isSupervisor ? "supervisor" : "operator";

  return {
    siteCode: safeSiteCode,
    days: safeDays,
    roleView,
    cards: {
      activeWorkOrders: Number(site.activeWorkOrders ?? 0),
      pendingApprovals: Number(site.pendingApprovals ?? 0),
      overdueWorkOrders: Number(site.overdueWorkOrders ?? 0),
      totalActualCost: round(Number(site.actualCost ?? 0)),
      totalDowntimeHours: round(Number(site.downtimeHours ?? 0)),
      myRaised: Number(my.myRaised ?? 0),
      myOpen: Number(my.myOpen ?? 0),
      myClosed: Number(my.myClosed ?? 0)
    }
  };
}

export async function listWorkOrderEvents(workOrderId: number) {
  const result = await pool.query(
    `
      SELECT
        id,
        event_type AS "eventType",
        message,
        actor_user_id AS "actorUserId",
        metadata,
        created_at AS "createdAt"
      FROM work_order_events
      WHERE work_order_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `,
    [workOrderId]
  );

  return { items: result.rows };
}

export async function getWorkflowBoard(siteCode: string, limit = 200) {
  const safeSiteCode = toSiteCode(siteCode);
  const safeLimit = Math.max(20, Math.min(limit, 400));

  const result = await pool.query(
    `
      WITH checklist AS (
        SELECT
          work_order_id,
          COUNT(*)::int AS total,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)::int AS done
        FROM work_order_checklist_items
        GROUP BY work_order_id
      ),
      comments AS (
        SELECT
          work_order_id,
          COUNT(*)::int AS total
        FROM work_order_comments
        GROUP BY work_order_id
      ),
      deps AS (
        SELECT
          d.work_order_id,
          COUNT(*)::int AS total,
          SUM(CASE WHEN dep.status <> 'closed' THEN 1 ELSE 0 END)::int AS blocked
        FROM work_order_dependencies d
        JOIN work_orders dep ON dep.id = d.depends_on_work_order_id
        GROUP BY d.work_order_id
      )
      SELECT
        wo.id,
        wo.work_order_code AS "workOrderCode",
        wo.title,
        wo.priority,
        wo.status,
        wo.department,
        wo.assigned_to_name AS "assignedToName",
        wo.due_at AS "dueAt",
        wo.updated_at AS "updatedAt",
        COALESCE(checklist.total, 0)::int AS "checklistTotal",
        COALESCE(checklist.done, 0)::int AS "checklistDone",
        COALESCE(comments.total, 0)::int AS "commentsTotal",
        COALESCE(deps.total, 0)::int AS "dependenciesTotal",
        COALESCE(deps.blocked, 0)::int AS "dependenciesBlocked"
      FROM work_orders wo
      LEFT JOIN checklist ON checklist.work_order_id = wo.id
      LEFT JOIN comments ON comments.work_order_id = wo.id
      LEFT JOIN deps ON deps.work_order_id = wo.id
      WHERE wo.site_code = $1
      ORDER BY
        CASE wo.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        COALESCE(wo.due_at, NOW() + INTERVAL '365 days'),
        wo.updated_at DESC
      LIMIT $2
    `,
    [safeSiteCode, safeLimit]
  );

  const lanes: Record<string, Array<Record<string, unknown>>> = {
    open: [],
    assigned: [],
    in_progress: [],
    blocked: [],
    pending_approval: [],
    approved: [],
    closed: []
  };

  for (const row of result.rows) {
    const status = String(row.status);
    if (!lanes[status]) {
      lanes[status] = [];
    }
    lanes[status].push(row);
  }

  return {
    siteCode: safeSiteCode,
    generatedAt: new Date().toISOString(),
    lanes,
    items: result.rows
  };
}

export async function listChecklistItems(workOrderId: number) {
  const result = await pool.query(
    `
      SELECT
        id,
        work_order_id AS "workOrderId",
        title,
        status,
        assignee_name AS "assigneeName",
        due_at AS "dueAt",
        completed_at AS "completedAt",
        completed_by AS "completedBy",
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM work_order_checklist_items
      WHERE work_order_id = $1
      ORDER BY sort_order ASC, created_at ASC
    `,
    [workOrderId]
  );

  return { items: result.rows };
}

export async function createChecklistItem(
  workOrderId: number,
  input: { title: string; assigneeName?: string; dueAt?: string },
  actorUserId: string
) {
  const created = await pool.query(
    `
      INSERT INTO work_order_checklist_items(
        work_order_id,
        title,
        status,
        assignee_name,
        due_at,
        sort_order,
        created_by,
        updated_at
      )
      VALUES(
        $1,
        $2,
        'todo',
        $3,
        $4::timestamptz,
        COALESCE((SELECT MAX(sort_order) + 1 FROM work_order_checklist_items WHERE work_order_id = $1), 1),
        $5,
        NOW()
      )
      RETURNING
        id,
        work_order_id AS "workOrderId",
        title,
        status,
        assignee_name AS "assigneeName",
        due_at AS "dueAt",
        completed_at AS "completedAt",
        completed_by AS "completedBy",
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [workOrderId, input.title, input.assigneeName ?? null, input.dueAt ?? null, actorUserId]
  );

  await addWorkOrderEvent(workOrderId, "checklist_item_created", `Checklist item added: ${input.title}`, actorUserId, {
    checklistItemId: Number(created.rows[0]?.id)
  });

  return created.rows[0] ?? null;
}

export async function updateChecklistItemStatus(
  workOrderId: number,
  checklistItemId: number,
  status: "todo" | "done",
  actorUserId: string
) {
  const updated = await pool.query(
    `
      UPDATE work_order_checklist_items
      SET
        status = $3,
        completed_at = CASE WHEN $3 = 'done' THEN NOW() ELSE NULL END,
        completed_by = CASE WHEN $3 = 'done' THEN $4::uuid ELSE NULL END,
        updated_at = NOW()
      WHERE id = $2
        AND work_order_id = $1
      RETURNING
        id,
        work_order_id AS "workOrderId",
        title,
        status,
        assignee_name AS "assigneeName",
        due_at AS "dueAt",
        completed_at AS "completedAt",
        completed_by AS "completedBy",
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [workOrderId, checklistItemId, status, actorUserId]
  );

  const row = updated.rows[0] ?? null;
  if (!row) {
    return null;
  }

  await addWorkOrderEvent(
    workOrderId,
    "checklist_item_updated",
    `Checklist item ${checklistItemId} marked ${status}`,
    actorUserId,
    { checklistItemId, status }
  );

  return row;
}

export async function listWorkOrderComments(workOrderId: number, limit = 100) {
  const safeLimit = Math.max(10, Math.min(limit, 300));
  const result = await pool.query(
    `
      SELECT
        c.id,
        c.work_order_id AS "workOrderId",
        c.author_user_id AS "authorUserId",
        u.email AS "authorEmail",
        c.message,
        c.created_at AS "createdAt"
      FROM work_order_comments c
      LEFT JOIN users u ON u.id = c.author_user_id
      WHERE c.work_order_id = $1
      ORDER BY c.created_at DESC
      LIMIT $2
    `,
    [workOrderId, safeLimit]
  );

  return { items: result.rows };
}

export async function createWorkOrderComment(workOrderId: number, message: string, actorUserId: string) {
  const created = await pool.query(
    `
      INSERT INTO work_order_comments(work_order_id, author_user_id, message)
      VALUES($1, $2, $3)
      RETURNING
        id,
        work_order_id AS "workOrderId",
        author_user_id AS "authorUserId",
        message,
        created_at AS "createdAt"
    `,
    [workOrderId, actorUserId, message]
  );

  await addWorkOrderEvent(workOrderId, "comment_added", "Workflow comment added", actorUserId, {
    commentId: Number(created.rows[0]?.id)
  });

  return created.rows[0] ?? null;
}

export async function listWorkOrderDependencies(workOrderId: number) {
  const result = await pool.query(
    `
      SELECT
        d.work_order_id AS "workOrderId",
        d.depends_on_work_order_id AS "dependsOnWorkOrderId",
        wo.work_order_code AS "dependsOnWorkOrderCode",
        wo.title AS "dependsOnTitle",
        wo.status AS "dependsOnStatus",
        d.created_at AS "createdAt"
      FROM work_order_dependencies d
      JOIN work_orders wo ON wo.id = d.depends_on_work_order_id
      WHERE d.work_order_id = $1
      ORDER BY d.created_at DESC
    `,
    [workOrderId]
  );

  return { items: result.rows };
}

export async function addWorkOrderDependency(workOrderId: number, dependsOnWorkOrderId: number, actorUserId: string) {
  const inserted = await pool.query(
    `
      INSERT INTO work_order_dependencies(work_order_id, depends_on_work_order_id, created_by)
      VALUES($1, $2, $3)
      ON CONFLICT (work_order_id, depends_on_work_order_id) DO NOTHING
      RETURNING work_order_id AS "workOrderId", depends_on_work_order_id AS "dependsOnWorkOrderId", created_at AS "createdAt"
    `,
    [workOrderId, dependsOnWorkOrderId, actorUserId]
  );

  const row = inserted.rows[0] ?? null;
  if (row) {
    await addWorkOrderEvent(workOrderId, "dependency_added", `Dependency added: ${dependsOnWorkOrderId}`, actorUserId, {
      dependsOnWorkOrderId
    });
  }

  return row;
}

export async function removeWorkOrderDependency(workOrderId: number, dependsOnWorkOrderId: number, actorUserId: string) {
  const removed = await pool.query(
    `
      DELETE FROM work_order_dependencies
      WHERE work_order_id = $1
        AND depends_on_work_order_id = $2
      RETURNING work_order_id AS "workOrderId", depends_on_work_order_id AS "dependsOnWorkOrderId"
    `,
    [workOrderId, dependsOnWorkOrderId]
  );

  const row = removed.rows[0] ?? null;
  if (row) {
    await addWorkOrderEvent(workOrderId, "dependency_removed", `Dependency removed: ${dependsOnWorkOrderId}`, actorUserId, {
      dependsOnWorkOrderId
    });
  }

  return row;
}
