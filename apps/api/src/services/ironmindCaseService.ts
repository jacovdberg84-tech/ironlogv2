import { pool } from "../db/pool.js";

type CreateCaseInput = {
  machineCode: string;
  faultCode: string;
  severity: "low" | "warning" | "high" | "critical";
  title: string;
  description?: string;
  ownerName?: string;
  openedBy: string;
};

type AddActionInput = {
  caseId: number;
  actionTitle: string;
  ownerName?: string;
  dueAt?: string;
  notes?: string;
  createdBy: string;
};

type UpdateActionInput = {
  caseId: number;
  actionId: number;
  status?: "todo" | "in_progress" | "blocked" | "done";
  ownerName?: string;
  dueAt?: string;
  notes?: string;
};

const caseSelectSql = `
  SELECT
    c.id,
    c.case_code AS "caseCode",
    c.machine_code AS "machineCode",
    c.fault_code AS "faultCode",
    c.severity,
    c.status,
    c.title,
    c.description,
    c.owner_name AS "ownerName",
    c.opened_at AS "openedAt",
    c.closed_at AS "closedAt",
    c.closure_summary AS "closureSummary",
    opener.email AS "openedByEmail"
  FROM ironmind_investigation_cases c
  LEFT JOIN users opener ON opener.id = c.opened_by
`;

export async function listInvestigationCases(limit: number, status?: string) {
  const safeLimit = Math.max(10, Math.min(limit, 200));
  const params: unknown[] = [];

  let where = "";
  if (status) {
    params.push(status);
    where = `WHERE c.status = $${params.length}`;
  }

  params.push(safeLimit);
  const result = await pool.query(
    `${caseSelectSql}
     ${where}
     ORDER BY c.opened_at DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows;
}

export async function getInvestigationCase(caseId: number) {
  const caseResult = await pool.query(`${caseSelectSql} WHERE c.id = $1 LIMIT 1`, [caseId]);
  const investigationCase = caseResult.rows[0];
  if (!investigationCase) {
    return null;
  }

  const actionsResult = await pool.query(
    `
      SELECT
        id,
        action_title AS "actionTitle",
        owner_name AS "ownerName",
        due_at AS "dueAt",
        status,
        notes,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ironmind_case_actions
      WHERE case_id = $1
      ORDER BY created_at ASC
    `,
    [caseId]
  );

  return {
    ...investigationCase,
    actions: actionsResult.rows
  };
}

export async function createInvestigationCase(input: CreateCaseInput) {
  const caseCode = `IMC-${Date.now().toString().slice(-8)}`;

  const result = await pool.query(
    `
      INSERT INTO ironmind_investigation_cases(
        case_code, machine_code, fault_code, severity, status, title, description, owner_name, opened_by
      )
      VALUES($1, $2, $3, $4, 'open', $5, $6, $7, $8)
      RETURNING id
    `,
    [
      caseCode,
      input.machineCode,
      input.faultCode,
      input.severity,
      input.title,
      input.description ?? null,
      input.ownerName ?? null,
      input.openedBy
    ]
  );

  const id = result.rows[0]?.id as number;
  return getInvestigationCase(id);
}

export async function addInvestigationAction(input: AddActionInput) {
  await pool.query(
    `
      INSERT INTO ironmind_case_actions(case_id, action_title, owner_name, due_at, status, notes, created_by)
      VALUES($1, $2, $3, $4::timestamptz, 'todo', $5, $6)
    `,
    [
      input.caseId,
      input.actionTitle,
      input.ownerName ?? null,
      input.dueAt ?? null,
      input.notes ?? null,
      input.createdBy
    ]
  );

  await pool.query(`UPDATE ironmind_investigation_cases SET updated_at = NOW() WHERE id = $1`, [input.caseId]);

  return getInvestigationCase(input.caseId);
}

export async function updateInvestigationAction(input: UpdateActionInput) {
  await pool.query(
    `
      UPDATE ironmind_case_actions
      SET
        status = COALESCE($1, status),
        owner_name = COALESCE($2, owner_name),
        due_at = COALESCE($3::timestamptz, due_at),
        notes = COALESCE($4, notes),
        updated_at = NOW()
      WHERE id = $5 AND case_id = $6
    `,
    [input.status ?? null, input.ownerName ?? null, input.dueAt ?? null, input.notes ?? null, input.actionId, input.caseId]
  );

  await pool.query(`UPDATE ironmind_investigation_cases SET updated_at = NOW() WHERE id = $1`, [input.caseId]);
  return getInvestigationCase(input.caseId);
}

export async function closeInvestigationCase(caseId: number, closureSummary?: string) {
  await pool.query(
    `
      UPDATE ironmind_investigation_cases
      SET
        status = 'closed',
        closed_at = NOW(),
        closure_summary = COALESCE($2, closure_summary),
        updated_at = NOW()
      WHERE id = $1
    `,
    [caseId, closureSummary ?? null]
  );

  return getInvestigationCase(caseId);
}
