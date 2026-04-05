import { Router } from "express";
import path from "path";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requirePermission } from "../middleware/auth.js";
import { PERMISSIONS } from "../permissions.js";
import { getUserSiteRole, hasRequiredSiteRole } from "../services/siteAccessService.js";
import {
  createSlaRule,
  evaluateWorkOrderSlaBreaches,
  generateExecutiveShiftReportPdf,
  getWorkOrderAttachment,
  listEscalations,
  listSlaRules,
  listWorkOrderAttachments,
  retryPendingEscalations,
  runExecutiveShiftReportDispatch,
  updateSlaRule,
  uploadWorkOrderAttachment,
} from "../services/workOrderExecutionService.js";
import {
  approveWorkOrder,
  addWorkOrderDependency,
  createChecklistItem,
  createWorkOrderComment,
  closeWorkOrder,
  createWorkOrder,
  getRoleScorecard,
  getShiftCommandBoard,
  getWorkflowBoard,
  getWorkOrderAttribution,
  getWorkOrderById,
  listChecklistItems,
  listWorkOrderComments,
  listWorkOrderDependencies,
  listWorkOrderEvents,
  listWorkOrders,
  removeWorkOrderDependency,
  requestWorkOrderApproval,
  updateChecklistItemStatus,
  updateWorkOrder
} from "../services/workOrderService.js";

export const workOrdersRouter = Router();

const listQuerySchema = z.object({
  siteCode: z.string().min(2).max(20).optional().default("SITE-A"),
  status: z.enum(["open", "assigned", "in_progress", "blocked", "pending_approval", "approved", "closed"]).optional(),
  limit: z.coerce.number().min(10).max(200).optional().default(80)
});

const createSchema = z.object({
  siteCode: z.string().min(2).max(20),
  department: z.string().min(2).max(40).default("operations"),
  machineCode: z.string().min(2).max(40).optional(),
  faultCode: z.string().min(2).max(40).optional(),
  title: z.string().min(6).max(180),
  description: z.string().max(4000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  assignedToName: z.string().max(120).optional(),
  dueAt: z.string().optional(),
  estimatedCost: z.coerce.number().min(0).max(100000000).default(0),
  downtimeHours: z.coerce.number().min(0).max(10000).default(0)
});

const idParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const updateSchema = z.object({
  title: z.string().min(6).max(180).optional(),
  description: z.string().max(4000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["open", "assigned", "in_progress", "blocked", "pending_approval", "approved", "closed"]).optional(),
  assignedToName: z.string().max(120).optional(),
  dueAt: z.string().nullable().optional(),
  actualCost: z.coerce.number().min(0).max(100000000).optional(),
  downtimeHours: z.coerce.number().min(0).max(10000).optional(),
  evidenceNotes: z.string().max(4000).optional()
});

const requestApprovalSchema = z.object({
  reason: z.string().max(500).optional()
});

const approveSchema = z.object({
  notes: z.string().max(500).optional()
});

const closeSchema = z.object({
  actualCost: z.coerce.number().min(0).max(100000000).optional(),
  downtimeHours: z.coerce.number().min(0).max(10000).optional(),
  evidenceNotes: z.string().max(4000).optional()
});

const attributionQuerySchema = z.object({
  siteCode: z.string().min(2).max(20).optional().default("SITE-A"),
  hours: z.coerce.number().min(24).max(24 * 30).optional().default(24 * 7)
});

const scorecardQuerySchema = z.object({
  siteCode: z.string().min(2).max(20).optional().default("SITE-A"),
  days: z.coerce.number().min(1).max(90).optional().default(30)
});

const slaRuleSchema = z.object({
  siteCode: z.string().min(2).max(20),
  name: z.string().min(3).max(120),
  enabled: z.boolean().default(true),
  appliesPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
  appliesDepartment: z.string().min(2).max(40).optional(),
  breachAfterHours: z.coerce.number().min(0.5).max(24 * 30),
  escalationChannel: z.enum(["email", "teams_webhook", "whatsapp_webhook"]).default("email"),
  escalationRecipient: z.string().min(4).max(300),
  autoRequestApproval: z.boolean().default(true)
});

const slaRuleUpdateSchema = slaRuleSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required"
});

const attachmentUploadSchema = z.object({
  fileName: z.string().min(1).max(180),
  mimeType: z.string().min(3).max(120),
  contentBase64: z.string().min(10),
  notes: z.string().max(1000).optional()
});

const checklistCreateSchema = z.object({
  title: z.string().min(2).max(200),
  assigneeName: z.string().max(120).optional(),
  dueAt: z.string().optional()
});

const checklistUpdateSchema = z.object({
  status: z.enum(["todo", "done"])
});

const commentsCreateSchema = z.object({
  message: z.string().min(1).max(4000)
});

const dependencyCreateSchema = z.object({
  dependsOnWorkOrderId: z.coerce.number().int().positive()
});

const dependencyParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  dependsOnId: z.coerce.number().int().positive()
});

const checklistParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive()
});

function normalizeSiteCode(siteCode?: string | null) {
  const safe = (siteCode ?? "SITE-A").trim().toUpperCase();
  return safe.length > 0 ? safe : "SITE-A";
}

async function ensureSiteRole(
  req: any,
  res: any,
  requiredRole: "viewer" | "operator" | "manager" | "admin",
  siteCodeRaw?: string
) {
  const siteCode = normalizeSiteCode(siteCodeRaw);
  const isSystemAdmin = req.user?.permissions.includes(PERMISSIONS.systemAdmin) ?? false;
  if (isSystemAdmin) {
    return { allowed: true, siteCode };
  }

  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return { allowed: false, siteCode };
  }

  const role = await getUserSiteRole(userId, siteCode);
  if (!hasRequiredSiteRole(role, requiredRole)) {
    res.status(403).json({ error: "Forbidden", siteCode, requiredRole });
    return { allowed: false, siteCode };
  }

  return { allowed: true, siteCode };
}

workOrdersRouter.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const result = await listWorkOrders({
    siteCode: access.siteCode,
    status: parsed.data.status,
    limit: parsed.data.limit
  });

  return res.json(result);
});

workOrdersRouter.get("/workflow/board", async (req, res) => {
  const parsed = z.object({
    siteCode: z.string().min(2).max(20).optional().default("SITE-A"),
    limit: z.coerce.number().min(20).max(400).optional().default(200)
  }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const board = await getWorkflowBoard(access.siteCode, parsed.data.limit);
  return res.json(board);
});

workOrdersRouter.get("/sla-rules", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const rules = await listSlaRules(access.siteCode);
  return res.json(rules);
});

workOrdersRouter.post("/sla-rules", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsed = slaRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "manager", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const created = await createSlaRule({
    ...parsed.data,
    siteCode: access.siteCode
  });

  return res.status(201).json(created);
});

workOrdersRouter.patch("/sla-rules/:id", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  const parsedBody = slaRuleUpdateSchema.safeParse(req.body ?? {});
  if (!parsedId.success || !parsedBody.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: parsedId.success ? null : parsedId.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      }
    });
  }

  if (parsedBody.data.siteCode) {
    const access = await ensureSiteRole(req, res, "manager", parsedBody.data.siteCode);
    if (!access.allowed) {
      return;
    }
  }

  const updated = await updateSlaRule(parsedId.data.id, parsedBody.data);
  if (!updated) {
    return res.status(404).json({ error: "SLA rule not found" });
  }

  return res.json(updated);
});

workOrdersRouter.post("/sla-evaluate/run", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsed = z.object({ siteCode: z.string().min(2).max(20).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  if (parsed.data.siteCode) {
    const access = await ensureSiteRole(req, res, "manager", parsed.data.siteCode);
    if (!access.allowed) {
      return;
    }
  }

  const result = await evaluateWorkOrderSlaBreaches({ siteCode: parsed.data.siteCode, triggeredBy: "manual" });
  return res.json(result);
});

workOrdersRouter.get("/escalations", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const result = await listEscalations(access.siteCode, parsed.data.limit);
  return res.json(result);
});

workOrdersRouter.post("/escalations/retry-run", requirePermission(PERMISSIONS.operationsWrite), async (_req, res) => {
  const result = await retryPendingEscalations(100);
  return res.json(result);
});

workOrdersRouter.post("/reports/executive/pdf", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsed = z.object({ siteCode: z.string().min(2).max(20).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "manager", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const report = await generateExecutiveShiftReportPdf({
    siteCode: access.siteCode,
    requestedBy: req.user!.id,
    triggeredBy: "manual"
  });

  return res.status(201).json({
    ...report,
    downloadUrl: `/api/work-orders/reports/executive/pdf/${report.artifactId}/download`
  });
});

workOrdersRouter.post("/reports/executive/pdf/dispatch", requirePermission(PERMISSIONS.operationsWrite), async (_req, res) => {
  const result = await runExecutiveShiftReportDispatch("manual");
  return res.json(result);
});

workOrdersRouter.get("/reports/executive/pdf/:id/download", async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  if (!parsedId.success) {
    return res.status(400).json({ error: "Invalid id", details: parsedId.error.flatten() });
  }

  const artifact = await pool.query(
    `
      SELECT id, site_code AS "siteCode", file_name AS "fileName", file_path AS "filePath"
      FROM export_artifacts
      WHERE id = $1
        AND artifact_type = 'executive_shift_report_pdf'
      LIMIT 1
    `,
    [parsedId.data.id]
  );

  const row = artifact.rows[0];
  if (!row) {
    return res.status(404).json({ error: "Report not found" });
  }

  const access = await ensureSiteRole(req, res, "viewer", String(row.siteCode));
  if (!access.allowed) {
    return;
  }

  return res.download(path.resolve(String(row.filePath)), String(row.fileName));
});

workOrdersRouter.post("/", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "operator", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const created = await createWorkOrder(
    {
      ...parsed.data,
      siteCode: access.siteCode,
      department: parsed.data.department.toLowerCase()
    },
    req.user!.id
  );

  return res.status(201).json(created);
});

workOrdersRouter.patch("/:id", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  const parsedBody = updateSchema.safeParse(req.body ?? {});

  if (!parsedId.success || !parsedBody.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: parsedId.success ? null : parsedId.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      }
    });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "operator", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const updated = await updateWorkOrder(parsedId.data.id, parsedBody.data, req.user!.id);
  return res.json(updated);
});

workOrdersRouter.post("/:id/request-approval", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  const parsedBody = requestApprovalSchema.safeParse(req.body ?? {});

  if (!parsedId.success || !parsedBody.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: parsedId.success ? null : parsedId.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      }
    });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "operator", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const updated = await requestWorkOrderApproval(parsedId.data.id, req.user!.id, parsedBody.data.reason);
  return res.json(updated);
});

workOrdersRouter.post("/:id/approve", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  const parsedBody = approveSchema.safeParse(req.body ?? {});

  if (!parsedId.success || !parsedBody.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: parsedId.success ? null : parsedId.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      }
    });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "manager", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const updated = await approveWorkOrder(parsedId.data.id, req.user!.id, parsedBody.data.notes);
  return res.json(updated);
});

workOrdersRouter.post("/:id/close", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  const parsedBody = closeSchema.safeParse(req.body ?? {});

  if (!parsedId.success || !parsedBody.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: parsedId.success ? null : parsedId.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      }
    });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "operator", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const closed = await closeWorkOrder(parsedId.data.id, req.user!.id, parsedBody.data);
  if ("error" in closed && closed.error === "approval_required") {
    return res.status(409).json({ error: "Supervisor approval required before close" });
  }

  if ("error" in closed) {
    return res.status(404).json({ error: "Work order not found" });
  }

  return res.json(closed.item);
});

workOrdersRouter.post("/:id/attachments", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  const parsedBody = attachmentUploadSchema.safeParse(req.body ?? {});
  if (!parsedId.success || !parsedBody.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: parsedId.success ? null : parsedId.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      }
    });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "operator", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const uploaded = await uploadWorkOrderAttachment({
    workOrderId: parsedId.data.id,
    fileName: parsedBody.data.fileName,
    mimeType: parsedBody.data.mimeType,
    contentBase64: parsedBody.data.contentBase64,
    notes: parsedBody.data.notes,
    uploadedBy: req.user!.id
  });

  if (!uploaded) {
    return res.status(404).json({ error: "Work order not found" });
  }

  return res.status(201).json(uploaded);
});

workOrdersRouter.get("/:id/attachments", async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  if (!parsedId.success) {
    return res.status(400).json({ error: "Invalid id", details: parsedId.error.flatten() });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "viewer", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const attachments = await listWorkOrderAttachments(parsedId.data.id);
  return res.json(attachments);
});

workOrdersRouter.get("/:id/attachments/:attachmentId/download", async (req, res) => {
  const parsed = z.object({
    id: z.coerce.number().int().positive(),
    attachmentId: z.coerce.number().int().positive()
  }).safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
  }

  const existing = await getWorkOrderById(parsed.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "viewer", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const attachment = await getWorkOrderAttachment(parsed.data.attachmentId);
  if (!attachment || Number(attachment.workOrderId) !== parsed.data.id) {
    return res.status(404).json({ error: "Attachment not found" });
  }

  return res.download(path.resolve(String(attachment.filePath)), String(attachment.fileName));
});

workOrdersRouter.get("/:id/events", async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  if (!parsedId.success) {
    return res.status(400).json({ error: "Invalid id", details: parsedId.error.flatten() });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "viewer", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const events = await listWorkOrderEvents(parsedId.data.id);
  return res.json(events);
});

workOrdersRouter.get("/:id/checklist", async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  if (!parsedId.success) {
    return res.status(400).json({ error: "Invalid id", details: parsedId.error.flatten() });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "viewer", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const items = await listChecklistItems(parsedId.data.id);
  return res.json(items);
});

workOrdersRouter.post("/:id/checklist", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  const parsedBody = checklistCreateSchema.safeParse(req.body ?? {});
  if (!parsedId.success || !parsedBody.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: parsedId.success ? null : parsedId.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      }
    });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "operator", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const created = await createChecklistItem(parsedId.data.id, parsedBody.data, req.user!.id);
  return res.status(201).json(created);
});

workOrdersRouter.patch("/:id/checklist/:itemId", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsedParams = checklistParamsSchema.safeParse(req.params);
  const parsedBody = checklistUpdateSchema.safeParse(req.body ?? {});
  if (!parsedParams.success || !parsedBody.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: parsedParams.success ? null : parsedParams.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      }
    });
  }

  const existing = await getWorkOrderById(parsedParams.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "operator", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const updated = await updateChecklistItemStatus(
    parsedParams.data.id,
    parsedParams.data.itemId,
    parsedBody.data.status,
    req.user!.id
  );
  if (!updated) {
    return res.status(404).json({ error: "Checklist item not found" });
  }

  return res.json(updated);
});

workOrdersRouter.get("/:id/comments", async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  const parsedQuery = z.object({ limit: z.coerce.number().min(10).max(300).optional().default(100) }).safeParse(req.query);
  if (!parsedId.success || !parsedQuery.success) {
    return res.status(400).json({
      error: "Invalid query",
      details: {
        params: parsedId.success ? null : parsedId.error.flatten(),
        query: parsedQuery.success ? null : parsedQuery.error.flatten()
      }
    });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "viewer", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const comments = await listWorkOrderComments(parsedId.data.id, parsedQuery.data.limit);
  return res.json(comments);
});

workOrdersRouter.post("/:id/comments", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  const parsedBody = commentsCreateSchema.safeParse(req.body ?? {});
  if (!parsedId.success || !parsedBody.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: parsedId.success ? null : parsedId.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      }
    });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "operator", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const comment = await createWorkOrderComment(parsedId.data.id, parsedBody.data.message, req.user!.id);
  return res.status(201).json(comment);
});

workOrdersRouter.get("/:id/dependencies", async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  if (!parsedId.success) {
    return res.status(400).json({ error: "Invalid id", details: parsedId.error.flatten() });
  }

  const existing = await getWorkOrderById(parsedId.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "viewer", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const deps = await listWorkOrderDependencies(parsedId.data.id);
  return res.json(deps);
});

workOrdersRouter.post("/:id/dependencies", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsedId = idParamsSchema.safeParse(req.params);
  const parsedBody = dependencyCreateSchema.safeParse(req.body ?? {});
  if (!parsedId.success || !parsedBody.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: {
        params: parsedId.success ? null : parsedId.error.flatten(),
        body: parsedBody.success ? null : parsedBody.error.flatten()
      }
    });
  }

  if (parsedId.data.id === parsedBody.data.dependsOnWorkOrderId) {
    return res.status(400).json({ error: "Work order cannot depend on itself" });
  }

  const [existing, dependsOn] = await Promise.all([
    getWorkOrderById(parsedId.data.id),
    getWorkOrderById(parsedBody.data.dependsOnWorkOrderId)
  ]);

  if (!existing || !dependsOn) {
    return res.status(404).json({ error: "Work order or dependency target not found" });
  }

  if (String(existing.siteCode) !== String(dependsOn.siteCode)) {
    return res.status(400).json({ error: "Dependencies must belong to the same site" });
  }

  const access = await ensureSiteRole(req, res, "operator", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const added = await addWorkOrderDependency(parsedId.data.id, parsedBody.data.dependsOnWorkOrderId, req.user!.id);
  if (!added) {
    return res.status(200).json({ added: false, message: "Dependency already exists" });
  }

  return res.status(201).json(added);
});

workOrdersRouter.delete("/:id/dependencies/:dependsOnId", requirePermission(PERMISSIONS.operationsWrite), async (req, res) => {
  const parsed = dependencyParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid params", details: parsed.error.flatten() });
  }

  const existing = await getWorkOrderById(parsed.data.id);
  if (!existing) {
    return res.status(404).json({ error: "Work order not found" });
  }

  const access = await ensureSiteRole(req, res, "operator", String(existing.siteCode));
  if (!access.allowed) {
    return;
  }

  const removed = await removeWorkOrderDependency(parsed.data.id, parsed.data.dependsOnId, req.user!.id);
  if (!removed) {
    return res.status(404).json({ error: "Dependency not found" });
  }

  return res.json({ removed: true });
});

workOrdersRouter.get("/board/shift", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const board = await getShiftCommandBoard(access.siteCode);
  return res.json(board);
});

workOrdersRouter.get("/attribution/cost-downtime", async (req, res) => {
  const parsed = attributionQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const attribution = await getWorkOrderAttribution(access.siteCode, parsed.data.hours);
  return res.json(attribution);
});

workOrdersRouter.get("/scorecard/role", async (req, res) => {
  const parsed = scorecardQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const access = await ensureSiteRole(req, res, "viewer", parsed.data.siteCode);
  if (!access.allowed) {
    return;
  }

  const scorecard = await getRoleScorecard(access.siteCode, req.user!, parsed.data.days);
  return res.json(scorecard);
});
